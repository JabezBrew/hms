use chrono::{DateTime, Utc};
use hms_access::require_patient_demographics_access;
use hms_db::care::CareCursor;
use hms_domain::care::{
    AppointmentListItem, AppointmentListQuery, CheckInVisitRequest, ClinicListItem,
    CreateAppointmentRequest, CreateClinicRequest, CursorListQuery, UpdateAppointmentRequest,
    UpdateClinicRequest, VisitListItem, VisitListQuery, VisitStatus,
};
use hms_domain::deployment::PermissionCode;
use hms_domain::patients::PatientRecord;
use uuid::Uuid;

use crate::cursor_list;
use crate::error::ApiError;
use crate::response::{object, ListResponse, ObjectResponse};
use crate::state::AppState;

const DEFAULT_LIMIT: u8 = 25;
const MAX_LIMIT: u8 = 100;
const MAX_CLINIC_CODE_LEN: usize = 48;
const MAX_CLINIC_NAME_LEN: usize = 160;

#[derive(Clone)]
pub struct CareService {
    state: AppState,
}

impl CareService {
    pub fn new(state: AppState) -> Self {
        Self { state }
    }

    pub async fn list_appointments(
        &self,
        ctx: &hms_access::RequestContext,
        query: AppointmentListQuery,
    ) -> Result<ListResponse<AppointmentListItem>, ApiError> {
        require_workflow_list_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::AppointmentView,
        )?;
        let date = query.date;
        let clinic_id = query.clinic_id;
        let (cursor, page_size) = page_request(CursorListQuery {
            cursor: query.cursor,
            limit: query.limit,
        })?;
        let rows = self
            .state
            .list_appointments(cursor, date, clinic_id, page_size as i64 + 1)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "appointment_list_failed",
                    "Appointments could not be loaded.",
                )
            })?;

        Ok(page_response(rows, page_size, |item| {
            encode_cursor(item.starts_at, item.id)
        }))
    }

    pub async fn list_clinics(
        &self,
        ctx: &hms_access::RequestContext,
        query: CursorListQuery,
    ) -> Result<ListResponse<ClinicListItem>, ApiError> {
        require_workflow_list_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::AppointmentView,
        )?;
        let (cursor, page_size) = page_request(query)?;
        let rows = self
            .state
            .list_clinics(cursor, page_size as i64 + 1)
            .await
            .map_err(|_| {
                ApiError::conflict("clinic_list_failed", "Clinics could not be loaded.")
            })?;

        Ok(page_response(rows, page_size, |item| {
            encode_cursor(item.created_at, item.id)
        }))
    }

    pub async fn get_clinic(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<ClinicListItem>, ApiError> {
        require_workflow_list_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::AppointmentView,
        )?;
        let clinic = self
            .state
            .get_clinic(id)
            .await
            .map_err(|_| ApiError::conflict("clinic_load_failed", "Clinic could not be loaded."))?
            .ok_or_else(|| ApiError::not_found("clinic_not_found", "Clinic was not found."))?;

        Ok(object(clinic))
    }

    pub async fn create_clinic(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateClinicRequest,
    ) -> Result<ObjectResponse<ClinicListItem>, ApiError> {
        require_action_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::AppointmentManage,
        )?;
        let clinic = self
            .state
            .create_clinic(
                validate_required_text(payload.code, MAX_CLINIC_CODE_LEN, "clinic_code")?,
                validate_required_text(payload.name, MAX_CLINIC_NAME_LEN, "clinic_name")?,
                ctx.user_id,
            )
            .await
            .map_err(|_| {
                ApiError::conflict("clinic_create_failed", "Clinic could not be created.")
            })?;

        Ok(object(clinic))
    }

    pub async fn update_clinic(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        payload: UpdateClinicRequest,
    ) -> Result<ObjectResponse<ClinicListItem>, ApiError> {
        require_action_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::AppointmentManage,
        )?;
        let clinic = self
            .state
            .update_clinic(
                id,
                validate_optional_text(payload.code, MAX_CLINIC_CODE_LEN, "clinic_code")?,
                validate_optional_text(payload.name, MAX_CLINIC_NAME_LEN, "clinic_name")?,
                payload.is_active,
                ctx.user_id,
            )
            .await
            .map_err(|_| {
                ApiError::conflict("clinic_update_failed", "Clinic could not be updated.")
            })?
            .ok_or_else(|| ApiError::not_found("clinic_not_found", "Clinic was not found."))?;

        Ok(object(clinic))
    }

    pub async fn delete_clinic(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<ClinicListItem>, ApiError> {
        require_action_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::AppointmentManage,
        )?;
        let clinic = self
            .state
            .deactivate_clinic(id, ctx.user_id)
            .await
            .map_err(|_| {
                ApiError::conflict("clinic_delete_failed", "Clinic could not be deactivated.")
            })?
            .ok_or_else(|| ApiError::not_found("clinic_not_found", "Clinic was not found."))?;

        Ok(object(clinic))
    }

    pub async fn create_appointment(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateAppointmentRequest,
    ) -> Result<ObjectResponse<AppointmentListItem>, ApiError> {
        require_action_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::AppointmentManage,
        )?;
        let _patient = load_patient_for_access(&self.state, ctx, payload.patient_id).await?;
        if payload.ends_at <= payload.starts_at {
            return Err(ApiError::bad_request(
                "invalid_appointment",
                "Appointment end time must be after start time.",
            ));
        }

        let appointment = self
            .state
            .create_appointment(
                payload.patient_id,
                payload.starts_at,
                payload.ends_at,
                ctx.user_id,
            )
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "appointment_create_failed",
                    "Appointment could not be created.",
                )
            })?;

        Ok(object(appointment))
    }

    pub async fn get_appointment(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<AppointmentListItem>, ApiError> {
        Ok(object(
            load_appointment_for_access(&self.state, ctx, id, PermissionCode::AppointmentView)
                .await?,
        ))
    }

    pub async fn update_appointment(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        payload: UpdateAppointmentRequest,
    ) -> Result<ObjectResponse<AppointmentListItem>, ApiError> {
        let existing =
            load_appointment_for_access(&self.state, ctx, id, PermissionCode::AppointmentManage)
                .await?;

        if payload.starts_at.is_none() && payload.ends_at.is_none() {
            return Err(ApiError::bad_request(
                "invalid_appointment",
                "At least one appointment time field must be supplied.",
            ));
        }

        let starts_at = payload.starts_at.unwrap_or(existing.starts_at);
        let ends_at = payload.ends_at.unwrap_or(existing.ends_at);
        if ends_at <= starts_at {
            return Err(ApiError::bad_request(
                "invalid_appointment",
                "Appointment end time must be after start time.",
            ));
        }

        let appointment = self
            .state
            .update_appointment(id, Some(starts_at), Some(ends_at), ctx.user_id)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "appointment_update_failed",
                    "Appointment could not be updated.",
                )
            })?
            .ok_or_else(|| {
                ApiError::conflict(
                    "appointment_update_failed",
                    "Only scheduled appointments can be updated.",
                )
            })?;

        Ok(object(appointment))
    }

    pub async fn cancel_appointment(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<AppointmentListItem>, ApiError> {
        let _existing =
            load_appointment_for_access(&self.state, ctx, id, PermissionCode::AppointmentManage)
                .await?;
        let appointment = self
            .state
            .cancel_appointment(id, ctx.user_id)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "appointment_cancel_failed",
                    "Appointment could not be cancelled.",
                )
            })?
            .ok_or_else(|| {
                ApiError::conflict(
                    "appointment_cancel_failed",
                    "Only scheduled appointments can be cancelled.",
                )
            })?;

        Ok(object(appointment))
    }

    pub async fn list_visits(
        &self,
        ctx: &hms_access::RequestContext,
        query: VisitListQuery,
    ) -> Result<ListResponse<VisitListItem>, ApiError> {
        require_workflow_list_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::AppointmentView,
        )?;
        let clinic_id = query.clinic_id;
        let (cursor, page_size) = page_request(CursorListQuery {
            cursor: query.cursor,
            limit: query.limit,
        })?;
        let rows = self
            .state
            .list_visits(clinic_id, cursor, page_size as i64 + 1)
            .await
            .map_err(|_| ApiError::conflict("visit_list_failed", "Visits could not be loaded."))?;

        Ok(page_response(rows, page_size, |item| {
            encode_cursor(item.checked_in_at, item.id)
        }))
    }

    pub async fn get_visit(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<VisitListItem>, ApiError> {
        require_action_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::AppointmentView,
        )?;
        Ok(object(load_visit_for_access(&self.state, ctx, id).await?))
    }

    pub async fn check_in_visit(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CheckInVisitRequest,
    ) -> Result<ObjectResponse<VisitListItem>, ApiError> {
        require_action_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::AppointmentManage,
        )?;
        let _patient = load_patient_for_access(&self.state, ctx, payload.patient_id).await?;
        let visit = self
            .state
            .check_in_visit(
                payload.patient_id,
                payload.appointment_id,
                payload.clinic_id,
                ctx.user_id,
            )
            .await
            .map_err(|_| {
                ApiError::conflict("visit_check_in_failed", "Visit could not be checked in.")
            })?;

        Ok(object(visit))
    }

    pub async fn call_visit(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<VisitListItem>, ApiError> {
        self.update_visit_with_access(
            ctx,
            id,
            VisitStatus::Called,
            PermissionCode::AppointmentManage,
        )
        .await
    }

    pub async fn start_visit_consultation(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<VisitListItem>, ApiError> {
        self.update_visit_with_access(
            ctx,
            id,
            VisitStatus::InConsultation,
            PermissionCode::EncounterManage,
        )
        .await
    }

    pub async fn hold_visit(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<VisitListItem>, ApiError> {
        self.update_visit_with_access(
            ctx,
            id,
            VisitStatus::OnHold,
            PermissionCode::EncounterManage,
        )
        .await
    }

    pub async fn ready_checkout_visit(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<VisitListItem>, ApiError> {
        self.update_visit_with_access(
            ctx,
            id,
            VisitStatus::ReadyCheckout,
            PermissionCode::EncounterManage,
        )
        .await
    }

    pub async fn checkout_visit(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<VisitListItem>, ApiError> {
        self.update_visit_with_access(
            ctx,
            id,
            VisitStatus::CheckedOut,
            PermissionCode::AppointmentManage,
        )
        .await
    }

    pub async fn no_show_visit(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<VisitListItem>, ApiError> {
        self.update_visit_with_access(
            ctx,
            id,
            VisitStatus::NoShow,
            PermissionCode::AppointmentManage,
        )
        .await
    }

    async fn update_visit_with_access(
        &self,
        ctx: &hms_access::RequestContext,
        visit_id: Uuid,
        status: VisitStatus,
        permission: PermissionCode,
    ) -> Result<ObjectResponse<VisitListItem>, ApiError> {
        require_action_permission(ctx, self.state.facility_id(), permission)?;
        let _visit = load_visit_for_access(&self.state, ctx, visit_id).await?;
        let updated = self
            .state
            .update_visit_status(visit_id, status)
            .await
            .map_err(|_| ApiError::conflict("visit_update_failed", "Visit could not be updated."))?
            .ok_or_else(|| ApiError::not_found("visit_not_found", "Visit was not found."))?;

        Ok(object(updated))
    }
}

impl AppState {
    pub fn care_service(&self) -> CareService {
        CareService::new(self.clone())
    }
}

async fn load_appointment_for_access(
    state: &AppState,
    ctx: &hms_access::RequestContext,
    appointment_id: Uuid,
    permission: PermissionCode,
) -> Result<AppointmentListItem, ApiError> {
    require_action_permission(ctx, state.facility_id(), permission)?;
    let appointment = state
        .get_appointment(appointment_id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "appointment_load_failed",
                "Appointment could not be loaded.",
            )
        })?
        .ok_or_else(|| {
            ApiError::not_found("appointment_not_found", "Appointment was not found.")
        })?;
    let _patient = load_patient_for_access(state, ctx, appointment.patient_id).await?;
    Ok(appointment)
}

async fn load_visit_for_access(
    state: &AppState,
    ctx: &hms_access::RequestContext,
    visit_id: Uuid,
) -> Result<VisitListItem, ApiError> {
    let visit = state
        .get_visit(visit_id)
        .await
        .map_err(|_| ApiError::conflict("visit_load_failed", "Visit could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("visit_not_found", "Visit was not found."))?;
    let _patient = load_patient_for_access(state, ctx, visit.patient_id).await?;
    Ok(visit)
}

async fn load_patient_for_access(
    state: &AppState,
    ctx: &hms_access::RequestContext,
    patient_id: Uuid,
) -> Result<PatientRecord, ApiError> {
    let patient = state
        .get_patient(patient_id)
        .await
        .map_err(|_| ApiError::conflict("patient_load_failed", "Patient could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("patient_not_found", "Patient was not found."))?;

    require_patient_demographics_access(ctx, &patient).map_err(|_| {
        ApiError::forbidden(
            "patient_access_denied",
            "You do not have access to this patient.",
        )
    })?;

    Ok(patient)
}

fn require_workflow_list_access(
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
    permission: PermissionCode,
) -> Result<(), ApiError> {
    hms_access::require_patient_workflow_access(ctx, facility_id, permission).map_err(|error| {
        match error {
            hms_access::AccessError::PatientWorkflowAccessDenied => ApiError::forbidden(
                "patient_access_denied",
                "You do not have access to patient workflow lists.",
            ),
            other => ApiError::from(other),
        }
    })
}

fn require_action_permission(
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
    permission: PermissionCode,
) -> Result<(), ApiError> {
    hms_access::require_patient_workflow_access(ctx, facility_id, permission).map_err(|_| {
        ApiError::forbidden(
            "permission_denied",
            "You do not have permission to perform this action.",
        )
    })
}

fn validate_required_text(
    value: String,
    max_len: usize,
    field_name: &'static str,
) -> Result<String, ApiError> {
    validate_optional_text(Some(value), max_len, field_name)?.ok_or_else(|| {
        ApiError::bad_request("invalid_clinic", "Clinic code and name are required.")
    })
}

fn validate_optional_text(
    value: Option<String>,
    max_len: usize,
    field_name: &'static str,
) -> Result<Option<String>, ApiError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = value.trim().to_owned();
    if value.is_empty() {
        return Err(ApiError::bad_request(
            "invalid_clinic",
            "Clinic code and name cannot be blank.",
        ));
    }
    if value.len() > max_len {
        return Err(ApiError::bad_request(
            "invalid_clinic",
            match field_name {
                "clinic_code" => "Clinic code is too long.",
                "clinic_name" => "Clinic name is too long.",
                _ => "Clinic field is too long.",
            },
        ));
    }
    Ok(Some(value))
}

fn page_request(query: CursorListQuery) -> Result<(Option<CareCursor>, u8), ApiError> {
    let page = cursor_list::page_request(
        query.cursor.as_deref(),
        query.limit,
        DEFAULT_LIMIT,
        MAX_LIMIT,
        |occurred_at, id| CareCursor { occurred_at, id },
    )?;
    Ok((page.cursor, page.limit))
}

fn page_response<T, F>(rows: Vec<T>, page_size: u8, cursor_for: F) -> ListResponse<T>
where
    F: Fn(&T) -> String,
{
    cursor_list::page_response(rows, page_size, cursor_for)
}

fn encode_cursor(occurred_at: DateTime<Utc>, id: Uuid) -> String {
    cursor_list::encode_cursor(occurred_at, id)
}
