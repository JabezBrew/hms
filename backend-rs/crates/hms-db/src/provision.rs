use argon2::{Argon2, PasswordHasher};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{DateTime, NaiveDate, Utc};
use hms_domain::admin::{AuthorityAppointmentStatus, CommitteeStatus, OrgUnitType, PositionStatus};
use hms_domain::auth::PatientDataVisibility;
use hms_domain::billing::{BillingRuleType, ServiceKind};
use hms_domain::capabilities::{
    enabled_features_for_profile, feature_flags_for_profile, permissions_for_profile, ALL_PROFILES,
};
use hms_domain::dashboard::NotificationPriority;
use hms_domain::deployment::{DeploymentProfile, FeatureKey, PermissionCode};
use hms_domain::inventory::InventoryItemType;
use hms_domain::patients::{PatientAdministrativeStatus, PatientContextKind, Sex};
use hms_domain::ward::{BedStatus, WardStatus};
use password_hash::SaltString;
use rand_core::{OsRng, RngCore};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::codec;
use crate::PgPool;

static PROVISION_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

pub const FACILITY_ID: u128 = 0x10000000000000000000000000000001;
pub const OWNER_USER_ID: u128 = 0x20000000000000000000000000000001;
pub const LIMITED_USER_ID: u128 = 0x20000000000000000000000000000002;
pub const PATIENT_ONE_ID: u128 = 0x30000000000000000000000000000001;
pub const PATIENT_TWO_ID: u128 = 0x30000000000000000000000000000002;
pub const DEFAULT_PATIENT_VALIDATION_FIRST_NAME_ID: u128 = 0x30000000000000000000000000000100;
pub const DEFAULT_PATIENT_VALIDATION_LAST_NAME_ID: u128 = 0x30000000000000000000000000000101;
pub const DEFAULT_PATIENT_VALIDATION_DATE_OF_BIRTH_ID: u128 = 0x30000000000000000000000000000102;
pub const DEFAULT_PATIENT_VALIDATION_SEX_ID: u128 = 0x30000000000000000000000000000103;
pub const DEFAULT_CLINIC_ID: u128 = 0x40000000000000000000000000000001;
pub const DEFAULT_WARD_ID: u128 = 0x50000000000000000000000000000001;
pub const DEFAULT_BED_ID: u128 = 0x50000000000000000000000000000002;
pub const DEFAULT_NOTE_TEMPLATE_ID: u128 = 0x60000000000000000000000000000001;
pub const DEFAULT_LAB_TEST_FBC_ID: u128 = 0x70000000000000000000000000000001;
pub const DEFAULT_LAB_TEST_MALARIA_ID: u128 = 0x70000000000000000000000000000002;
pub const DEFAULT_LAB_PANEL_BASIC_ID: u128 = 0x70000000000000000000000000000010;
pub const DEFAULT_INVENTORY_CATEGORY_MED_ID: u128 = 0x80000000000000000000000000000001;
pub const DEFAULT_INVENTORY_ITEM_PARACETAMOL_ID: u128 = 0x80000000000000000000000000000002;
pub const DEFAULT_INVENTORY_ITEM_MORPHINE_ID: u128 = 0x80000000000000000000000000000003;
pub const DEFAULT_MAIN_STORE_ID: u128 = 0x80000000000000000000000000000010;
pub const DEFAULT_PHARMACY_STORE_ID: u128 = 0x80000000000000000000000000000011;
pub const DEFAULT_SERVICE_CONSULTATION_ID: u128 = 0x90000000000000000000000000000001;
pub const DEFAULT_SERVICE_LAB_FBC_ID: u128 = 0x90000000000000000000000000000002;
pub const DEFAULT_SERVICE_MEDICATION_ID: u128 = 0x90000000000000000000000000000003;
pub const DEFAULT_PRICE_CONSULTATION_ID: u128 = 0x90000000000000000000000000000010;
pub const DEFAULT_PRICE_LAB_FBC_ID: u128 = 0x90000000000000000000000000000011;
pub const DEFAULT_PRICE_MEDICATION_ID: u128 = 0x90000000000000000000000000000012;
pub const DEFAULT_BILLING_RULE_CASH_ID: u128 = 0x90000000000000000000000000000020;
pub const DEFAULT_BILLING_RULE_NHIS_ID: u128 = 0x90000000000000000000000000000021;
pub const DEFAULT_CASH_DRAWER_ID: u128 = 0x90000000000000000000000000000030;
pub const DEFAULT_ORG_UNIT_ADMIN_ID: u128 = 0xa0000000000000000000000000000001;
pub const DEFAULT_ORG_UNIT_CLINICAL_ID: u128 = 0xa0000000000000000000000000000002;
pub const DEFAULT_POSITION_TEMPLATE_ADMIN_ID: u128 = 0xa0000000000000000000000000000010;
pub const DEFAULT_POSITION_ADMIN_ID: u128 = 0xa0000000000000000000000000000020;
pub const DEFAULT_AUTHORITY_APPOINTMENT_ID: u128 = 0xa0000000000000000000000000000030;
pub const DEFAULT_COMMITTEE_ID: u128 = 0xa0000000000000000000000000000040;
pub const DEFAULT_NOTIFICATION_ID: u128 = 0xb0000000000000000000000000000001;

