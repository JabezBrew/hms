use std::collections::HashSet;
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
use hms_domain::ward::{
    BedStatus, HandoffStatus, MonitoringEventKind, NursingAlertSeverity, NursingAlertStatus,
    WardStatus, WardStockRequestStatus,
};
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
pub const DEFAULT_LAB_TEST_RBG_ID: u128 = 0x70000000000000000000000000000003;
pub const DEFAULT_LAB_TEST_FBS_ID: u128 = 0x70000000000000000000000000000004;
pub const DEFAULT_LAB_TEST_HBA1C_ID: u128 = 0x70000000000000000000000000000005;
pub const DEFAULT_LAB_TEST_UE_ID: u128 = 0x70000000000000000000000000000006;
pub const DEFAULT_LAB_TEST_CREATININE_ID: u128 = 0x70000000000000000000000000000007;
pub const DEFAULT_LAB_TEST_LFT_ID: u128 = 0x70000000000000000000000000000008;
pub const DEFAULT_LAB_TEST_LIPID_ID: u128 = 0x70000000000000000000000000000009;
pub const DEFAULT_LAB_TEST_TSH_ID: u128 = 0x7000000000000000000000000000000a;
pub const DEFAULT_LAB_TEST_WIDAL_ID: u128 = 0x7000000000000000000000000000000b;
pub const DEFAULT_LAB_TEST_HBSAG_ID: u128 = 0x7000000000000000000000000000000c;
pub const DEFAULT_LAB_TEST_HIV_ID: u128 = 0x7000000000000000000000000000000d;
pub const DEFAULT_LAB_TEST_URINALYSIS_ID: u128 = 0x7000000000000000000000000000000e;
pub const DEFAULT_LAB_TEST_GROUP_SCREEN_ID: u128 = 0x7000000000000000000000000000000f;
pub const DEFAULT_LAB_TEST_CRP_ID: u128 = 0x70000000000000000000000000000011;
pub const DEFAULT_LAB_TEST_COAG_ID: u128 = 0x70000000000000000000000000000012;
pub const DEFAULT_LAB_TEST_AFB_ID: u128 = 0x70000000000000000000000000000013;
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
pub const DEFAULT_INSURANCE_PROVIDER_NHIS_ID: u128 = 0x90000000000000000000000000000040;
pub const DEFAULT_INSURANCE_PROVIDER_PRIVATE_ID: u128 = 0x90000000000000000000000000000041;
pub const DEFAULT_INSURANCE_PLAN_NHIS_ID: u128 = 0x90000000000000000000000000000042;
pub const DEFAULT_INSURANCE_PLAN_PRIVATE_ID: u128 = 0x90000000000000000000000000000043;
pub const DEFAULT_PATIENT_INSURANCE_ONE_ID: u128 = 0x90000000000000000000000000000044;
pub const DEFAULT_PATIENT_INSURANCE_TWO_ID: u128 = 0x90000000000000000000000000000045;
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

const DEMO_WARD_BASE_ID: u128 = 0xd1000000000000000000000000000000;
const DEMO_SECTION_BASE_ID: u128 = 0xd1000000000000000000000000000100;
#[allow(dead_code)]
const DEMO_WARD_ID: u128 = DEMO_WARD_BASE_ID + 1;
#[allow(dead_code)]
const DEMO_SECTION_ID: u128 = DEMO_SECTION_BASE_ID + 1;
const DEMO_BED_BASE_ID: u128 = 0xd1100000000000000000000000000000;
const DEMO_PATIENT_BASE_ID: u128 = 0xd2000000000000000000000000000000;
const DEMO_CONTEXT_BASE_ID: u128 = 0xd2100000000000000000000000000000;
const DEMO_APPOINTMENT_BASE_ID: u128 = 0xd2200000000000000000000000000000;
const DEMO_VISIT_BASE_ID: u128 = 0xd2300000000000000000000000000000;
const DEMO_ENCOUNTER_BASE_ID: u128 = 0xd2400000000000000000000000000000;
const DEMO_CARE_TEAM_BASE_ID: u128 = 0xd2500000000000000000000000000000;
const DEMO_ADMISSION_BASE_ID: u128 = 0xd3000000000000000000000000000000;
const DEMO_NURSING_TASK_BASE_ID: u128 = 0xd3100000000000000000000000000000;
const DEMO_MED_ADMIN_BASE_ID: u128 = 0xd3200000000000000000000000000000;
const DEMO_TREATMENT_SHEET_BASE_ID: u128 = 0xd3300000000000000000000000000000;
const DEMO_DISCHARGE_CASE_BASE_ID: u128 = 0xd3400000000000000000000000000000;
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
const DEMO_PATIENT_VITAL_BASE_ID: u128 = 0xd8000000000000000000000000000000;
const DEMO_NURSING_ALERT_BASE_ID: u128 = 0xd8100000000000000000000000000000;
const DEMO_MONITORING_EVENT_BASE_ID: u128 = 0xd8200000000000000000000000000000;
const DEMO_FLUID_BALANCE_BASE_ID: u128 = 0xd8300000000000000000000000000000;
const DEMO_WARD_STOCK_REQUEST_BASE_ID: u128 = 0xd8400000000000000000000000000000;
const DEMO_HANDOFF_BASE_ID: u128 = 0xd8500000000000000000000000000000;

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
    Staging,
    Small,
    Medium,
    Large,
}

impl DemoSeedProfile {
    pub fn parse(value: &str) -> anyhow::Result<Option<Self>> {
        match value.trim().to_ascii_lowercase().as_str() {
            "" | "0" | "false" | "no" | "off" | "none" => Ok(None),
            "1" | "true" | "yes" | "on" | "smoke" => Ok(Some(Self::Smoke)),
            "staging" => Ok(Some(Self::Staging)),
            "small" => Ok(Some(Self::Small)),
            "medium" => Ok(Some(Self::Medium)),
            "large" => Ok(Some(Self::Large)),
            _ => anyhow::bail!(
                "HMS_DEMO_SEED_PROFILE must be smoke, staging, small, medium, large, or disabled"
            ),
        }
    }

