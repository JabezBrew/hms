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
    let unroutable_search_documents = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT count(*)
        FROM search_documents
        WHERE facility_id = $1
          AND NOT (
              route_path ~ '^/patients/[0-9a-f-]{36}(\?.*)?$'
              OR route_path ~ '^/staff/[0-9a-f-]{36}(\?.*)?$'
              OR route_path ~ '^/wards/[0-9a-f-]{36}(\?.*)?$'
              OR route_path ~ '^/appointments(/[0-9a-f-]{36})?(\?.*)?$'
              OR route_path ~ '^/clinics/[0-9a-f-]{36}/waiting-room(\?.*)?$'
              OR route_path ~ '^/encounters/[0-9a-f-]{36}(\?.*)?$'
              OR route_path ~ '^/admissions/[0-9a-f-]{36}(\?.*)?$'
              OR route_path ~ '^/laboratory/(catalog|orders|results)(\?.*)?$'
              OR route_path ~ '^/billing(/invoices/[0-9a-f-]{36}(\?.*)?|/catalog\?service=[0-9a-f-]{36}|/claims\?claim=[0-9a-f-]{36})$'
              OR route_path ~ '^/inventory(/items(/[0-9a-f-]{36})?(\?.*)?|/purchase-orders(/[0-9a-f-]{36})?(\?.*)?)$'
              OR route_path ~ '^/referrals/(inbox|sent)(\?.*)?$'
          )
        "#,
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("search route contract query succeeds");
    assert_eq!(
        unroutable_search_documents, 0,
        "OmniSearch index rows must target registered frontend routes"
    );
    let untargeted_clinic_documents = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT count(*)
        FROM search_documents
        WHERE facility_id = $1
          AND resource_type = 'clinics'
          AND route_path !~ '^/appointments\?tab=sessions&clinic=[0-9a-f-]{36}$'
        "#,
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("clinic route contract query succeeds");
    assert_eq!(
        untargeted_clinic_documents, 0,
        "clinic search documents must preserve their clinic target in route_path"
    );
    let untargeted_lab_catalog_documents = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT count(*)
        FROM search_documents
        WHERE facility_id = $1
          AND resource_type = 'laboratory'
          AND metadata->>'source_table' IN ('lab_tests', 'lab_panels')
          AND route_path !~ '^/laboratory/catalog\?tab=(tests&test|panels&panel)=[0-9a-f-]{36}$'
        "#,
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("lab catalog route contract query succeeds");
    assert_eq!(
        untargeted_lab_catalog_documents, 0,
        "lab catalog search documents must preserve their test or panel target in route_path"
    );
    let untargeted_visit_documents = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT count(*)
        FROM search_documents
        WHERE facility_id = $1
          AND resource_type = 'visits'
          AND route_path !~ '^/clinics/[0-9a-f-]{36}/waiting-room\?visit=[0-9a-f-]{36}$'
        "#,
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("visit route contract query succeeds");
    assert_eq!(
        untargeted_visit_documents, 0,
        "visit search documents must preserve their visit target on a registered destination"
    );
    let unhonored_waitlist_documents = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT count(*)
        FROM search_documents
        WHERE facility_id = $1
          AND resource_type = 'referrals'
          AND metadata->>'source_table' = 'clinic_waitlist_entries'
          AND status_label NOT IN ('waiting', 'offered')
        "#,
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("waitlist route contract query succeeds");
    assert_eq!(
        unhonored_waitlist_documents, 0,
        "waitlist search documents must only index statuses rendered by the appointment waitlist"
    );
    let untargeted_billing_documents = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT count(*)
        FROM search_documents
        WHERE facility_id = $1
          AND resource_type = 'billing'
          AND (
            (metadata->>'source_table' = 'service_catalog'
              AND route_path !~ '^/billing/catalog\?service=[0-9a-f-]{36}$')
            OR (metadata->>'source_table' = 'payments'
              AND route_path !~ '^/billing/invoices/[0-9a-f-]{36}\?payment=[0-9a-f-]{36}$')
            OR (metadata->>'source_table' = 'nhis_claims'
              AND route_path !~ '^/billing/claims\?claim=[0-9a-f-]{36}$')
          )
        "#,
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("billing route contract query succeeds");
    assert_eq!(
        untargeted_billing_documents, 0,
        "billing search documents must route non-invoice targets to honored target params"
    );
    let untargeted_storage_location_documents = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT count(*)
        FROM search_documents
        WHERE facility_id = $1
          AND resource_type = 'inventory'
          AND metadata->>'source_table' = 'storage_locations'
          AND route_path !~ '^/inventory/items\?location=[0-9a-f-]{36}$'
        "#,
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("inventory location route contract query succeeds");
    assert_eq!(
        untargeted_storage_location_documents, 0,
        "storage location search documents must route to the honored stock-by-location view"
    );

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
    let ama_patient_id = sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT id FROM patients WHERE facility_id = $1 AND patient_code = 'P-0000000001'",
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("seed patient id exists");
    let ama_search_document_id = sqlx::query_scalar::<_, uuid::Uuid>(
        r#"
        SELECT id
        FROM search_documents
        WHERE facility_id = $1
          AND resource_type = 'patients'
          AND resource_id = $2
        "#,
    )
    .bind(facility_id)
    .bind(ama_patient_id)
    .fetch_one(&pool)
    .await
    .expect("seed patient search document exists");
    assert_eq!(patient_results.groups.patients[0].id, ama_patient_id);
    assert_ne!(
        patient_results.groups.patients[0].id, ama_search_document_id,
        "public OmniSearch item IDs must be target resource IDs, not search document IDs"
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

    let encounter_document_id = uuid::Uuid::new_v4();
    let encounter_resource_id = uuid::Uuid::new_v4();
    let billing_document_id = uuid::Uuid::new_v4();
    let billing_resource_id = uuid::Uuid::new_v4();
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
        VALUES
            (
                $1,
                $2,
                'encounters',
                $3,
                'RouteTarget Encounter',
                $4,
                'encounters',
                'encounter.view',
                'RouteTarget cross module encounter',
                80,
                now(),
                now(),
                '{}'::jsonb,
                true
            ),
            (
                $5,
                $2,
                'billing',
                $6,
                'RouteTarget Invoice',
                $7,
                'billing',
                'billing.view',
                'RouteTarget cross module billing',
                80,
                now(),
                now(),
                '{}'::jsonb,
                true
            )
        "#,
    )
    .bind(encounter_document_id)
    .bind(facility_id)
    .bind(encounter_resource_id)
    .bind(format!("/encounters/{encounter_resource_id}"))
    .bind(billing_document_id)
    .bind(billing_resource_id)
    .bind(format!("/billing/invoices/{billing_resource_id}"))
    .execute(&pool)
    .await
    .expect("cross-module search fixtures insert");

    let cross_module_results = hms_db::search::omni_search(
        &pool,
        OmniSearchFilters {
            facility_id,
            user_id: owner_id,
            query: Some("RouteTarget".to_owned()),
            types: vec![SearchResourceType::Encounters, SearchResourceType::Billing],
            limit_per_group: 5,
            permission_codes: vec![PermissionCode::EncounterView, PermissionCode::BillingView],
            feature_keys: vec![FeatureKey::Encounters, FeatureKey::Billing],
            patient_visibility: vec![PatientDataVisibility::None],
        },
    )
    .await
    .expect("cross-module search succeeds");

    let encounter_result = cross_module_results
        .groups
        .encounters
        .iter()
        .find(|item| item.title == "RouteTarget Encounter")
        .expect("encounter result is returned");
    assert_eq!(encounter_result.id, encounter_resource_id);
    assert_ne!(encounter_result.id, encounter_document_id);
    assert_eq!(
        encounter_result.route_path,
        format!("/encounters/{encounter_resource_id}")
    );

    let billing_result = cross_module_results
        .groups
        .billing
        .iter()
        .find(|item| item.title == "RouteTarget Invoice")
        .expect("billing result is returned");
    assert_eq!(billing_result.id, billing_resource_id);
    assert_ne!(billing_result.id, billing_document_id);
    assert_eq!(
        billing_result.route_path,
        format!("/billing/invoices/{billing_resource_id}")
    );

    let custom_inventory_title = "Qaxorz Lens";
    let custom_inventory_document_id = uuid::Uuid::new_v4();
    let custom_inventory_resource_id = uuid::Uuid::new_v4();
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
    .bind(custom_inventory_document_id)
    .bind(facility_id)
    .bind(custom_inventory_resource_id)
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
    let custom_inventory_item = short_prefix_results
        .groups
        .inventory
        .iter()
        .find(|item| item.title == custom_inventory_title)
        .expect("custom inventory result is returned");
    assert_eq!(custom_inventory_item.id, custom_inventory_resource_id);
    assert_ne!(custom_inventory_item.id, custom_inventory_document_id);

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