#[derive(Clone, Debug)]
pub struct BaselineProvisioning {
    pub facility_id: Uuid,
    pub facility_code: String,
    pub facility_name: String,
    pub deployment_profile: DeploymentProfile,
    pub owner_email: String,
    pub owner_display_name: String,
    pub owner_password: String,
    pub seed_demo_patients: bool,
}

impl BaselineProvisioning {
    pub fn hms_local(deployment_profile: DeploymentProfile) -> Self {
        Self {
            facility_id: Uuid::from_u128(FACILITY_ID),
            facility_code: "HMS".to_owned(),
            facility_name: "HMS Local Facility".to_owned(),
            deployment_profile,
            owner_email: "owner@hms.local".to_owned(),
            owner_display_name: "HMS Owner".to_owned(),
            owner_password: "ChangeMe123!".to_owned(),
            seed_demo_patients: true,
        }
    }
}

pub async fn provision_baseline(
    pool: &PgPool,
    baseline: &BaselineProvisioning,
) -> anyhow::Result<()> {
    let _guard = PROVISION_LOCK
        .get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await;
    seed_deployment_profiles(pool).await?;
    seed_facility(pool, baseline).await?;
    seed_default_clinic(pool, baseline).await?;
    seed_default_ward(pool, baseline).await?;
    seed_clinical_templates(pool, baseline).await?;
    seed_lab_catalog(pool, baseline).await?;
    seed_inventory_baseline(pool, baseline).await?;
    seed_billing_baseline(pool, baseline).await?;
    seed_users(pool, baseline).await?;
    seed_admin_authority_baseline(pool, baseline).await?;
    seed_notifications(pool, baseline).await?;
    seed_patient_validation_rules(pool, baseline).await?;
    if baseline.seed_demo_patients {
        seed_patients(pool, baseline).await?;
        seed_patient_contexts(pool, baseline).await?;
    }
    Ok(())
}

fn token_hash(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

pub fn hash_refresh_token(token: &str) -> String {
    token_hash(token)
}

pub fn generate_secret_token() -> String {
    let mut bytes = [0_u8; 32];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn hash_password(password: &str) -> anyhow::Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    Ok(Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|error| anyhow::anyhow!("failed to hash seed password: {error}"))?
        .to_string())
}

async fn seed_deployment_profiles(pool: &PgPool) -> anyhow::Result<()> {
    for profile in ALL_PROFILES {
        let profile_code = codec::encode(profile)?;
        sqlx::query(
            r#"
            INSERT INTO deployment_profiles (code, label, is_supported)
            VALUES ($1, $2, TRUE)
            ON CONFLICT (code) DO UPDATE
            SET label = EXCLUDED.label,
                is_supported = TRUE
            "#,
        )
        .bind(&profile_code)
        .bind(hms_domain::capabilities::profile_label(profile))
        .execute(pool)
        .await?;

        for (feature, enabled) in feature_flags_for_profile(profile) {
            sqlx::query(
                r#"
                INSERT INTO deployment_profile_features (profile_code, feature_key, enabled)
                VALUES ($1, $2, $3)
                ON CONFLICT (profile_code, feature_key) DO UPDATE
                SET enabled = EXCLUDED.enabled
                "#,
            )
            .bind(&profile_code)
            .bind(codec::encode(feature)?)
            .bind(enabled)
            .execute(pool)
            .await?;
        }

        for permission in permissions_for_profile(profile) {
            sqlx::query(
                r#"
                INSERT INTO deployment_profile_permissions (profile_code, permission_code)
                VALUES ($1, $2)
                ON CONFLICT (profile_code, permission_code) DO NOTHING
                "#,
            )
            .bind(&profile_code)
            .bind(codec::encode(permission)?)
            .execute(pool)
            .await?;
        }
    }

    Ok(())
}