    fn config(self) -> DemoSeedConfig {
        match self {
            Self::Smoke => DemoSeedConfig {
                patient_count: 9,
                years: 1,
                active_admission_target: 4,
                beds_per_ward: 8,
            },
            Self::Staging => DemoSeedConfig {
                patient_count: 90,
                years: 1,
                active_admission_target: 14,
                beds_per_ward: 18,
            },
            Self::Small => DemoSeedConfig {
                patient_count: 270,
                years: 2,
                active_admission_target: 32,
                beds_per_ward: 40,
            },
            Self::Medium => DemoSeedConfig {
                patient_count: 900,
                years: 3,
                active_admission_target: 120,
                beds_per_ward: 180,
            },
            Self::Large => DemoSeedConfig {
                patient_count: 2_700,
                years: 4,
                active_admission_target: 360,
                beds_per_ward: 480,
            },
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct DemoSeedConfig {
    patient_count: usize,
    years: u16,
    active_admission_target: usize,
    beds_per_ward: u32,
}

impl DemoSeedConfig {
    fn validate(self) -> anyhow::Result<()> {
        ensure!(
            self.patient_count > 0,
            "demo patient_count must be greater than zero"
        );
        ensure!(self.years > 0, "demo years must be greater than zero");
        ensure!(
            self.active_admission_target <= self.patient_count,
            "demo active admissions must fit inside patient_count"
        );
        ensure!(
            self.beds_per_ward > 0,
            "demo beds_per_ward must be greater than zero"
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
    let journeys = build_chronicle_demo_patients(config);

    let mut tx = pool.begin().await?;
    delete_demo_seed_graph(&mut tx, baseline.facility_id).await?;
    seed_chronicle_demo_ward_resources(&mut tx, baseline, config, &journeys).await?;
    seed_chronicle_demo_patient_graph(&mut tx, baseline, &journeys).await?;
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
              AND nhis_claims.claim_number ~ '^DEMO-CLM-[0-9]{4,6}$'
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
          AND nhis_claims.claim_number ~ '^DEMO-CLM-[0-9]{4,6}$'
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
        WITH demo_admissions AS (
            SELECT admission_cases.id
            FROM admission_cases
            JOIN patients ON patients.id = admission_cases.patient_id
            WHERE admission_cases.facility_id = $1
              AND patients.facility_id = $1
              AND patients.patient_code ~ '^DEMO-[0-9]{4}$'
        )
        DELETE FROM patient_vitals
        USING demo_admissions
        WHERE patient_vitals.facility_id = $1
          AND patient_vitals.admission_case_id = demo_admissions.id
        "#,
        r#"
        WITH demo_admissions AS (
            SELECT admission_cases.id
            FROM admission_cases
            JOIN patients ON patients.id = admission_cases.patient_id
            WHERE admission_cases.facility_id = $1
              AND patients.facility_id = $1
              AND patients.patient_code ~ '^DEMO-[0-9]{4}$'
        )
        DELETE FROM nursing_alerts
        USING demo_admissions
        WHERE nursing_alerts.facility_id = $1
          AND nursing_alerts.admission_case_id = demo_admissions.id
        "#,
        r#"
        WITH demo_admissions AS (
            SELECT admission_cases.id
            FROM admission_cases
            JOIN patients ON patients.id = admission_cases.patient_id
            WHERE admission_cases.facility_id = $1
              AND patients.facility_id = $1
              AND patients.patient_code ~ '^DEMO-[0-9]{4}$'
        )
        DELETE FROM monitoring_events
        USING demo_admissions
        WHERE monitoring_events.facility_id = $1
          AND monitoring_events.admission_case_id = demo_admissions.id
        "#,
        r#"
        WITH demo_admissions AS (
            SELECT admission_cases.id
            FROM admission_cases
            JOIN patients ON patients.id = admission_cases.patient_id
            WHERE admission_cases.facility_id = $1
              AND patients.facility_id = $1
              AND patients.patient_code ~ '^DEMO-[0-9]{4}$'
        )
        DELETE FROM fluid_balance_entries
        USING demo_admissions
        WHERE fluid_balance_entries.facility_id = $1
          AND fluid_balance_entries.admission_case_id = demo_admissions.id
        "#,
        r#"
        DELETE FROM discharge_cases
        USING patients
        WHERE discharge_cases.facility_id = $1
          AND patients.facility_id = $1
          AND discharge_cases.patient_id = patients.id
          AND patients.patient_code ~ '^DEMO-[0-9]{4}$'
        "#,
        r#"
        DELETE FROM treatment_sheets
        USING patients
        WHERE treatment_sheets.facility_id = $1
          AND patients.facility_id = $1
          AND treatment_sheets.patient_id = patients.id
          AND patients.patient_code ~ '^DEMO-[0-9]{4}$'
        "#,
        r#"
        DELETE FROM medication_administrations
        USING patients
        WHERE medication_administrations.facility_id = $1
          AND patients.facility_id = $1
          AND medication_administrations.patient_id = patients.id
          AND patients.patient_code ~ '^DEMO-[0-9]{4}$'
        "#,
        r#"
        DELETE FROM nursing_tasks
        USING patients
        WHERE nursing_tasks.facility_id = $1
          AND patients.facility_id = $1
          AND nursing_tasks.patient_id = patients.id
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
        DELETE FROM visits
        USING patients
        WHERE visits.facility_id = $1
          AND patients.facility_id = $1
          AND visits.patient_id = patients.id
          AND patients.patient_code ~ '^DEMO-[0-9]{4}$'
        "#,
        r#"
        DELETE FROM appointments
        USING patients
        WHERE appointments.facility_id = $1
          AND patients.facility_id = $1
          AND appointments.patient_id = patients.id
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
        DELETE FROM handoffs
        WHERE handoffs.facility_id = $1
          AND handoffs.id >= 'd8500000-0000-0000-0000-000000000000'::uuid
          AND handoffs.id < 'd8500000-0000-0000-0000-000001000000'::uuid
        "#,
        r#"
        DELETE FROM ward_stock_requests
        WHERE ward_stock_requests.facility_id = $1
          AND ward_stock_requests.id >= 'd8400000-0000-0000-0000-000000000000'::uuid
          AND ward_stock_requests.id < 'd8400000-0000-0000-0000-000001000000'::uuid
        "#,
        r#"
        DELETE FROM beds
        WHERE beds.facility_id = $1
          AND beds.id >= 'd1100000-0000-0000-0000-000000000000'::uuid
          AND beds.id < 'd1100000-0000-0000-0000-000000010000'::uuid
        "#,
        r#"
        DELETE FROM ward_sections
        WHERE ward_sections.facility_id = $1
          AND ward_sections.id >= 'd1000000-0000-0000-0000-000000000100'::uuid
          AND ward_sections.id < 'd1000000-0000-0000-0000-000000000200'::uuid
        "#,
        r#"
        DELETE FROM wards
        WHERE facility_id = $1
          AND id >= 'd1000000-0000-0000-0000-000000000000'::uuid
          AND id < 'd1000000-0000-0000-0000-000000000100'::uuid
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

#[allow(dead_code)]
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

#[allow(dead_code)]
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

#[allow(dead_code)]
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

#[allow(dead_code)]
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

#[allow(dead_code)]
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

#[allow(dead_code)]
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

#[allow(dead_code)]
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

#[allow(dead_code)]
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

#[allow(dead_code)]
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
#[allow(dead_code)]
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

#[allow(dead_code)]
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
#[allow(dead_code)]
struct DemoLabResult {
    test_id: Uuid,
    value: &'static str,
    unit: Option<&'static str>,
}

#[derive(Debug)]
#[allow(dead_code)]
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

#[allow(dead_code)]
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

#[allow(dead_code)]
fn demo_date(value: (i32, u32, u32)) -> NaiveDate {
    NaiveDate::from_ymd_opt(value.0, value.1, value.2).expect("static demo seed date is valid")
}

fn demo_time(offset_minutes: i64) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339("2026-05-20T08:00:00Z")
        .expect("static demo seed timestamp is valid")
        .with_timezone(&Utc)
        + Duration::minutes(offset_minutes)
}

const CHRONICLE_DEMO_INPATIENT_SEQUENCE: u32 = 90;

#[derive(Clone, Debug)]
struct ChronicleDemoPatient {
    ordinal: u32,
    archetype: ChronicleDemoArchetype,
    first_name: String,
    last_name: String,
    date_of_birth: NaiveDate,
    sex: Sex,
    outpatient_count: u32,
    problem_onset: NaiveDate,
    admission: Option<ChronicleDemoAdmission>,
}

impl ChronicleDemoPatient {
    fn patient_code(&self) -> String {
        format!("DEMO-{:04}", self.ordinal)
    }

    fn patient_id(&self) -> Uuid {
        demo_uuid(DEMO_PATIENT_BASE_ID, self.ordinal)
    }

    fn admission_id(&self) -> Uuid {
        demo_uuid(DEMO_ADMISSION_BASE_ID, self.ordinal)
    }

    fn appointment_id(&self, sequence: u32) -> Uuid {
        demo_graph_uuid(DEMO_APPOINTMENT_BASE_ID, self.ordinal, sequence)
    }

    fn visit_id(&self, sequence: u32) -> Uuid {
        demo_graph_uuid(DEMO_VISIT_BASE_ID, self.ordinal, sequence)
    }

    fn encounter_id(&self, sequence: u32) -> Uuid {
        demo_graph_uuid(DEMO_ENCOUNTER_BASE_ID, self.ordinal, sequence)
    }

    fn outpatient_time(&self, sequence: u32) -> DateTime<Utc> {
        let spacing_days = 730_i64 / i64::from(self.outpatient_count.max(1));
        demo_chronicle_anchor()
            - Duration::days(spacing_days * i64::from(self.outpatient_count - sequence + 1))
            + Duration::minutes(i64::from(self.ordinal * 3 + sequence))
    }

    fn latest_event_at(&self) -> DateTime<Utc> {
        self.admission
            .as_ref()
            .filter(|admission| admission.is_active())
            .map(|admission| admission.admitted_at + Duration::hours(30))
            .unwrap_or_else(|| self.outpatient_time(self.outpatient_count) + Duration::hours(2))
    }

    fn selected_lab_codes(&self, sequence: u32) -> Vec<&'static str> {
        let mut selected = Vec::new();
        if let Some(code) = self.archetype.lab_codes.first() {
            selected.push(*code);
        }
        if self.archetype.lab_codes.len() > 1 {
            selected.push(
                self.archetype.lab_codes
                    [((self.ordinal + sequence) as usize) % self.archetype.lab_codes.len()],
            );
        }
        selected.sort_unstable();
        selected.dedup();
        selected
    }

    fn invoice_amount_minor(&self, sequence: u32) -> i64 {
        self.archetype.base_invoice_minor + (i64::from((self.ordinal + sequence) % 4) * 1_000)
    }
}

#[derive(Clone, Copy, Debug)]
struct ChronicleDemoAdmission {
    status: &'static str,
    ward: ChronicleDemoWard,
    bed_ordinal: Option<u32>,
    admitted_at: DateTime<Utc>,
    discharged_at: Option<DateTime<Utc>>,
}

impl ChronicleDemoAdmission {
    fn is_active(self) -> bool {
        matches!(self.status, "admitted" | "discharge_pending")
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
struct ChronicleDemoWard {
    index: u32,
    code: &'static str,
    name: &'static str,
    bed_prefix: &'static str,
}

impl ChronicleDemoWard {
    fn id(self) -> Uuid {
        demo_uuid(DEMO_WARD_BASE_ID, self.index)
    }

    fn section_id(self) -> Uuid {
        demo_uuid(DEMO_SECTION_BASE_ID, self.index)
    }

    fn bed_id(self, bed_ordinal: u32) -> Uuid {
        demo_uuid(DEMO_BED_BASE_ID, self.index * 1_000 + bed_ordinal)
    }
}

#[derive(Clone, Debug)]
struct ChronicleDemoArchetype {
    key: &'static str,
    label: &'static str,
    op_min: u16,
    op_max: u16,
    admission_probability_per_year: u32,
    sex_rule: ChronicleDemoSexRule,
    age_min: u16,
    age_max: u16,
    lab_codes: &'static [&'static str],
    sbp: (i32, i32),
    dbp: (i32, i32),
    pulse: (i32, i32),
    temp_tenths: (i32, i32),
    spo2_base: i32,
    problem_label: &'static str,
    medication_name: &'static str,
    medication_dose: &'static str,
    medication_frequency: &'static str,
    nursing_instruction: &'static str,
    ward_round_plan: &'static str,
    complaints: &'static [&'static str],
    icd_codes: &'static [&'static str],
    ward: ChronicleDemoWard,
    allergy: Option<DemoAllergy>,
    urgent_labs: bool,
    claimable: bool,
    base_invoice_minor: i64,
}

#[derive(Clone, Copy, Debug)]
enum ChronicleDemoSexRule {
    Any,
    Female,
    Pediatric,
}

#[derive(Debug)]
struct ChronicleDemoVitals {
    blood_pressure: String,
    pulse: String,
    respiratory_rate: String,
    oxygen_saturation: String,
    temperature: String,
}

#[derive(Debug)]
struct ChronicleDemoObservationValues {
    systolic_bp: i32,
    diastolic_bp: i32,
    pulse: i32,
    respiratory_rate: i32,
    oxygen_saturation: i32,
    temperature_c: f32,
}

async fn seed_chronicle_demo_ward_resources(
    transaction: &mut Transaction<'_, Postgres>,
    baseline: &BaselineProvisioning,
    config: DemoSeedConfig,
    journeys: &[ChronicleDemoPatient],
) -> anyhow::Result<()> {
    let owner_user_id = Uuid::from_u128(OWNER_USER_ID);
    let occupied_beds: HashSet<(ChronicleDemoWard, u32)> = journeys
        .iter()
        .filter_map(|journey| {
            journey
                .admission
                .as_ref()
                .and_then(|admission| admission.bed_ordinal.map(|bed| (admission.ward, bed)))
        })
        .collect();

    for ward in chronicle_demo_wards() {
        sqlx::query(
            r#"
            INSERT INTO wards (id, facility_id, code, name, status)
            VALUES ($1, $2, $3, $4, 'active')
            ON CONFLICT (facility_id, code) DO UPDATE
            SET id = EXCLUDED.id,
                name = EXCLUDED.name,
                status = EXCLUDED.status,
                updated_at = now()
            "#,
        )
        .bind(ward.id())
        .bind(baseline.facility_id)
        .bind(ward.code)
        .bind(ward.name)
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
            VALUES ($1, $2, $3, $4, $5, 'active', $6)
            ON CONFLICT (ward_id, code) DO UPDATE
            SET id = EXCLUDED.id,
                name = EXCLUDED.name,
                status = EXCLUDED.status,
                created_by_user_id = EXCLUDED.created_by_user_id,
                updated_at = now()
            "#,
        )
        .bind(ward.section_id())
        .bind(baseline.facility_id)
        .bind(ward.id())
        .bind(format!("DEMO-{}", ward.bed_prefix))
        .bind(format!("{} Section", ward.name))
        .bind(owner_user_id)
        .execute(&mut **transaction)
        .await?;

        for bed_ordinal in 1..=config.beds_per_ward {
            let occupied = occupied_beds.contains(&(ward, bed_ordinal));
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
            .bind(ward.bed_id(bed_ordinal))
            .bind(baseline.facility_id)
            .bind(ward.id())
            .bind(ward.section_id())
            .bind(format!("{}-{bed_ordinal:02}", ward.bed_prefix))
            .bind(if occupied { "occupied" } else { "available" })
            .bind(owner_user_id)
            .execute(&mut **transaction)
            .await?;
        }
    }

    Ok(())
}

async fn seed_chronicle_demo_patient_graph(
    transaction: &mut Transaction<'_, Postgres>,
    baseline: &BaselineProvisioning,
    journeys: &[ChronicleDemoPatient],
) -> anyhow::Result<()> {
    for journey in journeys {
        seed_chronicle_demo_patient_journey(transaction, baseline, journey).await?;
    }
    Ok(())
}

async fn seed_chronicle_demo_patient_journey(
    transaction: &mut Transaction<'_, Postgres>,
    baseline: &BaselineProvisioning,
    journey: &ChronicleDemoPatient,
) -> anyhow::Result<()> {
    let owner_user_id = Uuid::from_u128(OWNER_USER_ID);
    let created_at = demo_time(i64::from(journey.ordinal));
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
    .bind(journey.patient_id())
    .bind(baseline.facility_id)
    .bind(journey.patient_code())
    .bind(&journey.first_name)
    .bind(&journey.last_name)
    .bind(journey.date_of_birth)
    .bind(codec::encode(journey.sex.clone())?)
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
    .bind(demo_uuid(DEMO_CONTEXT_BASE_ID, journey.ordinal))
    .bind(baseline.facility_id)
    .bind(owner_user_id)
    .bind(journey.patient_id())
    .bind(codec::encode(PatientContextKind::Assigned)?)
    .bind(format!("demo-seed: {}", journey.archetype.label))
    .bind(created_at)
    .execute(&mut **transaction)
    .await?;

    seed_chronicle_demo_problem_and_allergy(transaction, baseline, journey).await?;
    for sequence in 1..=journey.outpatient_count {
        seed_chronicle_demo_outpatient(transaction, baseline, journey, sequence).await?;
    }
    if let Some(admission) = &journey.admission {
        seed_chronicle_demo_admission(transaction, baseline, journey, admission).await?;
    }

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
    .bind(journey.patient_id())
    .bind(baseline.facility_id)
    .bind(journey.latest_event_at())
    .execute(&mut **transaction)
    .await?;

    Ok(())
}

async fn seed_chronicle_demo_problem_and_allergy(
    transaction: &mut Transaction<'_, Postgres>,
    baseline: &BaselineProvisioning,
    journey: &ChronicleDemoPatient,
) -> anyhow::Result<()> {
    let owner_user_id = Uuid::from_u128(OWNER_USER_ID);
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
    .bind(demo_uuid(DEMO_PROBLEM_BASE_ID, journey.ordinal))
    .bind(baseline.facility_id)
    .bind(journey.patient_id())
    .bind(journey.archetype.problem_label)
    .bind(journey.problem_onset)
    .bind(owner_user_id)
    .bind(demo_time(30 + i64::from(journey.ordinal)))
    .execute(&mut **transaction)
    .await?;

    if let Some(allergy) = journey.archetype.allergy {
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
        .bind(demo_uuid(DEMO_ALLERGY_BASE_ID, journey.ordinal))
        .bind(baseline.facility_id)
        .bind(journey.patient_id())
        .bind(allergy.substance)
        .bind(allergy.reaction)
        .bind(allergy.severity)
        .bind(owner_user_id)
        .bind(demo_time(31 + i64::from(journey.ordinal)))
        .execute(&mut **transaction)
        .await?;
    }
    Ok(())
}

async fn seed_chronicle_demo_outpatient(
    transaction: &mut Transaction<'_, Postgres>,
    baseline: &BaselineProvisioning,
    journey: &ChronicleDemoPatient,
    sequence: u32,
) -> anyhow::Result<()> {
    let owner_user_id = Uuid::from_u128(OWNER_USER_ID);
    let starts_at = journey.outpatient_time(sequence);
    let ends_at = starts_at + Duration::minutes(35);
    let appointment_id = journey.appointment_id(sequence);
    let visit_id = journey.visit_id(sequence);
    let encounter_id = journey.encounter_id(sequence);

    sqlx::query(
        r#"
        INSERT INTO appointments (
            id,
            facility_id,
            patient_id,
            clinic_id,
            starts_at,
            ends_at,
            status,
            created_by_user_id,
            created_at,
            updated_at,
            appointment_type_id,
            practitioner_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'completed', $7, $5, $6, $8, $7)
        ON CONFLICT (id) DO UPDATE
        SET starts_at = EXCLUDED.starts_at,
            ends_at = EXCLUDED.ends_at,
            status = EXCLUDED.status,
            appointment_type_id = EXCLUDED.appointment_type_id,
            practitioner_user_id = EXCLUDED.practitioner_user_id,
            updated_at = EXCLUDED.updated_at
        "#,
    )
    .bind(appointment_id)
    .bind(baseline.facility_id)
    .bind(journey.patient_id())
    .bind(Uuid::from_u128(DEFAULT_CLINIC_ID))
    .bind(starts_at)
    .bind(ends_at)
    .bind(owner_user_id)
    .bind(Uuid::from_u128(DEFAULT_APPOINTMENT_TYPE_GENERAL_ID))
    .execute(&mut **transaction)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO visits (
            id,
            facility_id,
            patient_id,
            appointment_id,
            clinic_id,
            status,
            checked_in_at,
            called_at,
            consultation_started_at,
            checked_out_at,
            created_by_user_id,
            created_at,
            updated_at
        )
        VALUES ($1, $2, $3, $4, $5, 'checked_out', $6, $7, $8, $9, $10, $6, $9)
        ON CONFLICT (id) DO UPDATE
        SET appointment_id = EXCLUDED.appointment_id,
            status = EXCLUDED.status,
            checked_in_at = EXCLUDED.checked_in_at,
            called_at = EXCLUDED.called_at,
            consultation_started_at = EXCLUDED.consultation_started_at,
            checked_out_at = EXCLUDED.checked_out_at,
            updated_at = EXCLUDED.updated_at
        "#,
    )
    .bind(visit_id)
    .bind(baseline.facility_id)
    .bind(journey.patient_id())
    .bind(appointment_id)
    .bind(Uuid::from_u128(DEFAULT_CLINIC_ID))
    .bind(starts_at - Duration::minutes(10))
    .bind(starts_at)
    .bind(starts_at + Duration::minutes(8))
    .bind(ends_at)
    .bind(owner_user_id)
    .execute(&mut **transaction)
    .await?;

    seed_chronicle_demo_encounter(
        transaction,
        baseline,
        journey,
        encounter_id,
        Some(visit_id),
        sequence,
        "outpatient",
        "finished",
        starts_at + Duration::minutes(8),
        Some(ends_at),
    )
    .await?;
    seed_chronicle_demo_note(
        transaction,
        baseline,
        journey,
        encounter_id,
        sequence,
        "progress_note",
        starts_at + Duration::minutes(20),
    )
    .await?;
    seed_chronicle_demo_chart_entries(
        transaction,
        baseline,
        journey,
        sequence,
        starts_at + Duration::minutes(12),
    )
    .await?;
    seed_chronicle_demo_prescription(
        transaction,
        baseline,
        journey,
        sequence,
        starts_at + Duration::minutes(24),
    )
    .await?;
    seed_chronicle_demo_labs(
        transaction,
        baseline,
        journey,
        sequence,
        starts_at + Duration::minutes(25),
    )
    .await?;
    seed_chronicle_demo_billing(
        transaction,
        baseline,
        journey,
        sequence,
        starts_at + Duration::minutes(32),
    )
    .await?;
    Ok(())
}

async fn seed_chronicle_demo_encounter(
    transaction: &mut Transaction<'_, Postgres>,
    baseline: &BaselineProvisioning,
    journey: &ChronicleDemoPatient,
    encounter_id: Uuid,
    visit_id: Option<Uuid>,
    sequence: u32,
    encounter_type: &'static str,
    status: &'static str,
    started_at: DateTime<Utc>,
    ended_at: Option<DateTime<Utc>>,
) -> anyhow::Result<()> {
    let owner_user_id = Uuid::from_u128(OWNER_USER_ID);
    sqlx::query(
        r#"
        INSERT INTO encounters (
            id,
            facility_id,
            patient_id,
            visit_id,
            encounter_type,
            status,
            started_at,
            ended_at,
            created_by_user_id,
            created_at,
            updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $7, COALESCE($8, $7))
        ON CONFLICT (id) DO UPDATE
        SET visit_id = EXCLUDED.visit_id,
            encounter_type = EXCLUDED.encounter_type,
            status = EXCLUDED.status,
            started_at = EXCLUDED.started_at,
            ended_at = EXCLUDED.ended_at,
            updated_at = EXCLUDED.updated_at
        "#,
    )
    .bind(encounter_id)
    .bind(baseline.facility_id)
    .bind(journey.patient_id())
    .bind(visit_id)
    .bind(encounter_type)
    .bind(status)
    .bind(started_at)
    .bind(ended_at)
    .bind(owner_user_id)
    .execute(&mut **transaction)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO encounter_care_team_assignments (
            id,
            encounter_id,
            user_id,
            role,
            is_active,
            created_by_user_id,
            created_at
        )
        VALUES ($1, $2, $3, 'attending', TRUE, $3, $4)
        ON CONFLICT (encounter_id, user_id, role) DO UPDATE
        SET is_active = TRUE
        "#,
    )
    .bind(demo_graph_uuid(
        DEMO_CARE_TEAM_BASE_ID,
        journey.ordinal,
        sequence,
    ))
    .bind(encounter_id)
    .bind(owner_user_id)
    .bind(started_at)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn seed_chronicle_demo_note(
    transaction: &mut Transaction<'_, Postgres>,
    baseline: &BaselineProvisioning,
    journey: &ChronicleDemoPatient,
    encounter_id: Uuid,
    sequence: u32,
    note_type: &'static str,
    note_time: DateTime<Utc>,
) -> anyhow::Result<()> {
    let owner_user_id = Uuid::from_u128(OWNER_USER_ID);
    let body = chronicle_demo_note_body(journey, sequence);
    let note_id = demo_graph_uuid(DEMO_NOTE_BASE_ID, journey.ordinal, sequence);
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
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'signed', 1, $8, $9, $9)
        ON CONFLICT (id) DO UPDATE
        SET encounter_id = EXCLUDED.encounter_id,
            note_type = EXCLUDED.note_type,
            title = EXCLUDED.title,
            body = EXCLUDED.body,
            status = EXCLUDED.status,
            version = EXCLUDED.version,
            updated_at = EXCLUDED.updated_at
        "#,
    )
    .bind(note_id)
    .bind(baseline.facility_id)
    .bind(journey.patient_id())
    .bind(encounter_id)
    .bind(note_type)
    .bind(format!(
        "Synthetic {} review {}",
        journey.archetype.label, sequence
    ))
    .bind(&body)
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
    .bind(demo_graph_uuid(
        DEMO_NOTE_VERSION_BASE_ID,
        journey.ordinal,
        sequence,
    ))
    .bind(note_id)
    .bind(body)
    .bind(owner_user_id)
    .bind(note_time)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn seed_chronicle_demo_chart_entries(
    transaction: &mut Transaction<'_, Postgres>,
    baseline: &BaselineProvisioning,
    journey: &ChronicleDemoPatient,
    sequence: u32,
    measured_at: DateTime<Utc>,
) -> anyhow::Result<()> {
    let owner_user_id = Uuid::from_u128(OWNER_USER_ID);
    let vitals = chronicle_demo_vitals(journey, sequence);
    for (entry_index, (entry_type, value, unit)) in [
        ("blood_pressure", vitals.blood_pressure, Some("mmHg")),
        ("pulse", vitals.pulse, Some("bpm")),
        ("respiratory_rate", vitals.respiratory_rate, Some("/min")),
        ("oxygen_saturation", vitals.oxygen_saturation, Some("%")),
        ("temperature", vitals.temperature, Some("C")),
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
        .bind(demo_compound_uuid(
            DEMO_CHART_ENTRY_BASE_ID,
            journey.ordinal,
            sequence,
            entry_index as u32 + 1,
        ))
        .bind(baseline.facility_id)
        .bind(journey.patient_id())
        .bind(entry_type)
        .bind(measured_at + Duration::minutes(i64::try_from(entry_index).unwrap_or(0)))
        .bind(value)
        .bind(unit)
        .bind(owner_user_id)
        .execute(&mut **transaction)
        .await?;
    }
    Ok(())
}

