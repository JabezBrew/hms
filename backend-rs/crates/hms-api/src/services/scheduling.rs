use chrono::{DateTime, NaiveDate, Utc};
use hms_access::require_patient_demographics_access;
use hms_db::care::NewVisit;
use hms_db::scheduling::{
    AvailabilityFilters, NewBookableService, NewBookableSession, NewSchedulingException,
    SchedulingCursor, SessionFilters,
};
use hms_domain::care::VisitListItem;
use hms_domain::deployment::PermissionCode;
use hms_domain::patients::PatientRecord;
use hms_domain::scheduling::{
    ArriveAppointmentRequest, AvailabilityQuery, AvailabilityResponse, BookAppointmentRequest,
    BookAppointmentResponse, BookableServiceListItem, BookableSessionListItem,
    BookableSessionListQuery, CancelBookableSessionRequest, CreateBookableServiceRequest,
    CreateBookableSessionRequest, SchedulingExceptionItem, SchedulingExceptionRequest,
    SchedulingListQuery,
};
use uuid::Uuid;

use crate::cursor_list;
use crate::error::ApiError;
use crate::response::{object, ListResponse, ObjectResponse};
use crate::state::AppState;

const DEFAULT_LIMIT: u8 = 25;
const MAX_LIMIT: u8 = 100;
const MAX_AVAILABILITY_LIMIT: u8 = 100;
const MAX_NAME_LEN: usize = 160;
const MAX_CODE_LEN: usize = 48;
const MAX_REASON_LEN: usize = 1_000;
const MAX_AVAILABILITY_DAYS: i64 = 45;

#[derive(Clone)]
pub struct SchedulingService {
    state: AppState,
}

impl SchedulingService {
    pub fn new(state: AppState) -> Self {
        Self { state }
    }

    fn facility_id(&self) -> Uuid {
        self.state.facility_id()
    }

    fn pool(&self) -> &hms_db::PgPool {
        self.state.db_pool()
    }

