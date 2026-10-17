//! Pure production-interface contracts; no database, runtime, or external I/O.
use chrono::{DateTime, NaiveDate, Utc};
use hms_db::clinical::template_render::{
    render, PatientTokens, RenderError, RenderInput, RenderKind, RenderMode, RenderedPatch,
};
use serde_json::{json, Value};

fn now(value: &str) -> DateTime<Utc> {
    value.parse().expect("fixed UTC fixture parses")
}
fn birth(value: &str) -> NaiveDate {
    value.parse().expect("fixed date fixture parses")
}
fn input<'a>(source: &'a str, base_body: &'a str) -> RenderInput<'a> {
    RenderInput {
        source,
        base_body,
        mode: RenderMode::EmptyOnly,
        sections: &[],
        patient: PatientTokens {
            first_name: "Fixture",
            last_name: "Person",
            date_of_birth: Some(birth("2000-10-17")),
            sex: "female",
            mrn: "SYNTHETIC-CODE",
        },
        chief_complaint: Some("Explicit clinician text"),
        now: now("2026-10-17T00:00:00Z"),
    }
}
fn rendered(input: RenderInput<'_>) -> RenderedPatch {
    render(input).unwrap_or_else(|_| panic!("bounded synthetic render succeeds"))
}
fn failure(input: RenderInput<'_>, expected: RenderError) {
    let error = render(input)
        .err()
        .expect("invalid synthetic render is rejected");
    assert_eq!(error, expected);
    assert!(matches!(
        error.to_string().as_str(),
        "invalid_template_render_input"
            | "unsupported_template_render_schema"
            | "template_render_limit_exceeded"
    ));
}
fn source(rows: Value) -> String {
    json!({"sections":rows}).to_string()
}

#[test]
fn eight_allowlisted_tokens_use_one_authoritative_utc_date_and_literal_unicode_values() {
    let text = "{{ PATIENT_NAME }}|{{ patient_first_name }}|{{ patient_last_name }}|{{ age }}|{{ sex }}|{{ mrn }}|{{ today }}|{{ chief_complaint }}";
    let mut request = input(text, "");
    request.patient.first_name = "  Fixturé \"Q\"\nLine  ";
    request.patient.last_name = "  Δelta  ";
    request.chief_complaint = Some("Explicit\n\"quoted\" <b>literal</b>");
    let response = rendered(request);
    assert_eq!(response.kind, RenderKind::Plain);
    let expected = "Fixturé \"Q\"\nLine Δelta|Fixturé \"Q\"\nLine|Δelta|26|female|SYNTHETIC-CODE|2026-10-17|Explicit\n\"quoted\" <b>literal</b>";
    assert!(response.patch == Value::String(expected.into()));
    assert!(response.applied_sections == ["text"]);
    assert!(response.unresolved.is_empty() && !response.unresolved_truncated);
    let mut whitespace = input("{{chief_complaint}}", "");
    whitespace.chief_complaint = Some("  Explicit\ntext  ");
    assert!(rendered(whitespace).patch == "Explicit\ntext");
    // JSON escaping is performed on generated leaf data, never source JSON.
    let encoded = serde_json::to_string(&response.patch).expect("generated leaf encodes");
    assert!(
        serde_json::from_str::<Value>(&encoded).expect("generated JSON decodes") == response.patch
    );
}

#[test]
fn literal_braces_and_non_schema_json_keep_existing_plain_template_meaning() {
    for (source, expected) in [
        ("{broken", "{broken"),
        (
            "{Literal {{patient_name}} note}",
            "{Literal Fixture Person note}",
        ),
        ("[Literal {{patient_first_name}}]", "[Literal Fixture]"),
        (
            r#"{"narrative":"{{patient_first_name}}","metadata":true}"#,
            r#"{"narrative":"Fixture","metadata":true}"#,
        ),
    ] {
        let result = rendered(input(source, ""));
        assert_eq!(result.kind, RenderKind::Plain);
        assert!(
            result.patch == expected,
            "literal text does not become an inferred schema"
        );
    }
}

