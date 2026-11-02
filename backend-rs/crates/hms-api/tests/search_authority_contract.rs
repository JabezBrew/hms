mod support;
use support::*;

// These tests cross the real public router, request-context/auth-facts cache,
// Omni cache and PostgreSQL projection query. Fixtures are synthetic; failures
// report only status, projection counts and opaque IDs, never response bodies.
async fn ordinary_reader(app: &TestApp, ordinal: u8) -> (Uuid, String) {
    let pool = app.db_pool().await;
    let id = Uuid::new_v4();
    let email = format!("search-authority-{ordinal}@hms.local");
    sqlx::query(
        "INSERT INTO users(id,facility_id,email,display_name,password_hash) \
         SELECT $1,facility_id,$2,'Synthetic search reader',password_hash FROM users \
         WHERE facility_id=$3 AND email='owner@hms.local'",
    )
    .bind(id)
    .bind(&email)
    .bind(app.state().facility_id())
    .execute(&pool)
    .await
    .unwrap();
    for permission in [
        PermissionCode::AuthMeView,
        PermissionCode::SystemDeploymentCapabilitiesView,
        PermissionCode::PatientDemographicsView,
        PermissionCode::InventoryView,
        PermissionCode::BillingView,
    ] {
        grant_test_permission(app, id, permission).await;
    }
    for feature in [
        FeatureKey::Patients,
        FeatureKey::Inventory,
        FeatureKey::Billing,
    ] {
        grant_test_feature(app, id, feature).await;
    }
    grant_test_patient_visibility(app, id, PatientDataVisibility::Demographics).await;
    let (token, _, _) = login_with_password(app.clone(), &email, "ChangeMe123!").await;
    let user = app
        .state()
        .auth_user_for_claims(&access_claims(&token))
        .await
        .unwrap()
        .unwrap();
    assert!(!user.permissions.contains(&PermissionCode::AdminStaffManage));
    assert!(!user.permissions.contains(&PermissionCode::InventoryManage));
    (id, token)
}

async fn search(app: &TestApp, token: &str, query: Option<&str>) -> Value {
    search_with_query_count(app, token, query).await.0
}

async fn search_with_query_count(app: &TestApp, token: &str, query: Option<&str>) -> (Value, u64) {
    let mut body = json!({"limit": 25});
    if let Some(query) = query {
        body["q"] = json!(query);
    }
    let response = fixture_json_post(app, Some(token), "/api/v2/search/omni", body).await;
    assert_eq!(response.status(), StatusCode::OK, "public search status");
    let queries = response
        .extensions()
        .get::<hms_observability::RequestMetricsSnapshot>()
        .expect("real HTTP telemetry attaches PHI-free query counts")
        .db_query_count;
    (json_body(response).await, queries)
}

fn group_ids(body: &Value, group: &str) -> Vec<Uuid> {
    body["data"]["groups"][group]
        .as_array()
        .expect("search group is an array")
        .iter()
        .map(|item| Uuid::parse_str(item["id"].as_str().expect("opaque ID")).unwrap())
        .collect()
}

async fn personal_recents(app: &TestApp, readers: &[Uuid]) -> Vec<Uuid> {
    let pool = app.db_pool().await;
    let patients: Vec<Uuid> = sqlx::query_scalar(
        "SELECT p.id FROM patients p JOIN search_documents d \
         ON d.facility_id=p.facility_id AND d.resource_type='patients' \
         AND d.resource_id=p.id AND d.is_active \
         WHERE p.facility_id=$1 ORDER BY p.id LIMIT 2",
    )
    .bind(app.state().facility_id())
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(patients.len(), 2, "two synthetic patient projections exist");
    for (&reader, &patient) in readers.iter().zip(&patients) {
        sqlx::query(
            "INSERT INTO patient_contexts(id,facility_id,user_id,patient_id,context_kind) \
             VALUES($1,$2,$3,$4,'assigned')",
        )
        .bind(Uuid::new_v4())
        .bind(app.state().facility_id())
        .bind(reader)
        .bind(patient)
        .execute(&pool)
        .await
        .unwrap();
    }
    patients
}