async fn seed_chronicle_demo_prescription(
    transaction: &mut Transaction<'_, Postgres>,
    baseline: &BaselineProvisioning,
    journey: &ChronicleDemoPatient,
    sequence: u32,
    prescribed_at: DateTime<Utc>,
) -> anyhow::Result<()> {
    let owner_user_id = Uuid::from_u128(OWNER_USER_ID);
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
    .bind(demo_graph_uuid(
        DEMO_PRESCRIPTION_BASE_ID,
        journey.ordinal,
        sequence,
    ))
    .bind(baseline.facility_id)
    .bind(journey.patient_id())
    .bind(journey.archetype.medication_name)
    .bind(journey.archetype.medication_dose)
    .bind(journey.archetype.medication_frequency)
    .bind(prescribed_at)
    .bind(owner_user_id)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn seed_chronicle_demo_labs(
    transaction: &mut Transaction<'_, Postgres>,
    baseline: &BaselineProvisioning,
    journey: &ChronicleDemoPatient,
    sequence: u32,
    order_time: DateTime<Utc>,
) -> anyhow::Result<()> {
    let owner_user_id = Uuid::from_u128(OWNER_USER_ID);
    let order_id = demo_graph_uuid(DEMO_LAB_ORDER_BASE_ID, journey.ordinal, sequence);
    let specimen_id = demo_graph_uuid(DEMO_LAB_SPECIMEN_BASE_ID, journey.ordinal, sequence);
    let selected_tests = journey.selected_lab_codes(sequence);

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
    .bind(order_id)
    .bind(baseline.facility_id)
    .bind(journey.patient_id())
    .bind(if journey.archetype.urgent_labs {
        "urgent"
    } else {
        "routine"
    })
    .bind(owner_user_id)
    .bind(order_time)
    .execute(&mut **transaction)
    .await?;

    for code in &selected_tests {
        sqlx::query(
            "INSERT INTO lab_order_tests (order_id, test_id) VALUES ($1, $2) ON CONFLICT (order_id, test_id) DO NOTHING",
        )
        .bind(order_id)
        .bind(chronicle_demo_lab_test_id(code))
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
    .bind(order_id)
    .bind(journey.patient_id())
    .bind(owner_user_id)
    .bind(order_time + Duration::minutes(20))
    .execute(&mut **transaction)
    .await?;

    for (index, code) in selected_tests.iter().enumerate() {
        let (value, unit) = chronicle_demo_lab_value(code, journey, sequence);
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
        .bind(demo_compound_uuid(
            DEMO_LAB_RESULT_BASE_ID,
            journey.ordinal,
            sequence,
            index as u32 + 1,
        ))
        .bind(baseline.facility_id)
        .bind(order_id)
        .bind(specimen_id)
        .bind(journey.patient_id())
        .bind(chronicle_demo_lab_test_id(code))
        .bind(value)
        .bind(unit)
        .bind(owner_user_id)
        .bind(order_time + Duration::minutes(50))
        .bind(order_time + Duration::minutes(60))
        .execute(&mut **transaction)
        .await?;
    }
    Ok(())
}

async fn seed_chronicle_demo_billing(
    transaction: &mut Transaction<'_, Postgres>,
    baseline: &BaselineProvisioning,
    journey: &ChronicleDemoPatient,
    sequence: u32,
    issued_at: DateTime<Utc>,
) -> anyhow::Result<()> {
    let owner_user_id = Uuid::from_u128(OWNER_USER_ID);
    let invoice_id = demo_graph_uuid(DEMO_INVOICE_BASE_ID, journey.ordinal, sequence);
    let amount_minor = journey.invoice_amount_minor(sequence);
    let paid_amount_minor = match (journey.ordinal + sequence) % 5 {
        0 => 0,
        1 => amount_minor / 2,
        _ => amount_minor,
    };
    let status = if paid_amount_minor == amount_minor {
        "paid"
    } else if paid_amount_minor > 0 {
        "partially_paid"
    } else {
        "issued"
    };

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
    .bind(journey.patient_id())
    .bind(format!("DEMO-{:06}", journey.ordinal * 100 + sequence))
    .bind(status)
    .bind(amount_minor)
    .bind(paid_amount_minor)
    .bind(owner_user_id)
    .bind(issued_at)
    .execute(&mut **transaction)
    .await?;

    for (line_index, (service_price_id, description, line_amount)) in [
        (
            Uuid::from_u128(DEFAULT_PRICE_CONSULTATION_ID),
            format!("Synthetic {} consultation", journey.archetype.label),
            amount_minor / 2,
        ),
        (
            Uuid::from_u128(DEFAULT_PRICE_LAB_FBC_ID),
            "Synthetic lab bundle".to_owned(),
            amount_minor / 3,
        ),
        (
            Uuid::from_u128(DEFAULT_PRICE_MEDICATION_ID),
            "Synthetic medication dispense".to_owned(),
            amount_minor - (amount_minor / 2) - (amount_minor / 3),
        ),
    ]
    .into_iter()
    .enumerate()
    {
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
        .bind(demo_compound_uuid(
            DEMO_INVOICE_LINE_BASE_ID,
            journey.ordinal,
            sequence,
            line_index as u32 + 1,
        ))
        .bind(baseline.facility_id)
        .bind(invoice_id)
        .bind(service_price_id)
        .bind(description)
        .bind(line_amount)
        .bind(issued_at)
        .execute(&mut **transaction)
        .await?;
    }

    if paid_amount_minor > 0 {
        seed_chronicle_demo_payment(
            transaction,
            baseline,
            journey,
            sequence,
            invoice_id,
            paid_amount_minor,
            issued_at + Duration::minutes(5),
        )
        .await?;
    }

    if journey.archetype.claimable && (journey.ordinal + sequence) % 3 == 0 {
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
            VALUES ($1, $2, $3, $4, $5, 'submitted', $6, $6, 0, 0, 'GHS', $7, $8, $8)
            ON CONFLICT (facility_id, claim_number) DO UPDATE
            SET status = EXCLUDED.status,
                amount_minor = EXCLUDED.amount_minor,
                payer_receivable_minor = EXCLUDED.payer_receivable_minor,
                patient_liability_minor = EXCLUDED.patient_liability_minor,
                written_off_minor = EXCLUDED.written_off_minor,
                updated_at = EXCLUDED.updated_at
            "#,
        )
        .bind(demo_graph_uuid(
            DEMO_NHIS_CLAIM_BASE_ID,
            journey.ordinal,
            sequence,
        ))
        .bind(baseline.facility_id)
        .bind(invoice_id)
        .bind(journey.patient_id())
        .bind(format!("DEMO-CLM-{:06}", journey.ordinal * 100 + sequence))
        .bind(amount_minor - paid_amount_minor)
        .bind(owner_user_id)
        .bind(issued_at + Duration::minutes(8))
        .execute(&mut **transaction)
        .await?;
    }
    Ok(())
}

async fn seed_chronicle_demo_payment(
    transaction: &mut Transaction<'_, Postgres>,
    baseline: &BaselineProvisioning,
    journey: &ChronicleDemoPatient,
    sequence: u32,
    invoice_id: Uuid,
    amount_minor: i64,
    paid_at: DateTime<Utc>,
) -> anyhow::Result<()> {
    let owner_user_id = Uuid::from_u128(OWNER_USER_ID);
    let receipt_number = format!("DEMO-RCPT-{:06}", journey.ordinal * 100 + sequence);
    let payment_id = demo_graph_uuid(DEMO_PAYMENT_BASE_ID, journey.ordinal, sequence);
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
    .bind(amount_minor)
    .bind(owner_user_id)
    .bind(paid_at)
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
    .bind(demo_graph_uuid(
        DEMO_RECEIPT_BASE_ID,
        journey.ordinal,
        sequence,
    ))
    .bind(baseline.facility_id)
    .bind(payment_id)
    .bind(invoice_id)
    .bind(receipt_number)
    .bind(amount_minor)
    .bind(paid_at + Duration::minutes(1))
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn seed_chronicle_demo_admission(
    transaction: &mut Transaction<'_, Postgres>,
    baseline: &BaselineProvisioning,
    journey: &ChronicleDemoPatient,
    admission: &ChronicleDemoAdmission,
) -> anyhow::Result<()> {
    let owner_user_id = Uuid::from_u128(OWNER_USER_ID);
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
            discharged_at,
            attending_user_id,
            created_by_user_id,
            created_at,
            updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $7, COALESCE($8, $7))
        ON CONFLICT (id) DO UPDATE
        SET ward_id = EXCLUDED.ward_id,
            bed_id = EXCLUDED.bed_id,
            status = EXCLUDED.status,
            admitted_at = EXCLUDED.admitted_at,
            discharged_at = EXCLUDED.discharged_at,
            attending_user_id = EXCLUDED.attending_user_id,
            created_by_user_id = EXCLUDED.created_by_user_id,
            updated_at = EXCLUDED.updated_at
        "#,
    )
    .bind(journey.admission_id())
    .bind(baseline.facility_id)
    .bind(journey.patient_id())
    .bind(admission.ward.id())
    .bind(admission.bed_ordinal.map(|bed| admission.ward.bed_id(bed)))
    .bind(admission.status)
    .bind(admission.admitted_at)
    .bind(admission.discharged_at)
    .bind(owner_user_id)
    .execute(&mut **transaction)
    .await?;

    seed_chronicle_demo_encounter(
        transaction,
        baseline,
        journey,
        journey.encounter_id(CHRONICLE_DEMO_INPATIENT_SEQUENCE),
        None,
        CHRONICLE_DEMO_INPATIENT_SEQUENCE,
        "inpatient",
        if admission.is_active() {
            "in_progress"
        } else {
            "finished"
        },
        admission.admitted_at + Duration::minutes(20),
        admission.discharged_at,
    )
    .await?;
    seed_chronicle_demo_note(
        transaction,
        baseline,
        journey,
        journey.encounter_id(CHRONICLE_DEMO_INPATIENT_SEQUENCE),
        CHRONICLE_DEMO_INPATIENT_SEQUENCE,
        "admission_note",
        admission.admitted_at + Duration::minutes(50),
    )
    .await?;

    for (task_index, (task_type, title, instruction)) in [
        (
            "observation",
            "Four-hourly observations",
            journey.archetype.nursing_instruction,
        ),
        (
            "ward_round",
            "Prepare for ward round",
            "Have recent vitals, labs, and medication chart ready for review.",
        ),
        (
            "medication",
            "Prepare medication administration",
            "Confirm allergy and medication chart before administration.",
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
            journey.ordinal * 10 + task_index as u32 + 1,
        ))
        .bind(baseline.facility_id)
        .bind(journey.admission_id())
        .bind(journey.patient_id())
        .bind(admission.ward.id())
        .bind(task_type)
        .bind(title)
        .bind(instruction)
        .bind(admission.admitted_at + Duration::hours(i64::try_from(task_index + 1).unwrap_or(1)))
        .bind(owner_user_id)
        .bind(admission.admitted_at)
        .execute(&mut **transaction)
        .await?;
    }

    for med_index in 1..=2 {
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
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10, $10)
            ON CONFLICT (id) DO UPDATE
            SET medication_name = EXCLUDED.medication_name,
                scheduled_at = EXCLUDED.scheduled_at,
                administered_at = EXCLUDED.administered_at,
                status = EXCLUDED.status,
                updated_at = EXCLUDED.updated_at
            "#,
        )
        .bind(demo_graph_uuid(
            DEMO_MED_ADMIN_BASE_ID,
            journey.ordinal,
            med_index,
        ))
        .bind(baseline.facility_id)
        .bind(journey.admission_id())
        .bind(journey.patient_id())
        .bind(journey.archetype.medication_name)
        .bind(admission.admitted_at + Duration::hours(i64::from(med_index * 8)))
        .bind(if med_index == 1 {
            Some(admission.admitted_at + Duration::hours(8))
        } else {
            None
        })
        .bind(if med_index == 1 {
            "administered"
        } else {
            "scheduled"
        })
        .bind(owner_user_id)
        .bind(admission.admitted_at)
        .execute(&mut **transaction)
        .await?;
    }

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
        VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $7)
        ON CONFLICT (admission_case_id, sheet_date) DO UPDATE
        SET status = EXCLUDED.status,
            updated_at = EXCLUDED.updated_at
        "#,
    )
    .bind(demo_uuid(DEMO_TREATMENT_SHEET_BASE_ID, journey.ordinal))
    .bind(baseline.facility_id)
    .bind(journey.admission_id())
    .bind(journey.patient_id())
    .bind(admission.admitted_at.date_naive())
    .bind(owner_user_id)
    .bind(admission.admitted_at)
    .execute(&mut **transaction)
    .await?;

    seed_chronicle_demo_inpatient_operations(transaction, baseline, journey, admission).await?;

    for day in 1..=3 {
        seed_chronicle_demo_chart_entries(
            transaction,
            baseline,
            journey,
            CHRONICLE_DEMO_INPATIENT_SEQUENCE + day,
            admission.admitted_at + Duration::days(i64::from(day - 1)) + Duration::hours(8),
        )
        .await?;
    }
    seed_chronicle_demo_prescription(
        transaction,
        baseline,
        journey,
        CHRONICLE_DEMO_INPATIENT_SEQUENCE,
        admission.admitted_at + Duration::hours(2),
    )
    .await?;
    seed_chronicle_demo_labs(
        transaction,
        baseline,
        journey,
        CHRONICLE_DEMO_INPATIENT_SEQUENCE,
        admission.admitted_at + Duration::hours(3),
    )
    .await?;
    seed_chronicle_demo_billing(
        transaction,
        baseline,
        journey,
        CHRONICLE_DEMO_INPATIENT_SEQUENCE,
        admission.admitted_at + Duration::hours(5),
    )
    .await?;

    if admission.status == "discharged" || admission.status == "discharge_pending" {
        seed_chronicle_demo_discharge_case(transaction, baseline, journey, admission).await?;
    }
    if admission.is_active() {
        seed_chronicle_demo_ward_rounds(transaction, baseline, journey, admission).await?;
    }
    Ok(())
}