#[test]
fn introduced_tokens_and_expression_looking_text_are_never_evaluated_or_rescanned() {
    let mut request = input(
        "{{patient_first_name}} {{today}} {{ patient_name.upper() }} {{ 7*7 }}",
        "",
    );
    request.patient.first_name = "{{ mrn }}";
    let response = rendered(request);
    assert!(response.patch == "{{ mrn }} 2026-10-17 {{ patient_name.upper() }} {{ 7*7 }}");
    assert!(response
        .unresolved
        .iter()
        .any(|item| item.name == "unsupported_placeholder" && item.count == 2));
    assert!(!response.unresolved.iter().any(|item| item.name == "mrn"));
}

#[test]
fn missing_and_unknown_placeholders_are_preserved_with_bounded_counts() {
    let mut request = input(
        "{{ age }} / {{chief_complaint}} / {{UNKNOWN}} / {{ unknown }}",
        "",
    );
    request.patient.date_of_birth = None;
    request.chief_complaint = None;
    let response = rendered(request);
    assert!(response.patch == "{{ age }} / {{chief_complaint}} / {{UNKNOWN}} / {{ unknown }}");
    assert!(response
        .unresolved
        .iter()
        .any(|item| item.name == "age" && item.count == 1));
    assert!(response
        .unresolved
        .iter()
        .any(|item| item.name == "chief_complaint" && item.count == 1));
    assert!(response
        .unresolved
        .iter()
        .any(|item| item.name == "unknown" && item.count == 2));
    let text = (0..40)
        .map(|index| format!("{{{{missing_{index}}}}}"))
        .collect::<Vec<_>>()
        .join(" ");
    let response = rendered(input(&text, ""));
    assert_eq!(response.unresolved.len(), 32);
    assert!(
        response.unresolved_truncated
            && response.unresolved.iter().all(|item| item.name.len() <= 64)
    );
    let text = format!("{{{{{}}}}}", "a".repeat(65));
    let response = rendered(input(&text, ""));
    assert!(response.patch == Value::String(text));
    assert!(
        response.unresolved_truncated
            && response.unresolved.iter().all(|item| item.name.len() <= 64)
    );
    assert!(rendered(input("Incomplete {{ patient_name", ""))
        .unresolved
        .iter()
        .any(|item| item.name == "unsupported_placeholder"));
}

#[test]
fn age_uses_completed_years_and_utc_midnight_with_explicit_leap_day_boundary() {
    for (time, birthday, expected) in [
        ("2026-10-16T23:59:59Z", "2000-10-17", "25|2026-10-16"),
        ("2026-10-17T00:00:00Z", "2000-10-17", "26|2026-10-17"),
        ("2025-02-28T23:59:59Z", "2000-02-29", "24|2025-02-28"),
        ("2025-03-01T00:00:00Z", "2000-02-29", "25|2025-03-01"),
        ("2024-02-29T00:00:00Z", "2000-02-29", "24|2024-02-29"),
        ("2026-10-17T00:00:00Z", "2026-10-17", "0|2026-10-17"),
    ] {
        let mut request = input("{{age}}|{{today}}", "");
        request.now = now(time);
        request.patient.date_of_birth = Some(birth(birthday));
        assert!(
            rendered(request).patch == expected,
            "completed-year/date boundary matches fixed server UTC instant"
        );
    }
    let mut request = input("{{age}}", "");
    request.patient.date_of_birth = Some(birth("2027-01-01"));
    let response = rendered(request);
    assert!(
        response.patch == "{{age}}" && response.unresolved.iter().any(|item| item.name == "age")
    );
    let mut request = input("{{patient_name}}/{{patient_first_name}}", "");
    request.patient.first_name = "";
    request.patient.last_name = "";
    assert!(rendered(request).patch == "Patient/{{patient_first_name}}");
}