async fn seed_facility(pool: &PgPool, baseline: &BaselineProvisioning) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO facilities (id, code, name, deployment_profile)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (code) DO UPDATE
        SET id = EXCLUDED.id,
            name = EXCLUDED.name,
            deployment_profile = EXCLUDED.deployment_profile,
            is_active = TRUE
        "#,
    )
    .bind(baseline.facility_id)
    .bind(&baseline.facility_code)
    .bind(&baseline.facility_name)
    .bind(codec::encode(baseline.deployment_profile)?)
    .execute(pool)
    .await?;

    Ok(())
}

async fn seed_default_clinic(pool: &PgPool, baseline: &BaselineProvisioning) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO clinics (id, facility_id, code, name)
        VALUES ($1, $2, 'general', 'General Clinic')
        ON CONFLICT (facility_id, code) DO UPDATE
        SET id = EXCLUDED.id,
            name = EXCLUDED.name,
            is_active = TRUE
        "#,
    )
    .bind(Uuid::from_u128(DEFAULT_CLINIC_ID))
    .bind(baseline.facility_id)
    .execute(pool)
    .await?;

    Ok(())
}

async fn seed_default_ward(pool: &PgPool, baseline: &BaselineProvisioning) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO wards (id, facility_id, code, name, status)
        VALUES ($1, $2, 'general', 'General Ward', $3)
        ON CONFLICT (facility_id, code) DO UPDATE
        SET id = EXCLUDED.id,
            name = EXCLUDED.name,
            status = EXCLUDED.status
        "#,
    )
    .bind(Uuid::from_u128(DEFAULT_WARD_ID))
    .bind(baseline.facility_id)
    .bind(codec::encode(WardStatus::Active)?)
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO beds (id, facility_id, ward_id, bed_code, status)
        VALUES ($1, $2, $3, 'G-01', $4)
        ON CONFLICT (ward_id, bed_code) DO UPDATE
        SET id = EXCLUDED.id,
            status = EXCLUDED.status
        "#,
    )
    .bind(Uuid::from_u128(DEFAULT_BED_ID))
    .bind(baseline.facility_id)
    .bind(Uuid::from_u128(DEFAULT_WARD_ID))
    .bind(codec::encode(BedStatus::Available)?)
    .execute(pool)
    .await?;

    Ok(())
}

async fn seed_clinical_templates(
    pool: &PgPool,
    baseline: &BaselineProvisioning,
) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO clinical_note_templates (
            id,
            facility_id,
            title,
            note_type,
            body_template
        )
        VALUES ($1, $2, 'General Clinical Note', 'general', 'History:\n\nExamination:\n\nAssessment:\n\nPlan:')
        ON CONFLICT (id) DO UPDATE
        SET title = EXCLUDED.title,
            note_type = EXCLUDED.note_type,
            body_template = EXCLUDED.body_template,
            is_active = TRUE
        "#,
    )
    .bind(Uuid::from_u128(DEFAULT_NOTE_TEMPLATE_ID))
    .bind(baseline.facility_id)
    .execute(pool)
    .await?;

    Ok(())
}

