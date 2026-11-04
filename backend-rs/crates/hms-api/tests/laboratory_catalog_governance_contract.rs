//! Production-router contracts for laboratory catalog governance.
mod support;
use sha2::{Digest, Sha256};
use support::*;

const PASSWORD: &str = "SyntheticLab33!CurrentCredential";
const OTHER_PASSWORD: &str = "SyntheticLab33!OtherCredential";

async fn public_lifecycle(app: &TestApp, email: &str, initial: &str, current: &str) -> String {
    let response = raw_password_login(app, email, initial, None).await;
    assert_eq!(
        response.status(),
        StatusCode::OK,
        "ordinary initial login succeeds"
    );
    let response = json_body(response).await;
    assert!(response["data"]["user"]["password_change_required"] == true);
    assert!(response["data"]["user"]["auth_security"]["privileged_user"] == false);
    let changed = fixture_json_post(
        app,
        response["data"]["access_token"].as_str(),
        "/api/v2/auth/password",
        json!({"current_password":initial,"new_password":current}),
    )
    .await;
    assert_eq!(
        changed.status(),
        StatusCode::OK,
        "mandatory password change succeeds"
    );
    let (token, _, _) = login_with_password(app.clone(), email, current).await;
    let before = access_claims(&token);
    let confirmed = fixture_json_post(
        app,
        Some(&token),
        "/api/v2/auth/reauthenticate",
        json!({"current_password":current}),
    )
    .await;
    assert_eq!(
        confirmed.status(),
        StatusCode::OK,
        "ordinary confirmation succeeds"
    );
    assert!(!confirmed.headers().contains_key(SET_COOKIE));
    let confirmed = json_body(confirmed).await;
    assert!(
        confirmed["data"]["ordinary_confirmation"]["purpose"] == "ordinary_password_confirmation"
    );
    assert!(confirmed["data"]["user"]["auth_security"]["privileged_user"] == false);
    assert!(confirmed["data"]["user"]["auth_security"]["passkey_required"] == false);
    assert!(confirmed["data"]["user"]["auth_security"]["passkey_enrolled"] == false);
    let token = confirmed["data"]["access_token"]
        .as_str()
        .unwrap()
        .to_owned();
    let after = access_claims(&token);
    assert!(before.sub == after.sub && before.session_id == after.session_id);
    token
}

async fn ordinary(catalog: bool) -> (TestApp, String) {
    let app = app().await;
    let user = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    let pool = app.db_pool().await;
    for table in [
        "user_permissions",
        "user_features",
        "user_patient_visibility",
    ] {
        sqlx::query(&format!("DELETE FROM {table} WHERE user_id=$1"))
            .bind(user)
            .execute(&pool)
            .await
            .unwrap();
    }
    if catalog {
        grant_test_permission(&app, user, PermissionCode::LaboratoryCatalogManage).await;
    } else {
        grant_test_permission(&app, user, PermissionCode::LaboratoryOrderManage).await;
        grant_test_permission(&app, user, PermissionCode::PatientDemographicsView).await;
        grant_test_patient_visibility(&app, user, PatientDataVisibility::Demographics).await;
    }
    grant_test_feature(&app, user, FeatureKey::Laboratory).await;
    let token = public_lifecycle(&app, "limited@hms.local", "ChangeMe123!", PASSWORD).await;
    (app, token)
}

async fn request(
    app: &TestApp,
    token: &str,
    method: Method,
    path: &str,
    input: Option<Value>,
) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .extension(axum::extract::ConnectInfo(std::net::SocketAddr::from((
                    [127, 0, 0, 1],
                    46333,
                ))))
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    input.map(|value| value.to_string()).unwrap_or_default(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1_048_576).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

fn exact_keys(value: &Value, expected: &[&str]) -> bool {
    value.as_object().is_some_and(|value| {
        value.len() == expected.len() && expected.iter().all(|key| value.contains_key(*key))
    })
}