#[test]
fn structured_envelope_and_array_only_render_known_starter_leaves() {
    let rows = json!([
        {"name":"Review Notes", "type":"structured", "default_text":"Fallback", "subsections":[
            {"name":"Current Finding", "defaultText":"For {{ patient_name }}"},
            {"name":"Plan", "default_text":"Next {{today}}", "extra":"{{mrn}}"},
            {"name":"Unknown Starter", "default_text":{"nested":"{{mrn}}"}}
        ]},
        {"section":"Évaluation 中文", "default_text":"Literal \"{{mrn}}\"\nnext", "metadata":{"code":9007199254740993_u64}},
        {"section":"No starter", "default_text":false},
        {"section":"Subsection fallback", "type":"structured", "default_text":"Fallback {{age}}", "subsections":[{"name":"Missing"}]}
    ]);
    for body in [source(rows.clone()), rows.to_string()] {
        let response = rendered(input(&body, ""));
        assert_eq!(response.kind, RenderKind::Structured);
        assert!(
            response.applied_sections == ["reviewnotes", "évaluation中文", "subsectionfallback"]
        );
        assert!(
            response.patch
                == json!({
                    "reviewnotes":{"current_finding":"For Fixture Person","plan":"Next 2026-10-17"},
                    "évaluation中文":"Literal \"SYNTHETIC-CODE\"\nnext", "subsectionfallback":"Fallback 26"
                })
        );
        assert!(!response.patch.to_string().contains("9007199254740993"));
        assert!(!response.patch.to_string().contains("metadata"));
    }
}

#[test]
fn clinical_artifact_types_produce_narrative_notes_only() {
    let body = source(json!([
        {"section":"Conditions", "type":"condition", "default_text":"Reviewed {{patient_first_name}}"},
        {"section":"Measurements", "type":"observation", "default_text":"Narrative only"},
        {"section":"Medicines", "type":"medication_administration", "default_text":"Documented narrative"},
        {"section":"Custom", "type":"unknown_imported_text_type", "default_text":"Literal"}
    ]));
    let response = rendered(input(&body, ""));
    assert!(
        response.patch
            == json!({"conditions":{"notes":"Reviewed Fixture"},"measurements":{"notes":"Narrative only"},"medicines":{"notes":"Documented narrative"},"custom":"Literal"})
    );
}

#[test]
fn empty_only_preserves_whole_meaningful_sections_including_false_zero_and_nonempty_collections() {
    let names = [
        "falseflag",
        "zerovalue",
        "nonemptyarr",
        "nonemptyobject",
        "emptyarr",
        "emptyobject",
        "nullvalue",
        "blank",
    ];
    let body = source(Value::Array(
        names
            .iter()
            .map(|name| json!({"section":name,"default_text":"Generated"}))
            .collect(),
    ));
    let base = "{\"falseflag\":false,\"zerovalue\":0,\"nonemptyarr\":[null],\"nonemptyobject\":{\"child\":\"\"},\"emptyarr\":[],\"emptyobject\":{},\"nullvalue\":null,\"blank\":\"  \"}";
    let response = rendered(input(&body, base));
    assert!(
        response.patch
            == json!({"emptyarr":"Generated","emptyobject":"Generated","nullvalue":"Generated","blank":"Generated"})
    );
    assert!(response.applied_sections == ["emptyarr", "emptyobject", "nullvalue", "blank"]);
    // A meaningful structured section is preserved entirely, not filled per child.
    let body = source(
        json!([{"section":"review", "type":"structured", "subsections":[{"name":"One","default_text":"A"},{"name":"Two","default_text":"B"}]}]),
    );
    let response = rendered(input(&body, "{\"review\":{\"one\":\"\",\"two\":false}}"));
    assert!(response.patch == json!({}) && response.applied_sections.is_empty());
    let response = rendered(input("New {{today}}", "false"));
    assert!(response.patch == "" && response.applied_sections.is_empty());
}