async fn seed_chronicle_demo_discharge_case(
    transaction: &mut Transaction<'_, Postgres>,
    baseline: &BaselineProvisioning,
    journey: &ChronicleDemoPatient,
    admission: &ChronicleDemoAdmission,
) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO discharge_cases (
            id,
            facility_id,
            admission_case_id,
            patient_id,
            status,
            requested_at,
            discharged_at,
            created_by_user_id,
            updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $6)
        ON CONFLICT (admission_case_id) DO UPDATE
        SET status = EXCLUDED.status,
            requested_at = EXCLUDED.requested_at,
            discharged_at = EXCLUDED.discharged_at,
            updated_at = EXCLUDED.updated_at
        "#,
    )
    .bind(demo_uuid(DEMO_DISCHARGE_CASE_BASE_ID, journey.ordinal))
    .bind(baseline.facility_id)
    .bind(journey.admission_id())
    .bind(journey.patient_id())
    .bind(if admission.status == "discharged" {
        "completed"
    } else {
        "requested"
    })
    .bind(admission.admitted_at + Duration::days(1))
    .bind(admission.discharged_at)
    .bind(Uuid::from_u128(OWNER_USER_ID))
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn seed_chronicle_demo_inpatient_operations(
    transaction: &mut Transaction<'_, Postgres>,
    baseline: &BaselineProvisioning,
    journey: &ChronicleDemoPatient,
    admission: &ChronicleDemoAdmission,
) -> anyhow::Result<()> {
    let owner_user_id = Uuid::from_u128(OWNER_USER_ID);
    let handoff_to_user_id = Uuid::from_u128(LIMITED_USER_ID);

    for observation_index in 1..=6 {
        let sequence = CHRONICLE_DEMO_INPATIENT_SEQUENCE + observation_index;
        let recorded_at = admission.admitted_at + Duration::hours(i64::from(observation_index * 6));
        let values = chronicle_demo_observation_values(journey, sequence);
        sqlx::query(
            r#"
            INSERT INTO patient_vitals (
                id,
                facility_id,
                admission_case_id,
                patient_id,
                recorded_at,
                temperature_c,
                systolic_bp,
                diastolic_bp,
                pulse,
                respiratory_rate,
                oxygen_saturation,
                recorded_by_user_id,
                created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $5)
            ON CONFLICT (id) DO UPDATE
            SET recorded_at = EXCLUDED.recorded_at,
                temperature_c = EXCLUDED.temperature_c,
                systolic_bp = EXCLUDED.systolic_bp,
                diastolic_bp = EXCLUDED.diastolic_bp,
                pulse = EXCLUDED.pulse,
                respiratory_rate = EXCLUDED.respiratory_rate,
                oxygen_saturation = EXCLUDED.oxygen_saturation,
                recorded_by_user_id = EXCLUDED.recorded_by_user_id
            "#,
        )
        .bind(demo_compound_uuid(
            DEMO_PATIENT_VITAL_BASE_ID,
            journey.ordinal,
            CHRONICLE_DEMO_INPATIENT_SEQUENCE,
            observation_index,
        ))
        .bind(baseline.facility_id)
        .bind(journey.admission_id())
        .bind(journey.patient_id())
        .bind(recorded_at)
        .bind(values.temperature_c)
        .bind(values.systolic_bp)
        .bind(values.diastolic_bp)
        .bind(values.pulse)
        .bind(values.respiratory_rate)
        .bind(values.oxygen_saturation)
        .bind(owner_user_id)
        .execute(&mut **transaction)
        .await?;
    }

    for (event_index, (event_kind, summary)) in [
        (
            MonitoringEventKind::Observation,
            format!(
                "Synthetic {} observations reviewed for ward escalation risk.",
                journey.archetype.label
            ),
        ),
        (
            MonitoringEventKind::Rounding,
            format!(
                "Synthetic {} care plan updated after labs, medication, and nursing review.",
                journey.archetype.label
            ),
        ),
    ]
    .into_iter()
    .enumerate()
    {
        let recorded_at =
            admission.admitted_at + Duration::hours(i64::try_from(event_index + 4).unwrap_or(4));
        sqlx::query(
            r#"
            INSERT INTO monitoring_events (
                id,
                facility_id,
                admission_case_id,
                patient_id,
                event_kind,
                summary,
                recorded_at,
                recorded_by_user_id,
                created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $7)
            ON CONFLICT (id) DO UPDATE
            SET event_kind = EXCLUDED.event_kind,
                summary = EXCLUDED.summary,
                recorded_at = EXCLUDED.recorded_at,
                recorded_by_user_id = EXCLUDED.recorded_by_user_id
            "#,
        )
        .bind(demo_compound_uuid(
            DEMO_MONITORING_EVENT_BASE_ID,
            journey.ordinal,
            CHRONICLE_DEMO_INPATIENT_SEQUENCE,
            event_index as u32 + 1,
        ))
        .bind(baseline.facility_id)
        .bind(journey.admission_id())
        .bind(journey.patient_id())
        .bind(codec::encode(event_kind)?)
        .bind(summary)
        .bind(recorded_at)
        .bind(owner_user_id)
        .execute(&mut **transaction)
        .await?;
    }

    if journey.archetype.urgent_labs
        || journey.archetype.spo2_base <= 94
        || admission.status == "discharge_pending"
    {
        let alert_created_at = admission.admitted_at + Duration::hours(2);
        let acknowledged_at =
            (!admission.is_active()).then_some(alert_created_at + Duration::hours(3));
        sqlx::query(
            r#"
            INSERT INTO nursing_alerts (
                id,
                facility_id,
                admission_case_id,
                patient_id,
                severity,
                title,
                status,
                created_by_user_id,
                acknowledged_by_user_id,
                acknowledged_at,
                created_at,
                updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
            ON CONFLICT (id) DO UPDATE
            SET severity = EXCLUDED.severity,
                title = EXCLUDED.title,
                status = EXCLUDED.status,
                acknowledged_by_user_id = EXCLUDED.acknowledged_by_user_id,
                acknowledged_at = EXCLUDED.acknowledged_at,
                updated_at = EXCLUDED.updated_at
            "#,
        )
        .bind(demo_uuid(DEMO_NURSING_ALERT_BASE_ID, journey.ordinal))
        .bind(baseline.facility_id)
        .bind(journey.admission_id())
        .bind(journey.patient_id())
        .bind(codec::encode(if journey.archetype.urgent_labs {
            NursingAlertSeverity::High
        } else {
            NursingAlertSeverity::Medium
        })?)
        .bind(format!(
            "Synthetic {} ward follow-up",
            journey.archetype.label
        ))
        .bind(codec::encode(if acknowledged_at.is_some() {
            NursingAlertStatus::Acknowledged
        } else {
            NursingAlertStatus::Open
        })?)
        .bind(owner_user_id)
        .bind(acknowledged_at.map(|_| owner_user_id))
        .bind(acknowledged_at)
        .bind(alert_created_at)
        .execute(&mut **transaction)
        .await?;
    }

    for entry_index in 1..=3 {
        let recorded_at = admission.admitted_at + Duration::hours(i64::from(entry_index * 8));
        let intake_ml = 450 + i32::try_from((journey.ordinal + entry_index) % 4).unwrap_or(0) * 75;
        let output_ml =
            300 + i32::try_from((journey.ordinal + entry_index * 2) % 4).unwrap_or(0) * 60;
        sqlx::query(
            r#"
            INSERT INTO fluid_balance_entries (
                id,
                facility_id,
                admission_case_id,
                patient_id,
                recorded_at,
                intake_ml,
                output_ml,
                recorded_by_user_id,
                created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $5)
            ON CONFLICT (id) DO UPDATE
            SET recorded_at = EXCLUDED.recorded_at,
                intake_ml = EXCLUDED.intake_ml,
                output_ml = EXCLUDED.output_ml,
                recorded_by_user_id = EXCLUDED.recorded_by_user_id
            "#,
        )
        .bind(demo_compound_uuid(
            DEMO_FLUID_BALANCE_BASE_ID,
            journey.ordinal,
            CHRONICLE_DEMO_INPATIENT_SEQUENCE,
            entry_index,
        ))
        .bind(baseline.facility_id)
        .bind(journey.admission_id())
        .bind(journey.patient_id())
        .bind(recorded_at)
        .bind(intake_ml)
        .bind(output_ml)
        .bind(owner_user_id)
        .execute(&mut **transaction)
        .await?;
    }

    let stock_requested_at = admission.admitted_at + Duration::hours(4);
    let stock_status = if admission.is_active() {
        WardStockRequestStatus::Approved
    } else {
        WardStockRequestStatus::Fulfilled
    };
    let stock_fulfilled_at =
        (!admission.is_active()).then_some(stock_requested_at + Duration::hours(2));
    sqlx::query(
        r#"
        INSERT INTO ward_stock_requests (
            id,
            facility_id,
            ward_id,
            requested_item,
            quantity_requested,
            status,
            requested_by_user_id,
            approved_by_user_id,
            fulfilled_by_user_id,
            requested_at,
            approved_at,
            fulfilled_at,
            updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9, $10, $11, COALESCE($11, $10))
        ON CONFLICT (id) DO UPDATE
        SET requested_item = EXCLUDED.requested_item,
            quantity_requested = EXCLUDED.quantity_requested,
            status = EXCLUDED.status,
            approved_by_user_id = EXCLUDED.approved_by_user_id,
            fulfilled_by_user_id = EXCLUDED.fulfilled_by_user_id,
            requested_at = EXCLUDED.requested_at,
            approved_at = EXCLUDED.approved_at,
            fulfilled_at = EXCLUDED.fulfilled_at,
            updated_at = EXCLUDED.updated_at
        "#,
    )
    .bind(demo_uuid(DEMO_WARD_STOCK_REQUEST_BASE_ID, journey.ordinal))
    .bind(baseline.facility_id)
    .bind(admission.ward.id())
    .bind(match journey.archetype.key {
        "surgical" => "Sterile dressing pack",
        "maternity" => "Maternity observation pack",
        "pediatric" => "Paediatric oral rehydration pack",
        _ => "General ward observation pack",
    })
    .bind(2 + i32::try_from(journey.ordinal % 3).unwrap_or(0))
    .bind(codec::encode(stock_status)?)
    .bind(owner_user_id)
    .bind(stock_fulfilled_at.map(|_| owner_user_id))
    .bind(stock_requested_at)
    .bind(stock_requested_at + Duration::minutes(30))
    .bind(stock_fulfilled_at)
    .execute(&mut **transaction)
    .await?;

    let handoff_created_at = admission.admitted_at + Duration::hours(12);
    let handoff_completed_at =
        (!admission.is_active()).then_some(handoff_created_at + Duration::minutes(45));
    sqlx::query(
        r#"
        INSERT INTO handoffs (
            id,
            facility_id,
            ward_id,
            from_user_id,
            to_user_id,
            shift_label,
            status,
            created_at,
            completed_at,
            updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($9, $8))
        ON CONFLICT (id) DO UPDATE
        SET shift_label = EXCLUDED.shift_label,
            status = EXCLUDED.status,
            completed_at = EXCLUDED.completed_at,
            updated_at = EXCLUDED.updated_at
        "#,
    )
    .bind(demo_uuid(DEMO_HANDOFF_BASE_ID, journey.ordinal))
    .bind(baseline.facility_id)
    .bind(admission.ward.id())
    .bind(owner_user_id)
    .bind(handoff_to_user_id)
    .bind(if admission.is_active() {
        "Demo day to night shift"
    } else {
        "Demo completed discharge handoff"
    })
    .bind(codec::encode(if handoff_completed_at.is_some() {
        HandoffStatus::Completed
    } else {
        HandoffStatus::Draft
    })?)
    .bind(handoff_created_at)
    .bind(handoff_completed_at)
    .execute(&mut **transaction)
    .await?;

    Ok(())
}

async fn seed_chronicle_demo_ward_rounds(
    transaction: &mut Transaction<'_, Postgres>,
    baseline: &BaselineProvisioning,
    journey: &ChronicleDemoPatient,
    admission: &ChronicleDemoAdmission,
) -> anyhow::Result<()> {
    let owner_user_id = Uuid::from_u128(OWNER_USER_ID);
    let committed_round_id = demo_graph_uuid(DEMO_WARD_ROUND_BASE_ID, journey.ordinal, 1);
    let draft_round_id = demo_graph_uuid(DEMO_WARD_ROUND_BASE_ID, journey.ordinal, 2);
    for (round_id, status, signed_at, rendered_note, note_sections) in [
        (
            committed_round_id,
            "committed",
            Some(admission.admitted_at + Duration::hours(18)),
            Some("Synthetic ward round summary. Continue current inpatient plan. No real patient data."),
            json!({
                "interval_history": format!("Synthetic {} patient reports modest improvement overnight.", journey.archetype.label),
                "examination": "Vitals reviewed from chart. No emergency features recorded.",
                "assessment": journey.archetype.problem_label,
                "plan": journey.archetype.ward_round_plan,
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
        .bind(journey.patient_id())
        .bind(journey.admission_id())
        .bind(status)
        .bind(note_sections)
        .bind(json!({
            "active_medication_count": 1,
            "open_lab_order_count": 0,
            "open_nursing_task_count": 3,
            "discharge_blocker_count": if admission.status == "discharge_pending" { 1 } else { 0 }
        }))
        .bind(rendered_note)
        .bind(owner_user_id)
        .bind(signed_at)
        .bind(admission.admitted_at + Duration::hours(16))
        .execute(&mut **transaction)
        .await?;
    }

    for action in [
        ChronicleDemoWardRoundAction {
            ordinal: 1,
            action_type: "prescription",
            title: journey.archetype.medication_name,
            instruction: None,
            payload: json!({
                "prescription_id": demo_graph_uuid(DEMO_PRESCRIPTION_BASE_ID, journey.ordinal, CHRONICLE_DEMO_INPATIENT_SEQUENCE),
                "medication_name": journey.archetype.medication_name,
                "dose": journey.archetype.medication_dose,
                "frequency": journey.archetype.medication_frequency,
                "status": "active"
            }),
            committed_resource_type: Some("prescription"),
            committed_resource_id: Some(demo_graph_uuid(
                DEMO_PRESCRIPTION_BASE_ID,
                journey.ordinal,
                CHRONICLE_DEMO_INPATIENT_SEQUENCE,
            )),
            link_title: Some(journey.archetype.medication_name),
        },
        ChronicleDemoWardRoundAction {
            ordinal: 2,
            action_type: "lab_order",
            title: "Review demo labs",
            instruction: Some("Review verified results before discharge planning."),
            payload: json!({
                "test_ids": [Uuid::from_u128(DEFAULT_LAB_TEST_FBC_ID)],
                "panel_ids": [],
                "priority": if journey.archetype.urgent_labs { "urgent" } else { "routine" }
            }),
            committed_resource_type: Some("lab_order"),
            committed_resource_id: Some(demo_graph_uuid(
                DEMO_LAB_ORDER_BASE_ID,
                journey.ordinal,
                CHRONICLE_DEMO_INPATIENT_SEQUENCE,
            )),
            link_title: Some("Demo lab order"),
        },
        ChronicleDemoWardRoundAction {
            ordinal: 3,
            action_type: "nursing_task",
            title: "Continue observation chart",
            instruction: Some(journey.archetype.nursing_instruction),
            payload: json!({
                "title": "Continue observation chart",
                "instruction": journey.archetype.nursing_instruction,
                "due_at": admission.admitted_at + Duration::hours(24),
                "task_type": "ward_round",
                "assigned_to_user_id": null
            }),
            committed_resource_type: Some("nursing_task"),
            committed_resource_id: Some(demo_uuid(
                DEMO_NURSING_TASK_BASE_ID,
                journey.ordinal * 10 + 1,
            )),
            link_title: Some("Continue observation chart"),
        },
    ] {
        seed_chronicle_demo_ward_round_action(
            transaction,
            baseline.facility_id,
            journey,
            committed_round_id,
            "committed",
            action,
        )
        .await?;
    }

    if admission.status == "discharge_pending" {
        seed_chronicle_demo_ward_round_action(
            transaction,
            baseline.facility_id,
            journey,
            committed_round_id,
            "committed",
            ChronicleDemoWardRoundAction {
                ordinal: 4,
                action_type: "discharge_request",
                title: "Prepare discharge request",
                instruction: Some(
                    "Confirm education, medicine supply, and billing clearance before discharge.",
                ),
                payload: json!({
                    "requested": true,
                    "target": "today",
                    "reason": "Synthetic discharge-readiness review"
                }),
                committed_resource_type: Some("discharge_case"),
                committed_resource_id: Some(demo_uuid(
                    DEMO_DISCHARGE_CASE_BASE_ID,
                    journey.ordinal,
                )),
                link_title: Some("Discharge request"),
            },
        )
        .await?;
    }

    seed_chronicle_demo_ward_round_action(
        transaction,
        baseline.facility_id,
        journey,
        draft_round_id,
        "draft",
        ChronicleDemoWardRoundAction {
            ordinal: 9,
            action_type: "nursing_task",
            title: "Draft next-shift check",
            instruction: Some("Confirm symptoms, intake, and urine output at next review."),
            payload: json!({
                "title": "Draft next-shift check",
                "instruction": "Confirm symptoms, intake, and urine output at next review.",
                "due_at": admission.admitted_at + Duration::hours(30),
                "task_type": "ward_round",
                "assigned_to_user_id": null
            }),
            committed_resource_type: None,
            committed_resource_id: None,
            link_title: None,
        },
    )
    .await?;

    Ok(())
}

#[derive(Debug)]
struct ChronicleDemoWardRoundAction {
    ordinal: u32,
    action_type: &'static str,
    title: &'static str,
    instruction: Option<&'static str>,
    payload: serde_json::Value,
    committed_resource_type: Option<&'static str>,
    committed_resource_id: Option<Uuid>,
    link_title: Option<&'static str>,
}

async fn seed_chronicle_demo_ward_round_action(
    transaction: &mut Transaction<'_, Postgres>,
    facility_id: Uuid,
    journey: &ChronicleDemoPatient,
    ward_round_id: Uuid,
    status: &'static str,
    action: ChronicleDemoWardRoundAction,
) -> anyhow::Result<()> {
    let action_id = demo_uuid(
        DEMO_WARD_ROUND_ACTION_BASE_ID,
        journey.ordinal * 100 + action.ordinal,
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
    .bind(journey.patient_id())
    .bind(journey.admission_id())
    .bind(action.action_type)
    .bind(status)
    .bind(action.title)
    .bind(action.instruction)
    .bind(action.payload)
    .bind(action.committed_resource_type)
    .bind(action.committed_resource_id)
    .bind(Uuid::from_u128(OWNER_USER_ID))
    .bind(journey.latest_event_at() + Duration::minutes(i64::from(action.ordinal)))
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
            journey.ordinal * 100 + action.ordinal,
        ))
        .bind(facility_id)
        .bind(ward_round_id)
        .bind(action_id)
        .bind(journey.patient_id())
        .bind(journey.admission_id())
        .bind(resource_type)
        .bind(resource_id)
        .bind(title)
        .bind(journey.latest_event_at() + Duration::minutes(i64::from(action.ordinal) + 1))
        .execute(&mut **transaction)
        .await?;
    }
    Ok(())
}

fn build_chronicle_demo_patients(config: DemoSeedConfig) -> Vec<ChronicleDemoPatient> {
    let archetypes = chronicle_demo_archetypes();
    let mut active_admission_count = 0usize;
    let mut active_beds_by_ward = [0_u32; 4];
    (1..=config.patient_count as u32)
        .map(|ordinal| {
            let archetype = archetypes[(ordinal as usize - 1) % archetypes.len()].clone();
            let sex = chronicle_demo_sex(archetype.sex_rule, ordinal);
            let age_span = u32::from(archetype.age_max - archetype.age_min + 1);
            let age = u32::from(archetype.age_min) + ((ordinal * 7) % age_span);
            let outpatient_count = (u32::from(archetype.op_min)
                + (ordinal % u32::from(archetype.op_max - archetype.op_min + 1)))
                * u32::from(config.years);
            let admission = chronicle_demo_admission_for_patient(
                &archetype,
                ordinal,
                config,
                &mut active_admission_count,
                &mut active_beds_by_ward,
            );
            ChronicleDemoPatient {
                ordinal,
                first_name: chronicle_demo_first_name(&sex, ordinal).to_owned(),
                last_name: chronicle_demo_last_name(ordinal).to_owned(),
                date_of_birth: NaiveDate::from_ymd_opt(
                    2026 - i32::try_from(age).expect("demo age fits i32"),
                    (ordinal % 12) + 1,
                    ((ordinal * 3) % 27) + 1,
                )
                .expect("deterministic demo DOB is valid"),
                sex,
                outpatient_count: outpatient_count.max(2),
                problem_onset: demo_chronicle_anchor().date_naive()
                    - Duration::days(i64::from(ordinal % 180 + 30)),
                admission,
                archetype,
            }
        })
        .collect()
}

fn chronicle_demo_admission_for_patient(
    archetype: &ChronicleDemoArchetype,
    ordinal: u32,
    config: DemoSeedConfig,
    active_admission_count: &mut usize,
    active_beds_by_ward: &mut [u32; 4],
) -> Option<ChronicleDemoAdmission> {
    let threshold = archetype.admission_probability_per_year * u32::from(config.years);
    let score = (ordinal * 37 + archetype.key.as_bytes()[0] as u32) % 100;
    let should_admit = threshold >= 50 || score < threshold.min(100);
    if !should_admit {
        return None;
    }

    let active = *active_admission_count < config.active_admission_target
        && archetype.admission_probability_per_year >= 25;
    let ward_index = usize::try_from(archetype.ward.index - 1).expect("demo ward index fits usize");
    let bed_ordinal = if active {
        active_beds_by_ward[ward_index] += 1;
        Some(active_beds_by_ward[ward_index])
    } else {
        None
    };
    if active {
        *active_admission_count += 1;
    }
    let admitted_at = if active {
        demo_chronicle_anchor() - Duration::hours(i64::from((ordinal % 72) + 6))
    } else {
        demo_chronicle_anchor() - Duration::days(i64::from((ordinal % 300) + 30))
    };
    let discharged_at =
        (!active).then_some(admitted_at + Duration::days(i64::from((ordinal % 7) + 2)));
    let status = if active && (ordinal % 5 == 0 || archetype.key == "maternity") {
        "discharge_pending"
    } else if active {
        "admitted"
    } else {
        "discharged"
    };
    Some(ChronicleDemoAdmission {
        status,
        ward: archetype.ward,
        bed_ordinal,
        admitted_at,
        discharged_at,
    })
}

fn chronicle_demo_wards() -> [ChronicleDemoWard; 4] {
    [
        ChronicleDemoWard {
            index: 1,
            code: "demo-medical",
            name: "Demo Medical Ward",
            bed_prefix: "MED",
        },
        ChronicleDemoWard {
            index: 2,
            code: "demo-surgical",
            name: "Demo Surgical Ward",
            bed_prefix: "SURG",
        },
        ChronicleDemoWard {
            index: 3,
            code: "demo-maternity",
            name: "Demo Maternity Ward",
            bed_prefix: "MAT",
        },
        ChronicleDemoWard {
            index: 4,
            code: "demo-paediatric",
            name: "Demo Paediatric Ward",
            bed_prefix: "PAED",
        },
    ]
}

fn chronicle_demo_archetypes() -> [ChronicleDemoArchetype; 9] {
    let [medical, surgical, maternity, pediatric] = chronicle_demo_wards();
    [
        ChronicleDemoArchetype { key: "healthy_adult", label: "healthy adult", op_min: 1, op_max: 3, admission_probability_per_year: 5, sex_rule: ChronicleDemoSexRule::Any, age_min: 18, age_max: 70, lab_codes: &["FBC", "RBG", "URE"], sbp: (100, 130), dbp: (60, 85), pulse: (60, 90), temp_tenths: (362, 372), spo2_base: 98, problem_label: "Wellness review", medication_name: "Paracetamol", medication_dose: "1 g", medication_frequency: "as needed", nursing_instruction: "Repeat observations if symptoms develop.", ward_round_plan: "No inpatient escalation required.", complaints: &["Routine check-up", "Mild fatigue", "Headache and body aches"], icd_codes: &["Z00.0", "J06.9", "K29.7", "M54.5"], ward: medical, allergy: None, urgent_labs: false, claimable: false, base_invoice_minor: 7_500 },
        ChronicleDemoArchetype { key: "hypertensive", label: "hypertensive", op_min: 4, op_max: 8, admission_probability_per_year: 25, sex_rule: ChronicleDemoSexRule::Any, age_min: 35, age_max: 82, lab_codes: &["FBC", "U&E", "CRE", "LFT", "LIPID"], sbp: (140, 190), dbp: (90, 120), pulse: (60, 90), temp_tenths: (362, 370), spo2_base: 96, problem_label: "Essential hypertension", medication_name: "Amlodipine", medication_dose: "10 mg", medication_frequency: "daily", nursing_instruction: "Recheck blood pressure after rest and document counselling points.", ward_round_plan: "Trend BP, review renal function, and reinforce medication adherence.", complaints: &["Known hypertensive for BP review", "Headache and dizziness", "Chest tightness"], icd_codes: &["I10", "I25.1", "N18.3", "I63.9"], ward: medical, allergy: None, urgent_labs: false, claimable: true, base_invoice_minor: 12_500 },
        ChronicleDemoArchetype { key: "diabetic", label: "diabetic", op_min: 4, op_max: 8, admission_probability_per_year: 25, sex_rule: ChronicleDemoSexRule::Any, age_min: 30, age_max: 78, lab_codes: &["FBS", "HBA1C", "U&E", "CRE", "LIPID"], sbp: (120, 155), dbp: (75, 100), pulse: (60, 95), temp_tenths: (362, 373), spo2_base: 95, problem_label: "Type 2 diabetes mellitus", medication_name: "Metformin", medication_dose: "500 mg", medication_frequency: "twice daily", nursing_instruction: "Check capillary glucose before meals and document symptoms.", ward_round_plan: "Review glucose trend, renal function, foot status, and discharge education.", complaints: &["Routine diabetic review", "Increased thirst and polyuria", "HbA1c monitoring"], icd_codes: &["E11.9", "E11.65", "N18.3"], ward: medical, allergy: None, urgent_labs: false, claimable: true, base_invoice_minor: 13_000 },
        ChronicleDemoArchetype { key: "chronic_complex", label: "chronic complex", op_min: 6, op_max: 12, admission_probability_per_year: 60, sex_rule: ChronicleDemoSexRule::Any, age_min: 45, age_max: 88, lab_codes: &["FBC", "U&E", "CRE", "LFT", "HBA1C", "CRP"], sbp: (145, 200), dbp: (90, 125), pulse: (65, 105), temp_tenths: (362, 375), spo2_base: 90, problem_label: "Hypertension with diabetes and chronic kidney disease", medication_name: "Furosemide", medication_dose: "40 mg", medication_frequency: "daily", nursing_instruction: "Record fluid balance, oedema check, and daily weight.", ward_round_plan: "Review fluid balance, renal profile, medication tolerance, and discharge blockers.", complaints: &["Multi-morbidity review", "Worsening pedal oedema", "Shortness of breath on exertion"], icd_codes: &["I10", "E11.9", "N18.3", "I50.9"], ward: medical, allergy: Some(DemoAllergy { substance: "Penicillin", reaction: Some("rash"), severity: "moderate" }), urgent_labs: true, claimable: true, base_invoice_minor: 24_000 },
        ChronicleDemoArchetype { key: "respiratory", label: "respiratory", op_min: 3, op_max: 7, admission_probability_per_year: 35, sex_rule: ChronicleDemoSexRule::Any, age_min: 16, age_max: 82, lab_codes: &["FBC", "CRP", "AFB"], sbp: (100, 140), dbp: (60, 90), pulse: (70, 115), temp_tenths: (365, 390), spo2_base: 90, problem_label: "Respiratory infection with bronchospasm", medication_name: "Salbutamol inhaler", medication_dose: "2 puffs", medication_frequency: "every 6 hours", nursing_instruction: "Record respiratory rate and oxygen saturation every four hours.", ward_round_plan: "Continue bronchodilator, review oxygen requirement, and check inflammatory markers.", complaints: &["Wheeze and shortness of breath", "Productive cough", "Cough, fever, pleuritic pain"], icd_codes: &["J45.9", "J18.9", "A15.0", "J44.1"], ward: medical, allergy: None, urgent_labs: true, claimable: true, base_invoice_minor: 18_500 },
        ChronicleDemoArchetype { key: "surgical", label: "surgical", op_min: 2, op_max: 5, admission_probability_per_year: 150, sex_rule: ChronicleDemoSexRule::Any, age_min: 18, age_max: 76, lab_codes: &["FBC", "U&E", "CRE", "LFT", "COAG", "GS"], sbp: (110, 140), dbp: (65, 90), pulse: (65, 100), temp_tenths: (365, 385), spo2_base: 96, problem_label: "Acute surgical abdomen observation", medication_name: "Ceftriaxone", medication_dose: "1 g", medication_frequency: "daily", nursing_instruction: "Monitor pain score, wound status, and oral intake.", ward_round_plan: "Review surgical site, analgesia, labs, and readiness for theatre or discharge.", complaints: &["Right iliac fossa pain", "Epigastric pain", "Post-operative wound review"], icd_codes: &["K80.2", "K35.9", "K40.9", "K57.3"], ward: surgical, allergy: Some(DemoAllergy { substance: "Co-trimoxazole", reaction: Some("itching"), severity: "mild" }), urgent_labs: true, claimable: true, base_invoice_minor: 32_000 },
        ChronicleDemoArchetype { key: "maternity", label: "maternity", op_min: 6, op_max: 12, admission_probability_per_year: 100, sex_rule: ChronicleDemoSexRule::Female, age_min: 18, age_max: 42, lab_codes: &["FBC", "GS", "HBS", "HIV", "URE"], sbp: (100, 140), dbp: (60, 90), pulse: (70, 95), temp_tenths: (362, 375), spo2_base: 98, problem_label: "Antenatal and maternity observation", medication_name: "Ferrous sulfate", medication_dose: "200 mg", medication_frequency: "daily", nursing_instruction: "Monitor bleeding, pain score, and fetal movement report during each shift.", ward_round_plan: "Confirm maternal observations, education, and discharge readiness.", complaints: &["First ANC visit", "Routine ANC review", "Term pregnancy contractions"], icd_codes: &["Z34.0", "O80", "O14.1", "O20.0"], ward: maternity, allergy: None, urgent_labs: false, claimable: true, base_invoice_minor: 16_000 },
        ChronicleDemoArchetype { key: "pediatric", label: "pediatric", op_min: 3, op_max: 8, admission_probability_per_year: 35, sex_rule: ChronicleDemoSexRule::Pediatric, age_min: 1, age_max: 12, lab_codes: &["FBC", "MP", "RBG"], sbp: (80, 110), dbp: (50, 75), pulse: (80, 130), temp_tenths: (365, 400), spo2_base: 94, problem_label: "Paediatric febrile illness", medication_name: "Artemether-lumefantrine", medication_dose: "20/120 mg", medication_frequency: "twice daily", nursing_instruction: "Document temperature, oral intake, urine output, and caregiver education.", ward_round_plan: "Review fever curve, hydration, malaria result, and caregiver instructions.", complaints: &["Fever and rigors", "Diarrhoea and vomiting", "Cough and difficulty breathing"], icd_codes: &["B54", "J18.9", "A09", "E43"], ward: pediatric, allergy: None, urgent_labs: true, claimable: false, base_invoice_minor: 9_000 },
        ChronicleDemoArchetype { key: "infectious", label: "infectious", op_min: 2, op_max: 5, admission_probability_per_year: 50, sex_rule: ChronicleDemoSexRule::Any, age_min: 16, age_max: 70, lab_codes: &["FBC", "MP", "WIDAL", "LFT"], sbp: (100, 135), dbp: (60, 85), pulse: (70, 115), temp_tenths: (375, 405), spo2_base: 95, problem_label: "Acute infectious syndrome", medication_name: "Azithromycin", medication_dose: "500 mg", medication_frequency: "daily", nursing_instruction: "Record fever chart, hydration status, and isolation precautions.", ward_round_plan: "Review fever trend, cultures if available, hydration, and antimicrobial response.", complaints: &["High grade fever", "Fever with abdominal pain", "Body pains and vomiting"], icd_codes: &["B54", "A01.0", "B15.9", "A09"], ward: medical, allergy: None, urgent_labs: true, claimable: true, base_invoice_minor: 15_000 },
    ]
}

fn chronicle_demo_sex(rule: ChronicleDemoSexRule, ordinal: u32) -> Sex {
    match rule {
        ChronicleDemoSexRule::Female => Sex::Female,
        ChronicleDemoSexRule::Any | ChronicleDemoSexRule::Pediatric => {
            if ordinal % 2 == 0 {
                Sex::Female
            } else {
                Sex::Male
            }
        }
    }
}

fn chronicle_demo_first_name(sex: &Sex, ordinal: u32) -> &'static str {
    const MALE: &[&str] = &[
        "Kwame", "Kofi", "Yaw", "Kweku", "Nii", "Kojo", "Kwesi", "Samuel", "Daniel", "Joseph",
        "Isaac", "Benjamin",
    ];
    const FEMALE: &[&str] = &[
        "Ama", "Akua", "Abena", "Adjoa", "Afia", "Efua", "Esi", "Mansa", "Grace", "Mercy", "Naomi",
        "Esther",
    ];
    let names = match sex {
        Sex::Female => FEMALE,
        _ => MALE,
    };
    names[(ordinal as usize - 1) % names.len()]
}

fn chronicle_demo_last_name(ordinal: u32) -> &'static str {
    const SURNAMES: &[&str] = &[
        "Mensah",
        "Owusu",
        "Asante",
        "Boateng",
        "Darko",
        "Agyei",
        "Amponsah",
        "Frimpong",
        "Adusei",
        "Appiah",
        "Ofori",
        "Acheampong",
        "Nyarko",
        "Tetteh",
        "Quartey",
        "Ankrah",
        "Nkrumah",
        "Aidoo",
    ];
    SURNAMES[(ordinal as usize - 1) % SURNAMES.len()]
}

