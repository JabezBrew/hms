use serde_json::{json, Value};
use std::collections::BTreeSet;

const METHODS: &[&str] = &[
    "get", "post", "put", "patch", "delete", "head", "options", "trace",
];
fn document() -> Value {
    hms_api::openapi::openapi_value()
}
fn operation<'a>(doc: &'a Value, id: &str) -> &'a Value {
    doc["paths"]
        .as_object()
        .unwrap()
        .values()
        .flat_map(|path| path.as_object().unwrap().iter())
        .find_map(|(method, operation)| {
            (METHODS.contains(&method.as_str()) && operation["operationId"] == id)
                .then_some(operation)
        })
        .expect("reviewed operation exists")
}
#[test]
fn every_exported_path_parameter_exactly_matches_a_real_route_token() {
    let doc = document();
    let mut violations = Vec::new();
    for (path, item) in doc["paths"].as_object().unwrap() {
        let tokens: BTreeSet<_> = path
            .split('{')
            .skip(1)
            .map(|part| part.split('}').next().unwrap().to_owned())
            .collect();
        for (method, op) in item.as_object().unwrap() {
            if !METHODS.contains(&method.as_str()) {
                continue;
            }
            let parameters: Vec<_> = item["parameters"]
                .as_array()
                .into_iter()
                .flatten()
                .chain(op["parameters"].as_array().into_iter().flatten())
                .collect();
            let declared: BTreeSet<_> = parameters
                .iter()
                .filter(|p| p["in"] == "path")
                .map(|p| p["name"].as_str().unwrap().to_owned())
                .collect();
            if declared != tokens
                || parameters
                    .iter()
                    .any(|p| p["in"] == "path" && p["required"] != true)
            {
                violations.push(op["operationId"].as_str().unwrap());
            }
        }
    }
    assert!(
        violations.is_empty(),
        "exported phantom or missing route parameters: {violations:?}"
    );
}
#[test]
fn reviewed_optional_query_filters_match_the_actual_http_query_extractors() {
    let doc = document();
    let expected: &[(&str, &[&str])] = &[
        ("getAuthPasskeys", &["cursor", "limit"]),
        (
            "getClinicalNoteTemplates",
            &["activity", "cursor", "limit", "note_type", "search"],
        ),
        ("getClinicalNoteTemplateHistory", &["cursor", "limit"]),
        ("getClinicalNoteHistory", &["cursor", "limit"]),
        ("getClinics", &["cursor", "limit"]),
        ("getFluidObservationHistory", &["cursor", "limit"]),
        (
            "getPatientChronicleCurrentWardRound",
            &["admission_case_id"],
        ),
        (
            "getReferralConsultationContext",
            &[
                "admission_case_id",
                "encounter_id",
                "mode",
                "visit_choice",
                "visit_id",
            ],
        ),
        (
            "getStorageLocationAdministration",
            &[
                "cursor",
                "is_active",
                "limit",
                "location_type",
                "search",
                "temperature_zone",
            ],
        ),
        (
            "getAdminOrgUnits",
            &["cursor", "is_active", "limit", "unit_type"],
        ),
        ("getAdminOrgUnitChildren", &["cursor", "limit"]),
    ];
    for (id, expected) in expected {
        let params = operation(&doc, id)["parameters"].as_array().unwrap();
        let queries: BTreeSet<_> = params
            .iter()
            .filter(|p| p["in"] == "query")
            .map(|p| p["name"].as_str().unwrap())
            .collect();
        assert_eq!(
            queries,
            expected.iter().copied().collect(),
            "actual optional query fields for {id}"
        );
        assert!(
            params
                .iter()
                .filter(|p| p["in"] == "query")
                .all(|p| p["required"] == false),
            "query fields remain optional for {id}"
        );
    }
}
#[test]
fn strict_consultation_source_objects_are_closed_in_both_serde_and_export() {
    use hms_domain::referral_consultations::{
        ReferralConsultationSource, ReferralConsultationVisitChoice,
    };
    assert!(serde_json::from_value::<ReferralConsultationSource>(
        json!({"mode":"new_outpatient","visit":{"choice":"no_visit"},"unexpected":"synthetic"})
    )
    .is_err());
    assert!(serde_json::from_value::<ReferralConsultationVisitChoice>(json!({"choice":"existing_visit","visit_id":"91919191-9191-4191-8191-000000000001","unexpected":"synthetic"})).is_err());
    assert!(serde_json::from_value::<ReferralConsultationVisitChoice>(
        json!({"choice":"no_visit","unexpected":"synthetic"})
    )
    .is_err());
    assert_eq!(
        serde_json::to_value(ReferralConsultationVisitChoice::NoVisit).unwrap(),
        json!({"choice":"no_visit"})
    );
    assert_eq!(
        serde_json::from_value::<ReferralConsultationVisitChoice>(json!({"choice":"no_visit"}))
            .unwrap(),
        ReferralConsultationVisitChoice::NoVisit
    );
    let doc = document();
    for name in [
        "ReferralConsultationSource",
        "ReferralConsultationVisitChoice",
    ] {
        let variants = doc["components"]["schemas"][name]["oneOf"]
            .as_array()
            .expect("tagged variants");
        assert_eq!(variants.len(), 2);
        assert!(
            variants
                .iter()
                .all(|variant| variant["type"] == "object"
                    && variant["additionalProperties"] == false),
            "strict tagged {name} object variants must reject undeclared fields"
        );
    }
}
#[test]
fn governed_command_body_schemas_keep_exact_required_fields_and_reject_extra_fields() {
    let doc = document();
    for (name, fields) in [
        (
            "ReferralConsultationStartRequest",
            &[
                "client_request_id",
                "expected_link_version",
                "expected_context_token",
                "source",
            ][..],
        ),
        (
            "CreateOrganizationUnitRequest",
            &["client_request_id", "code", "name", "unit_type"][..],
        ),
        (
            "RenameOrganizationUnitRequest",
            &["client_request_id", "expected_version", "name"][..],
        ),
        (
            "OrganizationUnitLifecycleRequest",
            &["client_request_id", "expected_version"][..],
        ),
        (
            "CreateStorageLocationRequest",
            &[
                "client_request_id",
                "code",
                "name",
                "location_type",
                "temperature_zone",
            ][..],
        ),
        (
            "RenameStorageLocationRequest",
            &["client_request_id", "expected_version", "name"][..],
        ),
        (
            "StorageLocationLifecycleRequest",
            &["client_request_id", "expected_version"][..],
        ),
        (
            "OrdinaryPasswordConfirmationRequest",
            &["current_password"][..],
        ),
    ] {
        let schema = &doc["components"]["schemas"][name];
        assert_eq!(schema["additionalProperties"], false, "closed {name}");
        let required: BTreeSet<_> = schema["required"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect();
        assert_eq!(
            required,
            fields.iter().copied().collect(),
            "mandatory reviewed fields for {name}"
        );
    }
}