    pub async fn list_services(
        &self,
        ctx: &hms_access::RequestContext,
        query: SchedulingListQuery,
    ) -> Result<ListResponse<BookableServiceListItem>, ApiError> {
        require_workflow_access(ctx, self.facility_id(), PermissionCode::AppointmentView)?;
        let (cursor, page_size) = page_request(query)?;
        let rows = hms_db::scheduling::list_bookable_services(
            self.pool(),
            self.facility_id(),
            cursor,
            page_size as i64 + 1,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "bookable_service_list_failed",
                "Bookable services could not be loaded.",
            )
        })?;

        Ok(page_response(rows, page_size, |item| {
            encode_cursor(item.created_at, item.id)
        }))
    }

    pub async fn create_service(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateBookableServiceRequest,
    ) -> Result<ObjectResponse<BookableServiceListItem>, ApiError> {
        require_workflow_access(ctx, self.facility_id(), PermissionCode::AppointmentManage)?;
        let default_duration_minutes = payload.default_duration_minutes.unwrap_or(30);
        if default_duration_minutes < 1 {
            return Err(ApiError::bad_request(
                "service_duration_invalid",
                "Service default duration must be positive.",
            ));
        }
        let service = hms_db::scheduling::create_bookable_service(
            self.pool(),
            NewBookableService {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                code: validate_required_text(payload.code, MAX_CODE_LEN, "service_code")?,
                name: validate_required_text(payload.name, MAX_NAME_LEN, "service_name")?,
                default_duration_minutes,
                created_by_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "bookable_service_create_failed",
                "Bookable service could not be created.",
            )
        })?;
        Ok(object(service))
    }

    pub async fn list_sessions(
        &self,
        ctx: &hms_access::RequestContext,
        query: BookableSessionListQuery,
    ) -> Result<ListResponse<BookableSessionListItem>, ApiError> {
        require_workflow_access(ctx, self.facility_id(), PermissionCode::AppointmentView)?;
        let (cursor, page_size) = page_request(SchedulingListQuery {
            cursor: query.cursor,
            limit: query.limit,
        })?;
        let rows = hms_db::scheduling::list_bookable_sessions(
            self.pool(),
            self.facility_id(),
            cursor,
            SessionFilters {
                date: query.date,
                clinic_id: query.clinic_id,
                service_id: query.service_id,
                practitioner_user_id: query.practitioner_user_id,
            },
            page_size as i64 + 1,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "bookable_session_list_failed",
                "Bookable sessions could not be loaded.",
            )
        })?;

        Ok(page_response(rows, page_size, |item| {
            encode_cursor(item.starts_at, item.id)
        }))
    }

    pub async fn create_session(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateBookableSessionRequest,
    ) -> Result<ObjectResponse<BookableSessionListItem>, ApiError> {
        require_workflow_access(ctx, self.facility_id(), PermissionCode::AppointmentManage)?;
        validate_time_range(payload.starts_at, payload.ends_at, "invalid_session")?;
        let allowed_service_ids = payload.allowed_service_ids.unwrap_or_default();
        for service_id in &allowed_service_ids {
            let service_exists = hms_db::scheduling::bookable_service_exists(
                self.pool(),
                self.facility_id(),
                *service_id,
            )
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "bookable_service_lookup_failed",
                    "Bookable service could not be verified.",
                )
            })?;
            if !service_exists {
                return Err(ApiError::bad_request(
                    "bookable_service_not_found",
                    "Bookable service was not found in this facility.",
                ));
            }
        }
        let session = hms_db::scheduling::create_bookable_session(
            self.pool(),
            NewBookableSession {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                clinic_id: payload.clinic_id,
                service_code: validate_optional_text(
                    payload.service_code,
                    MAX_CODE_LEN,
                    "service_code",
                )?,
                practitioner_user_id: payload.practitioner_user_id,
                owner_type: payload.owner_type,
                owner_id: payload.owner_id,
                name: validate_required_text(payload.name, MAX_NAME_LEN, "session_name")?,
                mode: payload.mode,
                starts_at: payload.starts_at,
                ends_at: payload.ends_at,
                slot_minutes: payload.slot_minutes,
                capacity: payload.capacity,
                allow_overbooking: payload.allow_overbooking.unwrap_or(false),
                overbook_limit: payload.overbook_limit.unwrap_or(0),
                created_by_user_id: ctx.user_id,
                allowed_service_ids,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "bookable_session_create_failed",
                "Bookable session could not be created.",
            )
        })?;
        Ok(object(session))
    }

    pub async fn cancel_session(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        payload: CancelBookableSessionRequest,
    ) -> Result<ObjectResponse<BookableSessionListItem>, ApiError> {
        require_workflow_access(ctx, self.facility_id(), PermissionCode::AppointmentManage)?;
        let _reason = validate_required_reason(payload.reason, "invalid_session")?;
        let session =
            hms_db::scheduling::cancel_bookable_session(self.pool(), self.facility_id(), id)
                .await
                .map_err(|_| {
                    ApiError::conflict(
                        "bookable_session_cancel_failed",
                        "Bookable session could not be cancelled.",
                    )
                })?
                .ok_or_else(|| {
                    ApiError::not_found(
                        "bookable_session_not_found",
                        "Bookable session was not found.",
                    )
                })?;
        Ok(object(session))
    }

    pub async fn availability(
        &self,
        ctx: &hms_access::RequestContext,
        query: AvailabilityQuery,
    ) -> Result<ObjectResponse<AvailabilityResponse>, ApiError> {
        require_workflow_access(ctx, self.facility_id(), PermissionCode::AppointmentView)?;
        let (starts_at, ends_before) = availability_range(query.start_date, query.end_date)?;
        let limit = query
            .limit
            .unwrap_or(MAX_AVAILABILITY_LIMIT)
            .min(MAX_AVAILABILITY_LIMIT);
        let slots = hms_db::scheduling::list_availability(
            self.pool(),
            self.facility_id(),
            AvailabilityFilters {
                starts_at,
                ends_before,
                clinic_id: query.clinic_id,
                service_id: query.service_id,
                practitioner_user_id: query.practitioner_user_id,
                limit: i64::from(limit),
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "availability_failed",
                "Scheduling availability could not be loaded.",
            )
        })?;

        Ok(object(AvailabilityResponse { slots }))
    }

    pub async fn book_appointment(
        &self,
        ctx: &hms_access::RequestContext,
        payload: BookAppointmentRequest,
    ) -> Result<ObjectResponse<BookAppointmentResponse>, ApiError> {
        require_workflow_access(ctx, self.facility_id(), PermissionCode::AppointmentManage)?;
        let _patient = load_patient_for_access(&self.state, ctx, payload.patient_id).await?;
        validate_time_range(payload.starts_at, payload.ends_at, "invalid_appointment")?;

        let manual_reason =
            validate_optional_reason(payload.manual_booking_reason, "invalid_appointment")?;
        if payload.session_id.is_none() && manual_reason.is_none() {
            return Err(ApiError::bad_request(
                "manual_booking_reason_required",
                "Manual booking requires an explicit reason.",
            ));
        }
        let overbook_reason =
            validate_optional_reason(payload.overbook_reason, "invalid_appointment")?;
        if let Some(service_id) = payload.service_id {
            let service_exists = hms_db::scheduling::bookable_service_exists(
                self.pool(),
                self.facility_id(),
                service_id,
            )
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "bookable_service_lookup_failed",
                    "Bookable service could not be verified.",
                )
            })?;
            if !service_exists {
                return Err(ApiError::bad_request(
                    "bookable_service_not_found",
                    "Bookable service was not found in this facility.",
                ));
            }
        }

        let appointment = hms_db::scheduling::book_appointment(
            self.pool(),
            hms_db::care::NewBookedAppointment {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                patient_id: payload.patient_id,
                clinic_id: payload.clinic_id,
                clinic_session_id: payload.session_id,
                appointment_type_id: payload.service_id,
                practitioner_user_id: payload.practitioner_user_id,
                starts_at: payload.starts_at,
                ends_at: payload.ends_at,
                overbook_reason,
                series_id: None,
                created_by_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "appointment_booking_failed",
                "Appointment could not be booked into the selected capacity.",
            )
        })?;

        if let Some(reason) = manual_reason {
            hms_db::scheduling::record_manual_booking_history(
                self.pool(),
                self.facility_id(),
                appointment.id,
                ctx.user_id,
                &reason,
                appointment.starts_at,
                appointment.ends_at,
            )
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "appointment_booking_audit_failed",
                    "Appointment was booked but manual booking audit could not be recorded.",
                )
            })?;
        }

        Ok(object(BookAppointmentResponse { appointment }))
    }

    pub async fn create_exception(
        &self,
        ctx: &hms_access::RequestContext,
        payload: SchedulingExceptionRequest,
    ) -> Result<ObjectResponse<SchedulingExceptionItem>, ApiError> {
        require_workflow_access(ctx, self.facility_id(), PermissionCode::AppointmentManage)?;
        validate_time_range(payload.starts_at, payload.ends_at, "invalid_exception")?;
        let exception = hms_db::scheduling::create_exception(
            self.pool(),
            NewSchedulingException {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                session_id: payload.session_id,
                practitioner_user_id: payload.practitioner_user_id,
                starts_at: payload.starts_at,
                ends_at: payload.ends_at,
                reason: validate_required_reason(payload.reason, "invalid_exception")?,
                created_by_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "scheduling_exception_create_failed",
                "Scheduling exception could not be created.",
            )
        })?;
        Ok(object(exception))
    }

    pub async fn arrive_appointment(
        &self,
        ctx: &hms_access::RequestContext,
        appointment_id: Uuid,
        payload: ArriveAppointmentRequest,
    ) -> Result<ObjectResponse<VisitListItem>, ApiError> {
        require_workflow_access(ctx, self.facility_id(), PermissionCode::AppointmentManage)?;
        let appointment =
            hms_db::care::get_appointment(self.pool(), self.facility_id(), appointment_id)
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
        let _patient = load_patient_for_access(&self.state, ctx, appointment.patient_id).await?;
        let visit = hms_db::care::check_in_visit(
            self.pool(),
            NewVisit {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                patient_id: appointment.patient_id,
                appointment_id: Some(appointment.id),
                clinic_id: payload.clinic_id.or(appointment.clinic_id),
                created_by_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "appointment_arrival_failed",
                "Appointment arrival could not be checked in.",
            )
        })?;
        Ok(object(visit))
    }
}