async fn seed_lab_catalog(pool: &PgPool, baseline: &BaselineProvisioning) -> anyhow::Result<()> {
    for (id, code, name, specimen_type, result_unit) in [
        (
            Uuid::from_u128(DEFAULT_LAB_TEST_FBC_ID),
            "FBC",
            "Full Blood Count",
            "blood",
            None,
        ),
        (
            Uuid::from_u128(DEFAULT_LAB_TEST_MALARIA_ID),
            "MP",
            "Malaria Parasite",
            "blood",
            Some("parasites/ul"),
        ),
    ] {
        sqlx::query(
            r#"
            INSERT INTO lab_tests (id, facility_id, code, name, specimen_type, result_unit)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (facility_id, code) DO UPDATE
            SET id = EXCLUDED.id,
                name = EXCLUDED.name,
                specimen_type = EXCLUDED.specimen_type,
                result_unit = EXCLUDED.result_unit,
                is_active = TRUE
            "#,
        )
        .bind(id)
        .bind(baseline.facility_id)
        .bind(code)
        .bind(name)
        .bind(specimen_type)
        .bind(result_unit)
        .execute(pool)
        .await?;
    }

    sqlx::query(
        r#"
        INSERT INTO lab_panels (id, facility_id, code, name)
        VALUES ($1, $2, 'BASIC_HEME', 'Basic Hematology')
        ON CONFLICT (facility_id, code) DO UPDATE
        SET id = EXCLUDED.id,
            name = EXCLUDED.name,
            is_active = TRUE
        "#,
    )
    .bind(Uuid::from_u128(DEFAULT_LAB_PANEL_BASIC_ID))
    .bind(baseline.facility_id)
    .execute(pool)
    .await?;

    for test_id in [
        Uuid::from_u128(DEFAULT_LAB_TEST_FBC_ID),
        Uuid::from_u128(DEFAULT_LAB_TEST_MALARIA_ID),
    ] {
        sqlx::query(
            r#"
            INSERT INTO lab_panel_tests (panel_id, test_id)
            VALUES ($1, $2)
            ON CONFLICT (panel_id, test_id) DO NOTHING
            "#,
        )
        .bind(Uuid::from_u128(DEFAULT_LAB_PANEL_BASIC_ID))
        .bind(test_id)
        .execute(pool)
        .await?;
    }

    Ok(())
}

async fn seed_inventory_baseline(
    pool: &PgPool,
    baseline: &BaselineProvisioning,
) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO inventory_categories (id, facility_id, code, name)
        VALUES ($1, $2, 'MED', 'Medicines')
        ON CONFLICT (facility_id, code) DO UPDATE
        SET id = EXCLUDED.id,
            name = EXCLUDED.name,
            is_active = TRUE
        "#,
    )
    .bind(Uuid::from_u128(DEFAULT_INVENTORY_CATEGORY_MED_ID))
    .bind(baseline.facility_id)
    .execute(pool)
    .await?;

    for (id, code, name, item_type, unit, controlled) in [
        (
            Uuid::from_u128(DEFAULT_INVENTORY_ITEM_PARACETAMOL_ID),
            "PARA500",
            "Paracetamol 500mg tablet",
            InventoryItemType::Medication,
            "tablet",
            false,
        ),
        (
            Uuid::from_u128(DEFAULT_INVENTORY_ITEM_MORPHINE_ID),
            "MOR10",
            "Morphine 10mg ampoule",
            InventoryItemType::ControlledSubstance,
            "ampoule",
            true,
        ),
    ] {
        sqlx::query(
            r#"
            INSERT INTO inventory_items (
                id, facility_id, category_id, code, name, item_type, unit, controlled
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (facility_id, code) DO UPDATE
            SET id = EXCLUDED.id,
                category_id = EXCLUDED.category_id,
                name = EXCLUDED.name,
                item_type = EXCLUDED.item_type,
                unit = EXCLUDED.unit,
                controlled = EXCLUDED.controlled,
                is_active = TRUE
            "#,
        )
        .bind(id)
        .bind(baseline.facility_id)
        .bind(Uuid::from_u128(DEFAULT_INVENTORY_CATEGORY_MED_ID))
        .bind(code)
        .bind(name)
        .bind(codec::encode(item_type)?)
        .bind(unit)
        .bind(controlled)
        .execute(pool)
        .await?;
    }

    for (id, code, name) in [
        (Uuid::from_u128(DEFAULT_MAIN_STORE_ID), "MAIN", "Main Store"),
        (
            Uuid::from_u128(DEFAULT_PHARMACY_STORE_ID),
            "PHARM",
            "Pharmacy Store",
        ),
    ] {
        sqlx::query(
            r#"
            INSERT INTO storage_locations (id, facility_id, code, name)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (facility_id, code) DO UPDATE
            SET id = EXCLUDED.id,
                name = EXCLUDED.name,
                is_active = TRUE
            "#,
        )
        .bind(id)
        .bind(baseline.facility_id)
        .bind(code)
        .bind(name)
        .execute(pool)
        .await?;
    }

    Ok(())
}

