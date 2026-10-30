use super::*;
#[tokio::test]
async fn immutable_receipts_cas_noop_and_changed_uuid_intent_do_not_reapply_metadata() {
    let (app, token) = setup().await;
    let original = create(&app, &token, "SYNTH23RECEIPT").await;
    let id = service_id(&original);
    let key = Uuid::new_v4();
    let input = json!({"client_request_id":key,"expected_version":1,"name":"Synthetic chosen metadata","default_duration_minutes":51});
    let path = format!("/api/v2/scheduling/services/{id}/metadata");
    let (s, changed) = request(&app, &token, Method::POST, &path, Some(input.clone())).await;
    assert_eq!(s, StatusCode::OK);
    let changed = changed["data"].clone();
    assert_eq!(changed["service"]["version"], 2);
    assert_eq!(changed["service"]["default_duration_minutes"], 51);
    let (s, retired) = request(
        &app,
        &token,
        Method::POST,
        &format!("/api/v2/scheduling/services/{id}/retire"),
        Some(json!({"client_request_id":Uuid::new_v4(),"expected_version":2})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(retired["data"]["service"]["version"], 3);
    let before = effects(&app).await;
    let (s, replay) = request(&app, &token, Method::POST, &path, Some(input.clone())).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(replay["data"], changed);
    assert_eq!(effects(&app).await, before);
    let (s, saved) = request(
        &app,
        &token,
        Method::GET,
        &format!("/api/v2/scheduling/services/commands/{key}"),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(saved["data"], changed);
    let mut conflict = input.clone();
    conflict["name"] = json!("Synthetic changed intent");
    assert_eq!(
        request(&app, &token, Method::POST, &path, Some(conflict))
            .await
            .0,
        StatusCode::CONFLICT
    );
    let mut stale = input;
    stale["client_request_id"] = json!(Uuid::new_v4());
    assert_eq!(
        request(&app, &token, Method::POST, &path, Some(stale))
            .await
            .0,
        StatusCode::CONFLICT
    );
    assert_eq!(effects(&app).await, before);
    let(s,noop)=request(&app,&token,Method::POST,&path,Some(json!({"client_request_id":Uuid::new_v4(),"expected_version":3,"name":"Synthetic chosen metadata","default_duration_minutes":51}))).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(noop["data"]["changed"], false);
    assert_eq!(noop["data"]["service"], retired["data"]["service"]);
    let current = request(
        &app,
        &token,
        Method::GET,
        &format!("/api/v2/scheduling/services/{id}/administration"),
        None,
    )
    .await
    .1;
    assert_eq!(current["data"], retired["data"]["service"]);
    let original_key = original["client_request_id"].as_str().unwrap();
    let saved = request(
        &app,
        &token,
        Method::GET,
        &format!("/api/v2/scheduling/services/commands/{original_key}"),
        None,
    )
    .await
    .1;
    assert_eq!(saved["data"], original);
    let row:(i64,i64)=sqlx::query_as("SELECT (SELECT count(*) FROM appointment_type_commands WHERE facility_id=$1),(SELECT count(*) FROM audit_events WHERE facility_id=$1 AND event_type LIKE 'scheduling.appointment_type.%')")
        .bind(app.state().facility_id()).fetch_one(&app.db_pool().await).await.unwrap();
    assert_eq!(row, (4, 4));
}
#[tokio::test]
async fn audit_failure_rolls_back_type_and_command_then_exact_retry_is_explicit() {
    let (app, token) = setup().await;
    let pool = app.db_pool().await;
    let before = effects(&app).await;
    sqlx::raw_sql("CREATE FUNCTION fail_type23_audit()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.event_type LIKE 'scheduling.appointment_type.%' THEN RAISE EXCEPTION 'SYNTH23_PRIVATE_AUDIT_MARKER';END IF;RETURN NEW;END$$;CREATE TRIGGER fail_type23_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_type23_audit();").execute(&pool).await.unwrap();
    let input = create_input("SYNTH23AUDIT");
    let key = input["client_request_id"].as_str().unwrap();
    let (s, b) = request(
        &app,
        &token,
        Method::POST,
        "/api/v2/scheduling/services",
        Some(input.clone()),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(b["error"]["code"], "appointment_type_write_unconfirmed");
    assert!(!b.to_string().contains("SYNTH23_PRIVATE_AUDIT_MARKER"));
    assert_eq!(effects(&app).await, before);
    assert_eq!(
        request(
            &app,
            &token,
            Method::GET,
            &format!("/api/v2/scheduling/services/commands/{key}"),
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    sqlx::raw_sql(
        "DROP TRIGGER fail_type23_audit ON audit_events;DROP FUNCTION fail_type23_audit();",
    )
    .execute(&pool)
    .await
    .unwrap();
    let (s, b) = request(
        &app,
        &token,
        Method::POST,
        "/api/v2/scheduling/services",
        Some(input),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(b["data"]["changed"], true);
}

#[tokio::test]
async fn database_backstops_refuse_identity_rewrite_delete_and_command_history_mutation() {
    let (app, token) = setup().await;
    let pool = app.db_pool().await;
    let original = create(&app, &token, "SYNTH23IDENTITY").await;
    let id = service_id(&original);
    let before: Value =
        sqlx::query_scalar("SELECT to_jsonb(t) FROM appointment_types t WHERE id=$1")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
    for sql in [
        "UPDATE appointment_types SET code=code||'X' WHERE id=$1",
        "UPDATE appointment_types SET id=gen_random_uuid() WHERE id=$1",
        "UPDATE appointment_types SET facility_id=gen_random_uuid() WHERE id=$1",
        "UPDATE appointment_types SET created_at=created_at+interval '1 second' WHERE id=$1",
        "UPDATE appointment_types SET name='Synthetic bypass' WHERE id=$1",
        "DELETE FROM appointment_types WHERE id=$1",
    ] {
        assert!(
            sqlx::query(sql).bind(id).execute(&pool).await.is_err(),
            "exact protected type identity/lifecycle must refuse raw rewrite"
        );
        let after: Value =
            sqlx::query_scalar("SELECT to_jsonb(t) FROM appointment_types t WHERE id=$1")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(before, after);
    }
    for sql in ["UPDATE appointment_type_commands SET receipt=receipt||'{\"changed\":false}'::jsonb WHERE type_id=$1","UPDATE appointment_type_commands SET actor_user_id=gen_random_uuid() WHERE type_id=$1","DELETE FROM appointment_type_commands WHERE type_id=$1"]{assert!(sqlx::query(sql).bind(id).execute(&pool).await.is_err(),"original actor receipt must be immutable");}
    let key = original["client_request_id"].as_str().unwrap();
    assert_eq!(
        request(
            &app,
            &token,
            Method::GET,
            &format!("/api/v2/scheduling/services/commands/{key}"),
            None
        )
        .await
        .1["data"],
        original
    );
}