#[tokio::test]
async fn one_ascii_character_search_keeps_each_ordinary_users_personal_recents() {
    let app = app().await;
    let (first, first_token) = ordinary_reader(&app, 1).await;
    let (second, second_token) = ordinary_reader(&app, 2).await;
    let patients = personal_recents(&app, &[first, second]).await;
    let first_facts = app
        .state()
        .request_context_facts_for_claims(&access_claims(&first_token), "/api/v2/search/omni")
        .await
        .unwrap()
        .unwrap();
    let second_facts = app
        .state()
        .request_context_facts_for_claims(&access_claims(&second_token), "/api/v2/search/omni")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(first_facts.user.permissions, second_facts.user.permissions);
    assert_eq!(first_facts.user.features, second_facts.user.features);
    assert_eq!(
        first_facts.user.patient_visibility,
        second_facts.user.patient_visibility
    );
    assert_eq!(first_facts.feature_flags, second_facts.feature_flags);
    assert_eq!(
        first_facts.user.active_profile,
        second_facts.user.active_profile
    );
    // No clear, relogin, sleep or rebuild between users: the second call must
    // not reuse the first user's just-warmed personal projection.
    for _ in 0..2 {
        let first_body = search(&app, &first_token, Some("a")).await;
        assert_eq!(group_ids(&first_body, "recent_patients"), vec![patients[0]]);
        let second_body = search(&app, &second_token, Some("a")).await;
        assert_eq!(
            group_ids(&second_body, "recent_patients"),
            vec![patients[1]]
        );
    }
}

#[tokio::test]
async fn empty_queries_stay_personal_and_two_byte_unicode_stays_a_global_query() {
    let app = app().await;
    let (first, first_token) = ordinary_reader(&app, 1).await;
    let (second, second_token) = ordinary_reader(&app, 2).await;
    let patients = personal_recents(&app, &[first, second]).await;
    for query in [None, Some(""), Some(" \t\n ")] {
        for _ in 0..2 {
            assert_eq!(
                group_ids(&search(&app, &first_token, query).await, "recent_patients"),
                vec![patients[0]]
            );
            assert_eq!(
                group_ids(&search(&app, &second_token, query).await, "recent_patients"),
                vec![patients[1]]
            );
        }
    }
    let pool = app.db_pool().await;
    sqlx::query(
        "UPDATE search_documents SET title='Éclair QZ26Shared',search_text='Éclair QZ26Shared' \
         WHERE facility_id=$1 AND resource_type='patients' AND resource_id=ANY($2)",
    )
    .bind(app.state().facility_id())
    .bind(&patients)
    .execute(&pool)
    .await
    .unwrap();
    // Existing byte threshold is intentional here: É is one scalar, two bytes.
    // A two-ASCII-byte term and a broad term also retain global result behavior.
    for query in ["É", "QZ", "QZ26Shared"] {
        for token in [&first_token, &second_token] {
            let body = search(&app, token, Some(query)).await;
            let mut found = group_ids(&body, "patients");
            found.sort_unstable();
            let mut expected = patients.clone();
            expected.sort_unstable();
            assert_eq!(
                found, expected,
                "global query finds both authorized patients"
            );
            assert!(group_ids(&body, "recent_patients").is_empty());
        }
    }
    let overlong = format!("  {}  ", "É".repeat(121));
    let capped = search(&app, &first_token, Some(&overlong)).await;
    assert_eq!(
        capped["data"]["query"].as_str().unwrap().chars().count(),
        120
    );
    assert!(group_ids(&capped, "recent_patients").is_empty());
}

async fn two_instances() -> (TestApp, TestApp) {
    let database = Arc::new(hms_db::test_support::TestDatabase::create().unwrap());
    let config = Config::for_tests_with_database_url(database.database_url().to_owned());
    let first = app_with_config(config.clone(), database.clone()).await;
    let second = app_with_config(config, database).await;
    (first, second)
}

