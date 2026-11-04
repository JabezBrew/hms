//! Fresh equally authorized ordinary actors cannot recover each other's immutable receipts.
use super::*;

#[tokio::test]
async fn supplier32_receipt_and_original_command_replay_bind_the_exact_original_actor() {
    let (app, token) = ordinary().await;
    let original_input = input("S32_ACTOR_ORIGINAL");
    let (status, original_body) = request(
        &app,
        &token,
        Method::POST,
        "/api/v2/inventory/supplier-administration",
        Some(original_input.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let original = original_body["data"].clone();
    let original_actor = access_claims(&token).sub;
    let pool = app.db_pool().await;
    let other = Uuid::new_v4();
    let email = "supplier-receipt-other@hms.local";
    // Isolated fixture account uses the already changed synthetic password hash;
    // its token and fresh credential witness still come from real public routes.
    sqlx::query("INSERT INTO users(id,facility_id,email,display_name,password_hash) SELECT $1,facility_id,$2,'Synthetic supplier reviewer',password_hash FROM users WHERE id=$3").bind(other).bind(email).bind(original_actor).execute(&pool).await.unwrap();
    for permission in [
        PermissionCode::InventoryView,
        PermissionCode::InventoryManage,
        PermissionCode::PatientDemographicsView,
    ] {
        grant_test_permission(&app, other, permission).await;
    }
    grant_test_feature(&app, other, FeatureKey::Inventory).await;
    grant_test_patient_visibility(&app, other, PatientDataVisibility::Demographics).await;
    let (other_token, _, _) = login_with_password(app.clone(), email, PASSWORD).await;
    let before = access_claims(&other_token);
    let confirmed = fixture_json_post(
        &app,
        Some(&other_token),
        "/api/v2/auth/reauthenticate",
        json!({"current_password":PASSWORD}),
    )
    .await;
    assert_eq!(confirmed.status(), StatusCode::OK);
    let confirmation = json_body(confirmed).await;
    let other_token = confirmation["data"]["access_token"].as_str().unwrap();
    let after = access_claims(other_token);
    assert!(
        before.sub == other
            && after.sub == other
            && other != original_actor
            && before.session_id == after.session_id,
        "real fresh confirmation retains the distinct ordinary actor/session"
    );
    let privileged:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM effective_user_permissions WHERE user_id=$1 AND(permission_code LIKE 'admin.%' OR permission_code='system.ops.manage'))").bind(other).fetch_one(&pool).await.unwrap();
    assert!(!privileged);
    let positive = create(&app, other_token, "S32_ACTOR_POSITIVE").await;
    assert!(
        positive["recorded_by_user_id"] == other.to_string(),
        "other actor passes the same actual command authority and freshness gates"
    );
    let key = original["client_request_id"].as_str().unwrap();
    let (status, missing) = request(
        &app,
        other_token,
        Method::GET,
        &format!("/api/v2/inventory/supplier-commands/{key}"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (unknown_status, unknown) = request(
        &app,
        other_token,
        Method::GET,
        &format!("/api/v2/inventory/supplier-commands/{}", Uuid::new_v4()),
        None,
    )
    .await;
    assert_eq!(unknown_status, StatusCode::NOT_FOUND);
    assert!(
        missing["error"]["code"] == unknown["error"]["code"]
            && missing["data"].is_null()
            && !missing.to_string().contains(PRIVATE),
        "another actor's receipt has the same scoped absence boundary as an unknown key"
    );
    let (status, replay) = request(
        &app,
        other_token,
        Method::POST,
        "/api/v2/inventory/supplier-administration",
        Some(original_input),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(
        replay["error"]["code"],
        "inventory_supplier_request_conflict"
    );
    assert!(replay["data"].is_null() && !replay.to_string().contains(PRIVATE));
    let (status, recovered) = request(
        &app,
        &token,
        Method::GET,
        &format!("/api/v2/inventory/supplier-commands/{key}"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        recovered["data"] == original,
        "original actor's exact immutable receipt remains recoverable"
    );
    let counts:(i64,i64)=sqlx::query_as("SELECT(SELECT count(*) FROM inventory_supplier_commands),(SELECT count(*) FROM audit_events WHERE resource_type='inventory_supplier')").fetch_one(&pool).await.unwrap();
    assert_eq!(counts, (2, 2));
}
