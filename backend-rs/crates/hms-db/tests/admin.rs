use chrono::NaiveDate;
use hms_db::admin::{NewAuditEvent, NewOrganizationUnit, NewPractitionerProfile, NewStaffAccount};
use hms_db::provision::{provision_baseline, BaselineProvisioning};
use hms_domain::admin::OrgUnitType;
use hms_domain::deployment::{DeploymentProfile, FeatureKey, PermissionCode};
use serde_json::json;
use uuid::Uuid;

#[tokio::test]
async fn feature_entitlements_are_facility_scoped_and_override_profile_defaults() {
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

    let baseline = hms_db::admin::list_feature_entitlements(&pool, facility_id)
        .await
        .expect("feature entitlements load");
    let nursing = baseline
        .iter()
        .find(|item| item.feature == FeatureKey::Nursing)
        .expect("nursing feature exists");
    assert!(nursing.profile_default);
    assert!(nursing.enabled);
    assert_eq!(nursing.override_enabled, None);

    let disabled = hms_db::admin::update_feature_entitlement(
        &pool,
        facility_id,
        FeatureKey::Nursing,
        false,
        owner_id,
        Some("feature-test".to_owned()),
    )
    .await
    .expect("feature entitlement updates")
    .expect("feature entitlement exists");
    assert!(!disabled.enabled);
    assert_eq!(disabled.override_enabled, Some(false));

    let effective =
        hms_db::admin::effective_feature_flags(&pool, facility_id, DeploymentProfile::Hospital)
            .await
            .expect("effective flags load");
    assert_eq!(effective.get(&FeatureKey::Nursing), Some(&false));

    let restored = hms_db::admin::delete_feature_entitlement(
        &pool,
        facility_id,
        FeatureKey::Nursing,
        owner_id,
        Some("feature-delete-test".to_owned()),
    )
    .await
    .expect("feature entitlement deletes")
    .expect("feature entitlement exists");
    assert!(restored.enabled);
    assert_eq!(restored.override_enabled, None);

    let effective_after_delete =
        hms_db::admin::effective_feature_flags(&pool, facility_id, DeploymentProfile::Hospital)
            .await
            .expect("effective flags load after delete");
    assert_eq!(
        effective_after_delete.get(&FeatureKey::Nursing),
        Some(&true)
    );

    assert!(
        hms_db::admin::list_feature_entitlements(&pool, uuid::Uuid::new_v4())
            .await
            .expect("cross-facility list succeeds")
            .is_empty()
    );
}

#[tokio::test]
async fn active_authorities_are_resolved_for_request_context() {
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
    let owner_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM users WHERE facility_id = $1 AND email = 'owner@hms.local'",
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("owner exists");

    let authorities = hms_db::admin::active_authorities_for_user(&pool, facility_id, owner_id)
        .await
        .expect("active authorities resolve");
    assert!(authorities.iter().any(|authority| {
        authority.facility_id == facility_id
            && authority.permission_code == Some(PermissionCode::AdminAuthorityManage)
            && authority.scope.scope_type == "organization_unit"
            && authority.scope.scope_id.is_some()
    }));
    assert!(
        hms_db::admin::active_authorities_for_user(&pool, Uuid::new_v4(), owner_id)
            .await
            .expect("cross-facility authority query succeeds")
            .is_empty()
    );

    let facts = hms_db::admin::request_context_admin_facts(
        &pool,
        facility_id,
        owner_id,
        DeploymentProfile::Hospital,
    )
    .await
    .expect("request context admin facts resolve");
    assert_eq!(facts.feature_flags.get(&FeatureKey::Patients), Some(&true));
    assert!(facts.active_authorities.iter().any(|authority| {
        authority.facility_id == facility_id
            && authority.permission_code == Some(PermissionCode::AdminAuthorityManage)
            && authority.scope.scope_type == "organization_unit"
            && authority.scope.scope_id.is_some()
    }));
}

#[tokio::test]
async fn organization_unit_lists_can_filter_by_type_and_active_state() {
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

    let inactive_facility = hms_db::admin::create_organization_unit(
        &pool,
        NewOrganizationUnit {
            facility_id,
            code: "OLD_FACILITY".to_owned(),
            name: "Closed Facility".to_owned(),
            unit_type: OrgUnitType::Facility,
            parent_unit_id: None,
        },
    )
    .await
    .expect("inactive facility unit is created");
    hms_db::admin::create_organization_unit(
        &pool,
        NewOrganizationUnit {
            facility_id,
            code: "SUPPORT_DEPT".to_owned(),
            name: "Support Department".to_owned(),
            unit_type: OrgUnitType::Department,
            parent_unit_id: None,
        },
    )
    .await
    .expect("department unit is created");
    sqlx::query("UPDATE organization_units SET is_active = false WHERE id = $1")
        .bind(inactive_facility.id)
        .execute(&pool)
        .await
        .expect("facility can be marked inactive");

    let facility_units = hms_db::admin::list_organization_units(
        &pool,
        facility_id,
        None,
        100,
        Some(OrgUnitType::Facility),
        Some(true),
    )
    .await
    .expect("facility units list");

    assert!(!facility_units.is_empty());
    assert!(facility_units
        .iter()
        .all(|unit| unit.unit_type == OrgUnitType::Facility && unit.is_active));
    assert!(!facility_units
        .iter()
        .any(|unit| unit.id == inactive_facility.id));
}