fn chronicle_demo_note_body(journey: &ChronicleDemoPatient, sequence: u32) -> String {
    let complaint = journey.archetype.complaints
        [((journey.ordinal + sequence) as usize) % journey.archetype.complaints.len()];
    let icd = journey.archetype.icd_codes
        [((journey.ordinal + sequence) as usize) % journey.archetype.icd_codes.len()];
    let vitals = chronicle_demo_vitals(journey, sequence);
    format!(
        "Synthetic {label} review. Subjective: {complaint}. Objective: BP {bp} mmHg, HR {hr} bpm, Temp {temp} C, SpO2 {spo2}%. Assessment: ICD-10 {icd}, synthetic {label} scenario. Plan: {plan} This is generated demo data only.",
        label = journey.archetype.label,
        complaint = complaint,
        bp = vitals.blood_pressure,
        hr = vitals.pulse,
        temp = vitals.temperature,
        spo2 = vitals.oxygen_saturation,
        icd = icd,
        plan = journey.archetype.ward_round_plan,
    )
}

fn chronicle_demo_vitals(journey: &ChronicleDemoPatient, sequence: u32) -> ChronicleDemoVitals {
    let values = chronicle_demo_observation_values(journey, sequence);
    ChronicleDemoVitals {
        blood_pressure: format!("{}/{}", values.systolic_bp, values.diastolic_bp),
        pulse: values.pulse.to_string(),
        respiratory_rate: values.respiratory_rate.to_string(),
        oxygen_saturation: values.oxygen_saturation.to_string(),
        temperature: format!("{:.1}", values.temperature_c),
    }
}

