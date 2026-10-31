use super::*;
#[tokio::test]
async fn view_only_access_keeps_minimal_reads_but_denies_commands_and_private_receipts() {
    let (app, t) = ordinary().await;
    let created = create(&app, &t, "S24_VIEW_POLICY").await;
    let id = item_id(&created);
    let pool = app.db_pool().await;
    let unknown = Uuid::new_v4();
    assert_eq!(
        request(
            &app,
            &t,
            Method::GET,
            &format!("/api/v2/inventory/item-commands/{unknown}"),
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    sqlx::query(
        "DELETE FROM user_permissions WHERE user_id=$1 AND permission_code='inventory.manage'",
    )
    .bind(Uuid::from_u128(hms_db::provision::LIMITED_USER_ID))
    .execute(&pool)
    .await
    .unwrap();
    let (t, _, _) = login_with_password(app.clone(), "limited@hms.local", PASSWORD).await;
    for path in [
        "/api/v2/inventory/items/administration?limit=1".to_owned(),
        format!("/api/v2/inventory/items/{id}/administration"),
        format!("/api/v2/inventory/items/{id}/catalog-history?limit=1"),
    ] {
        let (s, b) = request(&app, &t, Method::GET, &path, None).await;
        assert_eq!(s, StatusCode::OK);
        let text = b.to_string();
        assert!(
            !text.contains("recorded_by_user_id") && !text.contains("reason\""),
            "general reads omit private receipt facts"
        );
    }
    let before = effects(&app).await;
    assert_eq!(
        request(
            &app,
            &t,
            Method::POST,
            "/api/v2/inventory/items",
            Some(create_input(&app, "S24_VIEW_DENIED").await)
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        correction(
            &app,
            &t,
            id,
            1,
            today(),
            "tablet",
            "Synthetic forbidden label"
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        lifecycle(&app, &t, id, "retire", 1).await.0,
        StatusCode::FORBIDDEN
    );
    let key = created["client_request_id"].as_str().unwrap();
    assert_eq!(
        request(
            &app,
            &t,
            Method::GET,
            &format!("/api/v2/inventory/item-commands/{key}"),
            None
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(effects(&app).await, before);
    println!("ITEM24 view-only general reads/private receipt and all commands have independent least-privilege behavior");
}
#[tokio::test]
async fn future_or_expired_raw_credential_facts_never_authorize_catalog_publication() {
    let (app, t) = ordinary().await;
    let created = create(&app, &t, "S24_FRESH_POLICY").await;
    let id = item_id(&created);
    let claims = access_claims(&t);
    let pool = app.db_pool().await;
    let before = effects(&app).await;
    for interval in ["-16 minutes", "1 minute"] {
        assert!(matches!(interval, "-16 minutes" | "1 minute"));
        sqlx::query("UPDATE refresh_sessions SET password_verified_at=clock_timestamp()+$2::interval WHERE session_id=$1").bind(claims.session_id).bind(interval).execute(&pool).await.unwrap();
        let (s, _) = request(
            &app,
            &t,
            Method::GET,
            &format!("/api/v2/inventory/items/{id}/administration"),
            None,
        )
        .await;
        assert_eq!(s, StatusCode::OK);
        let (s, _) = correction(
            &app,
            &t,
            id,
            1,
            today(),
            "tablet",
            "Synthetic blocked credential label",
        )
        .await;
        assert_eq!(s, StatusCode::FORBIDDEN);
        assert_eq!(effects(&app).await, before);
    }
    let (current_login, _, _) =
        login_with_password(app.clone(), "limited@hms.local", PASSWORD).await;
    let response = fixture_json_post(
        &app,
        Some(&current_login),
        "/api/v2/auth/reauthenticate",
        json!({"current_password":PASSWORD}),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let data = json_body(response).await;
    let current = data["data"]["access_token"].as_str().unwrap();
    assert_eq!(
        correction(
            &app,
            current,
            id,
            1,
            today(),
            "tablet",
            "Synthetic confirmed current label"
        )
        .await
        .0,
        StatusCode::OK
    );
    println!("ITEM24 raw future/old credential lowerbounds refuse0effects; actual current password confirmation restores publication");
}
#[tokio::test]
async fn catalog_audit_failure_rolls_back_projection_receipt_revision_and_version() {
    let (app, t) = ordinary().await;
    let created = create(&app, &t, "S24_AUDIT_ROLLBACK").await;
    let id = item_id(&created);
    let pool = app.db_pool().await;
    let before = effects(&app).await;
    let snapshot = detail(&app, &t, id).await;
    sqlx::raw_sql("CREATE FUNCTION refuse_item24_audit()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.event_type='inventory.item.correct' THEN RAISE EXCEPTION 'synthetic_audit_refusal';END IF;RETURN NEW;END$$;CREATE TRIGGER refuse_item24_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION refuse_item24_audit();").execute(&pool).await.unwrap();
    let (s, b) = correction(
        &app,
        &t,
        id,
        1,
        today(),
        "pack",
        "Synthetic rolled-back label",
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(b["error"]["code"], "inventory_item_write_unconfirmed");
    assert_eq!(effects(&app).await, before);
    assert_eq!(detail(&app, &t, id).await, snapshot);
    println!("ITEM24 audit exception rolls back current item/CAS clock plus immutable receipt/revision publication");
}
#[tokio::test]
async fn catalog_final_current_grant_deadline_rolls_back_after_actual_audit_barrier() {
    let (app, t) = ordinary().await;
    let id = item_id(&create(&app, &t, "S24_CATALOG_EXPIRY").await);
    let pool = app.db_pool().await;
    let f = app.state().facility_id();
    let user = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    sqlx::query(
        "DELETE FROM user_permissions WHERE user_id=$1 AND permission_code='inventory.manage'",
    )
    .bind(user)
    .execute(&pool)
    .await
    .unwrap();
    let end:chrono::DateTime<Utc>=sqlx::query_scalar("INSERT INTO permission_assignments(id,facility_id,grantee_user_id,permission_code,scope_type,status,starts_at,ends_at,granted_by_user_id)VALUES($1,$2,$3,'inventory.manage','facility','active',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '3 seconds',$4)RETURNING ends_at").bind(Uuid::new_v4()).bind(f).bind(user).bind(Uuid::from_u128(hms_db::provision::OWNER_USER_ID)).fetch_one(&pool).await.unwrap();
    let (t, _, _) = login_with_password(app.clone(), "limited@hms.local", PASSWORD).await;
    let before = effects(&app).await;
    let snapshot = detail(&app, &t, id).await;
    let key = 24003029;
    sqlx::raw_sql("CREATE FUNCTION wait_item24_expiry()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.event_type='inventory.item.correct' THEN PERFORM pg_advisory_xact_lock(24003029);END IF;RETURN NEW;END$$;CREATE TRIGGER wait_item24_expiry BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION wait_item24_expiry();").execute(&pool).await.unwrap();
    let mut held = pool.begin().await.unwrap();
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(key)
        .execute(&mut *held)
        .await
        .unwrap();
    let a = app.clone();
    let token = t.clone();
    let pending = tokio::spawn(async move {
        correction(
            &a,
            &token,
            id,
            1,
            today(),
            "pack",
            "Synthetic expired catalog",
        )
        .await
    });
    super::transfers::wait_audit(&pool, key).await;
    loop {
        let expired: bool = sqlx::query_scalar("SELECT clock_timestamp()>$1")
            .bind(end)
            .fetch_one(&pool)
            .await
            .unwrap();
        if expired {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(30)).await;
    }
    held.rollback().await.unwrap();
    let (s, _) = pending.await.unwrap();
    assert_eq!(s, StatusCode::FORBIDDEN);
    assert_eq!(effects(&app).await, before);
    assert_eq!(detail(&app, &t, id).await, snapshot);
    println!(
        "ITEM24 final DB-clock authority deadline at real audit wait refuses all catalog effects"
    );
}
#[tokio::test]
async fn actual_code_and_request_uuid_reservations_refuse_without_waiting_or_effects() {
    let (app, t) = ordinary().await;
    let pool = app.db_pool().await;
    let f = app.state().facility_id();
    let input = create_input(&app, "S24_HELD_CODE").await;
    let before = effects(&app).await;
    let mut gate = pool.begin().await.unwrap();
    sqlx::query("SELECT inventory_item_reserve_codes($1,$2)")
        .bind(f)
        .bind(vec!["S24_HELD_CODE".to_owned()])
        .execute(&mut *gate)
        .await
        .unwrap();
    let (s, b) = request(
        &app,
        &t,
        Method::POST,
        "/api/v2/inventory/items",
        Some(input.clone()),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(b["error"]["code"], "inventory_item_busy");
    assert_eq!(effects(&app).await, before);
    gate.rollback().await.unwrap();
    let (s, b) = request(
        &app,
        &t,
        Method::POST,
        "/api/v2/inventory/items",
        Some(input),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    verify_receipt(&b["data"]);
    let input = create_input(&app, "S24_HELD_UUID").await;
    let key: Uuid = input["client_request_id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let mut bytes = b"hms.inventory-item.request.v1".to_vec();
    bytes.extend_from_slice(f.as_bytes());
    bytes.extend_from_slice(key.as_bytes());
    let hash = Sha256::digest(bytes);
    let lock = i64::from_be_bytes(hash[..8].try_into().unwrap());
    let before = effects(&app).await;
    let mut gate = pool.begin().await.unwrap();
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(lock)
        .execute(&mut *gate)
        .await
        .unwrap();
    let (s, b) = request(
        &app,
        &t,
        Method::POST,
        "/api/v2/inventory/items",
        Some(input.clone()),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(b["error"]["code"], "inventory_item_busy");
    assert_eq!(effects(&app).await, before);
    gate.rollback().await.unwrap();
    assert_eq!(
        request(
            &app,
            &t,
            Method::POST,
            "/api/v2/inventory/items",
            Some(input)
        )
        .await
        .0,
        StatusCode::OK
    );
    let before = effects(&app).await;
    let (s, b) = request(
        &app,
        &t,
        Method::POST,
        "/api/v2/inventory/items",
        Some(create_input(&app, "S24_HELD_CODE").await),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(b["error"]["code"], "inventory_item_code_conflict");
    assert_eq!(effects(&app).await, before);
    println!("ITEM24 actual held code/UUID reservations and committed code collisions refuse0effects with independent postrelease positives");
}
#[tokio::test]
async fn privileged_actor_cannot_read_or_replay_another_actors_original_receipt() {
    let (app, t) = ordinary().await;
    let input = create_input(&app, "S24_ORIGINAL_ACTOR").await;
    let (s, b) = request(
        &app,
        &t,
        Method::POST,
        "/api/v2/inventory/items",
        Some(input.clone()),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let key = b["data"]["client_request_id"].as_str().unwrap();
    let (owner, _, _) = login(app.clone(), "owner@hms.local").await;
    let before = effects(&app).await;
    assert_eq!(
        request(
            &app,
            &owner,
            Method::GET,
            &format!("/api/v2/inventory/item-commands/{key}"),
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let (s, b) = request(
        &app,
        &owner,
        Method::POST,
        "/api/v2/inventory/items",
        Some(input),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(b["error"]["code"], "inventory_item_request_conflict");
    assert_eq!(effects(&app).await, before);
    println!("ITEM24 real privileged-factor actor cannot retrieve or replay anotheractor immutable command");
}