async fn seed_billing_baseline(
    pool: &PgPool,
    baseline: &BaselineProvisioning,
) -> anyhow::Result<()> {
    for (id, code, name, service_kind) in [
        (
            DEFAULT_SERVICE_CONSULTATION_ID,
            "CONSULT",
            "General Consultation",
            ServiceKind::Consultation,
        ),
        (
            DEFAULT_SERVICE_LAB_FBC_ID,
            "LAB-FBC",
            "Full Blood Count",
            ServiceKind::Laboratory,
        ),
        (
            DEFAULT_SERVICE_MEDICATION_ID,
            "MED-GENERIC",
            "Generic Medication Dispense",
            ServiceKind::Pharmacy,
        ),
    ] {
        sqlx::query(
            r#"
            INSERT INTO service_catalog (id, facility_id, code, name, service_kind)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (facility_id, code) DO UPDATE
            SET id = EXCLUDED.id,
                name = EXCLUDED.name,
                service_kind = EXCLUDED.service_kind,
                active = TRUE
            "#,
        )
        .bind(Uuid::from_u128(id))
        .bind(baseline.facility_id)
        .bind(code)
        .bind(name)
        .bind(codec::encode(service_kind)?)
        .execute(pool)
        .await?;
    }

    for (id, service_id, amount_minor) in [
        (
            DEFAULT_PRICE_CONSULTATION_ID,
            DEFAULT_SERVICE_CONSULTATION_ID,
            5_000_i64,
        ),
        (
            DEFAULT_PRICE_LAB_FBC_ID,
            DEFAULT_SERVICE_LAB_FBC_ID,
            3_000_i64,
        ),
        (
            DEFAULT_PRICE_MEDICATION_ID,
            DEFAULT_SERVICE_MEDICATION_ID,
            1_500_i64,
        ),
    ] {
        sqlx::query(
            r#"
            INSERT INTO service_prices (id, facility_id, service_id, amount_minor, currency)
            VALUES ($1, $2, $3, $4, 'GHS')
            ON CONFLICT (facility_id, service_id, currency) DO UPDATE
            SET id = EXCLUDED.id,
                amount_minor = EXCLUDED.amount_minor,
                active = TRUE
            "#,
        )
        .bind(Uuid::from_u128(id))
        .bind(baseline.facility_id)
        .bind(Uuid::from_u128(service_id))
        .bind(amount_minor)
        .execute(pool)
        .await?;
    }

    for (id, code, name, rule_type) in [
        (
            DEFAULT_BILLING_RULE_CASH_ID,
            "cash-required",
            "Cash payment required before receipt",
            BillingRuleType::CashRequired,
        ),
        (
            DEFAULT_BILLING_RULE_NHIS_ID,
            "nhis-covered",
            "NHIS claimable service baseline",
            BillingRuleType::NhisCovered,
        ),
    ] {
        sqlx::query(
            r#"
            INSERT INTO billing_rules (id, facility_id, code, name, rule_type)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (facility_id, code) DO UPDATE
            SET id = EXCLUDED.id,
                name = EXCLUDED.name,
                rule_type = EXCLUDED.rule_type,
                active = TRUE
            "#,
        )
        .bind(Uuid::from_u128(id))
        .bind(baseline.facility_id)
        .bind(code)
        .bind(name)
        .bind(codec::encode(rule_type)?)
        .execute(pool)
        .await?;
    }

    sqlx::query(
        r#"
        INSERT INTO cash_drawers (id, facility_id, code, name)
        VALUES ($1, $2, 'MAIN', 'Main Cash Drawer')
        ON CONFLICT (facility_id, code) DO UPDATE
        SET id = EXCLUDED.id,
            name = EXCLUDED.name,
            active = TRUE
        "#,
    )
    .bind(Uuid::from_u128(DEFAULT_CASH_DRAWER_ID))
    .bind(baseline.facility_id)
    .execute(pool)
    .await?;

    Ok(())
}