fn chronicle_demo_observation_values(
    journey: &ChronicleDemoPatient,
    sequence: u32,
) -> ChronicleDemoObservationValues {
    let seed = i32::try_from(journey.ordinal + sequence * 7).expect("demo seed fits i32");
    let sbp = chronicle_demo_range_value(journey.archetype.sbp, seed);
    let dbp = chronicle_demo_range_value(journey.archetype.dbp, seed / 2);
    let pulse = chronicle_demo_range_value(journey.archetype.pulse, seed / 3);
    let temp_tenths = chronicle_demo_range_value(journey.archetype.temp_tenths, seed / 4);
    let spo2 = (journey.archetype.spo2_base + (seed % 4)).min(100);
    ChronicleDemoObservationValues {
        systolic_bp: sbp,
        diastolic_bp: dbp.min(sbp - 10),
        pulse,
        respiratory_rate: 14 + (seed % 10),
        oxygen_saturation: spo2,
        temperature_c: temp_tenths as f32 / 10.0,
    }
}

fn chronicle_demo_range_value(range: (i32, i32), seed: i32) -> i32 {
    range.0 + seed.rem_euclid(range.1 - range.0 + 1)
}

fn chronicle_demo_lab_value(
    code: &str,
    journey: &ChronicleDemoPatient,
    sequence: u32,
) -> (String, Option<&'static str>) {
    let seed = i32::try_from(journey.ordinal + sequence * 13).expect("demo seed fits i32");
    match code {
        "FBC" => (
            format!("{}.{}", 10 + seed.rem_euclid(5), seed.rem_euclid(9)),
            Some("g/dL"),
        ),
        "RBG" | "FBS" => (
            format!("{}.{}", 4 + seed.rem_euclid(8), seed.rem_euclid(9)),
            Some("mmol/L"),
        ),
        "HBA1C" => (
            format!("{}.{}", 6 + seed.rem_euclid(4), seed.rem_euclid(9)),
            Some("%"),
        ),
        "U&E" => ((3 + seed.rem_euclid(4)).to_string(), Some("mmol/L")),
        "CRE" => ((70 + seed.rem_euclid(90)).to_string(), Some("umol/L")),
        "LFT" => ((20 + seed.rem_euclid(80)).to_string(), Some("U/L")),
        "LIPID" => (
            format!("{}.{}", 3 + seed.rem_euclid(4), seed.rem_euclid(9)),
            Some("mmol/L"),
        ),
        "TSH" => (
            format!("{}.{}", 1 + seed.rem_euclid(5), seed.rem_euclid(9)),
            Some("mIU/L"),
        ),
        "MP" => (seed.rem_euclid(250).to_string(), Some("parasites/ul")),
        "WIDAL" => ((40 + seed.rem_euclid(160)).to_string(), Some("titre")),
        "HBS" | "HIV" | "AFB" => ("non-reactive".to_owned(), Some("result")),
        "URE" => ("normal".to_owned(), Some("summary")),
        "GS" => (
            if journey.ordinal % 2 == 0 { "O+" } else { "B+" }.to_owned(),
            Some("group"),
        ),
        "CRP" => ((5 + seed.rem_euclid(80)).to_string(), Some("mg/L")),
        "COAG" => ((11 + seed.rem_euclid(7)).to_string(), Some("seconds")),
        _ => ("synthetic".to_owned(), None),
    }
}