async fn targets(app: &TestApp) -> (Uuid, Uuid) {
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let test = sqlx::query_scalar(
        "SELECT id FROM lab_tests WHERE facility_id=$1 AND is_active ORDER BY id LIMIT 1",
    )
    .bind(facility)
    .fetch_one(&pool)
    .await
    .unwrap();
    let panel = sqlx::query_scalar(
        "SELECT id FROM lab_panels WHERE facility_id=$1 AND is_active ORDER BY id LIMIT 1",
    )
    .bind(facility)
    .fetch_one(&pool)
    .await
    .unwrap();
    (test, panel)
}

async fn detail(app: &TestApp, token: &str, family: &str, id: Uuid) -> Value {
    let (status, response) = request(
        app,
        token,
        Method::GET,
        &format!("/api/v2/laboratory/{family}/{id}/administration"),
        None,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "current administration detail succeeds"
    );
    response["data"].clone()
}

fn input(version: i64, active: bool) -> Value {
    json!({"client_request_id":Uuid::new_v4(),"expected_version":version,
        "is_active":active,"reason":"  Synthetic exact availability review  "})
}

async fn change(app: &TestApp, token: &str, family: &str, id: Uuid, input: Value) -> Value {
    let (status, response) = request(
        app,
        token,
        Method::POST,
        &format!("/api/v2/laboratory/{family}/{id}/availability"),
        Some(input),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "reviewed availability change succeeds"
    );
    let receipt = response["data"].clone();
    assert!(exact_keys(
        &receipt,
        &[
            "command_id",
            "client_request_id",
            "input_digest",
            "reviewed_input",
            "subject",
            "recorded_at",
            "recorded_by_user_id",
            "changed"
        ]
    ));
    assert!(exact_keys(
        &receipt["reviewed_input"],
        &[
            "action",
            "subject_kind",
            "subject_id",
            "client_request_id",
            "expected_version",
            "is_active",
            "reason"
        ]
    ));
    let digest = Sha256::digest(serde_json::to_vec(&receipt["reviewed_input"]).unwrap());
    let digest = digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    assert!(receipt["input_digest"].as_str() == Some(digest.as_str()));
    assert!(receipt["reviewed_input"]["reason"] == "Synthetic exact availability review");
    receipt
}

