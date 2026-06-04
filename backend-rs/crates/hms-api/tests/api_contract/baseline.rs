use super::*;

#[tokio::test]
async fn provisioned_baseline_uses_configured_facility_code_for_login() {
    let database =
        Arc::new(hms_db::test_support::TestDatabase::create().expect("test database is available"));
    let mut config = Config::for_tests_with_database_url(database.database_url().to_owned());
    config.facility_code = "MAIN".to_owned();
    let app = app_with_config(config, database).await;

    let response = app
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/login")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "email": "owner@hms.local",
                        "password": "ChangeMe123!",
                        "facility_code": "MAIN"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("login request succeeds");

    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["data"]["user"]["facility_code"], "MAIN");
}

#[tokio::test]
async fn baseline_supports_main_ui_patient_registration_prerequisites() {
    let app = app().await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let auth_header = format!("Bearer {access_token}");

    let departments_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/admin/org-units?unit_type=department&is_active=true&limit=20")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("department list succeeds");
    assert_eq!(departments_response.status(), StatusCode::OK);
    let departments_body = json_body(departments_response).await;
    let departments = departments_body["data"]
        .as_array()
        .expect("departments are an array");
    assert!(
        departments
            .iter()
            .any(|unit| unit["unit_type"].as_str() == Some("department")),
        "baseline must provision at least one active clinical department"
    );

    let capabilities_response = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/system/deployment-capabilities")
                .header(AUTHORIZATION, auth_header)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("deployment capabilities succeeds");
    assert_eq!(capabilities_response.status(), StatusCode::OK);
    let capabilities_body = json_body(capabilities_response).await;
    assert_eq!(
        capabilities_body["data"]["capabilities"]["outpatient_requires_active_clinic_schedule"],
        false
    );
}

#[tokio::test]
async fn omni_search_posts_access_scoped_projection_results() {
    let app = app().await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let auth_header = format!("Bearer {access_token}");

    let response = app
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/search/omni")
                .header(AUTHORIZATION, auth_header)
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "q": "Ama Mensah",
                        "types": ["patients"],
                        "limit": 5
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("omni search request succeeds");

    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["data"]["query"], "Ama Mensah");
    assert_eq!(
        body["data"]["groups"]["patients"][0]["patient_code"],
        "P-0000000001"
    );
    let patient_result = &body["data"]["groups"]["patients"][0];
    assert_eq!(patient_result["id"], patient_result["patient_id"]);
    assert_eq!(
        patient_result["route_path"],
        format!(
            "/patients/{}",
            patient_result["patient_id"]
                .as_str()
                .expect("patient id is serialized")
        )
    );
    assert_eq!(
        body["data"]["groups"]["patients"][0]["patient_date_of_birth"],
        "1990-02-14"
    );
    assert!(body["data"]["index_status"]
        .as_array()
        .expect("index status is an array")
        .iter()
        .any(|status| status["resource_type"] == "patients" && status["status"] == "ready"));
}

#[tokio::test]
async fn omni_search_hot_path_reuses_scoped_cache() {
    let app = app().await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let claims = access_claims(&access_token);
    let user = app
        .state()
        .auth_user_for_claims(&claims)
        .await
        .expect("auth user lookup succeeds")
        .expect("auth user exists");
    let types = vec![hms_domain::search::SearchResourceType::Patients];

    let (first, first_queries) = hms_observability::with_request_query_counter(async {
        app.state()
            .omni_search(&user, Some("Ama".to_owned()), types.clone(), 5)
            .await
    })
    .await;
    first.expect("first search succeeds");
    assert!(
        first_queries > 0,
        "first scoped search should hydrate from the database"
    );

    let (second, second_queries) = hms_observability::with_request_query_counter(async {
        app.state()
            .omni_search(&user, Some("Ama".to_owned()), types, 5)
            .await
    })
    .await;
    second.expect("cached search succeeds");
    assert_eq!(
        second_queries, 0,
        "same scoped search should stay off the database while warm"
    );

    let mut same_scope_user = user.clone();
    same_scope_user.id = Uuid::new_v4();
    same_scope_user.email = "same-scope-search-cache@hms.local".to_owned();
    let (same_scope, same_scope_queries) = hms_observability::with_request_query_counter(async {
        app.state()
            .omni_search(
                &same_scope_user,
                Some("Ama".to_owned()),
                vec![hms_domain::search::SearchResourceType::Patients],
                5,
            )
            .await
    })
    .await;
    same_scope.expect("same-scope cached search succeeds");
    assert_eq!(
        same_scope_queries, 0,
        "query-present OmniSearch cache should be scoped by result-affecting access facts, not user id"
    );
}