async fn seed_admin_authority_baseline(
    pool: &PgPool,
    baseline: &BaselineProvisioning,
) -> anyhow::Result<()> {
    for (id, code, name, unit_type) in [
        (
            DEFAULT_ORG_UNIT_ADMIN_ID,
            "ADMIN",
            "Administration",
            OrgUnitType::Administrative,
        ),
        (
            DEFAULT_ORG_UNIT_CLINICAL_ID,
            "CLINICAL",
            "Clinical Services",
            OrgUnitType::Service,
        ),
    ] {
        sqlx::query(
            r#"
            INSERT INTO organization_units (id, facility_id, code, name, unit_type)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (facility_id, code) DO UPDATE
            SET id = EXCLUDED.id,
                name = EXCLUDED.name,
                unit_type = EXCLUDED.unit_type,
                is_active = TRUE
            "#,
        )
        .bind(Uuid::from_u128(id))
        .bind(baseline.facility_id)
        .bind(code)
        .bind(name)
        .bind(codec::encode(unit_type)?)
        .execute(pool)
        .await?;
    }

    sqlx::query(
        r#"
        INSERT INTO position_templates (id, facility_id, code, title, description, permission_codes)
        VALUES ($1, $2, 'HMS_ADMIN', 'HMS Administrator', 'Manages native HMS authority and organization setup.', $3)
        ON CONFLICT (facility_id, code) DO UPDATE
        SET id = EXCLUDED.id,
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            permission_codes = EXCLUDED.permission_codes
        "#,
    )
    .bind(Uuid::from_u128(DEFAULT_POSITION_TEMPLATE_ADMIN_ID))
    .bind(baseline.facility_id)
    .bind(codec::encode_slice(&[PermissionCode::AdminAuthorityManage])?)
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO positions (id, facility_id, org_unit_id, template_id, code, title, status)
        VALUES ($1, $2, $3, $4, 'HMS_ADMIN', 'HMS Administrator', $5)
        ON CONFLICT (facility_id, code) DO UPDATE
        SET id = EXCLUDED.id,
            org_unit_id = EXCLUDED.org_unit_id,
            template_id = EXCLUDED.template_id,
            title = EXCLUDED.title,
            status = EXCLUDED.status
        "#,
    )
    .bind(Uuid::from_u128(DEFAULT_POSITION_ADMIN_ID))
    .bind(baseline.facility_id)
    .bind(Uuid::from_u128(DEFAULT_ORG_UNIT_ADMIN_ID))
    .bind(Uuid::from_u128(DEFAULT_POSITION_TEMPLATE_ADMIN_ID))
    .bind(codec::encode(PositionStatus::Active)?)
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO authority_appointments (
            id, facility_id, position_id, user_id, appointed_by_user_id,
            appointment_type, status
        )
        VALUES ($1, $2, $3, $4, $4, 'baseline_owner', $5)
        ON CONFLICT (facility_id, position_id, user_id) WHERE status = 'active' DO UPDATE
        SET appointment_type = EXCLUDED.appointment_type,
            status = EXCLUDED.status
        "#,
    )
    .bind(Uuid::from_u128(DEFAULT_AUTHORITY_APPOINTMENT_ID))
    .bind(baseline.facility_id)
    .bind(Uuid::from_u128(DEFAULT_POSITION_ADMIN_ID))
    .bind(Uuid::from_u128(OWNER_USER_ID))
    .bind(codec::encode(AuthorityAppointmentStatus::Active)?)
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO committees (id, facility_id, code, name, mandate, status)
        VALUES ($1, $2, 'CLINICAL_GOVERNANCE', 'Clinical Governance Committee', 'Oversees clinical safety, audit, and policy adoption.', $3)
        ON CONFLICT (facility_id, code) DO UPDATE
        SET id = EXCLUDED.id,
            name = EXCLUDED.name,
            mandate = EXCLUDED.mandate,
            status = EXCLUDED.status
        "#,
    )
    .bind(Uuid::from_u128(DEFAULT_COMMITTEE_ID))
    .bind(baseline.facility_id)
    .bind(codec::encode(CommitteeStatus::Active)?)
    .execute(pool)
    .await?;

    Ok(())
}

async fn seed_notifications(pool: &PgPool, baseline: &BaselineProvisioning) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO notifications (
            id, facility_id, recipient_user_id, notification_type, title, body, priority
        )
        VALUES ($1, $2, $3, 'system', 'HMS V2 foundation ready', 'Production cutover baseline is available.', $4)
        ON CONFLICT (id) DO NOTHING
        "#,
    )
    .bind(Uuid::from_u128(DEFAULT_NOTIFICATION_ID))
    .bind(baseline.facility_id)
    .bind(Uuid::from_u128(OWNER_USER_ID))
    .bind(codec::encode(NotificationPriority::Normal)?)
    .execute(pool)
    .await?;

    Ok(())
}