impl AppState {
    pub fn scheduling_service(&self) -> SchedulingService {
        SchedulingService::new(self.clone())
    }
}

fn require_workflow_access(
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
    permission: PermissionCode,
) -> Result<(), ApiError> {
    hms_access::require_patient_workflow_access(ctx, facility_id, permission).map_err(|_| {
        ApiError::forbidden(
            "permission_denied",
            "You do not have permission to use scheduling.",
        )
    })
}

async fn load_patient_for_access(
    state: &AppState,
    ctx: &hms_access::RequestContext,
    patient_id: Uuid,
) -> Result<PatientRecord, ApiError> {
    let patient = hms_db::patients::get_patient(state.db_pool(), state.facility_id(), patient_id)
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

fn validate_time_range(
    starts_at: DateTime<Utc>,
    ends_at: DateTime<Utc>,
    code: &'static str,
) -> Result<(), ApiError> {
    if ends_at <= starts_at {
        return Err(ApiError::bad_request(
            code,
            "End time must be after start time.",
        ));
    }
    Ok(())
}

fn validate_required_text(
    value: String,
    max_len: usize,
    code: &'static str,
) -> Result<String, ApiError> {
    validate_optional_text(Some(value), max_len, code)?
        .ok_or_else(|| ApiError::bad_request(code, "Required scheduling text cannot be blank."))
}

fn validate_optional_text(
    value: Option<String>,
    max_len: usize,
    code: &'static str,
) -> Result<Option<String>, ApiError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = value.trim().to_owned();
    if value.is_empty() {
        return Err(ApiError::bad_request(
            code,
            "Scheduling text cannot be blank.",
        ));
    }
    if value.len() > max_len {
        return Err(ApiError::bad_request(code, "Scheduling text is too long."));
    }
    Ok(Some(value))
}

