//! Clinical note evidence and ordinary effective template revisions. No signing semantics.
use crate::clinical::{ClinicalNoteStatus, ClinicalNoteType};
use chrono::{DateTime, NaiveDate, Utc};
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
#[into_params(parameter_in = Query)]
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
#[into_params(parameter_in = Query)]
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
/// Lightweight immutable revision evidence; body content is an exact-detail read.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct NoteTemplateHistoryItem {
    pub id: Uuid,
    pub template_id: Uuid,
    pub version: i64,
    pub title: String,
    pub note_type: ClinicalNoteType,
    /// Availability recorded in this revision, not the template's current state.
    pub is_active: bool,
    pub change_summary: Option<String>,
    pub created_by_user_id: Option<Uuid>,
    pub created_by_display_name: Option<String>,
    pub created_at: DateTime<Utc>,
    pub imported_legacy: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct NoteTemplateVersionDetail {
    #[serde(flatten)]
    pub history: NoteTemplateHistoryItem,
    /// The exact saved representation, including legacy or malformed content.
    pub body_template: String,
    /// Current protected root metadata, separately identified from saved evidence.
    pub current_template: GovernedNoteTemplateItem,
}
#[derive(Clone, Debug, Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields)]
pub struct NoteTemplateHistoryQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum NoteTemplatePreviewMode {
    All,
    EmptyOnly,
    Selected,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct PreviewClinicalNoteTemplateRequest {
    pub template_id: Uuid,
    pub template_revision_id: Uuid,
    pub encounter_id: Option<Uuid>,
    pub apply_mode: NoteTemplatePreviewMode,
    #[serde(default)]
    #[schema(max_items = 100)]
    pub sections: Vec<String>,
    #[schema(max_length = 20_000)]
    pub base_body: String,
    /// Explicit clinician input, never an override of server demographic facts.
    #[schema(max_length = 500)]
    pub chief_complaint: Option<String>,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum NoteTemplatePreviewKind {
    Plain,
    Structured,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum NoteTemplatePreviewDateBasis {
    Utc,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct NoteTemplatePreviewUnresolvedToken {
    #[schema(max_length = 64)]
    pub name: String,
    pub count: u32,
}
/// Ephemeral proposed starter text. This is neither a note nor a saved receipt.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ClinicalNoteTemplatePreview {
    pub patient_id: Uuid,
    pub encounter_id: Option<Uuid>,
    pub template_id: Uuid,
    pub template_revision_id: Uuid,
    pub template_revision_version: i64,
    pub rendered_on: NaiveDate,
    pub date_basis: NoteTemplatePreviewDateBasis,
    pub kind: NoteTemplatePreviewKind,
    /// Plain string or a patch of generated canonical section values only.
    pub patch: serde_json::Value,
    #[schema(max_items = 100)]
    pub applied_sections: Vec<String>,
    #[schema(max_items = 32)]
    pub unresolved: Vec<NoteTemplatePreviewUnresolvedToken>,
    pub unresolved_truncated: bool,
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
