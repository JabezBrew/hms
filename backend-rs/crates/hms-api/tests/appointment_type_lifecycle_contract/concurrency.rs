use super::*;
async fn wait_for_lock(pool: &hms_db::PgPool, fragment: &str) {
    tokio::time::timeout(std::time::Duration::from_secs(10),async{loop{
 let yes:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE $1)").bind(format!("%{fragment}%")).fetch_one(pool).await.unwrap();
 if yes {break;} tokio::time::sleep(std::time::Duration::from_millis(10)).await;
 }}).await.expect("actual command reaches controlled retained lock");
}
async fn retire(app: &TestApp, token: &str, id: Uuid) -> (StatusCode, Value) {
    request(
        app,
        token,
        Method::POST,
        &format!("/api/v2/scheduling/services/{id}/retire"),
        Some(json!({"client_request_id":Uuid::new_v4(),"expected_version":1})),
    )
    .await
}
fn future_template(id: Uuid) -> Value {
    json!({"owner_type":"service","owner_id":id,"name":"Synthetic retained template","mode":"capacity_block","weekdays":[1,2,3,4,5,6,7],"starts_on":Utc::now().date_naive(),"start_time":"08:00:00","end_time":"12:00:00","capacity":4,"allowed_service_ids":[id],"clinic_id":null,"service_code":null,"practitioner_user_id":null})
}
#[tokio::test]
async fn publisher_first_retirement_is_nowait_then_refuses_actual_committed_future_generator() {
    let (app, token) = setup().await;
    let pool = app.db_pool().await;
    let id = service_id(&create(&app, &token, "SYNTH23PUBFIRST").await);
    sqlx::raw_sql("CREATE FUNCTION pause_type23_template()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN PERFORM pg_advisory_xact_lock(17002901);RETURN NEW;END$$;CREATE TRIGGER pause_type23_template BEFORE INSERT ON clinic_session_templates FOR EACH ROW EXECUTE FUNCTION pause_type23_template();").execute(&pool).await.unwrap();
    let mut gate = pool.acquire().await.unwrap();
    sqlx::query("SELECT pg_advisory_lock(17002901)")
        .execute(&mut *gate)
        .await
        .unwrap();
    let a = app.clone();
    let t = token.clone();
    let body = future_template(id);
    let pending = tokio::spawn(async move {
        request(
            &a,
            &t,
            Method::POST,
            "/api/v2/scheduling/templates",
            Some(body),
        )
        .await
    });
    wait_for_lock(&pool, "INSERT INTO clinic_session_templates").await;
    let blocked =
        tokio::time::timeout(std::time::Duration::from_secs(2), retire(&app, &token, id)).await;
    sqlx::query("SELECT pg_advisory_unlock(17002901)")
        .execute(&mut *gate)
        .await
        .unwrap();
    let published = pending.await.unwrap();
    let (s, b) = blocked.expect("retirement must use NOWAIT against retained publisher type gate");
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(b["error"]["code"], "appointment_type_busy");
    assert_eq!(
        published.0,
        StatusCode::OK,
        "static {}",
        published.1["error"]["code"]
    );
    let before = effects(&app).await;
    let (s, b) = retire(&app, &token, id).await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(b["error"]["code"], "appointment_type_future_generator");
    assert_eq!(effects(&app).await, before);
}
#[tokio::test]
async fn retirement_first_new_template_is_nowait_then_refuses_retired_type_without_partial_rows() {
    let (app, token) = setup().await;
    let pool = app.db_pool().await;
    let id = service_id(&create(&app, &token, "SYNTH23RETIREFIRST").await);
    sqlx::raw_sql("CREATE FUNCTION pause_type23_retire()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.event_type='scheduling.appointment_type.retire' THEN PERFORM pg_advisory_xact_lock(17002902);END IF;RETURN NEW;END$$;CREATE TRIGGER pause_type23_retire BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION pause_type23_retire();").execute(&pool).await.unwrap();
    let count_before: i64 =
        sqlx::query_scalar("SELECT count(*) FROM clinic_session_templates WHERE facility_id=$1")
            .bind(app.state().facility_id())
            .fetch_one(&pool)
            .await
            .unwrap();
    let mut gate = pool.acquire().await.unwrap();
    sqlx::query("SELECT pg_advisory_lock(17002902)")
        .execute(&mut *gate)
        .await
        .unwrap();
    let a = app.clone();
    let t = token.clone();
    let pending = tokio::spawn(async move { retire(&a, &t, id).await });
    wait_for_lock(&pool, "INSERT INTO audit_events").await;
    let body = future_template(id);
    let blocked = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        request(
            &app,
            &token,
            Method::POST,
            "/api/v2/scheduling/templates",
            Some(body.clone()),
        ),
    )
    .await;
    sqlx::query("SELECT pg_advisory_unlock(17002902)")
        .execute(&mut *gate)
        .await
        .unwrap();
    let completed = pending.await.unwrap();
    assert_eq!(completed.0, StatusCode::OK);
    assert_eq!(
        blocked.expect("new publication must retain type NOWAIT").0,
        StatusCode::CONFLICT
    );
    let (inactive_status, inactive_body) = request(
        &app,
        &token,
        Method::POST,
        "/api/v2/scheduling/templates",
        Some(body),
    )
    .await;
    assert_eq!(inactive_status, StatusCode::BAD_REQUEST);
    assert_eq!(inactive_body["error"]["code"], "bookable_service_not_found");
    let count_after: i64 =
        sqlx::query_scalar("SELECT count(*) FROM clinic_session_templates WHERE facility_id=$1")
            .bind(app.state().facility_id())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count_before, count_after);
}
#[tokio::test]
async fn final_audit_wait_cannot_outlive_session_deadline_and_rolls_back_every_effect() {
    let (app, token) = setup().await;
    let pool = app.db_pool().await;
    let claims = access_claims(&token);
    sqlx::raw_sql("CREATE FUNCTION wait_type23_deadline()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.event_type='scheduling.appointment_type.create' THEN PERFORM pg_advisory_xact_lock(17002903);END IF;RETURN NEW;END$$;CREATE TRIGGER wait_type23_deadline BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION wait_type23_deadline();").execute(&pool).await.unwrap();
    let mut gate = pool.acquire().await.unwrap();
    sqlx::query("SELECT pg_advisory_lock(17002903)")
        .execute(&mut *gate)
        .await
        .unwrap();
    let end:chrono::DateTime<Utc>=sqlx::query_scalar("UPDATE refresh_sessions SET expires_at=clock_timestamp()+interval '3 seconds' WHERE session_id=$1 RETURNING expires_at").bind(claims.session_id).fetch_one(&pool).await.unwrap();
    let before = effects(&app).await;
    let a = app.clone();
    let pending = tokio::spawn(async move {
        request(
            &a,
            &token,
            Method::POST,
            "/api/v2/scheduling/services",
            Some(create_input("SYNTH23_EXPIRED")),
        )
        .await
    });
    wait_for_lock(&pool, "INSERT INTO audit_events").await;
    sqlx::query(
        "SELECT pg_sleep(GREATEST(0,extract(epoch FROM($1::timestamptz-clock_timestamp())))+0.03)",
    )
    .bind(end)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("SELECT pg_advisory_unlock(17002903)")
        .execute(&mut *gate)
        .await
        .unwrap();
    let (status, body) = pending.await.unwrap();
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "static {}",
        body["error"]["code"]
    );
    assert_eq!(effects(&app).await, before);
}
#[tokio::test]
async fn identity_wait_rechecks_revoked_session_before_metadata_publication() {
    let (app, token) = setup().await;
    let pool = app.db_pool().await;
    let claims = access_claims(&token);
    let before = effects(&app).await;
    let mut gate = pool.begin().await.unwrap();
    sqlx::query("SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE")
        .bind(claims.sub)
        .execute(&mut *gate)
        .await
        .unwrap();
    let a = app.clone();
    let pending = tokio::spawn(async move {
        request(
            &a,
            &token,
            Method::POST,
            "/api/v2/scheduling/services",
            Some(create_input("SYNTH23_REVOKED")),
        )
        .await
    });
    wait_for_lock(
        &pool,
        "SELECT session_version,permission_version FROM users",
    )
    .await;
    sqlx::query("UPDATE refresh_sessions SET revoked_at=clock_timestamp() WHERE session_id=$1")
        .bind(claims.session_id)
        .execute(&mut *gate)
        .await
        .unwrap();
    gate.commit().await.unwrap();
    let (status, body) = pending.await.unwrap();
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "static {}",
        body["error"]["code"]
    );
    assert_eq!(effects(&app).await, before);
}
#[tokio::test]
async fn uuid_and_code_reservations_never_wait_on_uncommitted_canonical_command() {
    let (app, token) = setup().await;
    let pool = app.db_pool().await;
    sqlx::raw_sql("CREATE FUNCTION wait_type23_uuid()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.event_type='scheduling.appointment_type.create' THEN PERFORM pg_advisory_xact_lock(17002904);END IF;RETURN NEW;END$$;CREATE TRIGGER wait_type23_uuid BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION wait_type23_uuid();").execute(&pool).await.unwrap();
    let mut gate = pool.acquire().await.unwrap();
    sqlx::query("SELECT pg_advisory_lock(17002904)")
        .execute(&mut *gate)
        .await
        .unwrap();
    let input = create_input("SYNTH23_UUID");
    let a = app.clone();
    let t = token.clone();
    let first = input.clone();
    let pending = tokio::spawn(async move {
        request(
            &a,
            &t,
            Method::POST,
            "/api/v2/scheduling/services",
            Some(first),
        )
        .await
    });
    wait_for_lock(&pool, "INSERT INTO audit_events").await;
    let same = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        request(
            &app,
            &token,
            Method::POST,
            "/api/v2/scheduling/services",
            Some(input.clone()),
        ),
    )
    .await;
    let code = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        request(
            &app,
            &token,
            Method::POST,
            "/api/v2/scheduling/services",
            Some(create_input("SYNTH23_UUID")),
        ),
    )
    .await;
    sqlx::query("SELECT pg_advisory_unlock(17002904)")
        .execute(&mut *gate)
        .await
        .unwrap();
    let first = pending.await.unwrap();
    assert_eq!(first.0, StatusCode::OK);
    for v in [same, code] {
        let (s, b) = v.expect("reservation has bounded busy result");
        assert_eq!(s, StatusCode::CONFLICT);
        assert_eq!(b["error"]["code"], "appointment_type_busy");
    }
    let before = effects(&app).await;
    let (s, b) = request(
        &app,
        &token,
        Method::POST,
        "/api/v2/scheduling/services",
        Some(input),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(b["data"], first.1["data"]);
    assert_eq!(effects(&app).await, before);
}
