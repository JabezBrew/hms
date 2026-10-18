use super::*;
#[tokio::test]
async fn malformed_organization_wire_inputs_are_static_typed400_without_echo_or_effects() {
    let (app, token) = setup().await;
    let fixture = create(&app, &token, "SYNTH20_INPUT_CONTROL").await;
    let id = unit_id(&fixture);
    let before = extraction_effects(&app).await;
    let marker = "SYNTH20_PRIVATE_INPUT_MARKER";
    let mut unknown = create_input("SYNTH20_BAD_INPUT");
    unknown[marker] = json!(true);
    let mut invalid_enum = create_input("SYNTH20_BAD_INPUT");
    invalid_enum["unit_type"] = json!(marker);
    let mut cases=vec![(Method::POST,"/api/v2/admin/org-units".to_owned(),unknown.to_string()),(Method::POST,"/api/v2/admin/org-units".to_owned(),invalid_enum.to_string()),(Method::POST,"/api/v2/admin/org-units".to_owned(),format!("{{{marker}")),(Method::POST,format!("/api/v2/admin/org-units/{marker}/rename"),json!({"client_request_id":Uuid::new_v4(),"expected_version":1,"name":"Synthetic rename"}).to_string()),(Method::GET,format!("/api/v2/admin/org-units?limit={marker}"),String::new())];
    for action in ["rename", "retire", "reactivate"] {
        let mut body = json!({"client_request_id":Uuid::new_v4(),"expected_version":1});
        if action == "rename" {
            body["name"] = json!("Synthetic valid name");
        }
        body[marker] = json!(true);
        cases.push((
            Method::POST,
            format!("/api/v2/admin/org-units/{id}/{action}"),
            body.to_string(),
        ));
    }
    cases.push((
        Method::GET,
        format!("/api/v2/admin/org-units/commands/{marker}"),
        String::new(),
    ));
    cases.push((
        Method::GET,
        format!("/api/v2/admin/org-units/{marker}"),
        String::new(),
    ));
    cases.push((
        Method::GET,
        format!("/api/v2/admin/org-units?is_active={marker}"),
        String::new(),
    ));
    for relation in ["children", "ancestors", "descendants"] {
        cases.push((
            Method::GET,
            format!("/api/v2/admin/org-units/{marker}/{relation}"),
            String::new(),
        ));
        cases.push((
            Method::GET,
            format!("/api/v2/admin/org-units/{id}/{relation}?limit={marker}"),
            String::new(),
        ));
    }
    cases.push((
        Method::GET,
        format!("/api/v2/admin/org-units?unit_type={marker}"),
        String::new(),
    ));
    let case_count = cases.len();
    let mut statuses = vec![];
    let mut typed = vec![];
    let mut echoes = vec![];
    for (method, path, body) in cases {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(path)
                    .header(AUTHORIZATION, format!("Bearer {token}"))
                    .header("content-type", "application/json")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        statuses.push(response.status().as_u16());
        let bytes = to_bytes(response.into_body(), 8192).await.unwrap();
        echoes.push(bytes.windows(marker.len()).any(|w| w == marker.as_bytes()));
        let value: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        typed.push(value["error"]["code"].is_string());
    }
    let unchanged = extraction_effects(&app).await == before;
    println!("organization20 rejected input statuses={statuses:?}; typed_envelopes={typed:?}; marker_echoes={echoes:?}; effects_unchanged={unchanged}");
    assert_eq!(statuses, vec![400; case_count]);
    assert!(typed.iter().all(|v| *v));
    assert!(echoes.iter().all(|v| !*v));
    assert!(unchanged);
}

async fn extraction_effects(app: &TestApp) -> Value {
    sqlx::query_scalar("SELECT jsonb_build_object('units',(SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM organization_units u WHERE facility_id=$1),'commands',(SELECT jsonb_agg(to_jsonb(c) ORDER BY request_key_hash) FROM organization_unit_commands c WHERE facility_id=$1),'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM audit_events a WHERE facility_id=$1 AND event_type LIKE 'admin.organization_unit.%'))")
        .bind(app.state().facility_id()).fetch_one(&app.db_pool().await).await.unwrap()
}