#[tokio::test]
async fn audit_events_are_filtered_server_side() {
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
    let owner_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM users WHERE facility_id = $1 AND email = 'owner@hms.local'",
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("owner exists");
    let patient_id = Uuid::new_v4();
    let invoice_id = Uuid::new_v4();

    hms_db::admin::insert_audit_event(
        &pool,
        NewAuditEvent {
            facility_id,
            actor_user_id: Some(owner_id),
            request_id: Some("audit-filter-patient".to_owned()),
            event_type: "patient.record.created".to_owned(),
            resource_type: "patient".to_owned(),
            resource_id: Some(patient_id),
            metadata: json!({}),
        },
    )
    .await
    .expect("patient audit event inserts");
    hms_db::admin::insert_audit_event(
        &pool,
        NewAuditEvent {
            facility_id,
            actor_user_id: Some(owner_id),
            request_id: Some("audit-filter-invoice".to_owned()),
            event_type: "billing.invoice.updated".to_owned(),
            resource_type: "invoice".to_owned(),
            resource_id: Some(invoice_id),
            metadata: json!({}),
        },
    )
    .await
    .expect("billing audit event inserts");

    let filters = hms_db::admin::AuditEventFilters {
        search: Some("invoice".to_owned()),
        action: Some("UPDATE".to_owned()),
        category: Some("BILLING".to_owned()),
        start_date: Some(chrono::Utc::now().date_naive()),
        end_date: Some(chrono::Utc::now().date_naive()),
        timestamp_desc: true,
    };
    let events = hms_db::admin::list_audit_events(&pool, facility_id, None, 10, filters)
        .await
        .expect("filtered audit events load");

    assert_eq!(events.len(), 1);
    assert_eq!(events[0].event_type, "billing.invoice.updated");
    assert_eq!(events[0].resource_type, "invoice");
    assert_eq!(events[0].resource_id, Some(invoice_id));
}