async fn feature_documents(app: &TestApp) -> [Uuid; 3] {
    let pool = app.db_pool().await;
    let ids = [Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4()];
    for (id, resource, feature, permission, route) in [
        (
            ids[0],
            "inventory",
            "inventory",
            "inventory.view",
            "/inventory/items",
        ),
        (ids[1], "billing", "billing", "billing.view", "/billing"),
        (
            ids[2],
            "patients",
            "patients",
            "patient.demographics.view",
            "/patients",
        ),
    ] {
        sqlx::query(
            "INSERT INTO search_documents(id,facility_id,resource_type,resource_id,title,route_path,\
             feature_key,permission_code,search_text,rank_boost,source_updated_at,is_active) \
             VALUES($1,$2,$3,$4,'QZ26Authority',$5,$6,$7,'QZ26Authority',1000,now(),true)",
        )
        .bind(Uuid::new_v4())
        .bind(app.state().facility_id())
        .bind(resource)
        .bind(id)
        .bind(route)
        .bind(feature)
        .bind(permission)
        .execute(&pool)
        .await
        .unwrap();
    }
    ids
}

#[tokio::test]
async fn authorized_global_queries_still_share_one_hydration_across_ordinary_users() {
    let app = app().await;
    let (_, first) = ordinary_reader(&app, 1).await;
    let (_, second) = ordinary_reader(&app, 2).await;
    let ids = feature_documents(&app).await;
    // First make both request-context/network paths warm. Personal empty
    // projections have different keys and cannot warm either global query.
    search(&app, &first, None).await;
    search(&app, &second, None).await;
    for query in ["QZ", "QZ26Authority"] {
        let (cold, cold_queries) = search_with_query_count(&app, &first, Some(query)).await;
        let (shared, shared_queries) = search_with_query_count(&app, &second, Some(query)).await;
        let (repeat, repeat_queries) = search_with_query_count(&app, &second, Some(query)).await;
        for body in [&cold, &shared, &repeat] {
            assert!(group_ids(body, "inventory").contains(&ids[0]));
            assert!(group_ids(body, "billing").contains(&ids[1]));
            assert!(group_ids(body, "patients").contains(&ids[2]));
        }
        assert_eq!(
            cold_queries,
            shared_queries + 1,
            "only the first global query hydrates the one-query DB projection"
        );
        assert_eq!(
            shared_queries, repeat_queries,
            "the other ordinary user selects the same warm global projection"
        );
    }
}

async fn entitlement(app: &TestApp, token: &str, feature: &str, enabled: Option<bool>) {
    let mut request = Request::builder()
        .method(if enabled.is_some() {
            Method::PATCH
        } else {
            Method::DELETE
        })
        .uri(format!("/api/v2/admin/features/{feature}"))
        .header(AUTHORIZATION, format!("Bearer {token}"));
    let body = if let Some(enabled) = enabled {
        request = request.header("content-type", "application/json");
        Body::from(json!({"enabled": enabled}).to_string())
    } else {
        Body::empty()
    };
    let response = app
        .clone()
        .oneshot(request.body(body).unwrap())
        .await
        .unwrap();
    assert_eq!(
        response.status(),
        StatusCode::OK,
        "real entitlement publisher succeeds"
    );
}

async fn assert_inventory_feature(app: &TestApp, token: &str, ids: [Uuid; 3], enabled: bool) {
    for query in ["QZ", "QZ26Authority"] {
        for _ in 0..2 {
            let body = search(app, token, Some(query)).await;
            assert_eq!(
                group_ids(&body, "inventory").contains(&ids[0]),
                enabled,
                "Inventory projection follows current entitlement"
            );
            assert!(
                group_ids(&body, "billing").contains(&ids[1]),
                "unaffected Billing projection remains available"
            );
            assert!(
                group_ids(&body, "patients").contains(&ids[2]),
                "unaffected Patients projection remains available"
            );
        }
    }
}

