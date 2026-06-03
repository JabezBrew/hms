use chrono::NaiveDate;
use hms_db::provision::{provision_baseline, BaselineProvisioning};
use hms_db::search::OmniSearchFilters;
use hms_domain::auth::PatientDataVisibility;
use hms_domain::deployment::{DeploymentProfile, FeatureKey, PermissionCode};
use hms_domain::search::{SearchIndexState, SearchResourceType};

#[tokio::test]
async fn omni_search_index_backfills_and_filters_before_ranking() {
    let database =
        hms_db::test_support::TestDatabase::create().expect("test database is available");
    let pool = hms_db::connect(database.database_url())
        .await
        .expect("database connects");

    hms_db::migrate::run(&pool).await.expect("migrations apply");
    provision_baseline(
        &pool,
        &BaselineProvisioning::hms_local(DeploymentProfile::Hospital),
    )
    .await
    .expect("baseline provisions");

    let facility_id = hms_db::facilities::facility_id_by_code(&pool, "HMS")
        .await
        .expect("facility query succeeds")
        .expect("facility exists");
    let owner_id = sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT id FROM users WHERE facility_id = $1 AND email = 'owner@hms.local'",
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("owner exists");
    sqlx::query(
        r#"
        INSERT INTO staff_profiles (
            id,
            facility_id,
            user_id,
            employee_id,
            department,
            position,
            hire_date
        )
        VALUES ($1, $2, $3, 'EMP-OWNER', 'Administration', 'HMS Administrator', $4)
        ON CONFLICT (user_id) DO UPDATE
        SET employee_id = EXCLUDED.employee_id,
            department = EXCLUDED.department,
            position = EXCLUDED.position,
            hire_date = EXCLUDED.hire_date,
            updated_at = now()
        "#,
    )
    .bind(uuid::Uuid::from_u128(0x11111111111111111111111111111111))
    .bind(facility_id)
    .bind(owner_id)
    .bind(NaiveDate::from_ymd_opt(2026, 1, 1).expect("static date is valid"))
    .execute(&pool)
    .await
    .expect("staff fixture inserts");

    let statuses = hms_db::search::rebuild_search_index_for_facility(&pool, facility_id)
        .await
        .expect("search index rebuilds");
    assert!(statuses.iter().any(|status| {
        status.resource_type == SearchResourceType::Patients
            && status.status == SearchIndexState::Ready
            && status.indexed_count > 0
    }));

    let (patient_results, observed_queries) =
        hms_observability::with_request_query_counter(async {
            hms_db::search::omni_search(
                &pool,
                OmniSearchFilters {
                    facility_id,
                    user_id: owner_id,
                    query: Some("Ama Mensah".to_owned()),
                    types: vec![SearchResourceType::Patients],
                    limit_per_group: 5,
                    permission_codes: vec![PermissionCode::PatientDemographicsView],
                    feature_keys: vec![FeatureKey::Patients],
                    patient_visibility: vec![PatientDataVisibility::Demographics],
                },
            )
            .await
        })
        .await;
    let patient_results = patient_results.expect("patient search succeeds");

    assert_eq!(observed_queries, 1);
    assert_eq!(patient_results.groups.patients.len(), 1);
    assert!(patient_results.index_status.iter().any(|status| {
        status.resource_type == SearchResourceType::Patients
            && status.status == SearchIndexState::Ready
    }));
    assert_eq!(
        patient_results.groups.patients[0].patient_code.as_deref(),
        Some("P-0000000001")
    );
    assert_eq!(
        patient_results.groups.patients[0]
            .patient_date_of_birth
            .expect("patient DOB is projected")
            .to_string(),
        "1990-02-14"
    );

    let hidden_patient_results = hms_db::search::omni_search(
        &pool,
        OmniSearchFilters {
            facility_id,
            user_id: owner_id,
            query: Some("Ama Mensah".to_owned()),
            types: vec![SearchResourceType::Patients],
            limit_per_group: 5,
            permission_codes: vec![PermissionCode::PatientDemographicsView],
            feature_keys: vec![FeatureKey::Patients],
            patient_visibility: vec![PatientDataVisibility::None],
        },
    )
    .await
    .expect("patient search without visibility succeeds");
    assert!(hidden_patient_results.groups.patients.is_empty());

    let staff_without_admin_permission = hms_db::search::omni_search(
        &pool,
        OmniSearchFilters {
            facility_id,
            user_id: owner_id,
            query: Some("HMS Owner".to_owned()),
            types: vec![SearchResourceType::Staff],
            limit_per_group: 1,
            permission_codes: vec![PermissionCode::PatientDemographicsView],
            feature_keys: vec![FeatureKey::Patients, FeatureKey::Admin],
            patient_visibility: vec![PatientDataVisibility::Demographics],
        },
    )
    .await
    .expect("staff search without permission succeeds");
    assert!(staff_without_admin_permission.groups.staff.is_empty());

    let staff_with_admin_permission = hms_db::search::omni_search(
        &pool,
        OmniSearchFilters {
            facility_id,
            user_id: owner_id,
            query: Some("HMS Owner".to_owned()),
            types: vec![SearchResourceType::Staff],
            limit_per_group: 1,
            permission_codes: vec![PermissionCode::AdminStaffManage],
            feature_keys: vec![FeatureKey::Admin],
            patient_visibility: vec![PatientDataVisibility::None],
        },
    )
    .await
    .expect("staff search with permission succeeds");
    assert_eq!(staff_with_admin_permission.groups.staff.len(), 1);
    assert_eq!(
        staff_with_admin_permission.groups.staff[0].title,
        "HMS Owner"
    );

    let inventory_results = hms_db::search::omni_search(
        &pool,
        OmniSearchFilters {
            facility_id,
            user_id: owner_id,
            query: Some("Paracetamol".to_owned()),
            types: vec![SearchResourceType::Inventory],
            limit_per_group: 5,
            permission_codes: vec![PermissionCode::InventoryView],
            feature_keys: vec![FeatureKey::Inventory],
            patient_visibility: vec![PatientDataVisibility::None],
        },
    )
    .await
    .expect("inventory search succeeds");
    assert!(inventory_results
        .groups
        .inventory
        .iter()
        .any(|item| item.title.contains("Paracetamol")));
    assert!(inventory_results.groups.patients.is_empty());

    let custom_inventory_title = "Qaxorz Lens";
    sqlx::query(
        r#"
        INSERT INTO search_documents (
            id,
            facility_id,
            resource_type,
            resource_id,
            title,
            route_path,
            feature_key,
            permission_code,
            search_text,
            rank_boost,
            source_updated_at,
            occurred_at,
            metadata,
            is_active
        )
        VALUES (
            $1,
            $2,
            'inventory',
            $3,
            $4,
            '/inventory/items/qaxorz-lens',
            'inventory',
            'inventory.view',
            'Qaxorz Lens optical supply',
            20,
            now(),
            now(),
            '{}'::jsonb,
            true
        )
        "#,
    )
    .bind(uuid::Uuid::new_v4())
    .bind(facility_id)
    .bind(uuid::Uuid::new_v4())
    .bind(custom_inventory_title)
    .execute(&pool)
    .await
    .expect("custom search fixture inserts");

    let inventory_filters = |query: &str| OmniSearchFilters {
        facility_id,
        user_id: owner_id,
        query: Some(query.to_owned()),
        types: vec![SearchResourceType::Inventory],
        limit_per_group: 5,
        permission_codes: vec![PermissionCode::InventoryView],
        feature_keys: vec![FeatureKey::Inventory],
        patient_visibility: vec![PatientDataVisibility::None],
    };
    let has_custom_inventory_title = |results: &hms_domain::search::OmniSearchGroups| {
        results
            .inventory
            .iter()
            .any(|item| item.title == custom_inventory_title)
    };

    let short_prefix_results = hms_db::search::omni_search(&pool, inventory_filters("Qa"))
        .await
        .expect("short prefix inventory search succeeds");
    assert!(has_custom_inventory_title(&short_prefix_results.groups));

    let short_later_token_prefix_results =
        hms_db::search::omni_search(&pool, inventory_filters("Le"))
            .await
            .expect("short later-token prefix inventory search succeeds");
    assert!(has_custom_inventory_title(
        &short_later_token_prefix_results.groups
    ));

    let short_middle_substring_results =
        hms_db::search::omni_search(&pool, inventory_filters("xo"))
            .await
            .expect("short middle substring inventory search succeeds");
    assert!(!has_custom_inventory_title(
        &short_middle_substring_results.groups
    ));

    let broad_substring_results = hms_db::search::omni_search(&pool, inventory_filters("xorz"))
        .await
        .expect("broad substring inventory search succeeds");
    assert!(has_custom_inventory_title(&broad_substring_results.groups));
}
