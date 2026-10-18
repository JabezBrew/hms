use super::*;
#[tokio::test]
async fn original_receipts_cas_noops_and_permanent_identity() {
    let (app, token) = setup().await;
    let input = create_input("SYNTH21_CAS");
    let (s, b) = request(
        &app,
        &token,
        Method::POST,
        "/api/v2/inventory/storage-locations",
        Some(input.clone()),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let original = b["data"].clone();
    let id = location_id(&original);
    let(s,b)=request(&app,&token,Method::POST,&format!("/api/v2/inventory/storage-locations/{id}/rename"),Some(json!({"client_request_id":Uuid::new_v4(),"expected_version":1,"name":original["location"]["name"]}))).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(b["data"]["changed"], false);
    assert_eq!(b["data"]["location"], original["location"]);
    let (s, retired) = command(&app, &token, id, "retire", 1).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(retired["data"]["location"]["version"], 2);
    assert_eq!(
        command(&app, &token, id, "reactivate", 1).await.0,
        StatusCode::CONFLICT
    );
    let (s, same) = command(&app, &token, id, "retire", 2).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(same["data"]["changed"], false);
    assert_eq!(same["data"]["location"], retired["data"]["location"]);
    assert_eq!(
        request(
            &app,
            &token,
            Method::GET,
            &format!("/api/v2/inventory/storage-locations/{id}"),
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        request(
            &app,
            &token,
            Method::GET,
            &format!("/api/v2/inventory/storage-locations/{id}/administration"),
            None
        )
        .await
        .1["data"],
        retired["data"]["location"]
    );
    let before = effects(&app).await;
    let (s, b) = request(
        &app,
        &token,
        Method::POST,
        "/api/v2/inventory/storage-locations",
        Some(input.clone()),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(b["data"], original);
    assert_eq!(effects(&app).await, before);
    let mut changed = input;
    changed["name"] = json!("Synthetic other intent");
    assert_eq!(
        request(
            &app,
            &token,
            Method::POST,
            "/api/v2/inventory/storage-locations",
            Some(changed)
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let pool = app.db_pool().await;
    for sql in [
        "UPDATE storage_locations SET code='SYNTH21_RETARGET' WHERE id=$1",
        "UPDATE storage_locations SET location_type='pharmacy' WHERE id=$1",
        "UPDATE storage_locations SET temperature_zone='frozen' WHERE id=$1",
        "DELETE FROM storage_locations WHERE id=$1",
    ] {
        assert!(sqlx::query(sql).bind(id).execute(&pool).await.is_err());
    }
    assert!(sqlx::query(
        "UPDATE storage_location_commands SET action='create' WHERE location_id=$1"
    )
    .bind(id)
    .execute(&pool)
    .await
    .is_err());
    assert_eq!(
        command(&app, &token, id, "reactivate", 2).await.0,
        StatusCode::OK
    );
    let mut duplicate = create_input("SYNTH21_CAS");
    duplicate["temperature_zone"] = json!("cold");
    assert_eq!(
        request(
            &app,
            &token,
            Method::POST,
            "/api/v2/inventory/storage-locations",
            Some(duplicate)
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let mut unsupported = create_input("SYNTH21_UNSUPPORTED");
    unsupported["parent"] = json!(id);
    assert!(request(
        &app,
        &token,
        Method::POST,
        "/api/v2/inventory/storage-locations",
        Some(unsupported)
    )
    .await
    .0
    .is_client_error());
}
#[tokio::test]
async fn ordinary_inventory_manager_needs_no_admin_or_privileged_factor_and_receipts_are_actor_bound(
) {
    let (app, token) = setup().await;
    let r = create(&app, &token, "SYNTH21_ACTOR").await;
    let pool = app.db_pool().await;
    let limited = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    grant_test_permission(&app, limited, PermissionCode::InventoryView).await;
    grant_test_feature(&app, limited, FeatureKey::Inventory).await;
    let (no_demographics, _, _) = login(app.clone(), "limited@hms.local").await;
    assert_eq!(
        request(
            &app,
            &no_demographics,
            Method::GET,
            "/api/v2/inventory/storage-locations/administration",
            None
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    grant_test_permission(&app, limited, PermissionCode::PatientDemographicsView).await;
    grant_test_patient_visibility(&app, limited, PatientDataVisibility::Demographics).await;
    let (viewer, _, _) = login(app.clone(), "limited@hms.local").await;
    let before = effects(&app).await;
    assert_eq!(
        request(
            &app,
            &viewer,
            Method::GET,
            "/api/v2/inventory/storage-locations/administration",
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        request(
            &app,
            &viewer,
            Method::POST,
            "/api/v2/inventory/storage-locations",
            Some(create_input("SYNTH21_DENIED"))
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(effects(&app).await, before);
    grant_test_permission(&app, limited, PermissionCode::InventoryManage).await;
    let (manager, _, _) = login(app.clone(), "limited@hms.local").await;
    let has_factor: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM auth_session_assurance WHERE session_id=$1)",
    )
    .bind(access_claims(&manager).session_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(
        !has_factor,
        "ordinary inventory manager does not need a privileged factor"
    );
    create(&app, &manager, "SYNTH21_ORDINARY_MANAGER").await;
    assert_eq!(
        request(
            &app,
            &manager,
            Method::GET,
            &format!(
                "/api/v2/inventory/storage-locations/commands/{}",
                r["client_request_id"].as_str().unwrap()
            ),
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let mut collision = create_input("SYNTH21_COLLISION");
    collision["client_request_id"] = r["client_request_id"].clone();
    assert_eq!(
        request(
            &app,
            &manager,
            Method::POST,
            "/api/v2/inventory/storage-locations",
            Some(collision)
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let stale = token_with_stale_reauth(&manager);
    assert_eq!(
        request(
            &app,
            &stale,
            Method::POST,
            "/api/v2/inventory/storage-locations",
            Some(create_input("SYNTH21_STALE"))
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
}
#[tokio::test]
async fn bounded_management_directory_includes_inactive_versions_without_broadening_active_selectors(
) {
    let (app, token) = setup().await;
    let pool = app.db_pool().await;
    sqlx::query("INSERT INTO storage_locations(id,facility_id,code,name,is_active)SELECT gen_random_uuid(),$1,'SYNTH21_PAGE_'||g,'Synthetic inactive paged location',false FROM generate_series(1,103)g").bind(app.state().facility_id()).execute(&pool).await.unwrap();
    let(s,first)=request(&app,&token,Method::GET,"/api/v2/inventory/storage-locations/administration?limit=100&is_active=false&location_type=store&temperature_zone=ambient",None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(first["data"].as_array().unwrap().len(), 100);
    assert_eq!(first["page"]["has_next"], true);
    let cursor = first["page"]["next_cursor"].as_str().unwrap();
    let(s,last)=request(&app,&token,Method::GET,&format!("/api/v2/inventory/storage-locations/administration?limit=100&is_active=false&location_type=store&temperature_zone=ambient&cursor={cursor}"),None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(last["data"].as_array().unwrap().len(), 3);
    assert_eq!(last["page"]["has_next"], false);
    let mut ids = std::collections::BTreeSet::new();
    for r in first["data"]
        .as_array()
        .unwrap()
        .iter()
        .chain(last["data"].as_array().unwrap())
    {
        assert_eq!(r["version"], 1);
        assert_eq!(r["is_active"], false);
        assert!(ids.insert(r["id"].as_str().unwrap()));
    }
    let (s, active) = request(
        &app,
        &token,
        Method::GET,
        "/api/v2/inventory/storage-locations?limit=100",
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert!(active["data"]
        .as_array()
        .unwrap()
        .iter()
        .all(|r| !ids.contains(r["id"].as_str().unwrap())));
}
#[tokio::test]
async fn audit_fault_rolls_back_metadata_receipt_and_audit_without_exposing_sql() {
    let (app, token) = setup().await;
    let pool = app.db_pool().await;
    sqlx::raw_sql("CREATE FUNCTION reject_storage21_audit()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.event_type='inventory.storage_location.create' THEN RAISE EXCEPTION 'synthetic private detail';END IF;RETURN NEW;END$$;CREATE TRIGGER reject_storage21_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_storage21_audit();").execute(&pool).await.unwrap();
    let before = effects(&app).await;
    let (s, b) = request(
        &app,
        &token,
        Method::POST,
        "/api/v2/inventory/storage-locations",
        Some(create_input("SYNTH21_ATOMIC")),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(b["error"]["code"], "storage_location_write_unconfirmed");
    assert!(!b.to_string().contains("synthetic private"));
    assert_eq!(effects(&app).await, before);
}