#[test]
fn overwrite_modes_return_only_explicit_generated_sections_never_base_or_template_metadata() {
    let body = "{\"metadata\":{\"large\":9007199254740993},\"sections\":[{\"section\":\"review\",\"default_text\":\"Generated\"},{\"section\":\"other\",\"default_text\":\"Other\"}]}";
    let base = "  {\"review\":false, \"other\":0, \"_meta\":{\"large\":9007199254740993}, \"untouched\":[true,null]}\n";
    let base_before = base.to_owned();
    let source_before = body.to_owned();
    let mut request = input(body, base);
    request.mode = RenderMode::All;
    assert!(rendered(request).patch == json!({"review":"Generated","other":"Other"}));
    let selected = vec!["other".to_owned()];
    let mut request = input(body, base);
    request.mode = RenderMode::Selected;
    request.sections = &selected;
    let response = rendered(request);
    assert!(response.patch == json!({"other":"Other"}) && response.applied_sections == ["other"]);
    assert!(
        base == base_before && body == source_before,
        "no source/base string can be rewritten by the patch interface"
    );
    let selected = vec!["text".to_owned()];
    let mut request = input("New {{today}}", "Original");
    request.mode = RenderMode::Selected;
    request.sections = &selected;
    assert!(rendered(request).patch == "New 2026-10-17");
}

#[test]
fn selection_requires_unique_existing_canonical_keys() {
    let body = source(json!([{"section":"Review Notes", "default_text":"Starter"}]));
    for values in [
        vec![],
        vec!["Review Notes"],
        vec!["unknown"],
        vec!["reviewnotes", "reviewnotes"],
        vec!["__proto__"],
    ] {
        let values = values.into_iter().map(str::to_owned).collect::<Vec<_>>();
        let mut request = input(&body, "");
        request.mode = RenderMode::Selected;
        request.sections = &values;
        failure(request, RenderError::InvalidInput);
    }
    let values = vec!["reviewnotes".to_owned()];
    let mut request = input(&body, "");
    request.sections = &values;
    failure(request, RenderError::InvalidInput);
    failure(input(&body, "[]"), RenderError::InvalidInput);
    failure(
        input(&body, "{\"Review Notes\":false}"),
        RenderError::InvalidInput,
    );
}

#[test]
fn malformed_historical_schema_collisions_and_prototype_sensitive_keys_are_rejected() {
    for body in [
        "[]", "[null]",
        "{\"sections\":[{\"section\":\"Review\",\"required\":\"yes\"}]}",
        "[{\"section\":\"A B\"},{\"section\":\"a-b\"}]",
        "[{\"section\":\"Review\",\"type\":\"structured\",\"subsections\":[{\"name\":\"Blood Pressure\"},{\"name\":\"blood pressure\"}]}]",
        "[{\"section\":\"Review\",\"type\":\"structured\",\"subsections\":{}}]",
        "[{\"section\":\"__proto__\",\"default_text\":\"value\"}]",
        "[{\"section\":\"constructor\",\"default_text\":\"value\"}]",
        "[{\"section\":\"Review\",\"type\":\"structured\",\"subsections\":[{\"name\":\"__proto__\",\"default_text\":\"value\"}]}]",
    ] { failure(input(body, ""), RenderError::UnsupportedSchema); }
}

