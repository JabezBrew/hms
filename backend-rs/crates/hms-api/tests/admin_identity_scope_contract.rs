//! Historical/imported inconsistent identity links must not cross facilities.
mod support;
use support::*;

const FOREIGN_NAME: &str = "FOREIGN-IDENTITY-MARKER";
const FOREIGN_LICENSE: &str = "FOREIGN-LICENSE-MARKER";

async fn user(pool: &hms_db::PgPool, facility: Uuid, name: &str) -> Uuid {
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO users(id,facility_id,email,display_name,password_hash) VALUES($1,$2,$3,$4,'unusable-isolated-identity-fixture')")
        .bind(id).bind(facility).bind(format!("{id}@synthetic.invalid")).bind(name).execute(pool).await.unwrap();
    id
}
async fn staff(pool: &hms_db::PgPool, facility: Uuid, user: Uuid, code: &str) -> Uuid {
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO staff_profiles(id,facility_id,user_id,employee_id,department,position,hire_date) VALUES($1,$2,$3,$4,'Synthetic department','Synthetic position',CURRENT_DATE)")
        .bind(id).bind(facility).bind(user).bind(code).execute(pool).await.unwrap();
    id
}
async fn practitioner(pool: &hms_db::PgPool, facility: Uuid, staff: Uuid, license: &str) -> Uuid {
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO practitioner_profiles(id,facility_id,staff_id,license_number,specialization,qualification) VALUES($1,$2,$3,$4,'Synthetic specialization','Synthetic qualification')")
        .bind(id).bind(facility).bind(staff).bind(license).execute(pool).await.unwrap();
    id
}
async fn foreign(pool: &hms_db::PgPool) -> Uuid {
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO facilities(id,code,name,deployment_profile) VALUES($1,'IDENTITY-FOREIGN','Synthetic isolated facility','hospital')")
        .bind(id).execute(pool).await.unwrap();
    id
}
async fn read(app: &TestApp, token: &str, path: &str) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(path)
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    (status, json_body(response).await)
}
fn private(value: &Value) {
    let encoded = value.to_string();
    assert!(
        !encoded.contains(FOREIGN_NAME),
        "foreign identity never appears in a local projection"
    );
    assert!(
        !encoded.contains(FOREIGN_LICENSE),
        "foreign practitioner metadata never appears in a local projection"
    );
}
async fn account_state(pool: &hms_db::PgPool, user: Uuid) -> Value {
    sqlx::query_scalar("SELECT jsonb_build_object('active',is_active,'session_version',session_version,'permission_version',permission_version,'updated_at',updated_at,'audit',(SELECT count(*) FROM audit_events)) FROM users WHERE id=$1")
        .bind(user).fetch_one(pool).await.unwrap()
}

#[tokio::test]
async fn local_staff_cannot_project_or_operate_on_a_legacy_foreign_user_link() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let pool = app.db_pool().await;
    let local = app.state().facility_id();
    let other = foreign(&pool).await;
    let foreign_user = user(&pool, other, FOREIGN_NAME).await;
    let corrupt = staff(&pool, local, foreign_user, "IDENTITY-BAD-USER").await;
    sqlx::query("UPDATE staff_profiles SET department='INCONSISTENT-IDENTITY-FACET' WHERE id=$1")
        .bind(corrupt)
        .execute(&pool)
        .await
        .unwrap();
    let valid_user = user(&pool, local, "Synthetic valid local account").await;
    let valid = staff(&pool, local, valid_user, "IDENTITY-VALID").await;
    let before = account_state(&pool, foreign_user).await;
    let (positive, body) = read(&app, &token, &format!("/api/v2/admin/staff/{valid}")).await;
    assert_eq!(positive, StatusCode::OK);
    private(&body);
    for path in [
        "/api/v2/admin/staff?limit=100",
        "/api/v2/staff/directory?limit=100",
    ] {
        let (status, body) = read(&app, &token, path).await;
        assert_eq!(status, StatusCode::OK);
        private(&body);
        assert!(
            body["data"]
                .as_array()
                .unwrap()
                .iter()
                .all(|row| row["user_id"].as_str() != Some(&foreign_user.to_string())),
            "inconsistent user is excluded before projection"
        );
    }
    let (status, body) = read(&app, &token, "/api/v2/admin/staff/filter-facets").await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        body["data"]["departments"]
            .as_array()
            .unwrap()
            .iter()
            .all(|row| row["value"] != "INCONSISTENT-IDENTITY-FACET"),
        "invalid identity links do not contribute local staff facets"
    );
    let (status, body) = read(&app, &token, &format!("/api/v2/admin/staff/{corrupt}")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    private(&body);
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/admin/staff/{corrupt}/deactivate"))
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let body = json_body(response).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    private(&body);
    assert!(
        before == account_state(&pool, foreign_user).await,
        "foreign account and audit remain unchanged"
    );
    let retained: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM staff_profiles WHERE id=$1 AND facility_id=$2 AND user_id=$3",
    )
    .bind(corrupt)
    .bind(local)
    .bind(foreign_user)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        retained, 1,
        "corrupt historical source is retained for explicit review"
    );
}

