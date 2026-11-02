use super::*;

#[tokio::test]
async fn provisioned_baseline_uses_configured_facility_code_for_login() {
    let database =
        Arc::new(hms_db::test_support::TestDatabase::create().expect("test database is available"));
    let mut config = Config::for_tests_with_database_url(database.database_url().to_owned());
    config.facility_code = "MAIN".to_owned();
    let app = app_with_config(config, database).await;

    let response = app
        .clone()
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
    assert_eq!(response.headers().get_all(SET_COOKIE).iter().count(), 0);
    let body = json_body(response).await;
    let pending = &body["data"];
    assert_eq!(pending["status"].as_str(), Some("setup_required"));
    assert!(pending["login_grant"]
        .as_str()
        .is_some_and(|value| value.len() >= 32));
    let expires = chrono::DateTime::parse_from_rfc3339(
        pending["expires_at"]
            .as_str()
            .expect("restricted grant has an expiry"),
    )
    .unwrap();
    assert!(expires > Utc::now());
    assert!(pending.get("access_token").is_none());
    assert!(pending.get("token_type").is_none());
    assert!(pending.get("user").is_none());

    // Configured facility routing is established by this restricted result;
    // unenrolled privileged users receive no ordinary session before a factor.
    let wrong_facility=app.oneshot(Request::builder().method(Method::POST).uri("/api/v2/auth/login")
        .header("content-type","application/json").body(Body::from(json!({"email":"owner@hms.local","password":"ChangeMe123!","facility_code":"HMS"}).to_string())).unwrap()).await.unwrap();
    assert_eq!(wrong_facility.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        wrong_facility.headers().get_all(SET_COOKIE).iter().count(),
        0
    );
    let wrong = json_body(wrong_facility).await;
    assert!(wrong.get("data").is_none());
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
    let facts = app
        .state()
        .request_context_facts_for_claims(&claims, "/api/v2/search/omni")
        .await
        .expect("auth facts read succeeds")
        .expect("auth facts exist");
    let enabled = facts
        .feature_flags
        .iter()
        .filter_map(|(feature, enabled)| {
            (*enabled && facts.user.features.contains(feature)).then_some(*feature)
        })
        .collect();
    let ctx = hms_access::RequestContext::new(
        "synthetic-search-cache".to_owned(),
        claims.session_id,
        facts.user,
        enabled,
        hms_access::OffsiteState::Onsite,
        hms_access::ReauthState::from_authentication_time(Utc::now()),
    );
    let types = vec![hms_domain::search::SearchResourceType::Patients];
    let (first, first_queries) = hms_observability::with_request_query_counter(async {
        app.state()
            .omni_search(&ctx, Some("Ama".to_owned()), types.clone(), 5)
            .await
    })
    .await;
    assert!(!first
        .expect("first search succeeds")
        .groups
        .patients
        .is_empty());
    assert!(first_queries > 0, "cold search hydrates from the database");
    let (second, second_queries) = hms_observability::with_request_query_counter(async {
        app.state()
            .omni_search(&ctx, Some("Ama".to_owned()), types.clone(), 5)
            .await
    })
    .await;
    second.expect("cached search succeeds");
    assert_eq!(
        second_queries, 0,
        "same scoped query stays off the database"
    );
    let mut same_scope = ctx.clone();
    same_scope.user_id = Uuid::new_v4();
    same_scope.user.id = same_scope.user_id;
    let (shared, shared_queries) = hms_observability::with_request_query_counter(async {
        app.state()
            .omni_search(&same_scope, Some("Ama".to_owned()), types.clone(), 5)
            .await
    })
    .await;
    shared.expect("same-fact shared global search succeeds");
    assert_eq!(
        shared_queries, 0,
        "global query sharing retains identical access facts"
    );
    let mut without_feature = ctx.clone();
    without_feature
        .enabled_features
        .retain(|feature| *feature != FeatureKey::Patients);
    assert!(
        without_feature
            .user
            .features
            .contains(&FeatureKey::Patients),
        "assigned feature remains unchanged"
    );
    let mut without_permission = ctx.clone();
    without_permission
        .permissions
        .retain(|permission| *permission != PermissionCode::PatientDemographicsView);
    let mut without_visibility = ctx.clone();
    without_visibility.patient_visibility.clear();
    for changed in [without_feature, without_permission, without_visibility] {
        let (result, queries) = hms_observability::with_request_query_counter(async {
            app.state()
                .omni_search(&changed, Some("Ama".to_owned()), types.clone(), 5)
                .await
        })
        .await;
        assert!(result
            .expect("changed-fact search succeeds")
            .groups
            .patients
            .is_empty());
        assert!(
            queries > 0,
            "changed scope cannot select the privileged cached projection"
        );
    }
    let mut foreign = ctx.clone();
    foreign.facility_id = Uuid::new_v4();
    let (denied, denied_queries) = hms_observability::with_request_query_counter(async {
        app.state()
            .omni_search(&foreign, Some("Ama".to_owned()), types, 5)
            .await
    })
    .await;
    assert!(
        denied.is_err(),
        "facility proof is checked before a warm cache hit"
    );
    assert_eq!(denied_queries, 0);
}

