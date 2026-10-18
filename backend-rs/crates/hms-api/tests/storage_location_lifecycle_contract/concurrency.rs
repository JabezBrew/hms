use super::*;
pub(super) async fn wait_for_lock(pool: &hms_db::PgPool, prefix: &str) {
    tokio::time::timeout(std::time::Duration::from_secs(10),async{loop{let yes:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE $1)").bind(format!("%{prefix}%")).fetch_one(pool).await.unwrap();if yes{break;}tokio::time::sleep(std::time::Duration::from_millis(10)).await;}}).await.expect("actual HTTP request reaches controlled transaction wait");
}
async fn item(app: &TestApp) -> Uuid {
    sqlx::query_scalar("SELECT id FROM inventory_items WHERE facility_id=$1 AND is_active AND NOT controlled LIMIT 1").bind(app.state().facility_id()).fetch_one(&app.db_pool().await).await.unwrap()
}
#[tokio::test]
async fn producer_first_location_retirement_is_bounded_and_later_refuses_committed_history() {
    let (app, token) = setup().await;
    let r = create(&app, &token, "SYNTH21_PRODUCER_FIRST").await;
    let id = location_id(&r);
    let pool = app.db_pool().await;
    let item = item(&app).await;
    sqlx::raw_sql("CREATE FUNCTION wait_storage21_transfer()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN PERFORM pg_advisory_xact_lock(17002801);RETURN NEW;END$$;CREATE TRIGGER wait_storage21_transfer AFTER INSERT ON stock_transfers FOR EACH ROW EXECUTE FUNCTION wait_storage21_transfer();").execute(&pool).await.unwrap();
    let mut gate = pool.acquire().await.unwrap();
    sqlx::query("SELECT pg_advisory_lock(17002801)")
        .execute(&mut *gate)
        .await
        .unwrap();
    let a = app.clone();
    let t = token.clone();
    let pending = tokio::spawn(async move {
        request(&a,&t,Method::POST,"/api/v2/inventory/transfers",Some(json!({"item_id":item,"from_location_id":id,"to_location_id":Uuid::from_u128(hms_db::provision::DEFAULT_PHARMACY_STORE_ID),"quantity":1}))).await
    });
    wait_for_lock(&pool, "INSERT INTO stock_transfers").await;
    let blocked = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        command(&app, &token, id, "retire", 1),
    )
    .await;
    sqlx::query("SELECT pg_advisory_unlock(17002801)")
        .execute(&mut *gate)
        .await
        .unwrap();
    let completed = pending.await.unwrap();
    let (s, b) = blocked.expect("retirement uses NOWAIT instead of waiting on a producer");
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(b["error"]["code"], "storage_location_busy");
    assert_eq!(completed.0, StatusCode::OK);
    assert_eq!(
        command(&app, &token, id, "retire", 1).await.1["error"]["code"],
        "storage_location_has_operational_history"
    );
}
#[tokio::test]
async fn lifecycle_first_publication_is_bounded_and_cannot_insert_against_retired_location() {
    let (app, token) = setup().await;
    let r = create(&app, &token, "SYNTH21_LIFECYCLE_FIRST").await;
    let id = location_id(&r);
    let pool = app.db_pool().await;
    let item = item(&app).await;
    sqlx::raw_sql("CREATE FUNCTION wait_storage21_retire()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.event_type='inventory.storage_location.retire' THEN PERFORM pg_advisory_xact_lock(17002802);END IF;RETURN NEW;END$$;CREATE TRIGGER wait_storage21_retire BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION wait_storage21_retire();").execute(&pool).await.unwrap();
    let mut gate = pool.acquire().await.unwrap();
    sqlx::query("SELECT pg_advisory_lock(17002802)")
        .execute(&mut *gate)
        .await
        .unwrap();
    let a = app.clone();
    let t = token.clone();
    let pending = tokio::spawn(async move { command(&a, &t, id, "retire", 1).await });
    wait_for_lock(&pool, "INSERT INTO audit_events").await;
    let body = json!({"item_id":item,"from_location_id":id,"to_location_id":Uuid::from_u128(hms_db::provision::DEFAULT_PHARMACY_STORE_ID),"quantity":1});
    let blocked = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        request(
            &app,
            &token,
            Method::POST,
            "/api/v2/inventory/transfers",
            Some(body.clone()),
        ),
    )
    .await;
    sqlx::query("SELECT pg_advisory_unlock(17002802)")
        .execute(&mut *gate)
        .await
        .unwrap();
    let completed = pending.await.unwrap();
    let (s, b) = blocked.expect("new reference proof uses NOWAIT");
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(b["error"]["code"], "storage_location_busy");
    assert_eq!(completed.0, StatusCode::OK);
    let (s, b) = request(
        &app,
        &token,
        Method::POST,
        "/api/v2/inventory/transfers",
        Some(body),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(b["error"]["code"], "storage_location_reference_unavailable");
    let rows: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM stock_transfers WHERE from_location_id=$1 OR to_location_id=$1",
    )
    .bind(id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(rows, 0);
}
#[tokio::test]
async fn final_audit_wait_cannot_outlive_session_deadline_and_rolls_back_every_effect() {
    let (app, token) = setup().await;
    let pool = app.db_pool().await;
    let claims = access_claims(&token);
    sqlx::raw_sql("CREATE FUNCTION wait_storage21_deadline()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.event_type='inventory.storage_location.create' THEN PERFORM pg_advisory_xact_lock(17002803);END IF;RETURN NEW;END$$;CREATE TRIGGER wait_storage21_deadline BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION wait_storage21_deadline();").execute(&pool).await.unwrap();
    let mut gate = pool.acquire().await.unwrap();
    sqlx::query("SELECT pg_advisory_lock(17002803)")
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
            "/api/v2/inventory/storage-locations",
            Some(create_input("SYNTH21_EXPIRED")),
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
    sqlx::query("SELECT pg_advisory_unlock(17002803)")
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
            "/api/v2/inventory/storage-locations",
            Some(create_input("SYNTH21_REVOKED")),
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
    sqlx::raw_sql("CREATE FUNCTION wait_storage21_uuid()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.event_type='inventory.storage_location.create' THEN PERFORM pg_advisory_xact_lock(17002804);END IF;RETURN NEW;END$$;CREATE TRIGGER wait_storage21_uuid BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION wait_storage21_uuid();").execute(&pool).await.unwrap();
    let mut gate = pool.acquire().await.unwrap();
    sqlx::query("SELECT pg_advisory_lock(17002804)")
        .execute(&mut *gate)
        .await
        .unwrap();
    let input = create_input("SYNTH21_UUID");
    let a = app.clone();
    let t = token.clone();
    let first = input.clone();
    let pending = tokio::spawn(async move {
        request(
            &a,
            &t,
            Method::POST,
            "/api/v2/inventory/storage-locations",
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
            "/api/v2/inventory/storage-locations",
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
            "/api/v2/inventory/storage-locations",
            Some(create_input("SYNTH21_UUID")),
        ),
    )
    .await;
    sqlx::query("SELECT pg_advisory_unlock(17002804)")
        .execute(&mut *gate)
        .await
        .unwrap();
    let first = pending.await.unwrap();
    assert_eq!(first.0, StatusCode::OK);
    for v in [same, code] {
        let (s, b) = v.expect("reservation has bounded busy result");
        assert_eq!(s, StatusCode::CONFLICT);
        assert_eq!(b["error"]["code"], "storage_location_busy");
    }
    let before = effects(&app).await;
    let (s, b) = request(
        &app,
        &token,
        Method::POST,
        "/api/v2/inventory/storage-locations",
        Some(input),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(b["data"], first.1["data"]);
    assert_eq!(effects(&app).await, before);
}
