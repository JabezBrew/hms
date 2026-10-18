use super::*;
#[tokio::test]
async fn feature_and_demographics_are_independent_and_offsite_readonly_never_grants_write() {
    let (app, owner) = setup().await;
    let user = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    grant_test_permission(&app, user, PermissionCode::InventoryView).await;
    grant_test_permission(&app, user, PermissionCode::InventoryManage).await;
    let (t, _, _) = login(app.clone(), "limited@hms.local").await;
    assert_eq!(
        request(
            &app,
            &t,
            Method::GET,
            "/api/v2/inventory/storage-locations/administration",
            None
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    grant_test_feature(&app, user, FeatureKey::Inventory).await;
    grant_test_permission(&app, user, PermissionCode::PatientDemographicsView).await;
    let (t, _, _) = login(app.clone(), "limited@hms.local").await;
    assert_eq!(
        request(
            &app,
            &t,
            Method::GET,
            "/api/v2/inventory/storage-locations/administration",
            None
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    grant_test_patient_visibility(&app, user, PatientDataVisibility::Demographics).await;
    let (t, _, _) = login(app.clone(), "limited@hms.local").await;
    assert_eq!(
        request(
            &app,
            &t,
            Method::GET,
            "/api/v2/inventory/storage-locations/administration",
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    create(&app, &t, "SYNTH21_DEMOS_ONLY").await;
    let before = effects(&app).await;
    let mut statuses = vec![];
    for method in [Method::GET, Method::POST] {
        let path = if method == Method::GET {
            "/api/v2/inventory/storage-locations/administration"
        } else {
            "/api/v2/inventory/storage-locations"
        };
        let mut req = Request::builder()
            .method(method)
            .uri(path)
            .header(AUTHORIZATION, format!("Bearer {t}"))
            .header("content-type", "application/json")
            .header("x-hms-offsite", "false")
            .header("x-forwarded-for", "127.0.0.1")
            .body(Body::from(create_input("SYNTH21_OFFSITE").to_string()))
            .unwrap();
        req.extensions_mut().insert(axum::extract::ConnectInfo(
            "192.0.2.23:44000".parse::<std::net::SocketAddr>().unwrap(),
        ));
        statuses.push(app.clone().oneshot(req).await.unwrap().status().as_u16());
    }
    assert_eq!(statuses, [200, 403]);
    assert_eq!(effects(&app).await, before);
    let pool = app.db_pool().await;
    sqlx::query("INSERT INTO facility_feature_entitlements(facility_id,feature_key,enabled)VALUES($1,'inventory',false)ON CONFLICT(facility_id,feature_key)DO UPDATE SET enabled=false").bind(app.state().facility_id()).execute(&pool).await.unwrap();
    let (fresh, _, _) = login(app.clone(), "owner@hms.local").await;
    assert_eq!(
        request(
            &app,
            &fresh,
            Method::POST,
            "/api/v2/inventory/storage-locations",
            Some(create_input("SYNTH21_FEATURE_OFF"))
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(effects(&app).await, before);
    drop(owner);
}
#[tokio::test]
async fn a_network_epoch_wait_rejects_previously_resolved_authority_without_metadata_effects() {
    let (app, token) = setup().await;
    let pool = app.db_pool().await;
    let before = effects(&app).await;
    let mut gate = pool.begin().await.unwrap();
    sqlx::query("SELECT version FROM facility_network_policies WHERE facility_id=$1 FOR UPDATE")
        .bind(app.state().facility_id())
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
            Some(create_input("SYNTH21_NETWORK_EPOCH")),
        )
        .await
    });
    super::concurrency::wait_for_lock(
        &pool,
        "SELECT version FROM facility_network_policies WHERE facility_id=",
    )
    .await;
    sqlx::query("UPDATE facility_network_policies SET version=version+1 WHERE facility_id=$1")
        .bind(app.state().facility_id())
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
async fn final_audit_wait_cannot_outlive_the_actual_credential_proof() {
    let (app, token) = setup().await;
    let pool = app.db_pool().await;
    let mut claims = access_claims(&token);
    let at = Utc::now() - Duration::minutes(15) + Duration::seconds(3);
    claims.iat = at.timestamp() as usize;
    claims.auth_time = Some(claims.iat);
    let end = hms_access::ReauthState::from_authentication_time(
        chrono::DateTime::from_timestamp(claims.iat as i64, 0).unwrap(),
    )
    .required_after;
    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(b"test-only-hms-v2-jwt-secret"),
    )
    .unwrap();
    sqlx::raw_sql("CREATE FUNCTION wait_storage21_credential()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.event_type='inventory.storage_location.create' THEN PERFORM pg_advisory_xact_lock(17002805);END IF;RETURN NEW;END$$;CREATE TRIGGER wait_storage21_credential BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION wait_storage21_credential();").execute(&pool).await.unwrap();
    let mut gate = pool.acquire().await.unwrap();
    sqlx::query("SELECT pg_advisory_lock(17002805)")
        .execute(&mut *gate)
        .await
        .unwrap();
    let before = effects(&app).await;
    let a = app.clone();
    let pending = tokio::spawn(async move {
        request(
            &a,
            &token,
            Method::POST,
            "/api/v2/inventory/storage-locations",
            Some(create_input("SYNTH21_CREDENTIAL_END")),
        )
        .await
    });
    super::concurrency::wait_for_lock(&pool, "INSERT INTO audit_events").await;
    sqlx::query(
        "SELECT pg_sleep(GREATEST(0,extract(epoch FROM($1::timestamptz-clock_timestamp())))+0.03)",
    )
    .bind(end)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("SELECT pg_advisory_unlock(17002805)")
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
async fn temporary_facility_inventory_grant_expiry_is_retained_after_login_and_until_final_clock() {
    let (app, _) = setup().await;
    let user = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    grant_test_feature(&app, user, FeatureKey::Inventory).await;
    grant_test_permission(&app, user, PermissionCode::PatientDemographicsView).await;
    grant_test_patient_visibility(&app, user, PatientDataVisibility::Demographics).await;
    let pool = app.db_pool().await;
    let assignment = Uuid::new_v4();
    sqlx::query("INSERT INTO permission_assignments(id,facility_id,grantee_user_id,permission_code,scope_type,status,starts_at,ends_at,granted_by_user_id)VALUES($1,$2,$3,'inventory.manage','facility','active',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',$4)").bind(assignment).bind(app.state().facility_id()).bind(user).bind(Uuid::from_u128(hms_db::provision::OWNER_USER_ID)).execute(&pool).await.unwrap();
    let (token, _, _) = login(app.clone(), "limited@hms.local").await;
    sqlx::raw_sql("CREATE FUNCTION wait_storage21_grant()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.event_type='inventory.storage_location.create' THEN PERFORM pg_advisory_xact_lock(17002806);END IF;RETURN NEW;END$$;CREATE TRIGGER wait_storage21_grant BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION wait_storage21_grant();").execute(&pool).await.unwrap();
    let mut gate = pool.acquire().await.unwrap();
    sqlx::query("SELECT pg_advisory_lock(17002806)")
        .execute(&mut *gate)
        .await
        .unwrap();
    let end:chrono::DateTime<Utc>=sqlx::query_scalar("UPDATE permission_assignments SET ends_at=clock_timestamp()+interval '3 seconds' WHERE id=$1 RETURNING ends_at").bind(assignment).fetch_one(&pool).await.unwrap();
    let before = effects(&app).await;
    let a = app.clone();
    let pending = tokio::spawn(async move {
        request(
            &a,
            &token,
            Method::POST,
            "/api/v2/inventory/storage-locations",
            Some(create_input("SYNTH21_GRANT_END")),
        )
        .await
    });
    super::concurrency::wait_for_lock(&pool, "INSERT INTO audit_events").await;
    sqlx::query(
        "SELECT pg_sleep(GREATEST(0,extract(epoch FROM($1::timestamptz-clock_timestamp())))+0.03)",
    )
    .bind(end)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("SELECT pg_advisory_unlock(17002806)")
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