async fn seed_users(pool: &PgPool, baseline: &BaselineProvisioning) -> anyhow::Result<()> {
    let owner_permissions = permissions_for_profile(baseline.deployment_profile);
    let owner_features = enabled_features_for_profile(baseline.deployment_profile);
    upsert_seed_user(
        pool,
        SeedUser {
            id: Uuid::from_u128(OWNER_USER_ID),
            facility_id: baseline.facility_id,
            email: &baseline.owner_email,
            display_name: &baseline.owner_display_name,
            password: &baseline.owner_password,
            password_change_required: false,
            permissions: owner_permissions,
            features: owner_features,
            visibility: vec![PatientDataVisibility::Demographics],
        },
    )
    .await?;

    upsert_seed_user(
        pool,
        SeedUser {
            id: Uuid::from_u128(LIMITED_USER_ID),
            facility_id: baseline.facility_id,
            email: "limited@hms.local",
            display_name: "Limited User",
            password: "ChangeMe123!",
            password_change_required: true,
            permissions: vec![PermissionCode::AuthMeView],
            features: vec![FeatureKey::Patients],
            visibility: vec![],
        },
    )
    .await?;

    Ok(())
}

struct SeedUser<'a> {
    id: Uuid,
    facility_id: Uuid,
    email: &'a str,
    display_name: &'a str,
    password: &'a str,
    password_change_required: bool,
    permissions: Vec<PermissionCode>,
    features: Vec<FeatureKey>,
    visibility: Vec<PatientDataVisibility>,
}

