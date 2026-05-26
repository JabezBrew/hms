use std::sync::OnceLock;

use anyhow::ensure;
use argon2::{Argon2, PasswordHasher};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{DateTime, Duration, NaiveDate, Utc};
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
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Transaction};
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
pub const DEFAULT_APPOINTMENT_TYPE_GENERAL_ID: u128 = 0x40000000000000000000000000000010;
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
pub const DEFAULT_SUPPLIER_ACME_ID: u128 = 0x80000000000000000000000000000020;
pub const DEFAULT_SUPPLIER_CITY_ID: u128 = 0x80000000000000000000000000000021;
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
pub const DEFAULT_ORG_UNIT_OPD_ID: u128 = 0xa0000000000000000000000000000003;
pub const DEFAULT_ORG_UNIT_EMERGENCY_ID: u128 = 0xa0000000000000000000000000000004;
pub const DEFAULT_ORG_UNIT_MEDICINE_ID: u128 = 0xa0000000000000000000000000000005;
pub const DEFAULT_POSITION_TEMPLATE_ADMIN_ID: u128 = 0xa0000000000000000000000000000010;
pub const DEFAULT_POSITION_ADMIN_ID: u128 = 0xa0000000000000000000000000000020;
pub const DEFAULT_AUTHORITY_APPOINTMENT_ID: u128 = 0xa0000000000000000000000000000030;
pub const DEFAULT_COMMITTEE_ID: u128 = 0xa0000000000000000000000000000040;
pub const DEFAULT_NOTIFICATION_ID: u128 = 0xb0000000000000000000000000000001;

const DEMO_WARD_ID: u128 = 0xd1000000000000000000000000000001;
const DEMO_SECTION_ID: u128 = 0xd1000000000000000000000000000010;
const DEMO_BED_BASE_ID: u128 = 0xd1100000000000000000000000000000;
const DEMO_PATIENT_BASE_ID: u128 = 0xd2000000000000000000000000000000;
const DEMO_CONTEXT_BASE_ID: u128 = 0xd2100000000000000000000000000000;
const DEMO_ADMISSION_BASE_ID: u128 = 0xd3000000000000000000000000000000;
const DEMO_NURSING_TASK_BASE_ID: u128 = 0xd3100000000000000000000000000000;
const DEMO_MED_ADMIN_BASE_ID: u128 = 0xd3200000000000000000000000000000;
const DEMO_TREATMENT_SHEET_BASE_ID: u128 = 0xd3300000000000000000000000000000;
const DEMO_NOTE_BASE_ID: u128 = 0xd4000000000000000000000000000000;
const DEMO_NOTE_VERSION_BASE_ID: u128 = 0xd4100000000000000000000000000000;
const DEMO_PROBLEM_BASE_ID: u128 = 0xd4200000000000000000000000000000;
const DEMO_ALLERGY_BASE_ID: u128 = 0xd4300000000000000000000000000000;
const DEMO_PRESCRIPTION_BASE_ID: u128 = 0xd4400000000000000000000000000000;
const DEMO_CHART_ENTRY_BASE_ID: u128 = 0xd4500000000000000000000000000000;
const DEMO_LAB_ORDER_BASE_ID: u128 = 0xd5000000000000000000000000000000;
const DEMO_LAB_SPECIMEN_BASE_ID: u128 = 0xd5100000000000000000000000000000;
const DEMO_LAB_RESULT_BASE_ID: u128 = 0xd5200000000000000000000000000000;
const DEMO_INVOICE_BASE_ID: u128 = 0xd6000000000000000000000000000000;
const DEMO_INVOICE_LINE_BASE_ID: u128 = 0xd6100000000000000000000000000000;
const DEMO_PAYMENT_BASE_ID: u128 = 0xd6200000000000000000000000000000;
const DEMO_RECEIPT_BASE_ID: u128 = 0xd6300000000000000000000000000000;
const DEMO_NHIS_CLAIM_BASE_ID: u128 = 0xd6400000000000000000000000000000;
const DEMO_WARD_ROUND_BASE_ID: u128 = 0xd7000000000000000000000000000000;
const DEMO_WARD_ROUND_ACTION_BASE_ID: u128 = 0xd7100000000000000000000000000000;
const DEMO_WARD_ROUND_LINK_BASE_ID: u128 = 0xd7200000000000000000000000000000;

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
    pub ops_operator_emails: Vec<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PerformanceSeedScale {
    Small,
    Medium,
    Large,
}

impl PerformanceSeedScale {
    pub fn parse(value: &str) -> anyhow::Result<Option<Self>> {
        match value.trim().to_ascii_lowercase().as_str() {
            "" | "0" | "false" | "no" | "off" | "none" | "current-seed" => Ok(None),
            "small" => Ok(Some(Self::Small)),
            "medium" => Ok(Some(Self::Medium)),
            "large" => Ok(Some(Self::Large)),
            _ => anyhow::bail!("HMS_PERF_SEED_SCALE must be small, medium, large, or disabled"),
        }
    }

