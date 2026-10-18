//! Exact-session password reconfirmation; all accounts and credentials are synthetic.
mod support;
use support::*;

const CONFIRM: &str = "/api/v2/auth/reauthenticate";
const PASSWORD: &str = "Synthetic22!CurrentCredential";

async fn ordinary() -> (TestApp, String, String, String) {
    ordinary_in(app().await).await
}

async fn ordinary_in(app: TestApp) -> (TestApp, String, String, String) {
    let user = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    for permission in [
        PermissionCode::InventoryView,
        PermissionCode::InventoryManage,
        PermissionCode::PatientDemographicsView,
    ] {
        grant_test_permission(&app, user, permission).await;
    }
    grant_test_feature(&app, user, FeatureKey::Inventory).await;
    grant_test_patient_visibility(&app, user, PatientDataVisibility::Demographics).await;
    let first = raw_password_login(&app, "limited@hms.local", "ChangeMe123!", None).await;
    assert_eq!(first.status(), StatusCode::OK);
    let first = json_body(first).await;
    let first_token = first["data"]["access_token"].as_str().unwrap();
    let changed = fixture_json_post(
        &app,
        Some(first_token),
        "/api/v2/auth/password",
        json!({"current_password":"ChangeMe123!","new_password":PASSWORD}),
    )
    .await;
    assert_eq!(
        changed.status(),
        StatusCode::OK,
        "real initial password lifecycle completes before confirmation tests"
    );
    let (token, cookie, csrf) =
        login_with_password(app.clone(), "limited@hms.local", PASSWORD).await;
    (app, token, cookie, csrf)
}

#[tokio::test]
async fn ordinary_password_confirmation_renews_exact_session_without_factor_or_cookie() {
    let (app, token, _, _) = ordinary().await;
    let pool = app.db_pool().await;
    let claims = access_claims(&token);
    sqlx::query("UPDATE refresh_sessions SET password_verified_at=clock_timestamp()-interval '16 minutes' WHERE session_id=$1").bind(claims.session_id).execute(&pool).await.unwrap();
    let stale = token_with_stale_reauth(&token);
    let before: (Uuid, chrono::DateTime<Utc>, chrono::DateTime<Utc>, chrono::DateTime<Utc>, chrono::DateTime<Utc>, i64) = sqlx::query_as("SELECT session_family_id,session_started_at,expires_at,idle_expires_at,absolute_expires_at,assurance_version FROM refresh_sessions WHERE session_id=$1").bind(claims.session_id).fetch_one(&pool).await.unwrap();
    let response = fixture_json_post(
        &app,
        Some(&stale),
        CONFIRM,
        json!({"current_password":PASSWORD}),
    )
    .await;
    let status = response.status();
    assert!(
        !response.headers().contains_key(SET_COOKIE),
        "same-session confirmation must preserve cookie material"
    );
    assert_eq!(
        status,
        StatusCode::OK,
        "ordinary exact-session password confirmation is reachable"
    );
    let body = json_body(response).await;
    let result = &body["data"];
    let new_token = result["access_token"].as_str().unwrap();
    let fresh = access_claims(new_token);
    assert_eq!(
        (
            fresh.sub,
            fresh.session_id,
            fresh.facility_id,
            fresh.session_version,
            fresh.permission_version
        ),
        (
            claims.sub,
            claims.session_id,
            claims.facility_id,
            claims.session_version,
            claims.permission_version
        )
    );
    assert_eq!(result["status"], "authenticated");
    assert_eq!(result["user"]["auth_security"]["passkey_required"], false);
    assert_eq!(result["user"]["auth_security"]["passkey_enrolled"], false);
    assert!(result["user"]["auth_security"]["session_assurance"]["method"].is_null());
    let after: (Uuid, chrono::DateTime<Utc>, chrono::DateTime<Utc>, chrono::DateTime<Utc>, chrono::DateTime<Utc>, i64) = sqlx::query_as("SELECT session_family_id,session_started_at,expires_at,idle_expires_at,absolute_expires_at,assurance_version FROM refresh_sessions WHERE session_id=$1").bind(claims.session_id).fetch_one(&pool).await.unwrap();
    assert_eq!(
        (after.0, after.1, after.2, after.3, after.4),
        (before.0, before.1, before.2, before.3, before.4)
    );
    assert_eq!(after.5, before.5 + 1);
    let rows: (i64, i64, i64) = sqlx::query_as("SELECT (SELECT count(*) FROM auth_session_assurance WHERE session_id=$1),(SELECT count(*) FROM audit_events WHERE event_type='auth.credential.reconfirmed' AND resource_id=$1),(SELECT count(*) FROM refresh_sessions WHERE user_id=$2 AND revoked_at IS NULL)").bind(claims.session_id).bind(claims.sub).fetch_one(&pool).await.unwrap();
    assert_eq!(rows, (0, 1, 1));
    let created = fixture_json_post(&app, Some(new_token), "/api/v2/inventory/storage-locations", json!({"client_request_id":Uuid::new_v4(),"code":"SYNTH22_ORDINARY","name":"Synthetic ordinary confirmation positive","location_type":"store","temperature_zone":"ambient"})).await;
    assert_eq!(created.status(), StatusCode::OK);
}

#[path = "ordinary_reauthentication_contract/attacks.rs"]
mod attacks;
#[path = "ordinary_reauthentication_contract/races.rs"]
mod races;