#[tokio::test]
async fn optional_foreign_practitioner_is_redacted_without_hiding_valid_local_staff() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let pool = app.db_pool().await;
    let local = app.state().facility_id();
    let other = foreign(&pool).await;
    let local_user = user(&pool, local, "Synthetic local staff").await;
    let local_staff = staff(&pool, local, local_user, "IDENTITY-OPTIONAL").await;
    let corrupt = practitioner(&pool, other, local_staff, FOREIGN_LICENSE).await;
    let before = account_state(&pool, local_user).await;
    let (status, body) = read(&app, &token, &format!("/api/v2/admin/staff/{local_staff}")).await;
    assert_eq!(status, StatusCode::OK);
    private(&body);
    assert!(
        body["data"]["practitioner_profile"].is_null(),
        "foreign optional profile is not asserted as local evidence"
    );
    let (status, body) = read(
        &app,
        &token,
        "/api/v2/admin/staff?limit=100&practitioners_only=true",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    private(&body);
    assert!(
        body["data"]
            .as_array()
            .unwrap()
            .iter()
            .all(|row| row["id"].as_str() != Some(&local_staff.to_string())),
        "foreign profile does not satisfy local practitioner filter"
    );
    let (status, body) = read(
        &app,
        &token,
        &format!("/api/v2/admin/practitioners/{corrupt}"),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    private(&body);
    assert!(
        before == account_state(&pool, local_user).await,
        "read redaction has no identity/audit effects"
    );
    let retained: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM practitioner_profiles WHERE id=$1 AND facility_id=$2 AND staff_id=$3",
    )
    .bind(corrupt)
    .bind(other)
    .bind(local_staff)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(retained, 1, "source is preserved");
}

#[tokio::test]
async fn local_practitioner_cannot_follow_a_foreign_staff_and_user_chain() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let pool = app.db_pool().await;
    let local = app.state().facility_id();
    let other = foreign(&pool).await;
    let foreign_user = user(&pool, other, FOREIGN_NAME).await;
    let foreign_staff = staff(&pool, other, foreign_user, "IDENTITY-FOREIGN").await;
    let corrupt = practitioner(&pool, local, foreign_staff, FOREIGN_LICENSE).await;
    let valid_user = user(&pool, local, "Synthetic valid local practitioner").await;
    let valid_staff = staff(&pool, local, valid_user, "IDENTITY-VALID").await;
    let valid = practitioner(&pool, local, valid_staff, "SYNTHETIC-LOCAL-LICENSE").await;
    let before = account_state(&pool, foreign_user).await;
    let (status, body) = read(
        &app,
        &token,
        &format!("/api/v2/admin/practitioners/{valid}"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    private(&body);
    let (status, body) = read(&app, &token, "/api/v2/admin/practitioners?limit=100").await;
    assert_eq!(status, StatusCode::OK);
    private(&body);
    assert!(
        body["data"]
            .as_array()
            .unwrap()
            .iter()
            .all(|row| row["id"].as_str() != Some(&corrupt.to_string())),
        "inconsistent local-leading profile is excluded before projection"
    );
    for key in [corrupt, foreign_staff] {
        let (status, body) =
            read(&app, &token, &format!("/api/v2/admin/practitioners/{key}")).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        private(&body);
    }
    assert!(
        before == account_state(&pool, foreign_user).await,
        "foreign source account/audit unchanged"
    );
}

#[tokio::test]
async fn local_practitioner_upsert_cannot_overwrite_a_foreign_existing_profile() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let pool = app.db_pool().await;
    let local = app.state().facility_id();
    let other = foreign(&pool).await;
    let local_user = user(&pool, local, "Synthetic local staff").await;
    let local_staff = staff(&pool, local, local_user, "IDENTITY-CONFLICT").await;
    let corrupt = practitioner(&pool, other, local_staff, FOREIGN_LICENSE).await;
    let before_account = account_state(&pool, local_user).await;
    let before_profile: Value =
        sqlx::query_scalar("SELECT to_jsonb(p) FROM practitioner_profiles p WHERE p.id=$1")
            .bind(corrupt)
            .fetch_one(&pool)
            .await
            .unwrap();
    let before_staff: Value =
        sqlx::query_scalar("SELECT to_jsonb(s) FROM staff_profiles s WHERE s.id=$1")
            .bind(local_staff)
            .fetch_one(&pool)
            .await
            .unwrap();
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::PUT)
                .uri(format!(
                    "/api/v2/admin/staff/{local_staff}/practitioner-profile"
                ))
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "license_number":"SYNTHETIC-REVIEWED-LOCAL-LICENSE",
                        "specialization":"Synthetic local specialization",
                        "qualification":"Synthetic local qualification",
                        "fhir_practitioner_id":null
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let body = json_body(response).await;
    let after_profile: Value =
        sqlx::query_scalar("SELECT to_jsonb(p) FROM practitioner_profiles p WHERE p.id=$1")
            .bind(corrupt)
            .fetch_one(&pool)
            .await
            .unwrap();
    let after_staff: Value =
        sqlx::query_scalar("SELECT to_jsonb(s) FROM staff_profiles s WHERE s.id=$1")
            .bind(local_staff)
            .fetch_one(&pool)
            .await
            .unwrap();
    let after_account = account_state(&pool, local_user).await;
    eprintln!(
        "practitioner_scope_conflict status={} profile_changed={} staff_changed={} account_or_audit_changed={}",
        status.as_u16(),
        before_profile != after_profile,
        before_staff != after_staff,
        before_account != after_account
    );
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"]["code"], "practitioner_profile_scope_conflict");
    private(&body);
    assert!(body["data"].is_null());
    assert!(
        before_profile == after_profile,
        "foreign source profile remains unchanged and is not adopted or rekeyed"
    );
    assert!(before_staff == after_staff, "local staff remains unchanged");
    assert!(
        before_account == after_account,
        "no account change or successful business audit"
    );
    let (status, body) = read(&app, &token, &format!("/api/v2/admin/staff/{local_staff}")).await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["data"]["practitioner_profile"].is_null());
    private(&body);
}