    pub fn config(self) -> PerformanceSeedConfig {
        match self {
            Self::Small => PerformanceSeedConfig {
                patient_count: 500,
                chronicled_patient_count: 50,
                notes_per_chronicle_patient: 20,
                lab_order_count: 400,
                inventory_item_count: 300,
                admission_count: 80,
                invoice_count: 400,
            },
            Self::Medium => PerformanceSeedConfig {
                patient_count: 2_500,
                chronicled_patient_count: 200,
                notes_per_chronicle_patient: 40,
                lab_order_count: 1_500,
                inventory_item_count: 1_000,
                admission_count: 250,
                invoice_count: 1_500,
            },
            Self::Large => PerformanceSeedConfig {
                patient_count: 10_000,
                chronicled_patient_count: 500,
                notes_per_chronicle_patient: 60,
                lab_order_count: 5_000,
                inventory_item_count: 3_000,
                admission_count: 750,
                invoice_count: 5_000,
            },
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PerformanceSeedConfig {
    pub patient_count: i32,
    pub chronicled_patient_count: i32,
    pub notes_per_chronicle_patient: i32,
    pub lab_order_count: i32,
    pub inventory_item_count: i32,
    pub admission_count: i32,
    pub invoice_count: i32,
}

impl PerformanceSeedConfig {
    fn validate(self) -> anyhow::Result<()> {
        ensure!(
            self.patient_count > 0,
            "patient_count must be greater than zero"
        );
        ensure!(
            self.chronicled_patient_count >= 0
                && self.chronicled_patient_count <= self.patient_count,
            "chronicled_patient_count must fit inside patient_count"
        );
        ensure!(
            self.notes_per_chronicle_patient >= 0,
            "notes_per_chronicle_patient must be non-negative"
        );
        ensure!(
            self.lab_order_count >= 0,
            "lab_order_count must be non-negative"
        );
        ensure!(
            self.inventory_item_count >= 0,
            "inventory_item_count must be non-negative"
        );
        ensure!(
            self.admission_count >= 0 && self.admission_count <= self.patient_count,
            "admission_count must fit inside patient_count"
        );
        ensure!(
            self.invoice_count >= 0,
            "invoice_count must be non-negative"
        );
        Ok(())
    }
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
            ops_operator_emails: Vec::new(),
        }
    }

    pub fn hms_local_with_facility_code(
        deployment_profile: DeploymentProfile,
        facility_code: impl Into<String>,
    ) -> Self {
        let mut baseline = Self::hms_local(deployment_profile);
        baseline.facility_code = facility_code.into();
        baseline
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DemoSeedProfile {
    Smoke,
    Small,
}

impl DemoSeedProfile {
    pub fn parse(value: &str) -> anyhow::Result<Option<Self>> {
        match value.trim().to_ascii_lowercase().as_str() {
            "" | "0" | "false" | "no" | "off" | "none" => Ok(None),
            "1" | "true" | "yes" | "on" | "smoke" => Ok(Some(Self::Smoke)),
            "small" => Ok(Some(Self::Small)),
            _ => anyhow::bail!("HMS_DEMO_SEED_PROFILE must be smoke, small, or disabled"),
        }
    }

    fn config(self) -> DemoSeedConfig {
        match self {
            Self::Smoke => DemoSeedConfig { patient_count: 2 },
            Self::Small => DemoSeedConfig { patient_count: 4 },
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct DemoSeedConfig {
    patient_count: usize,
}

impl DemoSeedConfig {
    fn validate(self) -> anyhow::Result<()> {
        ensure!(
            self.patient_count > 0,
            "demo patient_count must be greater than zero"
        );
        ensure!(
            self.patient_count <= demo_patient_archetypes().len(),
            "demo patient_count exceeds available archetypes"
        );
        Ok(())
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
    seed_default_appointment_types(pool, baseline).await?;
    seed_default_ward(pool, baseline).await?;
    seed_clinical_templates(pool, baseline).await?;
    seed_lab_catalog(pool, baseline).await?;
    seed_inventory_baseline(pool, baseline).await?;
    seed_billing_baseline(pool, baseline).await?;
    seed_users(pool, baseline).await?;
    seed_ops_operator_permissions(pool, baseline).await?;
    seed_admin_authority_baseline(pool, baseline).await?;
    seed_notifications(pool, baseline).await?;
    seed_patient_validation_rules(pool, baseline).await?;
    if baseline.seed_demo_patients {
        seed_patients(pool, baseline).await?;
        seed_patient_contexts(pool, baseline).await?;
    }
    Ok(())
}

pub async fn provision_demo_seed(
    pool: &PgPool,
    baseline: &BaselineProvisioning,
    profile: DemoSeedProfile,
) -> anyhow::Result<()> {
    let config = profile.config();
    config.validate()?;

    let _guard = PROVISION_LOCK
        .get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await;
    let mut tx = pool.begin().await?;
    delete_demo_seed_graph(&mut tx, baseline.facility_id).await?;
    seed_demo_ward_resources(&mut tx, baseline, config).await?;
    seed_demo_patient_graph(&mut tx, baseline, config).await?;
    tx.commit().await?;
    Ok(())
}

async fn delete_demo_seed_graph(
    transaction: &mut Transaction<'_, Postgres>,
    facility_id: Uuid,
) -> anyhow::Result<()> {
    let cleanup_statements = [
        r#"
        WITH demo_invoices AS (
            SELECT invoices.id
            FROM invoices
            JOIN patients ON patients.id = invoices.patient_id
            WHERE invoices.facility_id = $1
              AND patients.facility_id = $1
              AND patients.patient_code ~ '^DEMO-[0-9]{4}$'
              AND invoices.invoice_number ~ '^DEMO-[0-9]{6}$'
        )
        DELETE FROM receipts
        USING demo_invoices
        WHERE receipts.facility_id = $1
          AND receipts.invoice_id = demo_invoices.id
        "#,
        r#"
        WITH demo_invoices AS (
            SELECT invoices.id
            FROM invoices
            JOIN patients ON patients.id = invoices.patient_id
            WHERE invoices.facility_id = $1
              AND patients.facility_id = $1
              AND patients.patient_code ~ '^DEMO-[0-9]{4}$'
              AND invoices.invoice_number ~ '^DEMO-[0-9]{6}$'
        )
        DELETE FROM payments
        USING demo_invoices
        WHERE payments.facility_id = $1
          AND payments.invoice_id = demo_invoices.id
        "#,
        r#"
        WITH demo_claims AS (
            SELECT nhis_claims.id
            FROM nhis_claims
            JOIN invoices ON invoices.id = nhis_claims.invoice_id
            JOIN patients ON patients.id = invoices.patient_id
            WHERE nhis_claims.facility_id = $1
              AND invoices.facility_id = $1
              AND patients.facility_id = $1
              AND patients.patient_code ~ '^DEMO-[0-9]{4}$'
              AND nhis_claims.claim_number ~ '^DEMO-CLM-[0-9]{4}$'
        )
        DELETE FROM nhis_batch_claims
        USING demo_claims
        WHERE nhis_batch_claims.facility_id = $1
          AND nhis_batch_claims.claim_id = demo_claims.id
        "#,
        r#"
        WITH demo_invoices AS (
            SELECT invoices.id
            FROM invoices
            JOIN patients ON patients.id = invoices.patient_id
            WHERE invoices.facility_id = $1
              AND patients.facility_id = $1
              AND patients.patient_code ~ '^DEMO-[0-9]{4}$'
              AND invoices.invoice_number ~ '^DEMO-[0-9]{6}$'
        )
        DELETE FROM nhis_claims
        USING demo_invoices
        WHERE nhis_claims.facility_id = $1
          AND nhis_claims.invoice_id = demo_invoices.id
          AND nhis_claims.claim_number ~ '^DEMO-CLM-[0-9]{4}$'
        "#,
        r#"
        WITH demo_invoices AS (
            SELECT invoices.id
            FROM invoices
            JOIN patients ON patients.id = invoices.patient_id
            WHERE invoices.facility_id = $1
              AND patients.facility_id = $1
              AND patients.patient_code ~ '^DEMO-[0-9]{4}$'
              AND invoices.invoice_number ~ '^DEMO-[0-9]{6}$'
        )
        DELETE FROM invoice_lines
        USING demo_invoices
        WHERE invoice_lines.facility_id = $1
          AND invoice_lines.invoice_id = demo_invoices.id
        "#,
        r#"
        DELETE FROM invoices
        USING patients
        WHERE invoices.facility_id = $1
          AND patients.facility_id = $1
          AND invoices.patient_id = patients.id
          AND patients.patient_code ~ '^DEMO-[0-9]{4}$'
          AND invoices.invoice_number ~ '^DEMO-[0-9]{6}$'
        "#,
        r#"
        WITH demo_rounds AS (
            SELECT ward_rounds.id
            FROM ward_rounds
            JOIN patients ON patients.id = ward_rounds.patient_id
            WHERE ward_rounds.facility_id = $1
              AND patients.facility_id = $1
              AND patients.patient_code ~ '^DEMO-[0-9]{4}$'
        )
        DELETE FROM ward_round_artifact_links
        USING demo_rounds
        WHERE ward_round_artifact_links.facility_id = $1
          AND ward_round_artifact_links.ward_round_id = demo_rounds.id
        "#,
        r#"
        WITH demo_rounds AS (
            SELECT ward_rounds.id
            FROM ward_rounds
            JOIN patients ON patients.id = ward_rounds.patient_id
            WHERE ward_rounds.facility_id = $1
              AND patients.facility_id = $1
              AND patients.patient_code ~ '^DEMO-[0-9]{4}$'
        )
        DELETE FROM ward_round_actions
        USING demo_rounds
        WHERE ward_round_actions.facility_id = $1
          AND ward_round_actions.ward_round_id = demo_rounds.id
        "#,
        r#"
        DELETE FROM ward_rounds
        USING patients
        WHERE ward_rounds.facility_id = $1
          AND patients.facility_id = $1
          AND ward_rounds.patient_id = patients.id
          AND patients.patient_code ~ '^DEMO-[0-9]{4}$'
        "#,
        r#"
        DELETE FROM lab_orders
        USING patients
        WHERE lab_orders.facility_id = $1
          AND patients.facility_id = $1
          AND lab_orders.patient_id = patients.id
          AND patients.patient_code ~ '^DEMO-[0-9]{4}$'
        "#,
        r#"
        DELETE FROM admission_cases
        USING patients
        WHERE admission_cases.facility_id = $1
          AND patients.facility_id = $1
          AND admission_cases.patient_id = patients.id
          AND patients.patient_code ~ '^DEMO-[0-9]{4}$'
        "#,
        r#"
        DELETE FROM encounter_care_team_assignments
        USING encounters, patients
        WHERE encounter_care_team_assignments.encounter_id = encounters.id
          AND encounters.facility_id = $1
          AND patients.facility_id = $1
          AND encounters.patient_id = patients.id
          AND patients.patient_code ~ '^DEMO-[0-9]{4}$'
        "#,
        r#"
        DELETE FROM encounters
        USING patients
        WHERE encounters.facility_id = $1
          AND patients.facility_id = $1
          AND encounters.patient_id = patients.id
          AND patients.patient_code ~ '^DEMO-[0-9]{4}$'
        "#,
        r#"
        DELETE FROM clinical_notes
        USING patients
        WHERE clinical_notes.facility_id = $1
          AND patients.facility_id = $1
          AND clinical_notes.patient_id = patients.id
          AND patients.patient_code ~ '^DEMO-[0-9]{4}$'
        "#,
        r#"
        DELETE FROM patient_problems
        USING patients
        WHERE patient_problems.facility_id = $1
          AND patients.facility_id = $1
          AND patient_problems.patient_id = patients.id
          AND patients.patient_code ~ '^DEMO-[0-9]{4}$'
        "#,
        r#"
        DELETE FROM patient_allergies
        USING patients
        WHERE patient_allergies.facility_id = $1
          AND patients.facility_id = $1
          AND patient_allergies.patient_id = patients.id
          AND patients.patient_code ~ '^DEMO-[0-9]{4}$'
        "#,
        r#"
        DELETE FROM prescriptions
        USING patients
        WHERE prescriptions.facility_id = $1
          AND patients.facility_id = $1
          AND prescriptions.patient_id = patients.id
          AND patients.patient_code ~ '^DEMO-[0-9]{4}$'
        "#,
        r#"
        DELETE FROM chart_entries
        USING patients
        WHERE chart_entries.facility_id = $1
          AND patients.facility_id = $1
          AND chart_entries.patient_id = patients.id
          AND patients.patient_code ~ '^DEMO-[0-9]{4}$'
        "#,
        r#"
        DELETE FROM patient_contexts
        USING patients
        WHERE patient_contexts.facility_id = $1
          AND patients.facility_id = $1
          AND patient_contexts.patient_id = patients.id
          AND patients.patient_code ~ '^DEMO-[0-9]{4}$'
        "#,
        r#"
        DELETE FROM patients
        WHERE facility_id = $1
          AND patient_code ~ '^DEMO-[0-9]{4}$'
        "#,
        r#"
        DELETE FROM beds
        USING wards
        WHERE beds.facility_id = $1
          AND wards.facility_id = $1
          AND beds.ward_id = wards.id
          AND wards.code LIKE 'demo-%'
          AND beds.bed_code LIKE 'DEMO-%'
        "#,
        r#"
        DELETE FROM ward_sections
        USING wards
        WHERE ward_sections.facility_id = $1
          AND wards.facility_id = $1
          AND ward_sections.ward_id = wards.id
          AND wards.code LIKE 'demo-%'
          AND ward_sections.code LIKE 'DEMO-%'
        "#,
        r#"
        DELETE FROM wards
        WHERE facility_id = $1
          AND code LIKE 'demo-%'
        "#,
    ];

    for statement in cleanup_statements {
        sqlx::query(statement)
            .bind(facility_id)
            .execute(&mut **transaction)
            .await?;
    }

    Ok(())
}

async fn seed_demo_ward_resources(
    transaction: &mut Transaction<'_, Postgres>,
    baseline: &BaselineProvisioning,
    config: DemoSeedConfig,
) -> anyhow::Result<()> {
    let ward_id = Uuid::from_u128(DEMO_WARD_ID);
    let section_id = Uuid::from_u128(DEMO_SECTION_ID);
    let owner_user_id = Uuid::from_u128(OWNER_USER_ID);
    let patients = demo_patient_archetypes();

    sqlx::query(
        r#"
        INSERT INTO wards (id, facility_id, code, name, status)
        VALUES ($1, $2, 'demo-medical', 'Demo Medical Ward', 'active')
        ON CONFLICT (facility_id, code) DO UPDATE
        SET id = EXCLUDED.id,
            name = EXCLUDED.name,
            status = EXCLUDED.status,
            updated_at = now()
        "#,
    )
    .bind(ward_id)
    .bind(baseline.facility_id)
    .execute(&mut **transaction)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO ward_sections (
            id,
            facility_id,
            ward_id,
            code,
            name,
            status,
            created_by_user_id
        )
        VALUES ($1, $2, $3, 'DEMO-A', 'Demo Acute Section', 'active', $4)
        ON CONFLICT (ward_id, code) DO UPDATE
        SET id = EXCLUDED.id,
            name = EXCLUDED.name,
            status = EXCLUDED.status,
            created_by_user_id = EXCLUDED.created_by_user_id,
            updated_at = now()
        "#,
    )
    .bind(section_id)
    .bind(baseline.facility_id)
    .bind(ward_id)
    .bind(owner_user_id)
    .execute(&mut **transaction)
    .await?;

    for bed_ordinal in 1..=config.patient_count as u32 {
        let occupied = patients
            .iter()
            .take(config.patient_count)
            .any(|patient| patient.bed_ordinal == Some(bed_ordinal));
        sqlx::query(
            r#"
            INSERT INTO beds (
                id,
                facility_id,
                ward_id,
                section_id,
                bed_code,
                status,
                created_by_user_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (ward_id, bed_code) DO UPDATE
            SET id = EXCLUDED.id,
                section_id = EXCLUDED.section_id,
                status = EXCLUDED.status,
                created_by_user_id = EXCLUDED.created_by_user_id,
                updated_at = now()
            "#,
        )
        .bind(demo_uuid(DEMO_BED_BASE_ID, bed_ordinal))
        .bind(baseline.facility_id)
        .bind(ward_id)
        .bind(section_id)
        .bind(format!("DEMO-{bed_ordinal:02}"))
        .bind(if occupied { "occupied" } else { "available" })
        .bind(owner_user_id)
        .execute(&mut **transaction)
        .await?;
    }

    Ok(())
}

async fn seed_demo_patient_graph(
    transaction: &mut Transaction<'_, Postgres>,
    baseline: &BaselineProvisioning,
    config: DemoSeedConfig,
) -> anyhow::Result<()> {
    let patients = demo_patient_archetypes();
    for patient in patients.iter().take(config.patient_count) {
        seed_demo_patient(transaction, baseline, patient).await?;
        seed_demo_chronicle_entries(transaction, baseline, patient).await?;
        seed_demo_laboratory_path(transaction, baseline, patient).await?;
        seed_demo_billing_path(transaction, baseline, patient).await?;
        if patient.admission_status.is_some() {
            seed_demo_admission_path(transaction, baseline, patient).await?;
        }
    }

    Ok(())
}

async fn seed_demo_patient(
    transaction: &mut Transaction<'_, Postgres>,
    baseline: &BaselineProvisioning,
    patient: &DemoPatientArchetype,
) -> anyhow::Result<()> {
    let patient_id = patient.patient_id();
    let created_at = demo_time(i64::from(patient.ordinal));
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
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8, $8)
        ON CONFLICT (facility_id, patient_code) DO UPDATE
        SET id = EXCLUDED.id,
            first_name = EXCLUDED.first_name,
            last_name = EXCLUDED.last_name,
            date_of_birth = EXCLUDED.date_of_birth,
            sex = EXCLUDED.sex,
            status = EXCLUDED.status,
            updated_at = EXCLUDED.updated_at
        "#,
    )
    .bind(patient_id)
    .bind(baseline.facility_id)
    .bind(patient.patient_code)
    .bind(patient.first_name)
    .bind(patient.last_name)
    .bind(demo_date(patient.date_of_birth))
    .bind(codec::encode(patient.sex.clone())?)
    .bind(created_at)
    .execute(&mut **transaction)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO patient_contexts (
            id,
            facility_id,
            user_id,
            patient_id,
            context_kind,
            label,
            created_at,
            updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
        ON CONFLICT (user_id, patient_id, context_kind) DO UPDATE
        SET label = EXCLUDED.label,
            updated_at = EXCLUDED.updated_at
        "#,
    )
    .bind(demo_uuid(DEMO_CONTEXT_BASE_ID, patient.ordinal))
    .bind(baseline.facility_id)
    .bind(Uuid::from_u128(OWNER_USER_ID))
    .bind(patient_id)
    .bind(codec::encode(PatientContextKind::Assigned)?)
    .bind(format!("demo-seed: {}", patient.archetype_label))
    .bind(created_at)
    .execute(&mut **transaction)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO patient_chronicle_read_models (
            patient_id,
            facility_id,
            summary_status,
            latest_event_at,
            updated_at
        )
        VALUES ($1, $2, 'active', $3, $3)
        ON CONFLICT (patient_id) DO UPDATE
        SET summary_status = EXCLUDED.summary_status,
            latest_event_at = EXCLUDED.latest_event_at,
            updated_at = EXCLUDED.updated_at
        "#,
    )
    .bind(patient_id)
    .bind(baseline.facility_id)
    .bind(demo_time(300 + i64::from(patient.ordinal)))
    .execute(&mut **transaction)
    .await?;

    Ok(())
}

async fn seed_demo_chronicle_entries(
    transaction: &mut Transaction<'_, Postgres>,
    baseline: &BaselineProvisioning,
    patient: &DemoPatientArchetype,
) -> anyhow::Result<()> {
    let owner_user_id = Uuid::from_u128(OWNER_USER_ID);
    let patient_id = patient.patient_id();
    let note_id = patient.note_id();
    let note_time = demo_time(20 + i64::from(patient.ordinal));

    sqlx::query(
        r#"
        INSERT INTO clinical_notes (
            id,
            facility_id,
            patient_id,
            encounter_id,
            note_type,
            title,
            body,
            status,
            version,
            created_by_user_id,
            created_at,
            updated_at
        )
        VALUES ($1, $2, $3, NULL, $4, $5, $6, 'signed', 1, $7, $8, $8)
        ON CONFLICT (id) DO UPDATE
        SET note_type = EXCLUDED.note_type,
            title = EXCLUDED.title,
            body = EXCLUDED.body,
            status = EXCLUDED.status,
            version = EXCLUDED.version,
            updated_at = EXCLUDED.updated_at
        "#,
    )
    .bind(note_id)
    .bind(baseline.facility_id)
    .bind(patient_id)
    .bind(patient.note_type)
    .bind(patient.note_title)
    .bind(patient.note_body)
    .bind(owner_user_id)
    .bind(note_time)
    .execute(&mut **transaction)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO clinical_note_versions (
            id,
            note_id,
            version,
            body,
            created_by_user_id,
            created_at
        )
        VALUES ($1, $2, 1, $3, $4, $5)
        ON CONFLICT (note_id, version) DO UPDATE
        SET body = EXCLUDED.body,
            created_by_user_id = EXCLUDED.created_by_user_id,
            created_at = EXCLUDED.created_at
        "#,
    )
    .bind(demo_uuid(DEMO_NOTE_VERSION_BASE_ID, patient.ordinal))
    .bind(note_id)
    .bind(patient.note_body)
    .bind(owner_user_id)
    .bind(note_time)
    .execute(&mut **transaction)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO patient_problems (
            id,
            facility_id,
            patient_id,
            label,
            status,
            onset_date,
            created_by_user_id,
            created_at,
            updated_at
        )
        VALUES ($1, $2, $3, $4, 'active', $5, $6, $7, $7)
        ON CONFLICT (id) DO UPDATE
        SET label = EXCLUDED.label,
            status = EXCLUDED.status,
            onset_date = EXCLUDED.onset_date,
            updated_at = EXCLUDED.updated_at
        "#,
    )
    .bind(demo_uuid(DEMO_PROBLEM_BASE_ID, patient.ordinal))
    .bind(baseline.facility_id)
    .bind(patient_id)
    .bind(patient.problem_label)
    .bind(demo_date(patient.problem_onset))
    .bind(owner_user_id)
    .bind(demo_time(30 + i64::from(patient.ordinal)))
    .execute(&mut **transaction)
    .await?;

    if let Some(allergy) = patient.allergy {
        sqlx::query(
            r#"
            INSERT INTO patient_allergies (
                id,
                facility_id,
                patient_id,
                substance,
                reaction,
                severity,
                status,
                created_by_user_id,
                created_at,
                updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8, $8)
            ON CONFLICT (id) DO UPDATE
            SET substance = EXCLUDED.substance,
                reaction = EXCLUDED.reaction,
                severity = EXCLUDED.severity,
                status = EXCLUDED.status,
                updated_at = EXCLUDED.updated_at
            "#,
        )
        .bind(demo_uuid(DEMO_ALLERGY_BASE_ID, patient.ordinal))
        .bind(baseline.facility_id)
        .bind(patient_id)
        .bind(allergy.substance)
        .bind(allergy.reaction)
        .bind(allergy.severity)
        .bind(owner_user_id)
        .bind(demo_time(31 + i64::from(patient.ordinal)))
        .execute(&mut **transaction)
        .await?;
    }

    sqlx::query(
        r#"
        INSERT INTO prescriptions (
            id,
            facility_id,
            patient_id,
            medication_name,
            dose,
            frequency,
            status,
            prescribed_at,
            created_by_user_id,
            updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8, $7)
        ON CONFLICT (id) DO UPDATE
        SET medication_name = EXCLUDED.medication_name,
            dose = EXCLUDED.dose,
            frequency = EXCLUDED.frequency,
            status = EXCLUDED.status,
            prescribed_at = EXCLUDED.prescribed_at,
            updated_at = EXCLUDED.updated_at
        "#,
    )
    .bind(patient.prescription_id())
    .bind(baseline.facility_id)
    .bind(patient_id)
    .bind(patient.medication_name)
    .bind(patient.medication_dose)
    .bind(patient.medication_frequency)
    .bind(demo_time(40 + i64::from(patient.ordinal)))
    .bind(owner_user_id)
    .execute(&mut **transaction)
    .await?;

    for (entry_index, (entry_type, value, unit)) in [
        ("blood_pressure", patient.blood_pressure, Some("mmHg")),
        ("pulse", patient.pulse, Some("bpm")),
        ("oxygen_saturation", patient.oxygen_saturation, Some("%")),
        ("temperature", patient.temperature, Some("C")),
    ]
    .into_iter()
    .enumerate()
    {
        sqlx::query(
            r#"
            INSERT INTO chart_entries (
                id,
                facility_id,
                patient_id,
                entry_type,
                measured_at,
                value,
                unit,
                created_by_user_id,
                created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $5)
            ON CONFLICT (id) DO UPDATE
            SET entry_type = EXCLUDED.entry_type,
                measured_at = EXCLUDED.measured_at,
                value = EXCLUDED.value,
                unit = EXCLUDED.unit,
                created_by_user_id = EXCLUDED.created_by_user_id
            "#,
        )
        .bind(demo_uuid(
            DEMO_CHART_ENTRY_BASE_ID,
            patient.ordinal * 10 + entry_index as u32 + 1,
        ))
        .bind(baseline.facility_id)
        .bind(patient_id)
        .bind(entry_type)
        .bind(demo_time(
            50 + i64::from(patient.ordinal * 10 + entry_index as u32),
        ))
        .bind(value)
        .bind(unit)
        .bind(owner_user_id)
        .execute(&mut **transaction)
        .await?;
    }

    Ok(())
}

async fn seed_demo_laboratory_path(
    transaction: &mut Transaction<'_, Postgres>,
    baseline: &BaselineProvisioning,
    patient: &DemoPatientArchetype,
) -> anyhow::Result<()> {
    let owner_user_id = Uuid::from_u128(OWNER_USER_ID);
    let patient_id = patient.patient_id();
    let lab_order_id = patient.lab_order_id();
    let specimen_id = patient.lab_specimen_id();
    let order_time = demo_time(90 + i64::from(patient.ordinal));

    sqlx::query(
        r#"
        INSERT INTO lab_orders (
            id,
            facility_id,
            patient_id,
            priority,
            status,
            ordered_by_user_id,
            ordered_at,
            updated_at
        )
        VALUES ($1, $2, $3, $4, 'verified', $5, $6, $6)
        ON CONFLICT (id) DO UPDATE
        SET priority = EXCLUDED.priority,
            status = EXCLUDED.status,
            ordered_by_user_id = EXCLUDED.ordered_by_user_id,
            ordered_at = EXCLUDED.ordered_at,
            updated_at = EXCLUDED.updated_at
        "#,
    )
    .bind(lab_order_id)
    .bind(baseline.facility_id)
    .bind(patient_id)
    .bind(patient.lab_priority)
    .bind(owner_user_id)
    .bind(order_time)
    .execute(&mut **transaction)
    .await?;

    let mut lab_results = vec![DemoLabResult {
        test_id: Uuid::from_u128(DEFAULT_LAB_TEST_FBC_ID),
        value: patient.fbc_value,
        unit: Some("g/dL"),
    }];
    if let Some(value) = patient.malaria_result {
        lab_results.push(DemoLabResult {
            test_id: Uuid::from_u128(DEFAULT_LAB_TEST_MALARIA_ID),
            value,
            unit: Some("parasites/ul"),
        });
    }

    for result in &lab_results {
        sqlx::query(
            r#"
            INSERT INTO lab_order_tests (order_id, test_id)
            VALUES ($1, $2)
            ON CONFLICT (order_id, test_id) DO NOTHING
            "#,
        )
        .bind(lab_order_id)
        .bind(result.test_id)
        .execute(&mut **transaction)
        .await?;
    }

    sqlx::query(
        r#"
        INSERT INTO lab_specimens (
            id,
            facility_id,
            order_id,
            patient_id,
            specimen_type,
            status,
            collected_by_user_id,
            collected_at,
            updated_at
        )
        VALUES ($1, $2, $3, $4, 'blood', 'collected', $5, $6, $6)
        ON CONFLICT (id) DO UPDATE
        SET status = EXCLUDED.status,
            collected_by_user_id = EXCLUDED.collected_by_user_id,
            collected_at = EXCLUDED.collected_at,
            updated_at = EXCLUDED.updated_at
        "#,
    )
    .bind(specimen_id)
    .bind(baseline.facility_id)
    .bind(lab_order_id)
    .bind(patient_id)
    .bind(owner_user_id)
    .bind(demo_time(100 + i64::from(patient.ordinal)))
    .execute(&mut **transaction)
    .await?;

    for (index, result) in lab_results.iter().enumerate() {
        sqlx::query(
            r#"
            INSERT INTO lab_results (
                id,
                facility_id,
                order_id,
                specimen_id,
                patient_id,
                test_id,
                value,
                unit,
                status,
                entered_by_user_id,
                entered_at,
                verified_by_user_id,
                verified_at,
                updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'verified', $9, $10, $9, $11, $11)
            ON CONFLICT (specimen_id, test_id) DO UPDATE
            SET value = EXCLUDED.value,
                unit = EXCLUDED.unit,
                status = EXCLUDED.status,
                entered_by_user_id = EXCLUDED.entered_by_user_id,
                entered_at = EXCLUDED.entered_at,
                verified_by_user_id = EXCLUDED.verified_by_user_id,
                verified_at = EXCLUDED.verified_at,
                updated_at = EXCLUDED.updated_at
            "#,
        )
        .bind(demo_uuid(
            DEMO_LAB_RESULT_BASE_ID,
            patient.ordinal * 10 + index as u32 + 1,
        ))
        .bind(baseline.facility_id)
        .bind(lab_order_id)
        .bind(specimen_id)
        .bind(patient_id)
        .bind(result.test_id)
        .bind(result.value)
        .bind(result.unit)
        .bind(owner_user_id)
        .bind(demo_time(
            110 + i64::from(patient.ordinal * 10 + index as u32),
        ))
        .bind(demo_time(
            120 + i64::from(patient.ordinal * 10 + index as u32),
        ))
        .execute(&mut **transaction)
        .await?;
    }

    Ok(())
}

async fn seed_demo_billing_path(
    transaction: &mut Transaction<'_, Postgres>,
    baseline: &BaselineProvisioning,
    patient: &DemoPatientArchetype,
) -> anyhow::Result<()> {
    let owner_user_id = Uuid::from_u128(OWNER_USER_ID);
    let patient_id = patient.patient_id();
    let invoice_id = patient.invoice_id();
    let issued_at = demo_time(160 + i64::from(patient.ordinal));

    sqlx::query(
        r#"
        INSERT INTO invoices (
            id,
            facility_id,
            patient_id,
            invoice_number,
            status,
            gross_amount_minor,
            paid_amount_minor,
            currency,
            issued_by_user_id,
            issued_at,
            updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'GHS', $8, $9, $9)
        ON CONFLICT (facility_id, invoice_number) DO UPDATE
        SET patient_id = EXCLUDED.patient_id,
            status = EXCLUDED.status,
            gross_amount_minor = EXCLUDED.gross_amount_minor,
            paid_amount_minor = EXCLUDED.paid_amount_minor,
            issued_by_user_id = EXCLUDED.issued_by_user_id,
            issued_at = EXCLUDED.issued_at,
            updated_at = EXCLUDED.updated_at
        "#,
    )
    .bind(invoice_id)
    .bind(baseline.facility_id)
    .bind(patient_id)
    .bind(format!("DEMO-{:06}", patient.ordinal))
    .bind(patient.invoice_status)
    .bind(patient.invoice_amount_minor)
    .bind(patient.paid_amount_minor)
    .bind(owner_user_id)
    .bind(issued_at)
    .execute(&mut **transaction)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO invoice_lines (
            id,
            facility_id,
            invoice_id,
            service_price_id,
            description,
            quantity,
            unit_amount_minor,
            line_amount_minor,
            currency,
            created_at
        )
        VALUES ($1, $2, $3, $4, $5, 1, $6, $6, 'GHS', $7)
        ON CONFLICT (id) DO UPDATE
        SET service_price_id = EXCLUDED.service_price_id,
            description = EXCLUDED.description,
            unit_amount_minor = EXCLUDED.unit_amount_minor,
            line_amount_minor = EXCLUDED.line_amount_minor
        "#,
    )
    .bind(demo_uuid(DEMO_INVOICE_LINE_BASE_ID, patient.ordinal))
    .bind(baseline.facility_id)
    .bind(invoice_id)
    .bind(Uuid::from_u128(DEFAULT_PRICE_LAB_FBC_ID))
    .bind(format!("Demo {} care bundle", patient.archetype_label))
    .bind(patient.invoice_amount_minor)
    .bind(issued_at)
    .execute(&mut **transaction)
    .await?;

    if patient.paid_amount_minor > 0 {
        let receipt_number = format!("DEMO-RCPT-{:04}", patient.ordinal);
        let payment_id = demo_uuid(DEMO_PAYMENT_BASE_ID, patient.ordinal);
        sqlx::query(
            r#"
            INSERT INTO payments (
                id,
                facility_id,
                invoice_id,
                cash_session_id,
                receipt_number,
                amount_minor,
                currency,
                method,
                status,
                recorded_by_user_id,
                paid_at
            )
            VALUES ($1, $2, $3, NULL, $4, $5, 'GHS', 'cash', 'recorded', $6, $7)
            ON CONFLICT (facility_id, receipt_number) DO UPDATE
            SET amount_minor = EXCLUDED.amount_minor,
                status = EXCLUDED.status,
                recorded_by_user_id = EXCLUDED.recorded_by_user_id,
                paid_at = EXCLUDED.paid_at
            "#,
        )
        .bind(payment_id)
        .bind(baseline.facility_id)
        .bind(invoice_id)
        .bind(&receipt_number)
        .bind(patient.paid_amount_minor)
        .bind(owner_user_id)
        .bind(demo_time(170 + i64::from(patient.ordinal)))
        .execute(&mut **transaction)
        .await?;

        sqlx::query(
            r#"
            INSERT INTO receipts (
                id,
                facility_id,
                payment_id,
                invoice_id,
                receipt_number,
                amount_minor,
                currency,
                issued_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, 'GHS', $7)
            ON CONFLICT (facility_id, receipt_number) DO UPDATE
            SET amount_minor = EXCLUDED.amount_minor,
                issued_at = EXCLUDED.issued_at
            "#,
        )
        .bind(demo_uuid(DEMO_RECEIPT_BASE_ID, patient.ordinal))
        .bind(baseline.facility_id)
        .bind(payment_id)
        .bind(invoice_id)
        .bind(receipt_number)
        .bind(patient.paid_amount_minor)
        .bind(demo_time(171 + i64::from(patient.ordinal)))
        .execute(&mut **transaction)
        .await?;
    }

    if let Some(claim_status) = patient.claim_status {
        sqlx::query(
            r#"
            INSERT INTO nhis_claims (
                id,
                facility_id,
                invoice_id,
                patient_id,
                claim_number,
                status,
                amount_minor,
                payer_receivable_minor,
                patient_liability_minor,
                written_off_minor,
                currency,
                created_by_user_id,
                created_at,
                updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $7, 0, 0, 'GHS', $8, $9, $9)
            ON CONFLICT (facility_id, claim_number) DO UPDATE
            SET status = EXCLUDED.status,
                amount_minor = EXCLUDED.amount_minor,
                payer_receivable_minor = EXCLUDED.payer_receivable_minor,
                patient_liability_minor = EXCLUDED.patient_liability_minor,
                written_off_minor = EXCLUDED.written_off_minor,
                updated_at = EXCLUDED.updated_at
            "#,
        )
        .bind(demo_uuid(DEMO_NHIS_CLAIM_BASE_ID, patient.ordinal))
        .bind(baseline.facility_id)
        .bind(invoice_id)
        .bind(patient_id)
        .bind(format!("DEMO-CLM-{:04}", patient.ordinal))
        .bind(claim_status)
        .bind(patient.invoice_amount_minor - patient.paid_amount_minor)
        .bind(owner_user_id)
        .bind(demo_time(180 + i64::from(patient.ordinal)))
        .execute(&mut **transaction)
        .await?;
    }

    Ok(())
}

async fn seed_demo_admission_path(
    transaction: &mut Transaction<'_, Postgres>,
    baseline: &BaselineProvisioning,
    patient: &DemoPatientArchetype,
) -> anyhow::Result<()> {
    let owner_user_id = Uuid::from_u128(OWNER_USER_ID);
    let patient_id = patient.patient_id();
    let ward_id = Uuid::from_u128(DEMO_WARD_ID);
    let bed_id = patient
        .bed_ordinal
        .map(|ordinal| demo_uuid(DEMO_BED_BASE_ID, ordinal));
    let admission_id = patient.admission_id();
    let admitted_at = demo_time(200 + i64::from(patient.ordinal));

    sqlx::query(
        r#"
        INSERT INTO admission_cases (
            id,
            facility_id,
            patient_id,
            ward_id,
            bed_id,
            status,
            admitted_at,
            attending_user_id,
            created_by_user_id,
            created_at,
            updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $7, $7)
        ON CONFLICT (id) DO UPDATE
        SET ward_id = EXCLUDED.ward_id,
            bed_id = EXCLUDED.bed_id,
            status = EXCLUDED.status,
            admitted_at = EXCLUDED.admitted_at,
            attending_user_id = EXCLUDED.attending_user_id,
            created_by_user_id = EXCLUDED.created_by_user_id,
            updated_at = EXCLUDED.updated_at
        "#,
    )
    .bind(admission_id)
    .bind(baseline.facility_id)
    .bind(patient_id)
    .bind(ward_id)
    .bind(bed_id)
    .bind(patient.admission_status.expect("admission status exists"))
    .bind(admitted_at)
    .bind(owner_user_id)
    .execute(&mut **transaction)
    .await?;

    for (task_index, (task_type, title, instruction)) in [
        (
            "observation",
            "Four-hourly observations",
            patient.nursing_observation_instruction,
        ),
        (
            "ward_round",
            "Prepare for ward round",
            "Have recent vitals, labs, and medication chart ready for review.",
        ),
    ]
    .into_iter()
    .enumerate()
    {
        sqlx::query(
            r#"
            INSERT INTO nursing_tasks (
                id,
                facility_id,
                admission_case_id,
                patient_id,
                ward_id,
                task_type,
                title,
                instruction,
                status,
                due_at,
                assigned_to_user_id,
                created_by_user_id,
                created_at,
                updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open', $9, $10, $10, $11, $11)
            ON CONFLICT (id) DO UPDATE
            SET task_type = EXCLUDED.task_type,
                title = EXCLUDED.title,
                instruction = EXCLUDED.instruction,
                status = EXCLUDED.status,
                due_at = EXCLUDED.due_at,
                assigned_to_user_id = EXCLUDED.assigned_to_user_id,
                updated_at = EXCLUDED.updated_at
            "#,
        )
        .bind(demo_uuid(
            DEMO_NURSING_TASK_BASE_ID,
            patient.ordinal * 10 + task_index as u32 + 1,
        ))
        .bind(baseline.facility_id)
        .bind(admission_id)
        .bind(patient_id)
        .bind(ward_id)
        .bind(task_type)
        .bind(title)
        .bind(instruction)
        .bind(demo_time(
            220 + i64::from(patient.ordinal * 10 + task_index as u32),
        ))
        .bind(owner_user_id)
        .bind(admitted_at)
        .execute(&mut **transaction)
        .await?;
    }

    sqlx::query(
        r#"
        INSERT INTO medication_administrations (
            id,
            facility_id,
            admission_case_id,
            patient_id,
            medication_name,
            scheduled_at,
            administered_at,
            status,
            administered_by_user_id,
            created_by_user_id,
            created_at,
            updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, NULL, 'scheduled', NULL, $7, $8, $8)
        ON CONFLICT (id) DO UPDATE
        SET medication_name = EXCLUDED.medication_name,
            scheduled_at = EXCLUDED.scheduled_at,
            status = EXCLUDED.status,
            updated_at = EXCLUDED.updated_at
        "#,
    )
    .bind(demo_uuid(DEMO_MED_ADMIN_BASE_ID, patient.ordinal))
    .bind(baseline.facility_id)
    .bind(admission_id)
    .bind(patient_id)
    .bind(patient.medication_name)
    .bind(demo_time(240 + i64::from(patient.ordinal)))
    .bind(owner_user_id)
    .bind(admitted_at)
    .execute(&mut **transaction)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO treatment_sheets (
            id,
            facility_id,
            admission_case_id,
            patient_id,
            sheet_date,
            status,
            created_by_user_id,
            created_at,
            updated_at
        )
        VALUES ($1, $2, $3, $4, DATE '2026-05-20', 'active', $5, $6, $6)
        ON CONFLICT (admission_case_id, sheet_date) DO UPDATE
        SET status = EXCLUDED.status,
            updated_at = EXCLUDED.updated_at
        "#,
    )
    .bind(demo_uuid(DEMO_TREATMENT_SHEET_BASE_ID, patient.ordinal))
    .bind(baseline.facility_id)
    .bind(admission_id)
    .bind(patient_id)
    .bind(owner_user_id)
    .bind(admitted_at)
    .execute(&mut **transaction)
    .await?;

    seed_demo_ward_rounds(transaction, baseline, patient).await
}

async fn seed_demo_ward_rounds(
    transaction: &mut Transaction<'_, Postgres>,
    baseline: &BaselineProvisioning,
    patient: &DemoPatientArchetype,
) -> anyhow::Result<()> {
    let owner_user_id = Uuid::from_u128(OWNER_USER_ID);
    let patient_id = patient.patient_id();
    let admission_id = patient.admission_id();
    let committed_round_id = demo_uuid(DEMO_WARD_ROUND_BASE_ID, patient.ordinal * 10 + 1);
    let draft_round_id = demo_uuid(DEMO_WARD_ROUND_BASE_ID, patient.ordinal * 10 + 2);

    for (round_id, status, signed_at, rendered_note, note_sections) in [
        (
            committed_round_id,
            "committed",
            Some(demo_time(260 + i64::from(patient.ordinal))),
            Some("Synthetic ward round summary. Continue current inpatient plan."),
            json!({
                "interval_history": "Synthetic patient reports modest improvement overnight.",
                "examination": "Vitals reviewed from chart. No emergency features recorded.",
                "assessment": patient.problem_label,
                "plan": patient.ward_round_plan,
                "clinical_readiness_blockers": []
            }),
        ),
        (
            draft_round_id,
            "draft",
            None,
            None,
            json!({
                "interval_history": "Review pending for the next ward round.",
                "examination": null,
                "assessment": null,
                "plan": "Confirm labs and nursing observations before signing.",
                "clinical_readiness_blockers": ["Await review"]
            }),
        ),
    ] {
        sqlx::query(
            r#"
            INSERT INTO ward_rounds (
                id,
                facility_id,
                patient_id,
                admission_case_id,
                status,
                version,
                note_sections,
                review_rail,
                rendered_note,
                signed_by_user_id,
                signed_at,
                created_by_user_id,
                created_at,
                updated_at
            )
            VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8, $9, $10, $9, $11, $11)
            ON CONFLICT (id) DO UPDATE
            SET status = EXCLUDED.status,
                note_sections = EXCLUDED.note_sections,
                review_rail = EXCLUDED.review_rail,
                rendered_note = EXCLUDED.rendered_note,
                signed_by_user_id = EXCLUDED.signed_by_user_id,
                signed_at = EXCLUDED.signed_at,
                updated_at = EXCLUDED.updated_at
            "#,
        )
        .bind(round_id)
        .bind(baseline.facility_id)
        .bind(patient_id)
        .bind(admission_id)
        .bind(status)
        .bind(note_sections)
        .bind(json!({
            "active_medication_count": 1,
            "open_lab_order_count": 0,
            "open_nursing_task_count": 2,
            "discharge_blocker_count": 0
        }))
        .bind(rendered_note)
        .bind(owner_user_id)
        .bind(signed_at)
        .bind(demo_time(250 + i64::from(patient.ordinal)))
        .execute(&mut **transaction)
        .await?;
    }