#[tokio::test]
async fn staff_accounts_and_practitioner_profiles_are_facility_scoped() {
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
    let owner_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM users WHERE facility_id = $1 AND email = 'owner@hms.local'",
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("owner exists");

    let staff = hms_db::admin::create_staff_account(
        &pool,
        NewStaffAccount {
            facility_id,
            email: "akosua.clinician@hms.local".to_owned(),
            display_name: "Akosua Clinician".to_owned(),
            password_hash: "hashed-temporary-password".to_owned(),
            employee_id: "EMP-HMS-2026-0001".to_owned(),
            department: "Clinical".to_owned(),
            position: "Medical Officer".to_owned(),
            hire_date: NaiveDate::from_ymd_opt(2026, 5, 10).expect("valid hire date"),
            created_by_user_id: owner_id,
            practitioner_profile: Some(NewPractitionerProfile {
                license_number: "MDC/RN/0001".to_owned(),
                specialization: "Internal Medicine".to_owned(),
                qualification: "MBChB".to_owned(),
                fhir_practitioner_id: None,
            }),
        },
        Some("staff-create-test".to_owned()),
    )
    .await
    .expect("staff account is created");

    assert_eq!(staff.email, "akosua.clinician@hms.local");
    assert!(staff.is_active);
    assert!(staff.password_change_required);
    assert_eq!(
        staff
            .practitioner_profile
            .as_ref()
            .expect("practitioner profile exists")
            .license_number,
        "MDC/RN/0001"
    );

    let updated_staff = hms_db::admin::update_staff_account(
        &pool,
        facility_id,
        staff.id,
        hms_domain::admin::UpdateStaffRequest {
            display_name: Some("Akosua Updated".to_owned()),
            department: Some("Emergency".to_owned()),
            position: Some("Emergency Physician".to_owned()),
        },
        owner_id,
        Some("staff-update-test".to_owned()),
    )
    .await
    .expect("staff account updates")
    .expect("staff account exists");
    assert_eq!(updated_staff.display_name, "Akosua Updated");
    assert_eq!(updated_staff.department, "Emergency");
    assert_eq!(updated_staff.position, "Emergency Physician");
    assert!(hms_db::admin::update_staff_account(
        &pool,
        Uuid::new_v4(),
        staff.id,
        hms_domain::admin::UpdateStaffRequest {
            display_name: Some("Cross Facility".to_owned()),
            department: None,
            position: None,
        },
        owner_id,
        Some("staff-update-cross-facility-test".to_owned()),
    )
    .await
    .expect("cross-facility update succeeds")
    .is_none());

    let listed = hms_db::admin::list_staff_accounts(&pool, facility_id, None, 10, None, None, None)
        .await
        .expect("staff list succeeds");
    assert!(listed
        .iter()
        .any(|item| item.id == staff.id && item.display_name == "Akosua Updated"));

    let directory = hms_db::admin::list_staff_directory(&pool, facility_id, None, 10)
        .await
        .expect("staff directory succeeds");
    assert!(directory
        .iter()
        .any(|item| item.user_id == staff.user_id && item.display_name == "Akosua Updated"));
    assert!(
        hms_db::admin::list_staff_accounts(&pool, Uuid::new_v4(), None, 10, None, None, None)
            .await
            .expect("cross-facility list succeeds")
            .is_empty()
    );

    let forced_reset = hms_db::admin::force_staff_password_reset(
        &pool,
        facility_id,
        staff.id,
        owner_id,
        Some("staff-reset-test".to_owned()),
    )
    .await
    .expect("force password reset succeeds")
    .expect("staff account exists");
    assert!(forced_reset.password_change_required);
    assert!(forced_reset.session_version > staff.session_version);

    let updated_profile = hms_db::admin::upsert_practitioner_profile(
        &pool,
        facility_id,
        staff.id,
        owner_id,
        NewPractitionerProfile {
            license_number: "MDC/RN/0002".to_owned(),
            specialization: "Emergency Medicine".to_owned(),
            qualification: "MBChB, MWACP".to_owned(),
            fhir_practitioner_id: Some("Practitioner/hms-0002".to_owned()),
        },
        Some("staff-practitioner-test".to_owned()),
    )
    .await
    .expect("practitioner profile upsert succeeds")
    .expect("staff account exists");
    let practitioner_profile = updated_profile
        .practitioner_profile
        .as_ref()
        .expect("practitioner profile exists");
    assert_eq!(practitioner_profile.specialization, "Emergency Medicine");
    let practitioner_by_id =
        hms_db::admin::get_practitioner(&pool, facility_id, practitioner_profile.id)
            .await
            .expect("practitioner detail lookup succeeds")
            .expect("practitioner exists");
    assert_eq!(practitioner_by_id.id, practitioner_profile.id);
    assert_eq!(practitioner_by_id.staff_id, staff.id);
    assert_eq!(practitioner_by_id.license_number, "MDC/RN/0002");
    let practitioner_by_staff = hms_db::admin::get_practitioner(&pool, facility_id, staff.id)
        .await
        .expect("practitioner by staff lookup succeeds")
        .expect("practitioner exists by staff id");
    assert_eq!(practitioner_by_staff.id, practitioner_profile.id);
    assert!(
        hms_db::admin::get_practitioner(&pool, Uuid::new_v4(), practitioner_profile.id)
            .await
            .expect("cross-facility practitioner lookup succeeds")
            .is_none()
    );

    let matching_staff = hms_db::admin::list_staff_accounts(
        &pool,
        facility_id,
        None,
        25,
        Some("akosua".to_owned()),
        Some(true),
        Some(true),
    )
    .await
    .expect("staff search succeeds");
    assert_eq!(matching_staff.len(), 1);
    assert_eq!(matching_staff[0].id, staff.id);

    let matching_practitioners = hms_db::admin::list_practitioners(
        &pool,
        facility_id,
        None,
        25,
        Some("mdc/rn/0002".to_owned()),
        Some(true),
    )
    .await
    .expect("practitioner search succeeds");
    assert_eq!(matching_practitioners.len(), 1);
    assert_eq!(matching_practitioners[0].staff_id, staff.id);

    let deactivated = hms_db::admin::deactivate_staff_account(
        &pool,
        facility_id,
        staff.id,
        owner_id,
        Some("staff-deactivate-test".to_owned()),
    )
    .await
    .expect("deactivate succeeds")
    .expect("staff account exists");
    assert!(!deactivated.is_active);

    let active_directory = hms_db::admin::list_staff_directory(&pool, facility_id, None, 10)
        .await
        .expect("active staff directory succeeds");
    assert!(!active_directory
        .iter()
        .any(|item| item.user_id == staff.user_id));

    let reactivated = hms_db::admin::reactivate_staff_account(
        &pool,
        facility_id,
        staff.id,
        owner_id,
        Some("staff-reactivate-test".to_owned()),
    )
    .await
    .expect("reactivate succeeds")
    .expect("staff account exists");
    assert!(reactivated.is_active);
}