#[tokio::test]
async fn public_search_cold_and_warm_filters_effective_features_on_the_same_instance() {
    let app = app().await;
    let (_, reader) = ordinary_reader(&app, 1).await;
    let ids = feature_documents(&app).await;
    let (owner, _, _) = login(app.clone(), "owner@hms.local").await;
    entitlement(&app, &owner, "inventory", Some(false)).await;
    assert_inventory_feature(&app, &reader, ids, false).await;
    entitlement(&app, &owner, "inventory", None).await;
    assert_inventory_feature(&app, &reader, ids, true).await;
    entitlement(&app, &owner, "inventory", Some(false)).await;
    assert_inventory_feature(&app, &reader, ids, false).await;
    entitlement(&app, &owner, "inventory", Some(true)).await;
    assert_inventory_feature(&app, &reader, ids, true).await;
    let assigned: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM user_features WHERE user_id=$1 AND feature_key='inventory')",
    )
    .bind(access_claims(&reader).sub)
    .fetch_one(&app.db_pool().await)
    .await
    .unwrap();
    assert!(assigned, "the assigned feature is intentionally unchanged");
}

#[tokio::test]
async fn a_second_instances_warm_search_observes_real_entitlement_publications() {
    let (publisher, reader_app) = two_instances().await;
    let (_, reader) = ordinary_reader(&reader_app, 1).await;
    let ids = feature_documents(&reader_app).await;
    let (owner, _, _) = login(publisher.clone(), "owner@hms.local").await;
    assert_inventory_feature(&reader_app, &reader, ids, true).await;
    entitlement(&publisher, &owner, "inventory", Some(false)).await;
    assert_inventory_feature(&reader_app, &reader, ids, false).await;
    entitlement(&publisher, &owner, "inventory", None).await;
    assert_inventory_feature(&reader_app, &reader, ids, true).await;
}

async fn entitlement_max(pool: &hms_db::PgPool, facility: Uuid) -> chrono::DateTime<Utc> {
    sqlx::query_scalar(
        "SELECT MAX(updated_at) FROM facility_feature_entitlements WHERE facility_id=$1",
    )
    .bind(facility)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn cross_instance_admission_detects_nonmax_override_deletion() {
    let (publisher, reader_app) = two_instances().await;
    let ids = feature_documents(&reader_app).await;
    let (owner, _, _) = login(publisher.clone(), "owner@hms.local").await;
    entitlement(&publisher, &owner, "inventory", Some(false)).await;
    entitlement(&publisher, &owner, "billing", Some(true)).await;
    let pool = reader_app.db_pool().await;
    // Honest controlled source ordering: deleting Inventory must leave MAX
    // unchanged, rather than accidentally passing a timestamp-only repair.
    sqlx::query("UPDATE facility_feature_entitlements SET updated_at=CASE WHEN feature_key='inventory' THEN TIMESTAMPTZ '2000-01-01' ELSE TIMESTAMPTZ '2001-01-01' END WHERE facility_id=$1")
        .bind(reader_app.state().facility_id()).execute(&pool).await.unwrap();
    let before = entitlement_max(&pool, reader_app.state().facility_id()).await;
    let (_, reader) = ordinary_reader(&reader_app, 1).await;
    let initial = search(&reader_app, &reader, Some("QZ")).await;
    assert!(
        group_ids(&initial, "inventory").is_empty(),
        "cold disabled Inventory is hidden"
    );
    // Warm both caches through the real reader instance before the other
    // instance publishes the supported DELETE operation.
    search(&reader_app, &reader, Some("QZ")).await;
    entitlement(&publisher, &owner, "inventory", None).await;
    let inventory_override_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM facility_feature_entitlements WHERE facility_id=$1 AND feature_key='inventory')",
    ).bind(reader_app.state().facility_id()).fetch_one(&pool).await.unwrap();
    assert!(
        !inventory_override_exists,
        "genuine public DELETE removed the Inventory override"
    );
    assert_eq!(
        before,
        entitlement_max(&pool, reader_app.state().facility_id()).await,
        "fixture keeps MAX unchanged"
    );
    assert_inventory_feature(&reader_app, &reader, ids, true).await;
}