    let committed_actions = [
        DemoWardRoundAction {
            ordinal: 1,
            action_type: "prescription",
            title: patient.medication_name,
            instruction: None,
            payload: json!({
                "prescription_id": patient.prescription_id(),
                "medication_name": patient.medication_name,
                "dose": patient.medication_dose,
                "frequency": patient.medication_frequency,
                "status": "active"
            }),
            committed_resource_type: Some("prescription"),
            committed_resource_id: Some(patient.prescription_id()),
            link_title: Some(patient.medication_name),
        },
        DemoWardRoundAction {
            ordinal: 2,
            action_type: "lab_order",
            title: "Review demo FBC",
            instruction: Some("Review verified FBC result before discharge planning."),
            payload: json!({
                "test_ids": [Uuid::from_u128(DEFAULT_LAB_TEST_FBC_ID)],
                "panel_ids": [],
                "priority": patient.lab_priority
            }),
            committed_resource_type: Some("lab_order"),
            committed_resource_id: Some(patient.lab_order_id()),
            link_title: Some("Demo lab order"),
        },
        DemoWardRoundAction {
            ordinal: 3,
            action_type: "nursing_task",
            title: "Continue observation chart",
            instruction: Some(patient.nursing_observation_instruction),
            payload: json!({
                "title": "Continue observation chart",
                "instruction": patient.nursing_observation_instruction,
                "due_at": demo_time(280 + i64::from(patient.ordinal)),
                "task_type": "ward_round",
                "assigned_to_user_id": null
            }),
            committed_resource_type: Some("nursing_task"),
            committed_resource_id: Some(demo_uuid(
                DEMO_NURSING_TASK_BASE_ID,
                patient.ordinal * 10 + 1,
            )),
            link_title: Some("Continue observation chart"),
        },
    ];

