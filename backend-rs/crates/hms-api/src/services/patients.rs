use hms_db::patients::{
    NewPatient, PatientContextCursor, PatientContextFilters, PatientCursor, PatientUpdate,
};
use hms_domain::clinical::PatientChronicleSummary;
use hms_domain::deployment::{FeatureKey, PermissionCode};
use hms_domain::patients::{
    CreatePatientRequest, PatientContextListItem, PatientDetail, PatientListItem, PatientListQuery,
    PatientRecord, PatientRegistrationValidationRule, UpdatePatientRequest,
};
use serde_json::json;
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
        let search = query
            .search
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let page = patient_page_request(&query)?;
        let fetch_limit = page.fetch_limit();
        let patients = hms_db::patients::list_patients(
            self.pool(),
            self.facility_id(),
            page.cursor,
            fetch_limit,
            search,
            query.status,
        )
        .await
        .map_err(|_| ApiError::conflict("patient_list_failed", "Patients could not be loaded."))?;

        let mut visible = Vec::with_capacity(patients.len());
        for patient in patients {
            if hms_access::require_patient_demographics_access(ctx, &patient).is_ok() {
                visible.push(patient);
            }
        }

        let page = cursor_list::page_response(visible, page.limit, |patient| {
            cursor_list::encode_cursor(patient.created_at, patient.id)
        });

        Ok(list(
            page.data.iter().map(PatientListItem::from).collect(),
            page.page,
        ))
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
    ) -> Result<ObjectResponse<PatientChronicleSummary>, ApiError> {
        require_chronicle_read_access(ctx, self.facility_id())?;
        let _patient = load_patient_for_access(
            &self.state,
            ctx,
            id,
            "You do not have access to this patient Chronicle.",
        )
        .await?;

        let summary = self
            .state
            .patient_chronicle_summary(id, CHRONICLE_SUMMARY_LIMIT)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "patient_chronicle_load_failed",
                    "Patient Chronicle could not be loaded.",
                )
            })?
            .ok_or_else(|| ApiError::not_found("patient_not_found", "Patient was not found."))?;

        Ok(object(summary))
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

fn require_chronicle_read_access(
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
) -> Result<(), ApiError> {
    hms_access::require_chronicle_read_access(ctx, facility_id).map_err(|error| match error {
        hms_access::AccessError::FeatureDisabled => ApiError::from(error),
        _ => ApiError::forbidden(
            "patient_access_denied",
            "You do not have access to this patient Chronicle.",
        ),
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