fn chronicle_demo_lab_test_id(code: &str) -> Uuid {
    Uuid::from_u128(match code {
        "FBC" => DEFAULT_LAB_TEST_FBC_ID,
        "MP" => DEFAULT_LAB_TEST_MALARIA_ID,
        "RBG" => DEFAULT_LAB_TEST_RBG_ID,
        "FBS" => DEFAULT_LAB_TEST_FBS_ID,
        "HBA1C" => DEFAULT_LAB_TEST_HBA1C_ID,
        "U&E" => DEFAULT_LAB_TEST_UE_ID,
        "CRE" => DEFAULT_LAB_TEST_CREATININE_ID,
        "LFT" => DEFAULT_LAB_TEST_LFT_ID,
        "LIPID" => DEFAULT_LAB_TEST_LIPID_ID,
        "TSH" => DEFAULT_LAB_TEST_TSH_ID,
        "WIDAL" => DEFAULT_LAB_TEST_WIDAL_ID,
        "HBS" => DEFAULT_LAB_TEST_HBSAG_ID,
        "HIV" => DEFAULT_LAB_TEST_HIV_ID,
        "URE" => DEFAULT_LAB_TEST_URINALYSIS_ID,
        "GS" => DEFAULT_LAB_TEST_GROUP_SCREEN_ID,
        "CRP" => DEFAULT_LAB_TEST_CRP_ID,
        "COAG" => DEFAULT_LAB_TEST_COAG_ID,
        "AFB" => DEFAULT_LAB_TEST_AFB_ID,
        _ => DEFAULT_LAB_TEST_FBC_ID,
    })
}

fn demo_graph_uuid(base: u128, patient_ordinal: u32, sequence: u32) -> Uuid {
    demo_uuid(base, patient_ordinal * 100 + sequence)
}

fn demo_compound_uuid(base: u128, patient_ordinal: u32, sequence: u32, item: u32) -> Uuid {
    demo_uuid(base, patient_ordinal * 10_000 + sequence * 100 + item)
}