fn validate_required_reason(value: String, code: &'static str) -> Result<String, ApiError> {
    validate_optional_reason(Some(value), code)?
        .ok_or_else(|| ApiError::bad_request(code, "Reason is required."))
}

fn validate_optional_reason(
    value: Option<String>,
    code: &'static str,
) -> Result<Option<String>, ApiError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = value.trim().to_owned();
    if value.is_empty() {
        return Err(ApiError::bad_request(code, "Reason cannot be blank."));
    }
    if value.len() > MAX_REASON_LEN {
        return Err(ApiError::bad_request(code, "Reason is too long."));
    }
    Ok(Some(value))
}

fn availability_range(
    start_date: NaiveDate,
    end_date: Option<NaiveDate>,
) -> Result<(DateTime<Utc>, DateTime<Utc>), ApiError> {
    let end_date = end_date.unwrap_or(start_date);
    if end_date < start_date {
        return Err(ApiError::bad_request(
            "invalid_availability_range",
            "Availability end date cannot be before start date.",
        ));
    }
    if (end_date - start_date).num_days() > MAX_AVAILABILITY_DAYS {
        return Err(ApiError::bad_request(
            "invalid_availability_range",
            "Availability range is too large.",
        ));
    }
    let starts_at = start_date
        .and_hms_opt(0, 0, 0)
        .expect("valid availability start date")
        .and_utc();
    let ends_before = end_date
        .succ_opt()
        .and_then(|date| date.and_hms_opt(0, 0, 0))
        .expect("valid availability end date")
        .and_utc();
    Ok((starts_at, ends_before))
}

fn page_request(query: SchedulingListQuery) -> Result<(Option<SchedulingCursor>, u8), ApiError> {
    let page = cursor_list::page_request(
        query.cursor.as_deref(),
        query.limit,
        DEFAULT_LIMIT,
        MAX_LIMIT,
        |occurred_at, id| SchedulingCursor { occurred_at, id },
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