#[tokio::test]
async fn cross_instance_admission_detects_a_publication_below_the_retained_max_timestamp() {
    let (publisher, reader_app) = two_instances().await;
    let (_, reader) = ordinary_reader(&reader_app, 1).await;
    let ids = feature_documents(&reader_app).await;
    let (owner, _, _) = login(publisher.clone(), "owner@hms.local").await;
    entitlement(&publisher, &owner, "billing", Some(true)).await;
    let pool = reader_app.db_pool().await;
    assert_inventory_feature(&reader_app, &reader, ids, true).await;
    let mut blocker = pool.begin().await.unwrap();
    let blocker_pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *blocker)
        .await
        .unwrap();
    sqlx::query("SELECT id FROM facilities WHERE id=$1 FOR UPDATE")
        .bind(reader_app.state().facility_id())
        .execute(&mut *blocker)
        .await
        .unwrap();
    struct AbortOnDrop<T>(tokio::task::JoinHandle<T>);
    impl<T> Drop for AbortOnDrop<T> {
        fn drop(&mut self) {
            self.0.abort();
        }
    }
    let mut publication = AbortOnDrop(tokio::spawn(async move {
        entitlement(&publisher, &owner, "inventory", Some(false)).await;
    }));
    // Observe the exact public publisher transaction waiting on its canonical
    // exclusive facility lock. This is actual transaction-start time ordering,
    // not a guessed delay or a future timestamp that could hide a fixture bug.
    let waiting_start: chrono::DateTime<Utc> =
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            loop {
                let observed = sqlx::query_scalar::<_, chrono::DateTime<Utc>>(
                    "SELECT xact_start FROM pg_stat_activity WHERE datname=current_database() \
                     AND query='SELECT id FROM facilities WHERE id=$1 AND is_active FOR UPDATE' \
                     AND $1=ANY(pg_blocking_pids(pid)) AND wait_event_type='Lock'",
                )
                .bind(blocker_pid)
                .fetch_optional(&pool)
                .await
                .unwrap();
                if let Some(started) = observed {
                    break started;
                }
                assert!(
                    !publication.0.is_finished(),
                    "publisher must wait on the held source"
                );
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("public publisher reaches the observed lock wait");
    let later_max: chrono::DateTime<Utc> = sqlx::query_scalar(
        "UPDATE facility_feature_entitlements SET updated_at=clock_timestamp() \
         WHERE facility_id=$1 AND feature_key='billing' RETURNING updated_at",
    )
    .bind(reader_app.state().facility_id())
    .fetch_one(&mut *blocker)
    .await
    .unwrap();
    assert!(
        later_max > waiting_start,
        "retained maximum follows the publisher transaction start"
    );
    blocker.commit().await.unwrap();
    (&mut publication.0).await.unwrap();
    let published_at: chrono::DateTime<Utc> = sqlx::query_scalar(
        "SELECT updated_at FROM facility_feature_entitlements WHERE facility_id=$1 AND feature_key='inventory'",
    ).bind(reader_app.state().facility_id()).fetch_one(&pool).await.unwrap();
    assert!(
        published_at < later_max,
        "actual now()-based publication is below the retained maximum"
    );
    assert_eq!(
        later_max,
        entitlement_max(&pool, reader_app.state().facility_id()).await,
        "actual publication leaves MAX unchanged"
    );
    assert_inventory_feature(&reader_app, &reader, ids, false).await;
}

#[tokio::test]
async fn personal_recent_search_also_filters_the_current_patients_feature() {
    let (publisher, reader_app) = two_instances().await;
    let (reader_id, reader) = ordinary_reader(&reader_app, 1).await;
    let patient = personal_recents(&reader_app, &[reader_id]).await[0];
    let (owner, _, _) = login(publisher.clone(), "owner@hms.local").await;
    assert_eq!(
        group_ids(&search(&reader_app, &reader, None).await, "recent_patients"),
        vec![patient]
    );
    entitlement(&publisher, &owner, "patients", Some(false)).await;
    for _ in 0..2 {
        assert!(group_ids(&search(&reader_app, &reader, None).await, "recent_patients").is_empty());
    }
    entitlement(&publisher, &owner, "patients", None).await;
    assert_eq!(
        group_ids(&search(&reader_app, &reader, None).await, "recent_patients"),
        vec![patient]
    );
}