fn demo_chronicle_anchor() -> DateTime<Utc> {
    DateTime::parse_from_rfc3339("2026-05-20T08:00:00Z")
        .expect("static demo seed timestamp is valid")
        .with_timezone(&Utc)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn medium_and_large_demo_profiles_plan_expected_active_beds() {
        for profile in [DemoSeedProfile::Medium, DemoSeedProfile::Large] {
            let config = profile.config();
            let journeys = build_chronicle_demo_patients(config);
            let active_admissions = journeys
                .iter()
                .filter_map(|journey| journey.admission.as_ref())
                .filter(|admission| admission.is_active())
                .count();
            let occupied_beds: HashSet<(ChronicleDemoWard, u32)> = journeys
                .iter()
                .filter_map(|journey| {
                    journey.admission.as_ref().and_then(|admission| {
                        admission.bed_ordinal.map(|bed| (admission.ward, bed))
                    })
                })
                .collect();

            assert_eq!(journeys.len(), config.patient_count);
            assert_eq!(active_admissions, config.active_admission_target);
            assert_eq!(occupied_beds.len(), active_admissions);
            assert!(occupied_beds
                .iter()
                .all(|(_, bed_ordinal)| *bed_ordinal <= config.beds_per_ward));
        }
    }
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
            primary_supplier_id,
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
               (
                   SELECT inventory_suppliers.id
                   FROM inventory_suppliers
                   WHERE inventory_suppliers.facility_id = $1
                     AND inventory_suppliers.is_active = TRUE
                   ORDER BY inventory_suppliers.code ASC
                   LIMIT 1
               ),
               TRUE,
               TIMESTAMPTZ '2026-06-01 00:00:00+00' + (i * INTERVAL '1 minute'),
               TIMESTAMPTZ '2026-06-01 00:00:00+00' + (i * INTERVAL '1 minute')
        FROM generated
        ON CONFLICT (facility_id, code) DO UPDATE
        SET name = EXCLUDED.name,
            item_type = EXCLUDED.item_type,
            unit = EXCLUDED.unit,
            controlled = EXCLUDED.controlled,
            primary_supplier_id = EXCLUDED.primary_supplier_id,
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
        (
            Uuid::from_u128(DEFAULT_LAB_TEST_RBG_ID),
            "RBG",
            "Random Blood Glucose",
            "blood",
            Some("mmol/L"),
        ),
        (
            Uuid::from_u128(DEFAULT_LAB_TEST_FBS_ID),
            "FBS",
            "Fasting Blood Sugar",
            "blood",
            Some("mmol/L"),
        ),
        (
            Uuid::from_u128(DEFAULT_LAB_TEST_HBA1C_ID),
            "HBA1C",
            "Haemoglobin A1c",
            "blood",
            Some("%"),
        ),
        (
            Uuid::from_u128(DEFAULT_LAB_TEST_UE_ID),
            "U&E",
            "Urea and Electrolytes",
            "blood",
            Some("mmol/L"),
        ),
        (
            Uuid::from_u128(DEFAULT_LAB_TEST_CREATININE_ID),
            "CRE",
            "Creatinine",
            "blood",
            Some("umol/L"),
        ),
        (
            Uuid::from_u128(DEFAULT_LAB_TEST_LFT_ID),
            "LFT",
            "Liver Function Tests",
            "blood",
            Some("U/L"),
        ),
        (
            Uuid::from_u128(DEFAULT_LAB_TEST_LIPID_ID),
            "LIPID",
            "Lipid Profile",
            "blood",
            Some("mmol/L"),
        ),
        (
            Uuid::from_u128(DEFAULT_LAB_TEST_TSH_ID),
            "TSH",
            "Thyroid Stimulating Hormone",
            "blood",
            Some("mIU/L"),
        ),
        (
            Uuid::from_u128(DEFAULT_LAB_TEST_WIDAL_ID),
            "WIDAL",
            "Widal Test",
            "blood",
            Some("titre"),
        ),
        (
            Uuid::from_u128(DEFAULT_LAB_TEST_HBSAG_ID),
            "HBS",
            "Hepatitis B Surface Antigen",
            "blood",
            Some("result"),
        ),
        (
            Uuid::from_u128(DEFAULT_LAB_TEST_HIV_ID),
            "HIV",
            "HIV Screening",
            "blood",
            Some("result"),
        ),
        (
            Uuid::from_u128(DEFAULT_LAB_TEST_URINALYSIS_ID),
            "URE",
            "Urinalysis",
            "urine",
            Some("summary"),
        ),
        (
            Uuid::from_u128(DEFAULT_LAB_TEST_GROUP_SCREEN_ID),
            "GS",
            "Group and Screen",
            "blood",
            Some("group"),
        ),
        (
            Uuid::from_u128(DEFAULT_LAB_TEST_CRP_ID),
            "CRP",
            "C-Reactive Protein",
            "blood",
            Some("mg/L"),
        ),
        (
            Uuid::from_u128(DEFAULT_LAB_TEST_COAG_ID),
            "COAG",
            "Coagulation Screen",
            "blood",
            Some("seconds"),
        ),
        (
            Uuid::from_u128(DEFAULT_LAB_TEST_AFB_ID),
            "AFB",
            "AFB Smear",
            "sputum",
            Some("result"),
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
        UPDATE lab_tests
        SET category = CASE
                WHEN code IN ('FBC', 'GS', 'COAG') THEN 'hematology'
                WHEN code IN ('RBG', 'FBS', 'HBA1C', 'U&E', 'CRE', 'LFT', 'LIPID', 'TSH', 'CRP') THEN 'chemistry'
                WHEN code IN ('MP', 'WIDAL', 'AFB') THEN 'microbiology'
                WHEN code IN ('HBS', 'HIV') THEN 'serology'
                WHEN code = 'URE' THEN 'urinalysis'
                ELSE COALESCE(category, 'other')
            END,
            is_system_default = TRUE,
            is_facility_modified = FALSE
        WHERE facility_id = $1
          AND code IN (
              'FBC', 'MP', 'RBG', 'FBS', 'HBA1C', 'U&E', 'CRE', 'LFT', 'LIPID',
              'TSH', 'WIDAL', 'HBS', 'HIV', 'URE', 'GS', 'CRP', 'COAG', 'AFB'
          )
        "#,
    )
    .bind(baseline.facility_id)
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO lab_panels (id, facility_id, code, name)
        VALUES ($1, $2, 'BASIC_HEME', 'Basic Hematology')
        ON CONFLICT (facility_id, code) DO UPDATE
        SET id = EXCLUDED.id,
            name = EXCLUDED.name,
            is_active = TRUE,
            is_system_default = TRUE,
            is_facility_modified = FALSE
        "#,
    )
    .bind(Uuid::from_u128(DEFAULT_LAB_PANEL_BASIC_ID))
    .bind(baseline.facility_id)
    .execute(pool)
    .await?;

    for test_id in [
        Uuid::from_u128(DEFAULT_LAB_TEST_FBC_ID),
        Uuid::from_u128(DEFAULT_LAB_TEST_MALARIA_ID),
        Uuid::from_u128(DEFAULT_LAB_TEST_RBG_ID),
        Uuid::from_u128(DEFAULT_LAB_TEST_URINALYSIS_ID),
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

    sqlx::query(
        r#"
        UPDATE inventory_items
        SET primary_supplier_id = CASE
            WHEN code = 'PARA500' THEN $2
            WHEN code = 'MOR10' THEN $3
            ELSE primary_supplier_id
        END,
        updated_at = now()
        WHERE facility_id = $1
          AND code IN ('PARA500', 'MOR10')
        "#,
    )
    .bind(baseline.facility_id)
    .bind(Uuid::from_u128(DEFAULT_SUPPLIER_ACME_ID))
    .bind(Uuid::from_u128(DEFAULT_SUPPLIER_CITY_ID))
    .execute(pool)
    .await?;

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

    for (id, code, name, location_type, temperature_zone) in [
        (
            Uuid::from_u128(DEFAULT_MAIN_STORE_ID),
            "MAIN",
            "Main Store",
            "store",
            "ambient",
        ),
        (
            Uuid::from_u128(DEFAULT_PHARMACY_STORE_ID),
            "PHARM",
            "Pharmacy Store",
            "pharmacy",
            "ambient",
        ),
    ] {
        sqlx::query(
            r#"
            INSERT INTO storage_locations (
                id, facility_id, code, name, location_type, temperature_zone
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (facility_id, code) DO UPDATE
            SET id = EXCLUDED.id,
                name = EXCLUDED.name,
                location_type = EXCLUDED.location_type,
                temperature_zone = EXCLUDED.temperature_zone,
                is_active = TRUE
            "#,
        )
        .bind(id)
        .bind(baseline.facility_id)
        .bind(code)
        .bind(name)
        .bind(location_type)
        .bind(temperature_zone)
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

    for (id, code, name, payer_type) in [
        (
            DEFAULT_INSURANCE_PROVIDER_NHIS_ID,
            "NHIS",
            "National Health Insurance Scheme",
            "nhis",
        ),
        (
            DEFAULT_INSURANCE_PROVIDER_PRIVATE_ID,
            "AKWAABA",
            "Akwaaba Health Assurance",
            "commercial",
        ),
    ] {
        sqlx::query(
            r#"
            INSERT INTO insurance_providers (id, facility_id, code, name, payer_type)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (facility_id, code) DO UPDATE
            SET id = EXCLUDED.id,
                name = EXCLUDED.name,
                payer_type = EXCLUDED.payer_type,
                is_active = TRUE,
                updated_at = now()
            "#,
        )
        .bind(Uuid::from_u128(id))
        .bind(baseline.facility_id)
        .bind(code)
        .bind(name)
        .bind(payer_type)
        .execute(pool)
        .await?;
    }

    for (id, provider_id, code, name, coverage_percentage) in [
        (
            DEFAULT_INSURANCE_PLAN_NHIS_ID,
            DEFAULT_INSURANCE_PROVIDER_NHIS_ID,
            "NHIS-STANDARD",
            "NHIS Standard Cover",
            100_i32,
        ),
        (
            DEFAULT_INSURANCE_PLAN_PRIVATE_ID,
            DEFAULT_INSURANCE_PROVIDER_PRIVATE_ID,
            "AKWAABA-FAMILY",
            "Akwaaba Family Plan",
            80_i32,
        ),
    ] {
        sqlx::query(
            r#"
            INSERT INTO insurance_plans (
                id, facility_id, provider_id, code, name, coverage_percentage
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (facility_id, code) DO UPDATE
            SET id = EXCLUDED.id,
                provider_id = EXCLUDED.provider_id,
                name = EXCLUDED.name,
                coverage_percentage = EXCLUDED.coverage_percentage,
                is_active = TRUE,
                updated_at = now()
            "#,
        )
        .bind(Uuid::from_u128(id))
        .bind(baseline.facility_id)
        .bind(Uuid::from_u128(provider_id))
        .bind(code)
        .bind(name)
        .bind(coverage_percentage)
        .execute(pool)
        .await?;
    }

    for (id, patient_id, plan_id, policy_number, member_id, valid_until, is_active) in [
        (
            DEFAULT_PATIENT_INSURANCE_ONE_ID,
            PATIENT_ONE_ID,
            DEFAULT_INSURANCE_PLAN_NHIS_ID,
            "NHIS-000001",
            "NHIS-000001",
            Some(NaiveDate::from_ymd_opt(2027, 12, 31).expect("valid seed date")),
            true,
        ),
        (
            DEFAULT_PATIENT_INSURANCE_TWO_ID,
            PATIENT_TWO_ID,
            DEFAULT_INSURANCE_PLAN_PRIVATE_ID,
            "AKW-000002",
            "AKW-000002",
            Some(NaiveDate::from_ymd_opt(2026, 12, 31).expect("valid seed date")),
            false,
        ),
    ] {
        sqlx::query(
            r#"
            INSERT INTO patient_insurances (
                id, facility_id, patient_id, plan_id, policy_number, member_id,
                subscriber_number, valid_from, valid_until, is_active
            )
            VALUES ($1, $2, $3, $4, $5, $6, $6, DATE '2026-01-01', $7, $8)
            ON CONFLICT (facility_id, policy_number) DO UPDATE
            SET id = EXCLUDED.id,
                patient_id = EXCLUDED.patient_id,
                plan_id = EXCLUDED.plan_id,
                member_id = EXCLUDED.member_id,
                subscriber_number = EXCLUDED.subscriber_number,
                valid_from = EXCLUDED.valid_from,
                valid_until = EXCLUDED.valid_until,
                is_active = EXCLUDED.is_active,
                updated_at = now()
            "#,
        )
        .bind(Uuid::from_u128(id))
        .bind(baseline.facility_id)
        .bind(Uuid::from_u128(patient_id))
        .bind(Uuid::from_u128(plan_id))
        .bind(policy_number)
        .bind(member_id)
        .bind(valid_until)
        .bind(is_active)
        .execute(pool)
        .await?;
    }

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