#[tokio::test]
async fn catalog33_nine_routes_are_ordinary_no_patient_purposes_with_original_results() {
    let (app, token) = ordinary(true).await;
    let anonymous = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/laboratory/test-administration")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(anonymous.status(), StatusCode::UNAUTHORIZED);
    let user = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    let pool = app.db_pool().await;
    let (permissions, visibility, factors): (i64, i64, i64) = sqlx::query_as(
        "SELECT(SELECT count(*)FROM effective_user_permissions WHERE user_id=$1),\
        (SELECT count(*)FROM user_patient_visibility WHERE user_id=$1),\
        (SELECT count(*)FROM auth_webauthn_credentials WHERE user_id=$1)",
    )
    .bind(user)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!((permissions, visibility, factors), (1, 0, 0));
    for path in [
        "/api/v2/laboratory/test-catalog",
        "/api/v2/laboratory/panels",
    ] {
        let (status, _) = request(&app, &token, Method::GET, path, None).await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "configuration grants no patient-purpose catalog access"
        );
    }
    for path in [
        "/api/v2/laboratory/test-administration",
        "/api/v2/laboratory/panel-administration",
    ] {
        let (status, response) = request(&app, &token, Method::GET, path, None).await;
        assert_eq!(status, StatusCode::OK);
        assert!(response["page"]["limit"] == 25);
        let rows = response["data"].as_array().unwrap();
        assert!(!rows.is_empty());
        assert!(rows.iter().all(|row| exact_keys(
            row,
            &[
                "id",
                "code",
                "name",
                "is_active",
                "version",
                "catalog_changed_at",
                "created_at"
            ]
        )));
    }
    let (test, panel) = targets(&app).await;
    let test_before = detail(&app, &token, "test-catalog", test).await;
    let panel_before = detail(&app, &token, "panels", panel).await;
    for (subject, kind, count) in [(&test_before, "test", 14), (&panel_before, "panel", 12)] {
        assert!(exact_keys(subject, &["kind", "definition", "ordering"]));
        assert!(subject["kind"] == kind);
        assert_eq!(subject["definition"].as_object().unwrap().len(), count);
        assert!(exact_keys(
            &subject["ordering"],
            &["is_orderable", "blocked_by"]
        ));
    }
    let original_input = input(
        test_before["definition"]["version"].as_i64().unwrap(),
        false,
    );
    let original = change(&app, &token, "test-catalog", test, original_input.clone()).await;
    assert!(original["changed"] == true && original["subject"]["definition"]["is_active"] == false);
    let original_version = original["subject"]["definition"]["version"]
        .as_i64()
        .unwrap();
    let noop = change(
        &app,
        &token,
        "test-catalog",
        test,
        input(original_version, false),
    )
    .await;
    assert!(noop["changed"] == false && noop["subject"] == original["subject"]);
    let later = change(
        &app,
        &token,
        "test-catalog",
        test,
        input(original_version, true),
    )
    .await;
    assert!(later["subject"]["definition"]["is_active"] == true);
    assert!(later["subject"]["definition"]["version"].as_i64().unwrap() == original_version + 1);
    let replay = change(&app, &token, "test-catalog", test, original_input.clone()).await;
    assert!(
        replay == original,
        "later state never reinterprets the immutable original"
    );
    let key = original["client_request_id"].as_str().unwrap();
    let (status, recovered) = request(
        &app,
        &token,
        Method::GET,
        &format!("/api/v2/laboratory/catalog-commands/{key}"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(recovered["data"] == original);
    let mut changed_intent = original_input.clone();
    changed_intent["is_active"] = json!(true);
    for (family, id, reviewed) in [
        ("test-catalog", test, changed_intent),
        ("panels", panel, original_input),
    ] {
        let (status, refusal) = request(
            &app,
            &token,
            Method::POST,
            &format!("/api/v2/laboratory/{family}/{id}/availability"),
            Some(reviewed),
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT);
        assert!(refusal["error"]["code"] == "laboratory_catalog_request_conflict");
    }
    let panel_version = panel_before["definition"]["version"].as_i64().unwrap();
    change(&app, &token, "panels", panel, input(panel_version, false)).await;
    for (family, id, count) in [("test-catalog", test, 3), ("panels", panel, 1)] {
        let (status, response) = request(
            &app,
            &token,
            Method::GET,
            &format!("/api/v2/laboratory/{family}/{id}/history"),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let rows = response["data"].as_array().unwrap();
        assert_eq!(rows.len(), count);
        assert!(rows.iter().all(|row| exact_keys(
            row,
            &[
                "id",
                "action",
                "recorded_at",
                "before_version",
                "after_version",
                "before_is_active",
                "after_is_active",
                "changed"
            ]
        )));
        assert!(!response
            .to_string()
            .contains("Synthetic exact availability review"));
        assert!(!response.to_string().contains("recorded_by_user_id"));
    }
}

#[tokio::test]
async fn catalog33_closed_commands_bounds_nil_ids_and_no_partial_history() {
    let (app, token) = ordinary(true).await;
    let (test, _) = targets(&app).await;
    let before = detail(&app, &token, "test-catalog", test).await;
    let version = before["definition"]["version"].as_i64().unwrap();
    for missing in [
        "client_request_id",
        "expected_version",
        "is_active",
        "reason",
    ] {
        let mut value = input(version, false);
        value.as_object_mut().unwrap().remove(missing);
        let (status, _) = request(
            &app,
            &token,
            Method::POST,
            &format!("/api/v2/laboratory/test-catalog/{test}/availability"),
            Some(value),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }
    for (field, replacement) in [
        ("name", json!("Unsupported definition edit")),
        ("recorded_by_user_id", json!(Uuid::new_v4())),
        ("is_active", Value::Null),
        ("expected_version", json!(0)),
        ("client_request_id", json!(Uuid::nil())),
        ("reason", json!(" ")),
        ("reason", json!("x".repeat(1001))),
        ("reason", json!("é".repeat(2001))),
        ("reason", json!("Synthetic\u{0001}control")),
    ] {
        let mut value = input(version, false);
        value[field] = replacement;
        let (status, _) = request(
            &app,
            &token,
            Method::POST,
            &format!("/api/v2/laboratory/test-catalog/{test}/availability"),
            Some(value),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }
    for path in [
        "/api/v2/laboratory/test-administration?limit=0",
        "/api/v2/laboratory/test-administration?limit=101",
        "/api/v2/laboratory/test-administration?cursor=invalid",
        "/api/v2/laboratory/test-administration?search=%01",
        "/api/v2/laboratory/panel-administration?category=unsupported",
    ] {
        let (status, _) = request(&app, &token, Method::GET, path, None).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }
    let after = detail(&app, &token, "test-catalog", test).await;
    assert!(
        after == before,
        "refused commands preserve exact current definition"
    );
    let (status, history) = request(
        &app,
        &token,
        Method::GET,
        &format!("/api/v2/laboratory/test-catalog/{test}/history"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(history["data"].as_array().unwrap().is_empty());
    let mut boundary = input(version, false);
    boundary["reason"] = json!("\u{1f9ea}".repeat(1000));
    let (status, response) = request(
        &app,
        &token,
        Method::POST,
        &format!("/api/v2/laboratory/test-catalog/{test}/availability"),
        Some(boundary),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "exact scalar and UTF-8 boundary is accepted"
    );
    assert!(
        response["data"]["reviewed_input"]["reason"]
            .as_str()
            .unwrap()
            .len()
            == 4000
    );
}

#[tokio::test]
async fn catalog33_ordinary_orderer_has_clinical_reads_but_no_administration() {
    let (app, token) = ordinary(false).await;
    for path in [
        "/api/v2/laboratory/test-catalog",
        "/api/v2/laboratory/panels",
    ] {
        let (status, response) = request(&app, &token, Method::GET, path, None).await;
        assert_eq!(status, StatusCode::OK);
        let fields = if path.ends_with("panels") { 8 } else { 10 };
        let rows = response["data"].as_array().unwrap();
        assert!(!rows.is_empty());
        assert!(rows
            .iter()
            .all(|row| row.as_object().unwrap().len() == fields));
    }
    let (test, _) = targets(&app).await;
    for path in [
        "/api/v2/laboratory/test-administration".to_owned(),
        format!("/api/v2/laboratory/test-catalog/{test}/administration"),
        format!("/api/v2/laboratory/test-catalog/{test}/history"),
        format!("/api/v2/laboratory/catalog-commands/{}", Uuid::new_v4()),
    ] {
        let (status, _) = request(&app, &token, Method::GET, &path, None).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }
    let (status, _) = request(
        &app,
        &token,
        Method::POST,
        &format!("/api/v2/laboratory/test-catalog/{test}/availability"),
        Some(input(1, false)),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn catalog33_current_onsite_reads_do_not_require_a_fresh_write_credential() {
    let (app, token) = ordinary(true).await;
    let (test, _) = targets(&app).await;
    let before = detail(&app, &token, "test-catalog", test).await;
    let version = before["definition"]["version"].as_i64().unwrap();
    let original = change(&app, &token, "test-catalog", test, input(version, false)).await;
    let pool = app.db_pool().await;
    sqlx::query("UPDATE refresh_sessions SET password_verified_at=clock_timestamp()-interval '16 minutes' WHERE session_id=$1")
        .bind(access_claims(&token).session_id).execute(&pool).await.unwrap();
    sqlx::query("UPDATE facility_network_policies SET version=version+1,onsite_cidrs=ARRAY['127.0.0.0/8']::cidr[],offsite_mode='deny' WHERE facility_id=$1")
        .bind(app.state().facility_id()).execute(&pool).await.unwrap();
    for path in [
        "/api/v2/laboratory/test-administration".to_owned(),
        format!("/api/v2/laboratory/test-catalog/{test}/administration"),
        format!("/api/v2/laboratory/test-catalog/{test}/history"),
    ] {
        let (status, _) = request(&app, &token, Method::GET, &path, None).await;
        assert_eq!(status, StatusCode::OK);
    }
    let key = original["client_request_id"].as_str().unwrap();
    let (status, _) = request(
        &app,
        &token,
        Method::GET,
        &format!("/api/v2/laboratory/catalog-commands/{key}"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let current = original["subject"]["definition"]["version"]
        .as_i64()
        .unwrap();
    let (status, _) = request(
        &app,
        &token,
        Method::POST,
        &format!("/api/v2/laboratory/test-catalog/{test}/availability"),
        Some(input(current, true)),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn catalog33_foreign_and_wrong_kind_targets_are_hidden() {
    let (app, token) = ordinary(true).await;
    let pool = app.db_pool().await;
    let foreign_facility = Uuid::new_v4();
    let foreign_test = Uuid::new_v4();
    sqlx::query("INSERT INTO facilities(id,code,name,deployment_profile) VALUES($1,'S33_FOREIGN','Synthetic foreign catalog','hospital')")
        .bind(foreign_facility).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO lab_tests(id,facility_id,code,name,specimen_type) VALUES($1,$2,'S33_FOREIGN','Synthetic foreign definition','blood')")
        .bind(foreign_test).bind(foreign_facility).execute(&pool).await.unwrap();
    let (local_test, _) = targets(&app).await;
    for (family, id) in [
        ("test-catalog", foreign_test),
        ("test-catalog", Uuid::new_v4()),
        ("panels", local_test),
    ] {
        for suffix in ["administration", "history"] {
            let (status, _) = request(
                &app,
                &token,
                Method::GET,
                &format!("/api/v2/laboratory/{family}/{id}/{suffix}"),
                None,
            )
            .await;
            assert_eq!(status, StatusCode::NOT_FOUND);
        }
        let (status, _) = request(
            &app,
            &token,
            Method::POST,
            &format!("/api/v2/laboratory/{family}/{id}/availability"),
            Some(input(1, false)),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);
    }
}

#[tokio::test]
async fn catalog33_equally_authorized_other_actor_cannot_adopt_an_original_uuid() {
    let (app, token) = ordinary(true).await;
    let (test, _) = targets(&app).await;
    let current = detail(&app, &token, "test-catalog", test).await;
    let original_input = input(current["definition"]["version"].as_i64().unwrap(), false);
    let original = change(&app, &token, "test-catalog", test, original_input.clone()).await;
    let pool = app.db_pool().await;
    let other = Uuid::new_v4();
    let email = format!("synthetic-lab33-{other}@hms.local");
    sqlx::query("INSERT INTO users(id,facility_id,email,display_name,password_hash,password_change_required) SELECT $1,facility_id,$2,'Synthetic other catalog user',password_hash,true FROM users WHERE id=$3")
        .bind(other).bind(&email).bind(Uuid::from_u128(hms_db::provision::LIMITED_USER_ID))
        .execute(&pool).await.unwrap();
    grant_test_permission(&app, other, PermissionCode::LaboratoryCatalogManage).await;
    grant_test_feature(&app, other, FeatureKey::Laboratory).await;
    let other_token = public_lifecycle(&app, &email, PASSWORD, OTHER_PASSWORD).await;
    let (status, _) = request(
        &app,
        &other_token,
        Method::GET,
        "/api/v2/laboratory/test-administration",
        None,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "the other actor has genuine current authority"
    );
    let key = original["client_request_id"].as_str().unwrap();
    let path = format!("/api/v2/laboratory/catalog-commands/{key}");
    let (status, _) = request(&app, &other_token, Method::GET, &path, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, refusal) = request(
        &app,
        &other_token,
        Method::POST,
        &format!("/api/v2/laboratory/test-catalog/{test}/availability"),
        Some(original_input),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(refusal["error"]["code"] == "laboratory_catalog_request_conflict");
    let (status, recovered) = request(&app, &token, Method::GET, &path, None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(recovered["data"] == original);
}
