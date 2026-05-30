use chrono::{DateTime, NaiveDate, Utc};
use hms_db::auth::{EndBreakGlassGrants, StartBreakGlassGrant};
use hms_db::patients::{
    NewPatient, PatientContextCursor, PatientContextFilters, PatientCursor, PatientUpdate,
};
use hms_domain::auth::{
    BreakGlassGrant, BreakGlassGrantDenialReason, BreakGlassGrantOutcome,
    ClinicalPatientAccessDecision, EndBreakGlassGrantsResponse, StartBreakGlassGrantRequest,
};
use hms_domain::clinical::PatientChronicleSummary;
use hms_domain::deployment::{FeatureKey, PermissionCode};
use hms_domain::patients::{
    CreatePatientRequest, PatientContextListItem, PatientDetail, PatientListItem, PatientListQuery,
    PatientRecord, PatientRegistrationValidationRule, Sex, UpdatePatientRequest,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::cursor_list;
use crate::error::ApiError;
use crate::response::{list, object, ListResponse, ObjectResponse, PageInfo};
use crate::state::AppState;

const DEFAULT_LIMIT: u8 = 25;
const DEFAULT_CONTEXT_LIMIT: u8 = 10;
const MAX_LIMIT: u8 = 100;
const VALIDATION_RULE_LIMIT: u8 = 50;
const CHRONICLE_SUMMARY_LIMIT: i64 = 25;
const CHRONICLE_STARTUP_SUMMARY_LIMIT: i64 = 5;
const CHRONICLE_TIMELINE_DEFAULT_LIMIT: u8 = 20;
const CHRONICLE_TIMELINE_MAX_LIMIT: u8 = 50;
const MAX_BREAK_GLASS_REASON_LEN: usize = 500;

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
#[into_params(parameter_in = Query)]
pub struct ChronicleTimelineQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    #[serde(alias = "entry_type", rename = "type")]
    pub entry_type: Option<String>,
    pub search: Option<String>,
    pub encounter_id: Option<Uuid>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct PatientChronicleStartup {
    pub patient: PatientDetail,
    pub identity: PatientChronicleIdentitySummary,
    pub generated_at: DateTime<Utc>,
    pub active_context: PatientChronicleActiveContext,
    pub active_encounter: Option<PatientChronicleEncounterSummary>,
    pub active_admission: Option<PatientChronicleAdmissionSummary>,
    pub encounters: Vec<PatientChronicleEncounterSummary>,
    pub care_team: Vec<PatientChronicleCareTeamMember>,
    pub summaries: PatientChronicleSummarySlices,
    pub timeline: ListResponse<PatientChronicleTimelineEntry>,
    pub permissions: PatientChronicleActionAvailability,
    pub active_medications: Vec<hms_domain::clinical::PrescriptionListItem>,
    pub allergies: Vec<hms_domain::clinical::AllergyListItem>,
    pub lab_results: Vec<PatientChronicleLabSummary>,
    pub latest_vitals: Option<hms_domain::clinical::ChartEntryListItem>,
    pub notes: Vec<hms_domain::clinical::ClinicalNoteListItem>,
    pub problems: Vec<hms_domain::clinical::ProblemListItem>,
    pub prescriptions: Vec<hms_domain::clinical::PrescriptionListItem>,
    pub chart_entries: Vec<hms_domain::clinical::ChartEntryListItem>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct PatientChronicleIdentitySummary {
    pub id: Uuid,
    pub patient_code: String,
    pub display_name: String,
    pub date_of_birth: NaiveDate,
    pub sex: Sex,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct PatientChronicleActiveContext {
    pub encounter: Option<PatientChronicleEncounterSummary>,
    pub admission: Option<PatientChronicleAdmissionSummary>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct PatientChronicleEncounterSummary {
    pub id: Uuid,
    pub patient_id: Uuid,
    pub encounter_type: String,
    pub status: String,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct PatientChronicleAdmissionSummary {
    pub admission_id: Uuid,
    pub patient_id: Uuid,
    pub ward_id: Uuid,
    pub ward_name: String,
    pub bed_id: Option<Uuid>,
    pub bed_code: Option<String>,
    pub status: String,
    pub admitted_at: DateTime<Utc>,
    pub discharged_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct PatientChronicleCareTeamMember {
    pub assignment_id: Uuid,
    pub encounter_id: Uuid,
    pub user_id: Uuid,
    pub display_name: String,
    pub role: String,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct PatientChronicleLabSummary {
    pub id: Uuid,
    pub order_id: Uuid,
    pub specimen_id: Uuid,
    pub patient_id: Uuid,
    pub patient_code: String,
    pub test_id: Uuid,
    pub test_name: String,
    pub value: String,
    pub unit: Option<String>,
    pub status: String,
    pub entered_at: DateTime<Utc>,
    pub verified_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct PatientChronicleSummarySlices {
    pub problems: Vec<hms_domain::clinical::ProblemListItem>,
    pub allergies: Vec<hms_domain::clinical::AllergyListItem>,
    pub medications: Vec<hms_domain::clinical::PrescriptionListItem>,
    pub labs: Vec<PatientChronicleLabSummary>,
    pub vitals: Vec<hms_domain::clinical::ChartEntryListItem>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct PatientChronicleTimelineEntry {
    pub id: Uuid,
    pub entry_id: Uuid,
    pub entry_type: String,
    pub r#type: String,
    pub occurred_at: DateTime<Utc>,
    pub timestamp: DateTime<Utc>,
    pub encounter_id: Option<Uuid>,
    pub title: String,
    pub summary: Option<String>,
    pub data: JsonValue,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct PatientChronicleActionAvailability {
    pub can_view_chronicle: bool,
    pub can_add_note: bool,
    pub can_record_vitals: bool,
    pub can_prescribe: bool,
    pub can_order_labs: bool,
    pub can_manage_admission: bool,
    pub can_request_break_glass: bool,
    pub read_only: bool,
}

#[derive(Clone)]
pub struct PatientsService {
    state: AppState,
}

impl PatientsService {
    pub fn new(state: AppState) -> Self {
        Self { state }
    }

    fn facility_id(&self) -> Uuid {
        self.state.facility_id()
    }

    fn pool(&self) -> &hms_db::PgPool {
        self.state.db_pool()
    }

    pub async fn list_patients(
        &self,
        ctx: &hms_access::RequestContext,
        query: PatientListQuery,
    ) -> Result<ListResponse<PatientListItem>, ApiError> {
        require_patient_registry_access(ctx, self.facility_id())?;
        let include_total = query.include_total.unwrap_or(false);
        let search = query
            .search
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let status = query.status.clone();
        let page = patient_page_request(&query)?;
        let page_size = page.limit;
        let cacheable_hot_page =
            page.cursor.is_none() && query.patient_id.is_none() && !include_total;
        if cacheable_hot_page {
            if let Some(response) = self
                .state
                .cached_patient_list(ctx, search, &status, page_size)
            {
                return Ok(response);
            }
        }
        let fetch_limit = page.fetch_limit();
        let patients = hms_db::patients::list_patient_registry(
            self.pool(),
            self.facility_id(),
            page.cursor,
            fetch_limit,
            search,
            status.clone(),
        )
        .await
        .map_err(|_| ApiError::conflict("patient_list_failed", "Patients could not be loaded."))?;
        let total_count = if include_total {
            Some(
                hms_db::patients::count_patients(
                    self.pool(),
                    self.facility_id(),
                    search,
                    status.clone(),
                )
                .await
                .map_err(|_| {
                    ApiError::conflict(
                        "patient_count_failed",
                        "Patient registry count could not be loaded.",
                    )
                })?,
            )
        } else {
            None
        };

        let mut visible = Vec::with_capacity(patients.len());
        for patient in patients {
            if hms_access::require_patient_demographics_access(ctx, &patient.patient).is_ok() {
                visible.push(patient);
            }
        }

        let page = cursor_list::page_response(visible, page.limit, |patient| {
            cursor_list::encode_cursor(patient.patient.created_at, patient.patient.id)
        });

        let mut response = list(
            page.data
                .iter()
                .map(patient_list_item_from_record)
                .collect(),
            page.page,
        );
        if let Some(total_count) = total_count {
            response.meta = json!({
                "count_exact": true,
                "total_count": total_count,
            });
        }
        if cacheable_hot_page {
            self.state
                .put_cached_patient_list(ctx, search, &status, page_size, response.clone());
        }
        Ok(response)
    }

    pub async fn list_context_patients(
        &self,
        ctx: &hms_access::RequestContext,
        query: PatientListQuery,
    ) -> Result<ListResponse<PatientContextListItem>, ApiError> {
        require_patient_context_list_access(ctx, self.facility_id())?;
        let page = patient_context_page_request(&query)?;
        let fetch_limit = page.fetch_limit();
        let patients = hms_db::patients::list_context_patients(
            self.pool(),
            self.facility_id(),
            ctx.user_id,
            page.cursor,
            fetch_limit,
            PatientContextFilters {
                patient_id: query.patient_id,
                search: query.search.clone(),
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "patient_context_list_failed",
                "Context patients could not be loaded.",
            )
        })?;

        Ok(cursor_list::page_response(
            patients,
            page.limit,
            |patient| cursor_list::encode_cursor(patient.updated_at, patient.id),
        ))
    }

    pub async fn list_patient_validation_rules(
        &self,
        ctx: &hms_access::RequestContext,
    ) -> Result<ListResponse<PatientRegistrationValidationRule>, ApiError> {
        require_patient_validation_rule_access(ctx, self.facility_id())?;
        let rules = hms_db::patients::list_patient_registration_validation_rules(
            self.pool(),
            self.facility_id(),
            VALIDATION_RULE_LIMIT as i64,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "patient_validation_rules_failed",
                "Patient validation rules could not be loaded.",
            )
        })?;

        Ok(list(
            rules,
            PageInfo {
                next_cursor: None,
                has_next: false,
                limit: VALIDATION_RULE_LIMIT,
            },
        ))
    }

    pub async fn create_patient(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreatePatientRequest,
    ) -> Result<ObjectResponse<PatientDetail>, ApiError> {
        hms_access::can_create_patient(ctx, self.facility_id()).map_err(|_| {
            ApiError::forbidden(
                "permission_denied",
                "You do not have permission to register patients.",
            )
        })?;

        let first_name = normalize_name(payload.first_name, "first_name")?;
        let last_name = normalize_name(payload.last_name, "last_name")?;
        let id = Uuid::new_v4();
        let patient_code = format!("P-{}", &id.simple().to_string()[..10].to_uppercase());
        let patient = hms_db::patients::create_patient(
            self.pool(),
            NewPatient {
                id,
                facility_id: self.facility_id(),
                patient_code,
                first_name,
                last_name,
                date_of_birth: payload.date_of_birth,
                sex: payload.sex,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict("patient_create_failed", "Patient could not be created.")
        })?;

        self.state.invalidate_patient_list_cache();
        Ok(object(PatientDetail::from(&patient)))
    }

    pub async fn get_patient(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<PatientDetail>, ApiError> {
        let patient = load_patient_for_access(
            &self.state,
            ctx,
            id,
            "You do not have access to this patient.",
        )
        .await?;

        Ok(object(PatientDetail::from(&patient)))
    }

    pub async fn get_patient_chronicle(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        query: ChronicleTimelineQuery,
    ) -> Result<ObjectResponse<PatientChronicleStartup>, ApiError> {
        let (patient, decision) = load_patient_for_chronicle_access(&self.state, ctx, id).await?;
        let page = chronicle_timeline_page_request(&query)?;
        let filters = chronicle_timeline_filters(&query)?;
        let startup = hms_db::clinical::patient_chronicle_startup_for_patient(
            self.pool(),
            &patient,
            CHRONICLE_STARTUP_SUMMARY_LIMIT,
            page.fetch_limit(),
            page.cursor,
            filters,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "patient_chronicle_load_failed",
                "Patient Chronicle could not be loaded.",
            )
        })?;

        let response = patient_chronicle_startup_from_read(
            &patient,
            startup,
            page.limit,
            Utc::now(),
            &decision,
            ctx,
            self.facility_id(),
        );

        Ok(object(response))
    }

    pub async fn list_patient_chronicle_timeline(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        query: ChronicleTimelineQuery,
    ) -> Result<ListResponse<PatientChronicleTimelineEntry>, ApiError> {
        let (patient, _decision) = load_patient_for_chronicle_access(&self.state, ctx, id).await?;
        let page = chronicle_timeline_page_request(&query)?;
        let fetch_limit = page.fetch_limit();
        let filters = chronicle_timeline_filters(&query)?;
        let rows = hms_db::clinical::patient_chronicle_timeline(
            self.pool(),
            patient.facility_id,
            patient.id,
            page.cursor,
            fetch_limit,
            filters,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "patient_chronicle_timeline_load_failed",
                "Patient Chronicle timeline could not be loaded.",
            )
        })?;

        Ok(cursor_list::page_response(
            rows.into_iter()
                .map(patient_chronicle_timeline_entry_from_read)
                .collect(),
            page.limit,
            |entry| cursor_list::encode_cursor(entry.occurred_at, entry.id),
        ))
    }

    pub async fn get_patient_chronicle_summary(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<PatientChronicleSummary>, ApiError> {
        let (patient, _decision) = load_patient_for_chronicle_access(&self.state, ctx, id).await?;

        let summary = hms_db::clinical::patient_chronicle_summary_for_patient(
            self.pool(),
            patient,
            CHRONICLE_SUMMARY_LIMIT,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "patient_chronicle_load_failed",
                "Patient Chronicle could not be loaded.",
            )
        })?;

        Ok(object(summary))
    }

    pub async fn start_break_glass_grant(
        &self,
        ctx: &hms_access::RequestContext,
        patient_id: Uuid,
        payload: StartBreakGlassGrantRequest,
    ) -> Result<ObjectResponse<BreakGlassGrant>, ApiError> {
        let reason_text = normalize_break_glass_reason(payload.reason_text)?;
        let outcome = hms_db::auth::start_break_glass_grant(
            self.pool(),
            StartBreakGlassGrant {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                user_id: ctx.user_id,
                patient_id,
                category: payload.category,
                reason_text,
                request_id: Some(ctx.request_id.clone()),
                now: Utc::now(),
                reauth_verified_at: ctx.reauth.verified_at,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "break_glass_grant_failed",
                "Break-glass access could not be granted.",
            )
        })?;

        match outcome {
            BreakGlassGrantOutcome::Granted(grant) => Ok(object(grant)),
            BreakGlassGrantOutcome::Denied(reason) => Err(break_glass_denied(reason)),
        }
    }

    pub async fn end_break_glass_grants(
        &self,
        ctx: &hms_access::RequestContext,
        patient_id: Uuid,
    ) -> Result<ObjectResponse<EndBreakGlassGrantsResponse>, ApiError> {
        let ended_count = hms_db::auth::end_break_glass_grants(
            self.pool(),
            EndBreakGlassGrants {
                facility_id: self.facility_id(),
                user_id: ctx.user_id,
                patient_id,
                ended_by_user_id: ctx.user_id,
                request_id: Some(ctx.request_id.clone()),
                now: Utc::now(),
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "break_glass_end_failed",
                "Break-glass grants could not be ended.",
            )
        })?;

        Ok(object(EndBreakGlassGrantsResponse { ended_count }))
    }

    pub async fn update_patient(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        payload: UpdatePatientRequest,
    ) -> Result<ObjectResponse<PatientDetail>, ApiError> {
        let existing = load_patient_for_access(
            &self.state,
            ctx,
            id,
            "You do not have access to this patient.",
        )
        .await?;

        hms_access::can_update_patient(ctx, &existing).map_err(|_| {
            ApiError::forbidden(
                "patient_access_denied",
                "You do not have permission to update this patient.",
            )
        })?;
        validate_update_payload(&payload)?;

        let first_name = payload
            .first_name
            .map(|value| normalize_name(value, "first_name"))
            .transpose()?;
        let last_name = payload
            .last_name
            .map(|value| normalize_name(value, "last_name"))
            .transpose()?;

        let patient = hms_db::patients::update_patient(
            self.pool(),
            PatientUpdate {
                id,
                facility_id: self.facility_id(),
                first_name,
                last_name,
                date_of_birth: payload.date_of_birth,
                sex: payload.sex,
                status: payload.status,
                actor_user_id: ctx.user_id,
                request_id: Some(ctx.request_id.clone()),
            },
        )
        .await
        .map_err(|_| ApiError::conflict("patient_update_failed", "Patient could not be updated."))?
        .ok_or_else(|| ApiError::not_found("patient_not_found", "Patient was not found."))?;

        self.state.invalidate_patient_list_cache();
        hms_access::require_patient_demographics_access(ctx, &patient).map_err(|_| {
            ApiError::forbidden(
                "patient_access_denied",
                "You do not have access to this patient.",
            )
        })?;

        Ok(object(PatientDetail::from(&patient)))
    }
}

impl AppState {
    pub fn patients_service(&self) -> PatientsService {
        PatientsService::new(self.clone())
    }
}

async fn load_patient_for_access(
    state: &AppState,
    ctx: &hms_access::RequestContext,
    patient_id: Uuid,
    denied_message: &'static str,
) -> Result<PatientRecord, ApiError> {
    let patient = hms_db::patients::get_patient(state.db_pool(), state.facility_id(), patient_id)
        .await
        .map_err(|_| ApiError::conflict("patient_load_failed", "Patient could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("patient_not_found", "Patient was not found."))?;

    hms_access::require_patient_demographics_access(ctx, &patient)
        .map_err(|_| ApiError::forbidden("patient_access_denied", denied_message))?;
    Ok(patient)
}

async fn load_patient_for_chronicle_access(
    state: &AppState,
    ctx: &hms_access::RequestContext,
    patient_id: Uuid,
) -> Result<(PatientRecord, ClinicalPatientAccessDecision), ApiError> {
    let patient = load_patient_for_access(
        state,
        ctx,
        patient_id,
        "You do not have access to this patient Chronicle.",
    )
    .await?;
    let now = Utc::now();
    let evidence = hms_db::auth::clinical_patient_access_evidence(
        state.db_pool(),
        state.facility_id(),
        ctx.user_id,
        patient.id,
        now,
    )
    .await
    .map_err(|_| {
        ApiError::conflict(
            "patient_access_check_failed",
            "Patient access could not be checked.",
        )
    })?;
    let decision = hms_access::evaluate_clinical_patient_access(ctx, &patient, &evidence, now)
        .map_err(|_| {
            ApiError::forbidden(
                "patient_access_denied",
                "You do not have access to this patient Chronicle.",
            )
        })?;
    Ok((patient, decision))
}

fn require_patient_registry_access(
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
) -> Result<(), ApiError> {
    hms_access::require_patient_workflow_access(
        ctx,
        facility_id,
        PermissionCode::PatientDemographicsView,
    )
    .map_err(|error| match error {
        hms_access::AccessError::PatientWorkflowAccessDenied => ApiError::forbidden(
            "patient_access_denied",
            "You do not have access to the patient registry.",
        ),
        hms_access::AccessError::MissingPermission => ApiError::forbidden(
            "patient_access_denied",
            "You do not have access to the patient registry.",
        ),
        other => ApiError::from(other),
    })
}

fn require_patient_context_list_access(
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
) -> Result<(), ApiError> {
    hms_access::require_patient_workflow_access(
        ctx,
        facility_id,
        PermissionCode::PatientDemographicsView,
    )
    .map_err(|error| match error {
        hms_access::AccessError::PatientWorkflowAccessDenied => ApiError::forbidden(
            "patient_access_denied",
            "You do not have access to patient context lists.",
        ),
        hms_access::AccessError::MissingPermission => ApiError::forbidden(
            "patient_access_denied",
            "You do not have access to patient context lists.",
        ),
        other => ApiError::from(other),
    })
}

fn require_patient_validation_rule_access(
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
) -> Result<(), ApiError> {
    hms_access::require_feature(ctx, FeatureKey::Patients)?;
    hms_access::require_any_facility_permission(
        ctx,
        facility_id,
        &[PermissionCode::PatientCreate, PermissionCode::PatientUpdate],
    )
    .map_err(|_| {
        ApiError::forbidden(
            "permission_denied",
            "You do not have permission to use patient registration rules.",
        )
    })
}

fn patient_page_request(
    query: &PatientListQuery,
) -> Result<cursor_list::CursorPage<PatientCursor>, ApiError> {
    Ok(cursor_list::page_request(
        query.cursor.as_deref(),
        query.limit,
        DEFAULT_LIMIT,
        MAX_LIMIT,
        |created_at, id| PatientCursor { created_at, id },
    )?)
}

fn patient_context_page_request(
    query: &PatientListQuery,
) -> Result<cursor_list::CursorPage<PatientContextCursor>, ApiError> {
    Ok(cursor_list::page_request(
        query.cursor.as_deref(),
        query.limit,
        DEFAULT_CONTEXT_LIMIT,
        MAX_LIMIT,
        |updated_at, patient_id| PatientContextCursor {
            updated_at,
            patient_id,
        },
    )?)
}

fn patient_list_item_from_record(value: &hms_db::patients::PatientListRecord) -> PatientListItem {
    let mut item = PatientListItem::from(&value.patient);
    item.patient_location = value.patient_location.clone();
    item
}

fn chronicle_timeline_page_request(
    query: &ChronicleTimelineQuery,
) -> Result<cursor_list::CursorPage<hms_db::clinical::ClinicalCursor>, ApiError> {
    Ok(cursor_list::page_request(
        query.cursor.as_deref(),
        query.limit,
        CHRONICLE_TIMELINE_DEFAULT_LIMIT,
        CHRONICLE_TIMELINE_MAX_LIMIT,
        |occurred_at, id| hms_db::clinical::ClinicalCursor { occurred_at, id },
    )?)
}

fn chronicle_timeline_filters(
    query: &ChronicleTimelineQuery,
) -> Result<hms_db::clinical::ChronicleTimelineFilters, ApiError> {
    Ok(hms_db::clinical::ChronicleTimelineFilters {
        entry_type: normalize_chronicle_entry_filter(query.entry_type.as_deref())?,
        search: query
            .search
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned),
        encounter_id: query.encounter_id,
    })
}

fn normalize_chronicle_entry_filter(value: Option<&str>) -> Result<Option<String>, ApiError> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let normalized = match value {
        "all" => None,
        "note" | "notes" | "progress_note" | "soap_note" | "nursing_note" | "admission_note"
        | "discharge_note" | "consult_note" => Some("note"),
        "vital" | "vitals" => Some("vitals"),
        "medication" | "medications" | "prescription" | "prescriptions" => Some("prescription"),
        "lab" | "labs" | "lab_result" | "laboratory" => Some("lab_result"),
        "problem" | "problems" => Some("problem"),
        "allergy" | "allergies" => Some("allergy"),
        "ward_round" | "ward_rounds" => Some("ward_round"),
        _ => {
            return Err(ApiError::bad_request(
                "invalid_chronicle_filter",
                "Chronicle type filter is invalid.",
            ))
        }
    };

    Ok(normalized.map(str::to_owned))
}

fn patient_chronicle_startup_from_read(
    patient: &PatientRecord,
    read: hms_db::clinical::PatientChronicleStartupRead,
    timeline_page_size: u8,
    generated_at: DateTime<Utc>,
    decision: &ClinicalPatientAccessDecision,
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
) -> PatientChronicleStartup {
    let patient_detail = PatientDetail::from(patient);
    let identity = PatientChronicleIdentitySummary {
        id: patient.id,
        patient_code: patient.patient_code.clone(),
        display_name: patient.display_name(),
        date_of_birth: patient.date_of_birth,
        sex: patient.sex.clone(),
    };
    let encounter = read
        .active_encounter
        .map(patient_chronicle_encounter_from_read);
    let admission = read
        .active_admission
        .map(patient_chronicle_admission_from_read);
    let labs = read
        .lab_results
        .into_iter()
        .map(patient_chronicle_lab_from_read)
        .collect::<Vec<_>>();
    let timeline = cursor_list::page_response(
        read.timeline_entries
            .into_iter()
            .map(patient_chronicle_timeline_entry_from_read)
            .collect(),
        timeline_page_size,
        |entry| cursor_list::encode_cursor(entry.occurred_at, entry.id),
    );

    PatientChronicleStartup {
        patient: patient_detail,
        identity,
        generated_at,
        active_context: PatientChronicleActiveContext {
            encounter: encounter.clone(),
            admission: admission.clone(),
        },
        active_encounter: encounter,
        active_admission: admission,
        encounters: read
            .encounters
            .into_iter()
            .map(patient_chronicle_encounter_from_read)
            .collect(),
        care_team: read
            .care_team
            .into_iter()
            .map(patient_chronicle_care_team_from_read)
            .collect(),
        summaries: PatientChronicleSummarySlices {
            problems: read.problems.clone(),
            allergies: read.allergies.clone(),
            medications: read.prescriptions.clone(),
            labs: labs.clone(),
            vitals: read.chart_entries.clone(),
        },
        timeline,
        permissions: chronicle_permissions(ctx, facility_id, decision),
        active_medications: read.prescriptions.clone(),
        allergies: read.allergies.clone(),
        lab_results: labs,
        latest_vitals: read.chart_entries.first().cloned(),
        notes: read.notes,
        problems: read.problems,
        prescriptions: read.prescriptions,
        chart_entries: read.chart_entries,
    }
}

fn patient_chronicle_encounter_from_read(
    read: hms_db::clinical::ChronicleEncounterRead,
) -> PatientChronicleEncounterSummary {
    PatientChronicleEncounterSummary {
        id: read.id,
        patient_id: read.patient_id,
        encounter_type: read.encounter_type,
        status: read.status,
        started_at: read.started_at,
        ended_at: read.ended_at,
    }
}

fn patient_chronicle_admission_from_read(
    read: hms_db::clinical::ChronicleAdmissionRead,
) -> PatientChronicleAdmissionSummary {
    PatientChronicleAdmissionSummary {
        admission_id: read.admission_id,
        patient_id: read.patient_id,
        ward_id: read.ward_id,
        ward_name: read.ward_name,
        bed_id: read.bed_id,
        bed_code: read.bed_code,
        status: read.status,
        admitted_at: read.admitted_at,
        discharged_at: read.discharged_at,
    }
}

fn patient_chronicle_care_team_from_read(
    read: hms_db::clinical::ChronicleCareTeamMemberRead,
) -> PatientChronicleCareTeamMember {
    PatientChronicleCareTeamMember {
        assignment_id: read.assignment_id,
        encounter_id: read.encounter_id,
        user_id: read.user_id,
        display_name: read.display_name,
        role: read.role,
        is_active: read.is_active,
        created_at: read.created_at,
    }
}

fn patient_chronicle_lab_from_read(
    read: hms_db::clinical::ChronicleLabResultRead,
) -> PatientChronicleLabSummary {
    PatientChronicleLabSummary {
        id: read.id,
        order_id: read.order_id,
        specimen_id: read.specimen_id,
        patient_id: read.patient_id,
        patient_code: read.patient_code,
        test_id: read.test_id,
        test_name: read.test_name,
        value: read.value,
        unit: read.unit,
        status: read.status,
        entered_at: read.entered_at,
        verified_at: read.verified_at,
    }
}

fn patient_chronicle_timeline_entry_from_read(
    read: hms_db::clinical::ChronicleTimelineEntryRead,
) -> PatientChronicleTimelineEntry {
    PatientChronicleTimelineEntry {
        id: read.entry_id,
        entry_id: read.entry_id,
        r#type: read.entry_type.clone(),
        entry_type: read.entry_type,
        occurred_at: read.occurred_at,
        timestamp: read.occurred_at,
        encounter_id: read.encounter_id,
        title: read.title,
        summary: read.summary,
        data: read.data,
    }
}

fn chronicle_permissions(
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
    decision: &ClinicalPatientAccessDecision,
) -> PatientChronicleActionAvailability {
    let can_write_clinical =
        !decision.read_only && hms_access::require_clinical_write_access(ctx, facility_id).is_ok();

    PatientChronicleActionAvailability {
        can_view_chronicle: true,
        can_add_note: can_write_clinical,
        can_record_vitals: can_write_clinical,
        can_prescribe: can_write_clinical,
        can_order_labs: !decision.read_only
            && hms_access::require_lab_access(
                ctx,
                facility_id,
                PermissionCode::LaboratoryOrderManage,
            )
            .is_ok(),
        can_manage_admission: !decision.read_only
            && hms_access::require_patient_workflow_access(
                ctx,
                facility_id,
                PermissionCode::AdmissionManage,
            )
            .is_ok(),
        can_request_break_glass: ctx.has_permission(PermissionCode::PatientBreakGlassInvoke),
        read_only: decision.read_only,
    }
}

fn validate_update_payload(payload: &UpdatePatientRequest) -> Result<(), ApiError> {
    if payload.first_name.is_none()
        && payload.last_name.is_none()
        && payload.date_of_birth.is_none()
        && payload.sex.is_none()
        && payload.status.is_none()
    {
        return Err(ApiError::bad_request(
            "invalid_patient_update",
            "At least one patient field must be supplied.",
        ));
    }

    Ok(())
}

fn normalize_name(value: String, field: &'static str) -> Result<String, ApiError> {
    let value = value.trim();
    if value.is_empty() {
        let mut error = ApiError::bad_request("invalid_patient", "Patient request is invalid.");
        error.details = json!({ field: ["This field is required."] });
        return Err(error);
    }
    Ok(value.to_owned())
}

fn normalize_break_glass_reason(value: Option<String>) -> Result<Option<String>, ApiError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    if value.chars().count() > MAX_BREAK_GLASS_REASON_LEN {
        return Err(ApiError::bad_request(
            "invalid_break_glass_reason",
            "Break-glass reason is too long.",
        ));
    }
    Ok(Some(value.to_owned()))
}

fn break_glass_denied(reason: BreakGlassGrantDenialReason) -> ApiError {
    match reason {
        BreakGlassGrantDenialReason::MissingDedicatedPermission => ApiError::forbidden(
            "permission_denied",
            "Dedicated break-glass permission is required.",
        ),
        BreakGlassGrantDenialReason::ReauthRequired => ApiError::forbidden(
            "reauth_required",
            "Fresh reauthentication is required for break-glass access.",
        ),
        BreakGlassGrantDenialReason::PatientNotActive => ApiError::conflict(
            "break_glass_patient_not_active",
            "Break-glass access is only available for active patients.",
        ),
        BreakGlassGrantDenialReason::ActiveGrantAlreadyExists => ApiError::conflict(
            "break_glass_grant_exists",
            "An active break-glass grant already exists for this patient.",
        ),
        BreakGlassGrantDenialReason::TooManyActiveGrants => ApiError::conflict(
            "break_glass_grant_limit",
            "Too many active break-glass grants are already open.",
        ),
    }
}