    for action in committed_actions {
        seed_demo_ward_round_action(
            transaction,
            baseline.facility_id,
            patient,
            committed_round_id,
            "committed",
            action,
        )
        .await?;
    }

    seed_demo_ward_round_action(
        transaction,
        baseline.facility_id,
        patient,
        draft_round_id,
        "draft",
        DemoWardRoundAction {
            ordinal: 9,
            action_type: "nursing_task",
            title: "Draft next-shift check",
            instruction: Some("Confirm symptoms, intake, and urine output at next review."),
            payload: json!({
                "title": "Draft next-shift check",
                "instruction": "Confirm symptoms, intake, and urine output at next review.",
                "due_at": demo_time(320 + i64::from(patient.ordinal)),
                "task_type": "ward_round",
                "assigned_to_user_id": null
            }),
            committed_resource_type: None,
            committed_resource_id: None,
            link_title: None,
        },
    )
    .await
}

async fn seed_demo_ward_round_action(
    transaction: &mut Transaction<'_, Postgres>,
    facility_id: Uuid,
    patient: &DemoPatientArchetype,
    ward_round_id: Uuid,
    status: &'static str,
    action: DemoWardRoundAction,
) -> anyhow::Result<()> {
    let action_id = demo_uuid(
        DEMO_WARD_ROUND_ACTION_BASE_ID,
        patient.ordinal * 100 + action.ordinal,
    );
    sqlx::query(
        r#"
        INSERT INTO ward_round_actions (
            id,
            facility_id,
            ward_round_id,
            patient_id,
            admission_case_id,
            action_type,
            status,
            title,
            instruction,
            payload,
            committed_resource_type,
            committed_resource_id,
            created_by_user_id,
            created_at,
            updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14)
        ON CONFLICT (id) DO UPDATE
        SET action_type = EXCLUDED.action_type,
            status = EXCLUDED.status,
            title = EXCLUDED.title,
            instruction = EXCLUDED.instruction,
            payload = EXCLUDED.payload,
            committed_resource_type = EXCLUDED.committed_resource_type,
            committed_resource_id = EXCLUDED.committed_resource_id,
            updated_at = EXCLUDED.updated_at
        "#,
    )
    .bind(action_id)
    .bind(facility_id)
    .bind(ward_round_id)
    .bind(patient.patient_id())
    .bind(patient.admission_id())
    .bind(action.action_type)
    .bind(status)
    .bind(action.title)
    .bind(action.instruction)
    .bind(action.payload)
    .bind(action.committed_resource_type)
    .bind(action.committed_resource_id)
    .bind(Uuid::from_u128(OWNER_USER_ID))
    .bind(demo_time(
        270 + i64::from(patient.ordinal * 10 + action.ordinal),
    ))
    .execute(&mut **transaction)
    .await?;

    if let (Some(resource_type), Some(resource_id), Some(title)) = (
        action.committed_resource_type,
        action.committed_resource_id,
        action.link_title,
    ) {
        sqlx::query(
            r#"
            INSERT INTO ward_round_artifact_links (
                id,
                facility_id,
                ward_round_id,
                action_id,
                patient_id,
                admission_case_id,
                resource_type,
                resource_id,
                title,
                created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (ward_round_id, resource_type, resource_id) DO UPDATE
            SET title = EXCLUDED.title,
                action_id = EXCLUDED.action_id
            "#,
        )
        .bind(demo_uuid(
            DEMO_WARD_ROUND_LINK_BASE_ID,
            patient.ordinal * 100 + action.ordinal,
        ))
        .bind(facility_id)
        .bind(ward_round_id)
        .bind(action_id)
        .bind(patient.patient_id())
        .bind(patient.admission_id())
        .bind(resource_type)
        .bind(resource_id)
        .bind(title)
        .bind(demo_time(
            275 + i64::from(patient.ordinal * 10 + action.ordinal),
        ))
        .execute(&mut **transaction)
        .await?;
    }

    Ok(())
}

#[derive(Clone, Debug)]
struct DemoPatientArchetype {
    ordinal: u32,
    patient_code: &'static str,
    first_name: &'static str,
    last_name: &'static str,
    date_of_birth: (i32, u32, u32),
    sex: Sex,
    archetype_label: &'static str,
    note_type: &'static str,
    note_title: &'static str,
    note_body: &'static str,
    problem_label: &'static str,
    problem_onset: (i32, u32, u32),
    allergy: Option<DemoAllergy>,
    medication_name: &'static str,
    medication_dose: &'static str,
    medication_frequency: &'static str,
    blood_pressure: &'static str,
    pulse: &'static str,
    oxygen_saturation: &'static str,
    temperature: &'static str,
    fbc_value: &'static str,
    malaria_result: Option<&'static str>,
    lab_priority: &'static str,
    invoice_status: &'static str,
    invoice_amount_minor: i64,
    paid_amount_minor: i64,
    claim_status: Option<&'static str>,
    admission_status: Option<&'static str>,
    bed_ordinal: Option<u32>,
    nursing_observation_instruction: &'static str,
    ward_round_plan: &'static str,
}

impl DemoPatientArchetype {
    fn patient_id(&self) -> Uuid {
        demo_uuid(DEMO_PATIENT_BASE_ID, self.ordinal)
    }

    fn admission_id(&self) -> Uuid {
        demo_uuid(DEMO_ADMISSION_BASE_ID, self.ordinal)
    }

    fn note_id(&self) -> Uuid {
        demo_uuid(DEMO_NOTE_BASE_ID, self.ordinal)
    }

    fn prescription_id(&self) -> Uuid {
        demo_uuid(DEMO_PRESCRIPTION_BASE_ID, self.ordinal)
    }

    fn lab_order_id(&self) -> Uuid {
        demo_uuid(DEMO_LAB_ORDER_BASE_ID, self.ordinal)
    }

    fn lab_specimen_id(&self) -> Uuid {
        demo_uuid(DEMO_LAB_SPECIMEN_BASE_ID, self.ordinal)
    }

    fn invoice_id(&self) -> Uuid {
        demo_uuid(DEMO_INVOICE_BASE_ID, self.ordinal)
    }
}

#[derive(Clone, Copy, Debug)]
struct DemoAllergy {
    substance: &'static str,
    reaction: Option<&'static str>,
    severity: &'static str,
}

#[derive(Clone, Copy, Debug)]
struct DemoLabResult {
    test_id: Uuid,
    value: &'static str,
    unit: Option<&'static str>,
}

#[derive(Debug)]
struct DemoWardRoundAction {
    ordinal: u32,
    action_type: &'static str,
    title: &'static str,
    instruction: Option<&'static str>,
    payload: serde_json::Value,
    committed_resource_type: Option<&'static str>,
    committed_resource_id: Option<Uuid>,
    link_title: Option<&'static str>,
}

fn demo_patient_archetypes() -> Vec<DemoPatientArchetype> {
    vec![
        DemoPatientArchetype {
            ordinal: 1,
            patient_code: "DEMO-0001",
            first_name: "Afia",
            last_name: "Sarpong",
            date_of_birth: (1988, 4, 12),
            sex: Sex::Female,
            archetype_label: "respiratory inpatient",
            note_type: "admission_note",
            note_title: "Demo admission summary",
            note_body: "Synthetic admission note: fever and cough improving after initial treatment. No real patient data.",
            problem_label: "Community-acquired pneumonia with malaria rule-out",
            problem_onset: (2026, 5, 18),
            allergy: Some(DemoAllergy {
                substance: "Penicillin",
                reaction: Some("rash"),
                severity: "moderate",
            }),
            medication_name: "Ceftriaxone",
            medication_dose: "1 g",
            medication_frequency: "daily",
            blood_pressure: "124/78",
            pulse: "96",
            oxygen_saturation: "94",
            temperature: "37.8",
            fbc_value: "10.8",
            malaria_result: Some("0"),
            lab_priority: "urgent",
            invoice_status: "partially_paid",
            invoice_amount_minor: 18_500,
            paid_amount_minor: 5_000,
            claim_status: Some("submitted"),
            admission_status: Some("admitted"),
            bed_ordinal: Some(1),
            nursing_observation_instruction: "Record temperature, pulse, respiratory rate, and oxygen saturation every four hours.",
            ward_round_plan: "Continue antibiotics, review oxygen saturation trend, and repeat observations before evening handoff.",
        },
        DemoPatientArchetype {
            ordinal: 2,
            patient_code: "DEMO-0002",
            first_name: "Kojo",
            last_name: "Asante",
            date_of_birth: (1975, 11, 3),
            sex: Sex::Male,
            archetype_label: "hypertension review",
            note_type: "progress_note",
            note_title: "Demo hypertension review",
            note_body: "Synthetic outpatient review: blood pressure above target, adherence counselling completed. No real patient data.",
            problem_label: "Essential hypertension",
            problem_onset: (2024, 2, 6),
            allergy: None,
            medication_name: "Amlodipine",
            medication_dose: "10 mg",
            medication_frequency: "daily",
            blood_pressure: "156/94",
            pulse: "82",
            oxygen_saturation: "98",
            temperature: "36.7",
            fbc_value: "13.2",
            malaria_result: None,
            lab_priority: "routine",
            invoice_status: "paid",
            invoice_amount_minor: 7_500,
            paid_amount_minor: 7_500,
            claim_status: None,
            admission_status: None,
            bed_ordinal: None,
            nursing_observation_instruction: "Recheck blood pressure after rest and document counselling points.",
            ward_round_plan: "No active admission.",
        },
        DemoPatientArchetype {
            ordinal: 3,
            patient_code: "DEMO-0003",
            first_name: "Esi",
            last_name: "Owusu",
            date_of_birth: (1994, 8, 22),
            sex: Sex::Female,
            archetype_label: "maternity observation",
            note_type: "progress_note",
            note_title: "Demo maternity observation",
            note_body: "Synthetic maternity observation note: stable after overnight monitoring. No real patient data.",
            problem_label: "Third-trimester observation",
            problem_onset: (2026, 5, 19),
            allergy: None,
            medication_name: "Ferrous sulfate",
            medication_dose: "200 mg",
            medication_frequency: "daily",
            blood_pressure: "118/72",
            pulse: "88",
            oxygen_saturation: "99",
            temperature: "36.6",
            fbc_value: "11.1",
            malaria_result: None,
            lab_priority: "routine",
            invoice_status: "issued",
            invoice_amount_minor: 12_000,
            paid_amount_minor: 0,
            claim_status: Some("draft"),
            admission_status: Some("discharge_pending"),
            bed_ordinal: Some(3),
            nursing_observation_instruction: "Monitor bleeding, pain score, and fetal movement report during each shift.",
            ward_round_plan: "Confirm discharge readiness after nursing education and billing clearance.",
        },
        DemoPatientArchetype {
            ordinal: 4,
            patient_code: "DEMO-0004",
            first_name: "Nana",
            last_name: "Yeboah",
            date_of_birth: (2018, 1, 9),
            sex: Sex::Male,
            archetype_label: "pediatric malaria follow-up",
            note_type: "progress_note",
            note_title: "Demo pediatric follow-up",
            note_body: "Synthetic pediatric review: fever settled and oral intake improving. No real patient data.",
            problem_label: "Uncomplicated malaria follow-up",
            problem_onset: (2026, 5, 17),
            allergy: Some(DemoAllergy {
                substance: "Co-trimoxazole",
                reaction: Some("itching"),
                severity: "mild",
            }),
            medication_name: "Artemether-lumefantrine",
            medication_dose: "20/120 mg",
            medication_frequency: "twice daily",
            blood_pressure: "98/62",
            pulse: "104",
            oxygen_saturation: "97",
            temperature: "37.1",
            fbc_value: "10.5",
            malaria_result: Some("120"),
            lab_priority: "routine",
            invoice_status: "paid",
            invoice_amount_minor: 6_000,
            paid_amount_minor: 6_000,
            claim_status: None,
            admission_status: None,
            bed_ordinal: None,
            nursing_observation_instruction: "Document temperature and oral intake at follow-up.",
            ward_round_plan: "No active admission.",
        },
    ]
}

fn demo_uuid(base: u128, ordinal: u32) -> Uuid {
    Uuid::from_u128(base + u128::from(ordinal))
}

fn demo_date(value: (i32, u32, u32)) -> NaiveDate {
    NaiveDate::from_ymd_opt(value.0, value.1, value.2).expect("static demo seed date is valid")
}

fn demo_time(offset_minutes: i64) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339("2026-05-20T08:00:00Z")
        .expect("static demo seed timestamp is valid")
        .with_timezone(&Utc)
        + Duration::minutes(offset_minutes)
}