async fn upsert_seed_user(pool: &PgPool, user: SeedUser<'_>) -> anyhow::Result<()> {
    let password_hash = hash_password(user.password)?;
    sqlx::query(
        r#"
        INSERT INTO users (
            id,
            facility_id,
            email,
            display_name,
            password_hash,
            password_change_required
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (id) DO UPDATE
        SET facility_id = EXCLUDED.facility_id,
            email = EXCLUDED.email,
            display_name = EXCLUDED.display_name,
            password_change_required = EXCLUDED.password_change_required,
            is_active = TRUE
        "#,
    )
    .bind(user.id)
    .bind(user.facility_id)
    .bind(user.email)
    .bind(user.display_name)
    .bind(password_hash)
    .bind(user.password_change_required)
    .execute(pool)
    .await?;

    for permission in user.permissions {
        sqlx::query(
            r#"
            INSERT INTO user_permissions (user_id, permission_code)
            VALUES ($1, $2)
            ON CONFLICT (user_id, permission_code) DO NOTHING
            "#,
        )
        .bind(user.id)
        .bind(codec::encode(permission)?)
        .execute(pool)
        .await?;
    }
    for feature in user.features {
        sqlx::query(
            r#"
            INSERT INTO user_features (user_id, feature_key)
            VALUES ($1, $2)
            ON CONFLICT (user_id, feature_key) DO NOTHING
            "#,
        )
        .bind(user.id)
        .bind(codec::encode(feature)?)
        .execute(pool)
        .await?;
    }
    for visibility in user.visibility {
        sqlx::query(
            r#"
            INSERT INTO user_patient_visibility (user_id, visibility)
            VALUES ($1, $2)
            ON CONFLICT (user_id, visibility) DO NOTHING
            "#,
        )
        .bind(user.id)
        .bind(codec::encode(visibility)?)
        .execute(pool)
        .await?;
    }

    Ok(())
}

async fn seed_patients(pool: &PgPool, baseline: &BaselineProvisioning) -> anyhow::Result<()> {
    let patients = [
        SeedPatient {
            id: Uuid::from_u128(PATIENT_ONE_ID),
            patient_code: "P-0000000001",
            first_name: "Ama",
            last_name: "Mensah",
            date_of_birth: NaiveDate::from_ymd_opt(1990, 2, 14).expect("static seed date is valid"),
            sex: Sex::Female,
            created_at: DateTime::parse_from_rfc3339("2026-01-01T08:00:00Z")?.with_timezone(&Utc),
        },
        SeedPatient {
            id: Uuid::from_u128(PATIENT_TWO_ID),
            patient_code: "P-0000000002",
            first_name: "Kojo",
            last_name: "Boateng",
            date_of_birth: NaiveDate::from_ymd_opt(1984, 7, 2).expect("static seed date is valid"),
            sex: Sex::Male,
            created_at: DateTime::parse_from_rfc3339("2026-01-01T08:01:00Z")?.with_timezone(&Utc),
        },
    ];

    for patient in patients {
        sqlx::query(
            r#"
            INSERT INTO patients (
                id,
                facility_id,
                patient_code,
                first_name,
                last_name,
                date_of_birth,
                sex,
                status,
                created_at,
                updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
            ON CONFLICT (id) DO NOTHING
            "#,
        )
        .bind(patient.id)
        .bind(baseline.facility_id)
        .bind(patient.patient_code)
        .bind(patient.first_name)
        .bind(patient.last_name)
        .bind(patient.date_of_birth)
        .bind(codec::encode(patient.sex)?)
        .bind(codec::encode(PatientAdministrativeStatus::Active)?)
        .bind(patient.created_at)
        .execute(pool)
        .await?;

        sqlx::query(
            r#"
            INSERT INTO patient_chronicle_read_models (patient_id, facility_id, summary_status)
            VALUES ($1, $2, 'empty')
            ON CONFLICT (patient_id) DO NOTHING
            "#,
        )
        .bind(patient.id)
        .bind(baseline.facility_id)
        .execute(pool)
        .await?;
    }

    Ok(())
}

async fn seed_patient_contexts(
    pool: &PgPool,
    baseline: &BaselineProvisioning,
) -> anyhow::Result<()> {
    for patient_id in [
        Uuid::from_u128(PATIENT_ONE_ID),
        Uuid::from_u128(PATIENT_TWO_ID),
    ] {
        crate::patients::upsert_patient_context(
            pool,
            baseline.facility_id,
            Uuid::from_u128(OWNER_USER_ID),
            patient_id,
            PatientContextKind::Assigned,
            Some("seeded-assignment".to_owned()),
        )
        .await?;
    }

    Ok(())
}

async fn seed_patient_validation_rules(
    pool: &PgPool,
    baseline: &BaselineProvisioning,
) -> anyhow::Result<()> {
    let rules = [
        SeedPatientValidationRule {
            id: Uuid::from_u128(DEFAULT_PATIENT_VALIDATION_FIRST_NAME_ID),
            field_name: "first_name",
            validation_regex: Some(r"^[A-Za-z' -]{2,100}$"),
            validation_message: "First name is required and must use valid name characters.",
            is_required: true,
        },
        SeedPatientValidationRule {
            id: Uuid::from_u128(DEFAULT_PATIENT_VALIDATION_LAST_NAME_ID),
            field_name: "last_name",
            validation_regex: Some(r"^[A-Za-z' -]{2,100}$"),
            validation_message: "Last name is required and must use valid name characters.",
            is_required: true,
        },
        SeedPatientValidationRule {
            id: Uuid::from_u128(DEFAULT_PATIENT_VALIDATION_DATE_OF_BIRTH_ID),
            field_name: "date_of_birth",
            validation_regex: None,
            validation_message: "Date of birth is required.",
            is_required: true,
        },
        SeedPatientValidationRule {
            id: Uuid::from_u128(DEFAULT_PATIENT_VALIDATION_SEX_ID),
            field_name: "gender",
            validation_regex: None,
            validation_message: "Sex is required.",
            is_required: true,
        },
    ];

    for rule in rules {
        sqlx::query(
            r#"
            INSERT INTO patient_registration_validation_rules (
                id,
                facility_id,
                field_name,
                validation_regex,
                validation_message,
                is_required,
                is_active
            )
            VALUES ($1, $2, $3, $4, $5, $6, TRUE)
            ON CONFLICT (facility_id, field_name) DO UPDATE
            SET validation_regex = EXCLUDED.validation_regex,
                validation_message = EXCLUDED.validation_message,
                is_required = EXCLUDED.is_required,
                is_active = TRUE,
                updated_at = now()
            "#,
        )
        .bind(rule.id)
        .bind(baseline.facility_id)
        .bind(rule.field_name)
        .bind(rule.validation_regex)
        .bind(rule.validation_message)
        .bind(rule.is_required)
        .execute(pool)
        .await?;
    }

    Ok(())
}

struct SeedPatient {
    id: Uuid,
    patient_code: &'static str,
    first_name: &'static str,
    last_name: &'static str,
    date_of_birth: NaiveDate,
    sex: Sex,
    created_at: DateTime<Utc>,
}

struct SeedPatientValidationRule {
    id: Uuid,
    field_name: &'static str,
    validation_regex: Option<&'static str>,
    validation_message: &'static str,
    is_required: bool,
}
use std::sync::OnceLock;