#[tokio::test]
async fn raw_state_query_truncation_cannot_share_personal_recents() {
    let app = app().await;
    let pool = app.db_pool().await;
    let state = app.state();
    let facility = app.state().facility_id();
    let patients: Vec<Uuid> = sqlx::query_scalar(
        "SELECT p.id FROM patients p JOIN search_documents d \
         ON d.facility_id=p.facility_id AND d.resource_type='patients' \
         AND d.resource_id=p.id AND d.is_active WHERE p.facility_id=$1 ORDER BY p.id LIMIT 2",
    )
    .bind(facility)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(patients.len(), 2, "two synthetic projections exist");
    sqlx::query(
        "UPDATE search_documents SET title='Éclair Boundary',search_text='Éclair Boundary' \
         WHERE facility_id=$1 AND resource_type='patients' AND resource_id=ANY($2)",
    )
    .bind(facility)
    .bind(&patients)
    .execute(&pool)
    .await
    .unwrap();
    let mut contexts = Vec::new();
    for (ordinal, &patient) in patients.iter().enumerate() {
        let id = Uuid::new_v4();
        let email = format!("state-boundary-{ordinal}@hms.local");
        sqlx::query(
            "INSERT INTO users(id,facility_id,email,display_name,password_hash) \
             SELECT $1,facility_id,$2,'Synthetic boundary reader',password_hash \
             FROM users WHERE facility_id=$3 AND email='owner@hms.local'",
        )
        .bind(id)
        .bind(&email)
        .bind(facility)
        .execute(&pool)
        .await
        .unwrap();
        for permission in [
            PermissionCode::AuthMeView,
            PermissionCode::PatientDemographicsView,
        ] {
            grant_test_permission(&app, id, permission).await;
        }
        grant_test_feature(&app, id, FeatureKey::Patients).await;
        grant_test_patient_visibility(&app, id, PatientDataVisibility::Demographics).await;
        sqlx::query(
            "INSERT INTO patient_contexts(id,facility_id,user_id,patient_id,context_kind) \
             VALUES($1,$2,$3,$4,'assigned')",
        )
        .bind(Uuid::new_v4())
        .bind(facility)
        .bind(id)
        .bind(patient)
        .execute(&pool)
        .await
        .unwrap();
        let (token, _, _) = login_with_password(app.clone(), &email, "ChangeMe123!").await;
        let claims = access_claims(&token);
        let facts = app
            .state()
            .request_context_facts_for_claims(&claims, "/api/v2/search/omni")
            .await
            .unwrap()
            .unwrap();
        let enabled = facts
            .feature_flags
            .iter()
            .filter_map(|(feature, enabled)| {
                (*enabled && facts.user.features.contains(feature)).then_some(*feature)
            })
            .collect();
        contexts.push(hms_access::RequestContext::new(
            "synthetic-state-boundary".to_owned(),
            claims.session_id,
            facts.user,
            enabled,
            hms_access::OffsiteState::Onsite,
            hms_access::ReauthState::from_authentication_time(Utc::now()),
        ));
    }
    assert_eq!(contexts[0].permissions, contexts[1].permissions);
    assert_eq!(contexts[0].enabled_features, contexts[1].enabled_features);
    assert_eq!(
        contexts[0].patient_visibility,
        contexts[1].patient_visibility
    );
    assert_eq!(contexts[0].active_profile, contexts[1].active_profile);
    // Raw trusted callers can bypass the handler's cap. A second normalization
    // in the DB must never turn this global cache key into personal recents.
    for raw in [
        format!("a{}b", " ".repeat(119)),
        format!(" \ta{}b\n", " ".repeat(119)),
    ] {
        for _ in 0..2 {
            for (ctx, &patient) in contexts.iter().zip(&patients) {
                let result = state
                    .omni_search(ctx, Some(raw.clone()), vec![], 5)
                    .await
                    .expect("raw state query succeeds");
                assert_eq!(
                    result
                        .groups
                        .recent_patients
                        .iter()
                        .map(|item| item.id)
                        .collect::<Vec<_>>(),
                    vec![patient]
                );
                assert!(result.groups.patients.is_empty());
            }
        }
    }
    // At exactly 120 scalars the final b survives: this remains a global
    // query. A surviving one-scalar/two-byte É also remains global and shared.
    for raw in [
        format!("a{}b", " ".repeat(118)),
        format!("É{}b", " ".repeat(119)),
    ] {
        let (first, cold_queries) = hms_observability::with_request_query_counter(
            state.omni_search(&contexts[0], Some(raw.clone()), vec![], 5),
        )
        .await;
        let first = first.expect("bounded global state query succeeds");
        assert!(first.groups.recent_patients.is_empty());
        let (second, shared_queries) = hms_observability::with_request_query_counter(
            state.omni_search(&contexts[1], Some(raw.clone()), vec![], 5),
        )
        .await;
        let second = second.expect("second authorized global query succeeds");
        assert!(second.groups.recent_patients.is_empty());
        assert_eq!(cold_queries, 1);
        assert_eq!(
            shared_queries, 0,
            "nonpersonal queries retain authorized sharing"
        );
        if raw.starts_with('É') {
            let mut found = second
                .groups
                .patients
                .iter()
                .map(|item| item.id)
                .collect::<Vec<_>>();
            let mut expected = patients.clone();
            found.sort_unstable();
            expected.sort_unstable();
            assert_eq!(
                found, expected,
                "two-byte scalar keeps both authorized projections"
            );
        }
    }
}
