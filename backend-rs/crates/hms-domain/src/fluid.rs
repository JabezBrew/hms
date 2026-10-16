//! Fluid observations, immutable corrections and facility monitoring rules.
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum FluidIntakeCategory {
    Oral,
    Iv,
    Enteral,
    Blood,
}
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum FluidOutputCategory {
    Urine,
    Vomit,
    Stool,
    Drain,
    NgSuction,
    Other,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct FluidMetadata {
    pub intake_category: Option<FluidIntakeCategory>,
    pub intake_subcategory: Option<String>,
    pub output_category: Option<FluidOutputCategory>,
    pub output_subcategory: Option<String>,
    pub output_colour: Option<String>,
    pub notes: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct FluidObservationValues {
    pub recorded_at: DateTime<Utc>,
    pub intake_ml: i32,
    pub output_ml: i32,
    #[serde(default)]
    pub metadata: FluidMetadata,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateFluidObservationRequest {
    pub client_request_id: Uuid,
    pub admission_case_id: Uuid,
    pub values: FluidObservationValues,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CorrectFluidObservationRequest {
    pub client_request_id: Uuid,
    pub reason: String,
    pub replacement: FluidObservationValues,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct VoidFluidObservationRequest {
    pub client_request_id: Uuid,
    pub reason: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum FluidWriteKind {
    Created,
    Corrected,
    Voided,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct FluidWriteResult {
    pub client_request_id: Uuid,
    pub root_entry_id: Uuid,
    pub entry_id: Uuid,
    pub revision: i64,
    pub action: FluidWriteKind,
    pub replayed: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct FluidObservation {
    pub id: Uuid,
    pub root_entry_id: Uuid,
    pub patient_id: Uuid,
    pub admission_case_id: Uuid,
    pub revision: i64,
    pub values: FluidObservationValues,
    pub created_at: DateTime<Utc>,
    pub recorded_by_user_id: Option<Uuid>,
    pub recorded_by_display_name: Option<String>,
    pub current: bool,
    pub closed_by_action: Option<FluidWriteKind>,
    pub correction_reason: Option<String>,
    pub closed_at: Option<DateTime<Utc>>,
    pub closed_by_user_id: Option<Uuid>,
    pub closed_by_display_name: Option<String>,
    pub replacement_entry_id: Option<Uuid>,
}
#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
#[into_params(parameter_in=Query)]
pub struct FluidObservationQuery {
    pub patient_id: Option<Uuid>,
    pub admission_case_id: Option<Uuid>,
    pub recorded_from: Option<DateTime<Utc>>,
    pub recorded_before: Option<DateTime<Utc>>,
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub descending: Option<bool>,
    /// Include the last recorded version of voided observations for history review. Totals remain effective-only.
    pub include_closed: Option<bool>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct FluidCategoryTotals {
    pub category: String,
    pub total_ml: i64,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct FluidEffectiveSummary {
    pub entry_count: i64,
    pub total_intake_ml: i64,
    pub total_output_ml: i64,
    pub net_ml: i64,
    pub intake_breakdown: Vec<FluidCategoryTotals>,
    pub output_breakdown: Vec<FluidCategoryTotals>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct FluidRuleValues {
    pub min_daily_intake_target: i32,
    pub max_daily_output_threshold: i32,
    pub negative_balance_alert_threshold: i32,
    pub positive_balance_alert_threshold: i32,
    pub enable_intake_alerts: bool,
    pub enable_output_alerts: bool,
    pub enable_balance_alerts: bool,
}
impl Default for FluidRuleValues {
    fn default() -> Self {
        Self {
            min_daily_intake_target: 1500,
            max_daily_output_threshold: 3000,
            negative_balance_alert_threshold: -500,
            positive_balance_alert_threshold: 2000,
            enable_intake_alerts: false,
            enable_output_alerts: false,
            enable_balance_alerts: false,
        }
    }
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct FluidRuleSettings {
    pub version: i64,
    pub configured: bool,
    pub values: FluidRuleValues,
    pub updated_at: Option<DateTime<Utc>>,
    pub updated_by_user_id: Option<Uuid>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct UpdateFluidRuleSettingsRequest {
    pub client_request_id: Uuid,
    pub expected_version: i64,
    pub reason: String,
    pub values: FluidRuleValues,
}
#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
#[into_params(parameter_in=Query)]
pub struct FluidAssessmentQuery {
    pub admission_case_id: Uuid,
    pub date: Option<NaiveDate>,
}
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum FluidAssessmentStatus {
    Unconfigured,
    Disabled,
    NoData,
    Assessed,
}
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum FluidConditionKind {
    LowIntake,
    HighOutput,
    NegativeBalance,
    PositiveBalance,
}
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum FluidConditionSeverity {
    Warning,
    Critical,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct FluidMonitoringCondition {
    pub kind: FluidConditionKind,
    pub severity: FluidConditionSeverity,
    pub value_ml: i64,
    pub threshold_ml: i32,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct FluidAssessment {
    pub patient_id: Uuid,
    pub admission_case_id: Uuid,
    pub date: NaiveDate,
    pub evaluated_at: DateTime<Utc>,
    pub partial_day: bool,
    pub status: FluidAssessmentStatus,
    pub settings: FluidRuleSettings,
    pub entry_count: i64,
    pub total_intake_ml: i64,
    pub total_output_ml: i64,
    pub net_ml: i64,
    pub conditions: Vec<FluidMonitoringCondition>,
}
