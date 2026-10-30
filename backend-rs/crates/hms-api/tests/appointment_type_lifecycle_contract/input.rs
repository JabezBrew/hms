use super::*;
#[tokio::test]
async fn strict_commands_paths_and_bounded_filters_return_static400_without_marker_or_effects() {
    let (app, token) = setup().await;
    let existing = create(&app, &token, "SYNTH23INPUT").await;
    let id = service_id(&existing);
    let marker = "SYNTH23_PRIVATE_INPUT_MARKER";
    let before = effects(&app).await;
    let base = create_input("SYNTH23INPUTBAD");
    let mut bodies = Vec::new();
    for field in ["patient_id", "facility_id", "actor_user_id", "extra"] {
        let mut v = base.clone();
        v[field] = json!(marker);
        bodies.push(v);
    }
    for duration in [0, 1441] {
        let mut v = base.clone();
        v["default_duration_minutes"] = json!(duration);
        bodies.push(v);
    }
    for name in [
        " Synthetic leading".to_string(),
        "Synthetic trailing ".to_string(),
        "x".repeat(161),
        "é".repeat(81),
        "Synthetic\ncontrol".to_string(),
    ] {
        let mut v = base.clone();
        v["name"] = json!(name);
        bodies.push(v);
    }
    for code in ["x".repeat(49), "synthetic space".into(), "SYNTH_é".into()] {
        let mut v = base.clone();
        v["code"] = json!(code);
        bodies.push(v);
    }
    let mut missing = base.clone();
    missing.as_object_mut().unwrap().remove("client_request_id");
    bodies.push(missing);
    let mut nil = base.clone();
    nil["client_request_id"] = json!(Uuid::nil());
    bodies.push(nil);
    bodies.push(json!([marker]));
    let mut statuses = Vec::new();
    for body in bodies {
        let (s, b) = request(
            &app,
            &token,
            Method::POST,
            "/api/v2/scheduling/services",
            Some(body),
        )
        .await;
        statuses.push(s.as_u16());
        assert!(!b.to_string().contains(marker));
    }
    for action in ["metadata", "retire", "reactivate"] {
        let mut body =
            json!({"client_request_id":Uuid::new_v4(),"expected_version":1,"extra":marker});
        if action == "metadata" {
            body["name"] = json!("Synthetic input");
            body["default_duration_minutes"] = json!(30);
        }
        let (s, b) = request(
            &app,
            &token,
            Method::POST,
            &format!("/api/v2/scheduling/services/{id}/{action}"),
            Some(body),
        )
        .await;
        statuses.push(s.as_u16());
        assert!(!b.to_string().contains(marker));
    }
    for path in [
        format!("/api/v2/scheduling/services/{marker}/administration"),
        format!("/api/v2/scheduling/services/commands/{marker}"),
        format!("/api/v2/scheduling/services/administration?cursor={marker}"),
        "/api/v2/scheduling/services/administration?limit=1000".into(),
        format!(
            "/api/v2/scheduling/services/administration?search={}{}",
            marker,
            "x".repeat(161)
        ),
    ] {
        let (s, b) = request(&app, &token, Method::GET, &path, None).await;
        statuses.push(s.as_u16());
        assert!(!b.to_string().contains(marker));
    }
    assert_eq!(statuses, vec![400; statuses.len()]);
    assert_eq!(effects(&app).await, before);
    let mut unicode = create_input("SYNTH23UTF8");
    unicode["name"] = json!("é".repeat(80));
    assert_eq!(
        request(
            &app,
            &token,
            Method::POST,
            "/api/v2/scheduling/services",
            Some(unicode)
        )
        .await
        .0,
        StatusCode::OK
    );
}
#[test]
fn all_four_reviewed_receipt_actions_reject_unknown_fields_and_keep_canonical_roundtrips() {
    use hms_domain::appointment_types::AppointmentTypeReviewedInput;
    let key = Uuid::new_v4();
    let id = Uuid::new_v4();
    let inputs = [
        json!({"action":"create","client_request_id":key,"code":"SYNTH23SERDE","name":"Synthetic service","default_duration_minutes":30}),
        json!({"action":"metadata","client_request_id":key,"service_id":id,"expected_version":1,"name":"Synthetic service","default_duration_minutes":30}),
        json!({"action":"retire","client_request_id":key,"service_id":id,"expected_version":1}),
        json!({"action":"reactivate","client_request_id":key,"service_id":id,"expected_version":1}),
    ];
    for original in inputs {
        let typed: AppointmentTypeReviewedInput = serde_json::from_value(original.clone()).unwrap();
        assert_eq!(serde_json::to_value(typed).unwrap(), original);
        let mut extra = original;
        extra["extra"] = json!("SYNTH23_PRIVATE_MARKER");
        assert!(serde_json::from_value::<AppointmentTypeReviewedInput>(extra).is_err());
    }
}

#[test]
fn actual_management_openapi_preserves_strict_input_receipts_query_scope_and_all_refusal_responses()
{
    let doc = hms_api::openapi::openapi_value();
    let schemas = &doc["components"]["schemas"];
    for (path, method) in [
        ("/api/v2/scheduling/services", "post"),
        ("/api/v2/scheduling/services/{id}/metadata", "post"),
        ("/api/v2/scheduling/services/{id}/retire", "post"),
        ("/api/v2/scheduling/services/{id}/reactivate", "post"),
        (
            "/api/v2/scheduling/services/commands/{client_request_id}",
            "get",
        ),
        ("/api/v2/scheduling/services/administration", "get"),
        ("/api/v2/scheduling/services/{id}/administration", "get"),
    ] {
        assert!(
            doc["paths"][path][method]["responses"]["409"].is_object(),
            "actual DB read/write refusal must appear in actual generated contract"
        );
    }
    for (name, fields) in [
        (
            "CreateAppointmentTypeRequest",
            vec![
                "client_request_id",
                "code",
                "name",
                "default_duration_minutes",
            ],
        ),
        (
            "UpdateAppointmentTypeMetadataRequest",
            vec![
                "client_request_id",
                "expected_version",
                "name",
                "default_duration_minutes",
            ],
        ),
        (
            "AppointmentTypeLifecycleRequest",
            vec!["client_request_id", "expected_version"],
        ),
    ] {
        assert_eq!(schemas[name]["additionalProperties"], false);
        let actual: std::collections::BTreeSet<_> = schemas[name]["required"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect();
        assert_eq!(
            actual,
            fields
                .into_iter()
                .collect::<std::collections::BTreeSet<_>>()
        );
    }
    let variants = schemas["AppointmentTypeReviewedInput"]["oneOf"]
        .as_array()
        .unwrap();
    assert_eq!(variants.len(), 4);
    assert!(variants.iter().all(|v| v["additionalProperties"] == false));
    assert_eq!(
        schemas["AppointmentTypeCommandReceipt"]["properties"]["reviewed_input"]["$ref"],
        "#/components/schemas/AppointmentTypeReviewedInput"
    );
    let parameters = doc["paths"]["/api/v2/scheduling/services/administration"]["get"]
        ["parameters"]
        .as_array()
        .unwrap();
    assert_eq!(parameters.len(), 4);
    assert!(parameters
        .iter()
        .all(|v| v["in"] == "query" && v["required"] == false));
}
