//! Clinical note evidence and ordinary effective template revisions. No signing semantics.
use crate::clinical::{ClinicalNoteStatus, ClinicalNoteType};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct RecordClinicalNoteRequest {
    pub client_request_id: Uuid,
    pub encounter_id: Option<Uuid>,
    pub template_revision_id: Option<Uuid>,
    pub note_type: ClinicalNoteType,
    pub title: String,
    pub body: String,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct AmendClinicalNoteRequest {
    pub client_request_id: Uuid,
    pub expected_version: i64,
    pub reason: String,
    pub body: String,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PinnedNoteTemplateRevision {
    pub template_id: Uuid,
    pub id: Uuid,
    pub version: i64,
    pub title: String,
    pub note_type: ClinicalNoteType,
    pub body_template: String,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ClinicalNoteRecordDetail {
    pub id: Uuid,
    pub patient_id: Uuid,
    pub encounter_id: Option<Uuid>,
    pub note_type: ClinicalNoteType,
    pub title: String,
    pub body: String,
    pub status: ClinicalNoteStatus,
    pub version: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub author_user_id: Option<Uuid>,
    pub author_display_name: Option<String>,
    pub can_amend: bool,
    pub template_revision: Option<PinnedNoteTemplateRevision>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ClinicalNoteHistoryItem {
    pub id: Uuid,
    pub note_id: Uuid,
    pub version: i64,
    pub created_at: DateTime<Utc>,
    pub recorded_by_user_id: Option<Uuid>,
    pub recorded_by_display_name: Option<String>,
    pub edit_reason: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ClinicalNoteVersionDetail {
    #[serde(flatten)]
    pub history: ClinicalNoteHistoryItem,
    pub body: String,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ClinicalNoteCommandAction {
    Recorded,
    Amended,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ClinicalNoteCommandReceipt {
    pub client_request_id: Uuid,
    pub action: ClinicalNoteCommandAction,
    pub reason: Option<String>,
    pub note: ClinicalNoteRecordDetail,
    pub replayed: bool,
}
#[derive(Clone, Debug, Deserialize, IntoParams, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ClinicalNoteHistoryQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TemplateActivity {
    Active,
    Inactive,
    All,
}
#[derive(Clone, Debug, Deserialize, IntoParams, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct GovernedNoteTemplateQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub search: Option<String>,
    pub activity: Option<TemplateActivity>,
    pub note_type: Option<ClinicalNoteType>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct GovernedNoteTemplateItem {
    pub id: Uuid,
    pub title: String,
    pub note_type: ClinicalNoteType,
    pub is_active: bool,
    pub version: i64,
    pub current_revision_id: Uuid,
    pub owner_user_id: Option<Uuid>,
    pub owner_display_name: Option<String>,
    pub can_manage: bool,
    pub updated_at: DateTime<Utc>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct GovernedNoteTemplateDetail {
    #[serde(flatten)]
    pub template: GovernedNoteTemplateItem,
    pub body_template: String,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct RecordNoteTemplateRequest {
    pub client_request_id: Uuid,
    pub title: String,
    pub note_type: ClinicalNoteType,
    pub body_template: String,
    pub is_active: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ChangeNoteTemplateRequest {
    pub client_request_id: Uuid,
    pub expected_version: i64,
    pub title: String,
    pub note_type: ClinicalNoteType,
    pub body_template: String,
    pub is_active: bool,
    pub change_summary: String,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum NoteTemplateCommandAction {
    Created,
    Changed,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct NoteTemplateCommandReceipt {
    pub client_request_id: Uuid,
    pub action: NoteTemplateCommandAction,
    pub template: GovernedNoteTemplateDetail,
    pub replayed: bool,
}
