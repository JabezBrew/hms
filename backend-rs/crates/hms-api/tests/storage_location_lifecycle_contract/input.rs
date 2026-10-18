use super::*;
#[tokio::test]
async fn malformed_new_wire_inputs_are_static_typed400_without_echo_or_effects() {
    let (app, token) = setup().await;
    let fixture = create(&app, &token, "SYNTH21_INPUT_CONTROL").await;
    let id = location_id(&fixture);
    let before = effects(&app).await;
    let marker = "SYNTH21_PRIVATE_INPUT_MARKER";
    let mut unknown = create_input("SYNTH21_BAD_INPUT");
    unknown[marker] = json!(true);
    let mut invalid_enum = create_input("SYNTH21_BAD_INPUT");
    invalid_enum["location_type"] = json!(marker);
    let mut cases=vec![(Method::POST,"/api/v2/inventory/storage-locations".to_owned(),unknown.to_string()),(Method::POST,"/api/v2/inventory/storage-locations".to_owned(),invalid_enum.to_string()),(Method::POST,"/api/v2/inventory/storage-locations".to_owned(),format!("{{{marker}")),(Method::POST,format!("/api/v2/inventory/storage-locations/{marker}/rename"),json!({"client_request_id":Uuid::new_v4(),"expected_version":1,"name":"Synthetic rename"}).to_string()),(Method::GET,format!("/api/v2/inventory/storage-locations/administration?limit={marker}"),String::new())];
    for action in ["rename", "retire", "reactivate"] {
        let mut body = json!({"client_request_id":Uuid::new_v4(),"expected_version":1});
        if action == "rename" {
            body["name"] = json!("Synthetic valid name");
        }
        body[marker] = json!(true);
        cases.push((
            Method::POST,
            format!("/api/v2/inventory/storage-locations/{id}/{action}"),
            body.to_string(),
        ));
    }
    cases.push((
        Method::GET,
        format!("/api/v2/inventory/storage-locations/commands/{marker}"),
        String::new(),
    ));
    cases.push((
        Method::GET,
        format!("/api/v2/inventory/storage-locations/{marker}/administration"),
        String::new(),
    ));
    cases.push((
        Method::GET,
        format!("/api/v2/inventory/storage-locations/administration?is_active={marker}"),
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
    let unchanged = effects(&app).await == before;
    println!("storage21 rejected input statuses={statuses:?}; typed_envelopes={typed:?}; marker_echoes={echoes:?}; effects_unchanged={unchanged}");
    assert_eq!(statuses, vec![400; case_count]);
    assert!(typed.iter().all(|v| *v));
    assert!(echoes.iter().all(|v| !*v));
    assert!(unchanged);
}