pub async fn provision_performance_seed(
    pool: &PgPool,
    baseline: &BaselineProvisioning,
    config: PerformanceSeedConfig,
) -> anyhow::Result<()> {
    config.validate()?;

    let mut tx = pool.begin().await?;
    let owner_user_id = Uuid::from_u128(OWNER_USER_ID);
    let default_ward_id = Uuid::from_u128(DEFAULT_WARD_ID);
    let performance_ward_id = Uuid::from_u128(0x51000000000000000000000000000001);
    let main_store_id = Uuid::from_u128(DEFAULT_MAIN_STORE_ID);
    let default_category_id = Uuid::from_u128(DEFAULT_INVENTORY_CATEGORY_MED_ID);
    let default_lab_test_id = Uuid::from_u128(DEFAULT_LAB_TEST_FBC_ID);
    let default_service_price_id = Uuid::from_u128(DEFAULT_PRICE_CONSULTATION_ID);

    sqlx::query(
        r#"
        WITH perf_invoices AS (
            SELECT id
            FROM invoices
            WHERE facility_id = $1
              AND invoice_number ~ '^PERF-[0-9]{8}$'
        )
        DELETE FROM payments
        USING perf_invoices
        WHERE payments.invoice_id = perf_invoices.id
          AND payments.facility_id = $1
        "#,
    )
    .bind(baseline.facility_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        WITH perf_patients AS (
            SELECT id
            FROM patients
            WHERE facility_id = $1
              AND patient_code ~ '^PERF-[0-9]{6}$'
        )
        DELETE FROM clinical_notes
        USING perf_patients
        WHERE clinical_notes.patient_id = perf_patients.id
          AND clinical_notes.facility_id = $1
          AND clinical_notes.title LIKE 'Performance note %'
        "#,
    )
    .bind(baseline.facility_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        WITH perf_patients AS (
            SELECT id
            FROM patients
            WHERE facility_id = $1
              AND patient_code ~ '^PERF-[0-9]{6}$'
        )
        DELETE FROM lab_orders
        USING perf_patients
        WHERE lab_orders.patient_id = perf_patients.id
          AND lab_orders.facility_id = $1
        "#,
    )
    .bind(baseline.facility_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        WITH perf_patients AS (
            SELECT id
            FROM patients
            WHERE facility_id = $1
              AND patient_code ~ '^PERF-[0-9]{6}$'
        )
        DELETE FROM admission_cases
        USING perf_patients
        WHERE admission_cases.patient_id = perf_patients.id
          AND admission_cases.facility_id = $1
        "#,
    )
    .bind(baseline.facility_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        WITH perf_patients AS (
            SELECT id
            FROM patients
            WHERE facility_id = $1
              AND patient_code ~ '^PERF-[0-9]{6}$'
        )
        DELETE FROM invoices
        USING perf_patients
        WHERE invoices.patient_id = perf_patients.id
          AND invoices.facility_id = $1
          AND invoices.invoice_number ~ '^PERF-[0-9]{8}$'
        "#,
    )
    .bind(baseline.facility_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        WITH perf_items AS (
            SELECT id
            FROM inventory_items
            WHERE facility_id = $1
              AND code ~ '^PERF-MED-[0-9]{6}$'
        )
        DELETE FROM stock_movements
        USING perf_items
        WHERE stock_movements.item_id = perf_items.id
          AND stock_movements.facility_id = $1
        "#,
    )
    .bind(baseline.facility_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        WITH perf_items AS (
            SELECT id
            FROM inventory_items
            WHERE facility_id = $1
              AND code ~ '^PERF-MED-[0-9]{6}$'
        )
        DELETE FROM stock_batches
        USING perf_items
        WHERE stock_batches.item_id = perf_items.id
          AND stock_batches.facility_id = $1
        "#,
    )
    .bind(baseline.facility_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        DELETE FROM patients
        WHERE facility_id = $1
          AND patient_code ~ '^PERF-[0-9]{6}$'
          AND substring(patient_code from 6)::int > $2
        "#,
    )
    .bind(baseline.facility_id)
    .bind(config.patient_count)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        DELETE FROM inventory_items
        WHERE facility_id = $1
          AND code ~ '^PERF-MED-[0-9]{6}$'
          AND substring(code from 10)::int > $2
        "#,
    )
    .bind(baseline.facility_id)
    .bind(config.inventory_item_count)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        WITH generated AS (
            SELECT generate_series(1, $2::int) AS i
        )
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
        SELECT ('310000000000000000000000' || lpad(to_hex(i::bigint), 8, '0'))::uuid,
               $1,
               'PERF-' || lpad(i::text, 6, '0'),
               'Load',
               'Patient ' || lpad(i::text, 6, '0'),
               DATE '1970-01-01' + (i % 18000),
               CASE WHEN i % 3 = 0 THEN 'unknown'
                    WHEN i % 2 = 0 THEN 'female'
                    ELSE 'male'
               END,
               'active',
               TIMESTAMPTZ '2026-02-01 00:00:00+00' + (i * INTERVAL '1 minute'),
               TIMESTAMPTZ '2026-02-01 00:00:00+00' + (i * INTERVAL '1 minute')
        FROM generated
        ON CONFLICT (facility_id, patient_code) DO UPDATE
        SET first_name = EXCLUDED.first_name,
            last_name = EXCLUDED.last_name,
            date_of_birth = EXCLUDED.date_of_birth,
            sex = EXCLUDED.sex,
            status = EXCLUDED.status,
            created_at = EXCLUDED.created_at,
            updated_at = EXCLUDED.updated_at
        "#,
    )
    .bind(baseline.facility_id)
    .bind(config.patient_count)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        WITH perf_patients AS (
            SELECT id,
                   substring(patient_code from 6)::int AS ordinal
            FROM patients
            WHERE facility_id = $1
              AND patient_code ~ '^PERF-[0-9]{6}$'
              AND substring(patient_code from 6)::int <= $3
        )
        INSERT INTO patient_contexts (
            id,
            facility_id,
            user_id,
            patient_id,
            context_kind,
            label,
            created_at,
            updated_at
        )
        SELECT ('320000000000000000000000' || lpad(to_hex(ordinal::bigint), 8, '0'))::uuid,
               $1,
               $2,
               id,
               'assigned',
               'performance-seed',
               TIMESTAMPTZ '2026-02-01 00:00:00+00' + (ordinal * INTERVAL '1 minute'),
               TIMESTAMPTZ '2026-02-01 00:00:00+00' + (ordinal * INTERVAL '1 minute')
        FROM perf_patients
        ON CONFLICT (user_id, patient_id, context_kind) DO UPDATE
        SET label = EXCLUDED.label,
            updated_at = EXCLUDED.updated_at
        "#,
    )
    .bind(baseline.facility_id)
    .bind(owner_user_id)
    .bind(config.patient_count)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        WITH perf_patients AS (
            SELECT id,
                   substring(patient_code from 6)::int AS ordinal
            FROM patients
            WHERE facility_id = $1
              AND patient_code ~ '^PERF-[0-9]{6}$'
              AND substring(patient_code from 6)::int <= $2
        )
        INSERT INTO clinical_notes (
            id,
            facility_id,
            patient_id,
            encounter_id,
            note_type,
            title,
            body,
            status,
            version,
            created_by_user_id,
            created_at,
            updated_at
        )
        SELECT ('610000000000000000000000'
                    || lpad(to_hex(((ordinal - 1) * $3 + note_index)::bigint), 8, '0'))::uuid,
               $1,
               id,
               NULL,
               CASE WHEN note_index % 4 = 0 THEN 'ward_round'
                    WHEN note_index % 3 = 0 THEN 'review'
                    ELSE 'general'
               END,
               'Performance note ' || lpad(note_index::text, 3, '0'),
               'Synthetic clinical performance seed note. No patient-identifying content.',
               CASE WHEN note_index % 5 = 0 THEN 'signed' ELSE 'draft' END,
               1,
               $4,
               TIMESTAMPTZ '2026-03-01 00:00:00+00'
                    + (((ordinal - 1) * $3 + note_index) * INTERVAL '1 minute'),
               TIMESTAMPTZ '2026-03-01 00:00:00+00'
                    + (((ordinal - 1) * $3 + note_index) * INTERVAL '1 minute')
        FROM perf_patients
        CROSS JOIN generate_series(1, $3::int) AS note_index
        "#,
    )
    .bind(baseline.facility_id)
    .bind(config.chronicled_patient_count)
    .bind(config.notes_per_chronicle_patient)
    .bind(owner_user_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO patient_chronicle_read_models (
            patient_id,
            facility_id,
            summary_status,
            latest_event_at,
            updated_at
        )
        SELECT id,
               facility_id,
               CASE
                   WHEN substring(patient_code from 6)::int <= $2 THEN 'active'
                   ELSE 'empty'
               END,
               CASE
                   WHEN substring(patient_code from 6)::int <= $2
                   THEN TIMESTAMPTZ '2026-03-01 00:00:00+00'
                        + ((substring(patient_code from 6)::int * $3) * INTERVAL '1 minute')
                   ELSE NULL
               END,
               now()
        FROM patients
        WHERE facility_id = $1
          AND patient_code ~ '^PERF-[0-9]{6}$'
          AND substring(patient_code from 6)::int <= $4
        ON CONFLICT (patient_id) DO UPDATE
        SET summary_status = EXCLUDED.summary_status,
            latest_event_at = EXCLUDED.latest_event_at,
            updated_at = EXCLUDED.updated_at
        "#,
    )
    .bind(baseline.facility_id)
    .bind(config.chronicled_patient_count)
    .bind(config.notes_per_chronicle_patient)
    .bind(config.patient_count)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO wards (id, facility_id, code, name, status)
        VALUES ($1, $2, 'perf-load', 'Performance Load Ward', 'active')
        ON CONFLICT (facility_id, code) DO UPDATE
        SET id = EXCLUDED.id,
            name = EXCLUDED.name,
            status = EXCLUDED.status,
            updated_at = now()
        "#,
    )
    .bind(performance_ward_id)
    .bind(baseline.facility_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "UPDATE beds SET status = 'available', updated_at = now() WHERE facility_id = $1 AND ward_id = $2 AND bed_code ~ '^PERF-[0-9]{4}$'",
    )
    .bind(baseline.facility_id)
    .bind(performance_ward_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        WITH generated AS (
            SELECT generate_series(1, GREATEST($3::int, 1)) AS i
        )
        INSERT INTO beds (id, facility_id, ward_id, bed_code, status)
        SELECT ('511000000000000000000000' || lpad(to_hex(i::bigint), 8, '0'))::uuid,
               $1,
               $2,
               'PERF-' || lpad(i::text, 4, '0'),
               CASE WHEN i <= $3 THEN 'occupied' ELSE 'available' END
        FROM generated
        ON CONFLICT (ward_id, bed_code) DO UPDATE
        SET status = EXCLUDED.status,
            updated_at = now()
        "#,
    )
    .bind(baseline.facility_id)
    .bind(performance_ward_id)
    .bind(config.admission_count)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        WITH generated AS (
            SELECT generate_series(1, $3::int) AS i
        ),
        perf_patients AS (
            SELECT id,
                   substring(patient_code from 6)::int AS ordinal
            FROM patients
            WHERE facility_id = $1
              AND patient_code ~ '^PERF-[0-9]{6}$'
        )
        INSERT INTO admission_cases (
            id,
            facility_id,
            patient_id,
            ward_id,
            bed_id,
            status,
            admitted_at,
            attending_user_id,
            created_by_user_id,
            created_at,
            updated_at
        )
        SELECT ('520000000000000000000000' || lpad(to_hex(i::bigint), 8, '0'))::uuid,
               $1,
               perf_patients.id,
               $2,
               ('511000000000000000000000' || lpad(to_hex(i::bigint), 8, '0'))::uuid,
               'admitted',
               TIMESTAMPTZ '2026-04-01 00:00:00+00' + (i * INTERVAL '30 minutes'),
               $4,
               $4,
               TIMESTAMPTZ '2026-04-01 00:00:00+00' + (i * INTERVAL '30 minutes'),
               TIMESTAMPTZ '2026-04-01 00:00:00+00' + (i * INTERVAL '30 minutes')
        FROM generated
        JOIN perf_patients ON perf_patients.ordinal = i
        ON CONFLICT (id) DO UPDATE
        SET patient_id = EXCLUDED.patient_id,
            ward_id = EXCLUDED.ward_id,
            bed_id = EXCLUDED.bed_id,
            status = EXCLUDED.status,
            admitted_at = EXCLUDED.admitted_at,
            attending_user_id = EXCLUDED.attending_user_id,
            created_by_user_id = EXCLUDED.created_by_user_id,
            updated_at = EXCLUDED.updated_at
        "#,
    )
    .bind(baseline.facility_id)
    .bind(performance_ward_id)
    .bind(config.admission_count)
    .bind(owner_user_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        WITH admissions AS (
            SELECT id, patient_id, row_number() OVER (ORDER BY admitted_at, id) AS ordinal
            FROM admission_cases
            WHERE facility_id = $1
              AND ward_id = $2
              AND status = 'admitted'
        )
        INSERT INTO nursing_tasks (
            id,
            facility_id,
            admission_case_id,
            patient_id,
            ward_id,
            task_type,
            status,
            due_at,
            assigned_to_user_id,
            created_by_user_id,
            created_at,
            updated_at
        )
        SELECT ('530000000000000000000000'
                    || lpad(to_hex(((ordinal - 1) * 3 + task_index)::bigint), 8, '0'))::uuid,
               $1,
               id,
               patient_id,
               $2,
               CASE WHEN task_index = 1 THEN 'ward_round'
                    WHEN task_index = 2 THEN 'observation'
                    ELSE 'medication'
               END,
               'open',
               TIMESTAMPTZ '2026-04-02 00:00:00+00'
                    + (((ordinal - 1) * 3 + task_index) * INTERVAL '15 minutes'),
               $3,
               $3,
               TIMESTAMPTZ '2026-04-01 00:00:00+00',
               TIMESTAMPTZ '2026-04-01 00:00:00+00'
        FROM admissions
        CROSS JOIN generate_series(1, 3) AS task_index
        "#,
    )
    .bind(baseline.facility_id)
    .bind(performance_ward_id)
    .bind(owner_user_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        WITH generated AS (
            SELECT generate_series(1, $2::int) AS i
        )
        INSERT INTO lab_orders (
            id,
            facility_id,
            patient_id,
            priority,
            status,
            ordered_by_user_id,
            ordered_at,
            updated_at
        )
        SELECT ('710000000000000000000000' || lpad(to_hex(i::bigint), 8, '0'))::uuid,
               $1,
               ('310000000000000000000000'
                    || lpad(to_hex((((i - 1) % $3) + 1)::bigint), 8, '0'))::uuid,
               CASE WHEN i % 11 = 0 THEN 'urgent' ELSE 'routine' END,
               CASE WHEN i % 4 = 0 THEN 'verified'
                    WHEN i % 3 = 0 THEN 'result_entered'
                    ELSE 'ordered'
               END,
               $4,
               TIMESTAMPTZ '2026-05-01 00:00:00+00' + (i * INTERVAL '10 minutes'),
               TIMESTAMPTZ '2026-05-01 00:00:00+00' + (i * INTERVAL '10 minutes')
        FROM generated
        ON CONFLICT (id) DO UPDATE
        SET patient_id = EXCLUDED.patient_id,
            priority = EXCLUDED.priority,
            status = EXCLUDED.status,
            ordered_at = EXCLUDED.ordered_at,
            updated_at = EXCLUDED.updated_at
        "#,
    )
    .bind(baseline.facility_id)
    .bind(config.lab_order_count)
    .bind(config.patient_count)
    .bind(owner_user_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        WITH generated AS (
            SELECT generate_series(1, $1::int) AS i
        )
        INSERT INTO lab_order_tests (order_id, test_id)
        SELECT ('710000000000000000000000' || lpad(to_hex(i::bigint), 8, '0'))::uuid,
               $2
        FROM generated
        ON CONFLICT (order_id, test_id) DO NOTHING
        "#,
    )
    .bind(config.lab_order_count)
    .bind(default_lab_test_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        WITH generated AS (
            SELECT generate_series(1, $2::int) AS i
        )
        INSERT INTO lab_specimens (
            id,
            facility_id,
            order_id,
            patient_id,
            specimen_type,
            status,
            collected_by_user_id,
            collected_at,
            updated_at
        )
        SELECT ('720000000000000000000000' || lpad(to_hex(i::bigint), 8, '0'))::uuid,
               $1,
               ('710000000000000000000000' || lpad(to_hex(i::bigint), 8, '0'))::uuid,
               ('310000000000000000000000'
                    || lpad(to_hex((((i - 1) % $3) + 1)::bigint), 8, '0'))::uuid,
               'blood',
               'collected',
               $4,
               TIMESTAMPTZ '2026-05-01 01:00:00+00' + (i * INTERVAL '10 minutes'),
               TIMESTAMPTZ '2026-05-01 01:00:00+00' + (i * INTERVAL '10 minutes')
        FROM generated
        ON CONFLICT (id) DO UPDATE
        SET patient_id = EXCLUDED.patient_id,
            status = EXCLUDED.status,
            collected_at = EXCLUDED.collected_at,
            updated_at = EXCLUDED.updated_at
        "#,
    )
    .bind(baseline.facility_id)
    .bind(config.lab_order_count)
    .bind(config.patient_count)
    .bind(owner_user_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        WITH generated AS (
            SELECT generate_series(1, $2::int) AS i
        )
        INSERT INTO lab_results (
            id,
            facility_id,
            order_id,
            specimen_id,
            patient_id,
            test_id,
            value,
            unit,
            status,
            entered_by_user_id,
            entered_at,
            verified_by_user_id,
            verified_at,
            updated_at
        )
        SELECT ('730000000000000000000000' || lpad(to_hex(i::bigint), 8, '0'))::uuid,
               $1,
               ('710000000000000000000000' || lpad(to_hex(i::bigint), 8, '0'))::uuid,
               ('720000000000000000000000' || lpad(to_hex(i::bigint), 8, '0'))::uuid,
               ('310000000000000000000000'
                    || lpad(to_hex((((i - 1) % $3) + 1)::bigint), 8, '0'))::uuid,
               $4,
               (10 + (i % 7))::text,
               'g/dL',
               CASE WHEN i % 4 = 0 THEN 'verified' ELSE 'entered' END,
               $5,
               TIMESTAMPTZ '2026-05-01 02:00:00+00' + (i * INTERVAL '10 minutes'),
               CASE WHEN i % 4 = 0 THEN $5 ELSE NULL END,
               CASE WHEN i % 4 = 0
                    THEN TIMESTAMPTZ '2026-05-01 03:00:00+00' + (i * INTERVAL '10 minutes')
                    ELSE NULL
               END,
               TIMESTAMPTZ '2026-05-01 02:00:00+00' + (i * INTERVAL '10 minutes')
        FROM generated
        ON CONFLICT (specimen_id, test_id) DO UPDATE
        SET value = EXCLUDED.value,
            status = EXCLUDED.status,
            entered_at = EXCLUDED.entered_at,
            verified_by_user_id = EXCLUDED.verified_by_user_id,
            verified_at = EXCLUDED.verified_at,
            updated_at = EXCLUDED.updated_at
        "#,
    )
    .bind(baseline.facility_id)
    .bind(config.lab_order_count)
    .bind(config.patient_count)
    .bind(default_lab_test_id)
    .bind(owner_user_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        WITH generated AS (
            SELECT generate_series(1, $2::int) AS i
        )
        INSERT INTO inventory_items (
            id,
            facility_id,
            category_id,
            code,
            name,
            item_type,
            unit,
            controlled,
            is_active,
            created_at,
            updated_at
        )
        SELECT ('810000000000000000000000' || lpad(to_hex(i::bigint), 8, '0'))::uuid,
               $1,
               $3,
               'PERF-MED-' || lpad(i::text, 6, '0'),
               'Performance Item ' || lpad(i::text, 6, '0'),
               'medication',
               'unit',
               FALSE,
               TRUE,
               TIMESTAMPTZ '2026-06-01 00:00:00+00' + (i * INTERVAL '1 minute'),
               TIMESTAMPTZ '2026-06-01 00:00:00+00' + (i * INTERVAL '1 minute')
        FROM generated
        ON CONFLICT (facility_id, code) DO UPDATE
        SET name = EXCLUDED.name,
            item_type = EXCLUDED.item_type,
            unit = EXCLUDED.unit,
            controlled = EXCLUDED.controlled,
            is_active = TRUE,
            updated_at = EXCLUDED.updated_at
        "#,
    )
    .bind(baseline.facility_id)
    .bind(config.inventory_item_count)
    .bind(default_category_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        WITH generated AS (
            SELECT generate_series(1, $2::int) AS i
        )
        INSERT INTO stock_batches (
            id,
            facility_id,
            item_id,
            location_id,
            batch_number,
            expires_on,
            quantity_on_hand,
            received_at,
            updated_at
        )
        SELECT ('820000000000000000000000' || lpad(to_hex(i::bigint), 8, '0'))::uuid,
               $1,
               ('810000000000000000000000' || lpad(to_hex(i::bigint), 8, '0'))::uuid,
               $3,
               'PERF-BATCH-' || lpad(i::text, 6, '0'),
               DATE '2027-01-01' + (i % 365),
               50 + (i % 500),
               TIMESTAMPTZ '2026-06-02 00:00:00+00' + (i * INTERVAL '1 minute'),
               TIMESTAMPTZ '2026-06-02 00:00:00+00' + (i * INTERVAL '1 minute')
        FROM generated
        ON CONFLICT (id) DO UPDATE
        SET quantity_on_hand = EXCLUDED.quantity_on_hand,
            expires_on = EXCLUDED.expires_on,
            updated_at = EXCLUDED.updated_at
        "#,
    )
    .bind(baseline.facility_id)
    .bind(config.inventory_item_count)
    .bind(main_store_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        WITH generated AS (
            SELECT generate_series(1, $2::int) AS i
        )
        INSERT INTO stock_movements (
            id,
            facility_id,
            item_id,
            batch_id,
            location_id,
            movement_type,
            quantity,
            balance_after,
            reason,
            created_by_user_id,
            created_at
        )
        SELECT ('830000000000000000000000' || lpad(to_hex(i::bigint), 8, '0'))::uuid,
               $1,
               ('810000000000000000000000' || lpad(to_hex(i::bigint), 8, '0'))::uuid,
               ('820000000000000000000000' || lpad(to_hex(i::bigint), 8, '0'))::uuid,
               $3,
               'receipt',
               50 + (i % 500),
               50 + (i % 500),
               'performance-seed',
               $4,
               TIMESTAMPTZ '2026-06-02 00:00:00+00' + (i * INTERVAL '1 minute')
        FROM generated
        ON CONFLICT (id) DO NOTHING
        "#,
    )
    .bind(baseline.facility_id)
    .bind(config.inventory_item_count)
    .bind(main_store_id)
    .bind(owner_user_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        WITH generated AS (
            SELECT generate_series(1, $2::int) AS i
        )
        INSERT INTO invoices (
            id,
            facility_id,
            patient_id,
            invoice_number,
            status,
            gross_amount_minor,
            paid_amount_minor,
            currency,
            issued_by_user_id,
            issued_at,
            updated_at
        )
        SELECT ('910000000000000000000000' || lpad(to_hex(i::bigint), 8, '0'))::uuid,
               $1,
               ('310000000000000000000000'
                    || lpad(to_hex((((i - 1) % $3) + 1)::bigint), 8, '0'))::uuid,
               'PERF-' || lpad(i::text, 8, '0'),
               CASE WHEN i % 3 = 0 THEN 'paid'
                    WHEN i % 3 = 1 THEN 'partially_paid'
                    ELSE 'issued'
               END,
               15000 + ((i % 9) * 2500),
               CASE WHEN i % 3 = 0 THEN 15000 + ((i % 9) * 2500)
                    WHEN i % 3 = 1 THEN 5000
                    ELSE 0
               END,
               'GHS',
               $4,
               TIMESTAMPTZ '2026-07-01 00:00:00+00' + (i * INTERVAL '10 minutes'),
               TIMESTAMPTZ '2026-07-01 00:00:00+00' + (i * INTERVAL '10 minutes')
        FROM generated
        ON CONFLICT (facility_id, invoice_number) DO UPDATE
        SET patient_id = EXCLUDED.patient_id,
            status = EXCLUDED.status,
            gross_amount_minor = EXCLUDED.gross_amount_minor,
            paid_amount_minor = EXCLUDED.paid_amount_minor,
            updated_at = EXCLUDED.updated_at
        "#,
    )
    .bind(baseline.facility_id)
    .bind(config.invoice_count)
    .bind(config.patient_count)
    .bind(owner_user_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        WITH generated AS (
            SELECT generate_series(1, $2::int) AS i
        )
        INSERT INTO invoice_lines (
            id,
            facility_id,
            invoice_id,
            service_price_id,
            description,
            quantity,
            unit_amount_minor,
            line_amount_minor,
            currency,
            created_at
        )
        SELECT ('911000000000000000000000' || lpad(to_hex(i::bigint), 8, '0'))::uuid,
               $1,
               ('910000000000000000000000' || lpad(to_hex(i::bigint), 8, '0'))::uuid,
               $3,
               'Performance consultation',
               1,
               15000 + ((i % 9) * 2500),
               15000 + ((i % 9) * 2500),
               'GHS',
               TIMESTAMPTZ '2026-07-01 00:00:00+00' + (i * INTERVAL '10 minutes')
        FROM generated
        ON CONFLICT (id) DO UPDATE
        SET unit_amount_minor = EXCLUDED.unit_amount_minor,
            line_amount_minor = EXCLUDED.line_amount_minor
        "#,
    )
    .bind(baseline.facility_id)
    .bind(config.invoice_count)
    .bind(default_service_price_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        WITH paid_invoices AS (
            SELECT id,
                   row_number() OVER (ORDER BY issued_at, id) AS ordinal,
                   paid_amount_minor,
                   issued_at
            FROM invoices
            WHERE facility_id = $1
              AND invoice_number ~ '^PERF-[0-9]{8}$'
              AND paid_amount_minor > 0
        )
        INSERT INTO payments (
            id,
            facility_id,
            invoice_id,
            cash_session_id,
            receipt_number,
            amount_minor,
            currency,
            method,
            status,
            recorded_by_user_id,
            paid_at
        )
        SELECT ('912000000000000000000000' || lpad(to_hex(ordinal::bigint), 8, '0'))::uuid,
               $1,
               id,
               NULL,
               'PERF-RCPT-' || lpad(ordinal::text, 8, '0'),
               paid_amount_minor,
               'GHS',
               'cash',
               'recorded',
               $2,
               issued_at + INTERVAL '20 minutes'
        FROM paid_invoices
        ON CONFLICT (facility_id, receipt_number) DO UPDATE
        SET amount_minor = EXCLUDED.amount_minor,
            status = EXCLUDED.status,
            paid_at = EXCLUDED.paid_at
        "#,
    )
    .bind(baseline.facility_id)
    .bind(owner_user_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query("UPDATE wards SET status = 'active', updated_at = now() WHERE id IN ($1, $2)")
        .bind(default_ward_id)
        .bind(performance_ward_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
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

async fn seed_default_appointment_types(
    pool: &PgPool,
    baseline: &BaselineProvisioning,
) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO appointment_types (
            id,
            facility_id,
            code,
            name,
            default_duration_minutes
        )
        VALUES ($1, $2, 'general', 'General', 30)
        ON CONFLICT (facility_id, code) DO UPDATE
        SET id = EXCLUDED.id,
            name = EXCLUDED.name,
            default_duration_minutes = EXCLUDED.default_duration_minutes,
            is_active = TRUE
        "#,
    )
    .bind(Uuid::from_u128(DEFAULT_APPOINTMENT_TYPE_GENERAL_ID))
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

    for (id, code, name, contact_name, phone, email) in [
        (
            Uuid::from_u128(DEFAULT_SUPPLIER_ACME_ID),
            "ACME",
            "Acme Medical Supplies",
            "Procurement Desk",
            "+233 30 000 1000",
            "orders@acme-med.local",
        ),
        (
            Uuid::from_u128(DEFAULT_SUPPLIER_CITY_ID),
            "CITY",
            "City Medical Depot",
            "Sales Desk",
            "+233 30 000 2000",
            "orders@city-med.local",
        ),
    ] {
        sqlx::query(
            r#"
            INSERT INTO inventory_suppliers (id, facility_id, code, name, contact_name, phone, email)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (facility_id, code) DO UPDATE
            SET id = EXCLUDED.id,
                name = EXCLUDED.name,
                contact_name = EXCLUDED.contact_name,
                phone = EXCLUDED.phone,
                email = EXCLUDED.email,
                is_active = TRUE,
                updated_at = now()
            "#,
        )
        .bind(id)
        .bind(baseline.facility_id)
        .bind(code)
        .bind(name)
        .bind(contact_name)
        .bind(phone)
        .bind(email)
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
    .bind(baseline.facility_id)
    .bind(baseline.facility_id)
    .bind(&baseline.facility_code)
    .bind(&baseline.facility_name)
    .bind(codec::encode(OrgUnitType::Facility)?)
    .execute(pool)
    .await?;

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

    for (id, code, name) in [
        (DEFAULT_ORG_UNIT_OPD_ID, "OPD", "Outpatient Department"),
        (
            DEFAULT_ORG_UNIT_EMERGENCY_ID,
            "EMERGENCY",
            "Emergency Department",
        ),
        (DEFAULT_ORG_UNIT_MEDICINE_ID, "MEDICINE", "General Medicine"),
    ] {
        sqlx::query(
            r#"
            INSERT INTO organization_units (id, facility_id, parent_unit_id, code, name, unit_type)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (facility_id, code) DO UPDATE
            SET id = EXCLUDED.id,
                parent_unit_id = EXCLUDED.parent_unit_id,
                name = EXCLUDED.name,
                unit_type = EXCLUDED.unit_type,
                is_active = TRUE
            "#,
        )
        .bind(Uuid::from_u128(id))
        .bind(baseline.facility_id)
        .bind(Uuid::from_u128(DEFAULT_ORG_UNIT_CLINICAL_ID))
        .bind(code)
        .bind(name)
        .bind(codec::encode(OrgUnitType::Department)?)
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

async fn seed_ops_operator_permissions(
    pool: &PgPool,
    baseline: &BaselineProvisioning,
) -> anyhow::Result<()> {
    let permission_code = codec::encode(PermissionCode::SystemOpsView)?;

    for email in baseline
        .ops_operator_emails
        .iter()
        .map(|email| email.trim())
        .filter(|email| !email.is_empty())
    {
        let user_id = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM users WHERE facility_id = $1 AND lower(email) = lower($2) AND is_active = TRUE",
        )
        .bind(baseline.facility_id)
        .bind(email)
        .fetch_optional(pool)
        .await?;

        let Some(user_id) = user_id else {
            anyhow::bail!(
                "HMS_OPS_OPERATOR_EMAILS includes {email}, but no active user exists in this facility"
            );
        };

        let result = sqlx::query(
            r#"
            INSERT INTO user_permissions (user_id, permission_code)
            VALUES ($1, $2)
            ON CONFLICT (user_id, permission_code) DO NOTHING
            "#,
        )
        .bind(user_id)
        .bind(&permission_code)
        .execute(pool)
        .await?;

        if result.rows_affected() > 0 {
            sqlx::query(
                "UPDATE users SET permission_version = permission_version + 1, updated_at = now() WHERE id = $1",
            )
            .bind(user_id)
            .execute(pool)
            .await?;
        }
    }

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