fn nested(levels: usize) -> Value {
    (0..levels).fold(Value::Null, |value, _| Value::Array(vec![value]))
}
#[test]
fn source_base_section_depth_and_generated_field_limits_are_enforced() {
    let long = "x".repeat(20_001);
    failure(input(&long, ""), RenderError::LimitExceeded);
    failure(input("Starter", &long), RenderError::LimitExceeded);
    let body = source(Value::Array(
        (0..101)
            .map(|index| json!({"section":format!("s{index}")}))
            .collect(),
    ));
    failure(input(&body, ""), RenderError::LimitExceeded);
    let body = source(json!([{"section":"review", "default_text":"Starter"}]));
    let base_allowed = json!({"review":nested(9)}).to_string();
    assert!(rendered(input(&body, &base_allowed))
        .applied_sections
        .is_empty());
    let base_deep = json!({"review":nested(10)}).to_string();
    failure(input(&body, &base_deep), RenderError::LimitExceeded);
    let source_deep =
        source(json!([{"section":"review","default_text":"Starter","metadata":nested(8)}]));
    failure(input(&source_deep, ""), RenderError::LimitExceeded);
    for (count, accepted) in [(200, true), (201, false)] {
        let body = source(
            json!([{"section":"review","type":"structured","subsections":(0..count).map(|index|json!({"name":format!("s{index}"),"default_text":"x"})).collect::<Vec<_>>()}]),
        );
        if accepted {
            assert_eq!(
                rendered(input(&body, "")).patch["review"]
                    .as_object()
                    .expect("generated child map exists")
                    .len(),
                200
            );
        } else {
            failure(input(&body, ""), RenderError::LimitExceeded);
        }
    }
    let long = "x".repeat(501);
    let mut request = input("{{chief_complaint}}", "");
    request.chief_complaint = Some(&long);
    failure(request, RenderError::LimitExceeded);
}

#[test]
fn output_budget_is_checked_during_single_pass_expansion_including_json_escaping() {
    let allowed = "x".repeat(19_998);
    let response = rendered(input(&allowed, ""));
    assert_eq!(
        serde_json::to_string(&response.patch)
            .expect("bounded patch serializes")
            .chars()
            .count(),
        20_000
    );
    let too_long = "x".repeat(19_999);
    failure(input(&too_long, ""), RenderError::LimitExceeded);
    let long_value = "é".repeat(10_000);
    let mut request = input("{{patient_first_name}}{{patient_first_name}}", "");
    request.patient.first_name = &long_value;
    failure(request, RenderError::LimitExceeded);
    let escaped = format!("A{}Z", "\n".repeat(10_000));
    let mut request = input("X{{chief_complaint}}", "");
    request.patient.first_name = &escaped;
    request.chief_complaint = None;
    // Use the patient token because chief complaint is independently capped500.
    request.source = "X{{patient_first_name}}Y";
    failure(request, RenderError::LimitExceeded);
}

#[test]
fn valid_json_beyond_value_parser_depth_cannot_fall_back_to_literal_rendering() {
    let nesting = format!("{}0{}", "[".repeat(200), "]".repeat(200));
    let envelope = [
        r#"{"sections":[{"section":"Review","default_text":"For {{patient_name}}"}],"metadata":"#,
        &nesting,
        "}",
    ]
    .concat();
    let array = [
        r#"[{"section":"Review","default_text":"For {{patient_name}}","metadata":"#,
        &nesting,
        "}]",
    ]
    .concat();
    for source in [&envelope, &array] {
        assert!(
            source.chars().count() < 20_000,
            "deep source stays within the admitted text bound"
        );
        assert!(
            serde_json::from_str::<serde::de::IgnoredAny>(source).is_ok(),
            "iterative validation proves the deep fixture is valid JSON"
        );
        assert!(
            serde_json::from_str::<Value>(source).is_err(),
            "fixture crosses the current Value parser resource boundary"
        );
    }
    // High brace depth alone does not turn invalid literal narrative into a
    // schema. This control must pass before checking either rejection outcome.
    let literal = format!("{}Literal narrative{}", "{".repeat(200), "}".repeat(199));
    assert!(serde_json::from_str::<serde::de::IgnoredAny>(&literal).is_err());
    let plain = rendered(input(&literal, ""));
    assert_eq!(plain.kind, RenderKind::Plain);
    assert!(
        plain.patch == Value::String(literal),
        "genuine invalid JSON remains literal text"
    );
    let rejected = [&envelope, &array]
        .map(|source| matches!(render(input(source, "")), Err(RenderError::LimitExceeded)));
    assert!(rejected.into_iter().all(|result| result), "valid deep schema must fail the bounded preview rather than interpolate a serialized document");
}
