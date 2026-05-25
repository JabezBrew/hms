use chrono::{DateTime, Utc};
use hms_access::require_patient_demographics_access;
use hms_db::referrals::{NewClinicWaitlistEntry, NewReferral, ReferralCursor};
use hms_domain::care::CursorListQuery;
use hms_domain::deployment::PermissionCode;
use hms_domain::patients::PatientRecord;
use hms_domain::referrals::{
    AcceptReferralRequest, CancelClinicWaitlistEntryRequest, ClinicWaitlistEntryListItem,
    ClinicWaitlistStatus, CompleteReferralRequest, CreateClinicWaitlistEntryRequest,
    CreateReferralRequest, DeclineReferralRequest, OfferNextClinicWaitlistEntryRequest,
    PromoteClinicWaitlistEntryRequest, ReferralListItem, ReferralListQuery, ReferralPriority,
    ReferralSlaDashboard, ReferralSlaState, ReferralStatus, ScheduleReferralAppointmentRequest,
};
use hms_domain::scheduling::BookAppointmentRequest;
use serde_json::json;
use uuid::Uuid;

use crate::cursor_list;
use crate::error::ApiError;
use crate::response::{object, ListResponse, ObjectResponse};
use crate::state::AppState;

const DEFAULT_LIMIT: u8 = 25;
const MAX_LIMIT: u8 = 100;

#[derive(Clone)]
pub struct ReferralsService {
    state: AppState,
}

impl ReferralsService {
    pub fn new(state: AppState) -> Self {
        Self { state }
    }

    fn facility_id(&self) -> Uuid {
        self.state.facility_id()
    }

    fn pool(&self) -> &hms_db::PgPool {
        self.state.db_pool()
    }

    pub async fn list_referrals(
        &self,
        ctx: &hms_access::RequestContext,
        query: ReferralListQuery,
    ) -> Result<ListResponse<ReferralListItem>, ApiError> {
        require_patient_workflow_access(ctx, self.facility_id())?;
        let status = query.status;
        let (cursor, page_size) = page_request(CursorListQuery {
            cursor: query.cursor,
            limit: query.limit,
        })?;
        let rows = hms_db::referrals::list_referrals(
            self.pool(),
            self.facility_id(),
            cursor,
            page_size as i64 + 1,
            status,
        )
        .await
        .map_err(|_| {
            ApiError::conflict("referral_list_failed", "Referrals could not be loaded.")
        })?;

        Ok(page_response(rows, page_size, |item| {
            encode_cursor(item.created_at, item.id)
        }))
    }

    pub async fn create_referral(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateReferralRequest,
    ) -> Result<ObjectResponse<ReferralListItem>, ApiError> {
        require_referral_permission(ctx, self.facility_id())?;
        let _patient = load_patient_for_access(&self.state, ctx, payload.patient_id).await?;
        let to_service = required_text(payload.to_service, "to_service")?;
        let reason = optional_text(payload.reason);
        let referral = hms_db::referrals::create_referral(
            self.pool(),
            NewReferral {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                patient_id: payload.patient_id,
                to_service,
                priority: payload.priority,
                reason,
                sla_due_at: sla_due_at(payload.priority),
                created_by_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict("referral_create_failed", "Referral could not be created.")
        })?;

        Ok(object(referral))
    }

    pub async fn get_referral(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<ReferralListItem>, ApiError> {
        require_referral_permission(ctx, self.facility_id())?;
        let referral = load_referral_for_access(&self.state, ctx, id).await?;
        Ok(object(referral))
    }

    pub async fn accept_referral(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        payload: AcceptReferralRequest,
    ) -> Result<ObjectResponse<ReferralListItem>, ApiError> {
        require_referral_permission(ctx, self.facility_id())?;
        let _existing = load_referral_for_access(&self.state, ctx, id).await?;
        let referral = hms_db::referrals::accept_referral(
            self.pool(),
            self.facility_id(),
            id,
            ctx.user_id,
            optional_text(payload.acceptance_notes),
        )
        .await
        .map_err(|_| {
            ApiError::conflict("referral_accept_failed", "Referral could not be accepted.")
        })?
        .ok_or_else(|| ApiError::not_found("referral_not_found", "Referral was not found."))?;

        Ok(object(referral))
    }

    pub async fn decline_referral(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        payload: DeclineReferralRequest,
    ) -> Result<ObjectResponse<ReferralListItem>, ApiError> {
        require_referral_permission(ctx, self.facility_id())?;
        let _existing = load_referral_for_access(&self.state, ctx, id).await?;
        let decline_reason = required_text(payload.decline_reason, "decline_reason")?;
        let referral = hms_db::referrals::decline_referral(
            self.pool(),
            self.facility_id(),
            id,
            decline_reason,
        )
        .await
        .map_err(|_| {
            ApiError::conflict("referral_decline_failed", "Referral could not be declined.")
        })?
        .ok_or_else(|| ApiError::not_found("referral_not_found", "Referral was not found."))?;

        Ok(object(referral))
    }

    pub async fn complete_referral(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        payload: CompleteReferralRequest,
    ) -> Result<ObjectResponse<ReferralListItem>, ApiError> {
        require_referral_permission(ctx, self.facility_id())?;
        let _existing = load_referral_for_access(&self.state, ctx, id).await?;
        let specialist_notes = required_text(payload.specialist_notes, "specialist_notes")?;
        let referral = hms_db::referrals::complete_referral(
            self.pool(),
            self.facility_id(),
            id,
            specialist_notes,
            optional_text(payload.recommendations),
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "referral_complete_failed",
                "Referral could not be completed.",
            )
        })?
        .ok_or_else(|| ApiError::not_found("referral_not_found", "Referral was not found."))?;

        Ok(object(referral))
    }

    pub async fn schedule_referral_appointment(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        payload: ScheduleReferralAppointmentRequest,
    ) -> Result<ObjectResponse<ReferralListItem>, ApiError> {
        require_referral_permission(ctx, self.facility_id())?;
        require_appointment_manage(ctx, self.facility_id())?;
        validate_appointment_window(payload.starts_at, payload.ends_at)?;
        let existing = load_referral_for_access(&self.state, ctx, id).await?;
        if !matches!(
            existing.status,
            ReferralStatus::Sent | ReferralStatus::Accepted
        ) {
            return Err(ApiError::conflict(
                "referral_schedule_failed",
                "Only sent or accepted referrals can be scheduled.",
            ));
        }
        let appointment_id = self
            .book_scheduling_appointment(
                ctx,
                existing.patient_id,
                SchedulingAppointmentPayload {
                    starts_at: payload.starts_at,
                    ends_at: payload.ends_at,
                    session_id: payload.session_id,
                    service_id: payload.service_id,
                    clinic_id: payload.clinic_id,
                    practitioner_user_id: payload.practitioner_user_id,
                    overbook_reason: payload.overbook_reason,
                    manual_booking_reason: payload.manual_booking_reason,
                },
            )
            .await?;

        let referral = hms_db::referrals::schedule_referral_appointment(
            self.pool(),
            self.facility_id(),
            id,
            appointment_id,
            ctx.user_id,
            Some(ctx.request_id.clone()),
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "referral_schedule_failed",
                "Referral could not be scheduled.",
            )
        })?
        .ok_or_else(|| {
            ApiError::conflict(
                "referral_schedule_failed",
                "Only sent or accepted referrals can be scheduled.",
            )
        })?;

        Ok(object(referral))
    }

    pub async fn get_referral_sla_state(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<ReferralSlaState>, ApiError> {
        require_referral_permission(ctx, self.facility_id())?;
        let _existing = load_referral_for_access(&self.state, ctx, id).await?;
        let sla_state = hms_db::referrals::referral_sla_state(self.pool(), self.facility_id(), id)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "referral_sla_state_failed",
                    "Referral SLA state could not be loaded.",
                )
            })?
            .ok_or_else(|| ApiError::not_found("referral_not_found", "Referral was not found."))?;

        Ok(object(sla_state))
    }

    pub async fn get_referral_sla_dashboard(
        &self,
        ctx: &hms_access::RequestContext,
    ) -> Result<ObjectResponse<ReferralSlaDashboard>, ApiError> {
        require_patient_workflow_access(ctx, self.facility_id())?;
        let dashboard = hms_db::referrals::referral_sla_dashboard(self.pool(), self.facility_id())
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "referral_sla_dashboard_failed",
                    "Referral SLA dashboard could not be loaded.",
                )
            })?;

        Ok(object(dashboard))
    }

    pub async fn list_clinic_waitlist_entries(
        &self,
        ctx: &hms_access::RequestContext,
        query: CursorListQuery,
    ) -> Result<ListResponse<ClinicWaitlistEntryListItem>, ApiError> {
        require_patient_workflow_access(ctx, self.facility_id())?;
        let (cursor, page_size) = page_request(query)?;
        let rows = hms_db::referrals::list_clinic_waitlist_entries(
            self.pool(),
            self.facility_id(),
            cursor,
            page_size as i64 + 1,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "clinic_waitlist_failed",
                "Clinic waitlist could not be loaded.",
            )
        })?;

        Ok(page_response(rows, page_size, |item| {
            encode_cursor(item.created_at, item.id)
        }))
    }

    pub async fn create_clinic_waitlist_entry(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateClinicWaitlistEntryRequest,
    ) -> Result<ObjectResponse<ClinicWaitlistEntryListItem>, ApiError> {
        require_referral_permission(ctx, self.facility_id())?;
        let _patient = load_patient_for_access(&self.state, ctx, payload.patient_id).await?;
        let service = required_text(payload.service, "service")?;
        let entry = hms_db::referrals::create_clinic_waitlist_entry(
            self.pool(),
            NewClinicWaitlistEntry {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                patient_id: payload.patient_id,
                service,
                priority: payload.priority,
                created_by_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "clinic_waitlist_create_failed",
                "Clinic waitlist entry could not be created.",
            )
        })?;

        Ok(object(entry))
    }

    pub async fn offer_next_clinic_waitlist_entry(
        &self,
        ctx: &hms_access::RequestContext,
        payload: OfferNextClinicWaitlistEntryRequest,
    ) -> Result<ObjectResponse<ClinicWaitlistEntryListItem>, ApiError> {
        require_patient_workflow_access(ctx, self.facility_id())?;
        let service = required_text(payload.service, "service")?;
        let entry = hms_db::referrals::offer_next_clinic_waitlist_entry(
            self.pool(),
            self.facility_id(),
            &service,
            ctx.user_id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "clinic_waitlist_offer_failed",
                "Clinic waitlist entry could not be offered.",
            )
        })?
        .ok_or_else(|| {
            ApiError::not_found("clinic_waitlist_empty", "No waiting entry was available.")
        })?;

        Ok(object(entry))
    }

    pub async fn promote_clinic_waitlist_entry(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        payload: PromoteClinicWaitlistEntryRequest,
    ) -> Result<ObjectResponse<ClinicWaitlistEntryListItem>, ApiError> {
        require_referral_permission(ctx, self.facility_id())?;
        require_appointment_manage(ctx, self.facility_id())?;
        validate_appointment_window(payload.starts_at, payload.ends_at)?;
        let entry =
            hms_db::referrals::get_clinic_waitlist_entry(self.pool(), self.facility_id(), id)
                .await
                .map_err(|_| {
                    ApiError::conflict(
                        "clinic_waitlist_load_failed",
                        "Clinic waitlist entry could not be loaded.",
                    )
                })?
                .ok_or_else(|| {
                    ApiError::not_found(
                        "clinic_waitlist_not_found",
                        "Clinic waitlist entry was not found.",
                    )
                })?;
        let _patient = load_patient_for_access(&self.state, ctx, entry.patient_id).await?;
        if !matches!(
            entry.status,
            ClinicWaitlistStatus::Waiting | ClinicWaitlistStatus::Offered
        ) {
            return Err(ApiError::conflict(
                "clinic_waitlist_promote_failed",
                "Only waiting or offered entries can be promoted.",
            ));
        }
        let appointment_id = self
            .book_scheduling_appointment(
                ctx,
                entry.patient_id,
                SchedulingAppointmentPayload {
                    starts_at: payload.starts_at,
                    ends_at: payload.ends_at,
                    session_id: payload.session_id,
                    service_id: payload.service_id,
                    clinic_id: payload.clinic_id,
                    practitioner_user_id: payload.practitioner_user_id,
                    overbook_reason: payload.overbook_reason,
                    manual_booking_reason: payload.manual_booking_reason,
                },
            )
            .await?;

        let entry = hms_db::referrals::promote_clinic_waitlist_entry(
            self.pool(),
            self.facility_id(),
            id,
            appointment_id,
            ctx.user_id,
            Some(ctx.request_id.clone()),
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "clinic_waitlist_promote_failed",
                "Clinic waitlist entry could not be promoted.",
            )
        })?
        .ok_or_else(|| {
            ApiError::conflict(
                "clinic_waitlist_promote_failed",
                "Only waiting or offered entries can be promoted.",
            )
        })?;

        Ok(object(entry))
    }

    async fn book_scheduling_appointment(
        &self,
        ctx: &hms_access::RequestContext,
        patient_id: Uuid,
        payload: SchedulingAppointmentPayload,
    ) -> Result<Uuid, ApiError> {
        let response = self
            .state
            .scheduling_service()
            .book_appointment(
                ctx,
                BookAppointmentRequest {
                    patient_id,
                    service_id: payload.service_id,
                    session_id: payload.session_id,
                    clinic_id: payload.clinic_id,
                    practitioner_user_id: payload.practitioner_user_id,
                    starts_at: payload.starts_at,
                    ends_at: payload.ends_at,
                    overbook_reason: payload.overbook_reason,
                    manual_booking_reason: payload.manual_booking_reason,
                },
            )
            .await?;

        Ok(response.data.appointment.id)
    }

    pub async fn cancel_clinic_waitlist_entry(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        payload: CancelClinicWaitlistEntryRequest,
    ) -> Result<ObjectResponse<ClinicWaitlistEntryListItem>, ApiError> {
        require_referral_permission(ctx, self.facility_id())?;
        let reason = required_text(payload.reason, "reason")?;
        let entry =
            hms_db::referrals::get_clinic_waitlist_entry(self.pool(), self.facility_id(), id)
                .await
                .map_err(|_| {
                    ApiError::conflict(
                        "clinic_waitlist_load_failed",
                        "Clinic waitlist entry could not be loaded.",
                    )
                })?
                .ok_or_else(|| {
                    ApiError::not_found(
                        "clinic_waitlist_not_found",
                        "Clinic waitlist entry was not found.",
                    )
                })?;
        let _patient = load_patient_for_access(&self.state, ctx, entry.patient_id).await?;
        let entry = hms_db::referrals::cancel_clinic_waitlist_entry(
            self.pool(),
            self.facility_id(),
            id,
            ctx.user_id,
            reason,
            Some(ctx.request_id.clone()),
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "clinic_waitlist_cancel_failed",
                "Clinic waitlist entry could not be cancelled.",
            )
        })?
        .ok_or_else(|| {
            ApiError::conflict(
                "clinic_waitlist_cancel_failed",
                "Only waiting or offered entries can be cancelled.",
            )
        })?;

        Ok(object(entry))
    }
}

struct SchedulingAppointmentPayload {
    starts_at: DateTime<Utc>,
    ends_at: DateTime<Utc>,
    session_id: Option<Uuid>,
    service_id: Option<Uuid>,
    clinic_id: Option<Uuid>,
    practitioner_user_id: Option<Uuid>,
    overbook_reason: Option<String>,
    manual_booking_reason: Option<String>,
}

impl AppState {
    pub fn referrals_service(&self) -> ReferralsService {
        ReferralsService::new(self.clone())
    }
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

async fn load_referral_for_access(
    state: &AppState,
    ctx: &hms_access::RequestContext,
    referral_id: Uuid,
) -> Result<ReferralListItem, ApiError> {
    let referral =
        hms_db::referrals::get_referral(state.db_pool(), state.facility_id(), referral_id)
            .await
            .map_err(|_| {
                ApiError::conflict("referral_load_failed", "Referral could not be loaded.")
            })?
            .ok_or_else(|| ApiError::not_found("referral_not_found", "Referral was not found."))?;
    let _patient = load_patient_for_access(state, ctx, referral.patient_id).await?;
    Ok(referral)
}

fn require_patient_workflow_access(
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
) -> Result<(), ApiError> {
    hms_access::require_referral_access(ctx, facility_id).map_err(|error| match error {
        hms_access::AccessError::PatientWorkflowAccessDenied => ApiError::forbidden(
            "patient_access_denied",
            "You do not have access to patient workflow lists.",
        ),
        other => ApiError::from(other),
    })
}

fn require_referral_permission(
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
) -> Result<(), ApiError> {
    hms_access::require_referral_access(ctx, facility_id).map_err(|_| {
        ApiError::forbidden(
            "permission_denied",
            "You do not have permission to perform this action.",
        )
    })
}

fn require_appointment_manage(
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
) -> Result<(), ApiError> {
    hms_access::require_patient_workflow_access(ctx, facility_id, PermissionCode::AppointmentManage)
        .map_err(|_| {
            ApiError::forbidden(
                "permission_denied",
                "You do not have permission to schedule appointments.",
            )
        })
}

fn validate_appointment_window(
    starts_at: DateTime<Utc>,
    ends_at: DateTime<Utc>,
) -> Result<(), ApiError> {
    if ends_at <= starts_at {
        return Err(ApiError::bad_request(
            "invalid_appointment",
            "Appointment end time must be after start time.",
        ));
    }
    Ok(())
}

fn page_request(query: CursorListQuery) -> Result<(Option<ReferralCursor>, u8), ApiError> {
    let page = cursor_list::page_request(
        query.cursor.as_deref(),
        query.limit,
        DEFAULT_LIMIT,
        MAX_LIMIT,
        |occurred_at, id| ReferralCursor { occurred_at, id },
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

fn required_text(value: String, field: &'static str) -> Result<String, ApiError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(validation_error(field, "This field is required."));
    }
    Ok(value.to_owned())
}

fn validation_error(field: &'static str, message: &'static str) -> ApiError {
    let mut error = ApiError::bad_request("invalid_request", "Request is invalid.");
    error.details = json!({ field: [message] });
    error
}

fn optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn sla_due_at(priority: ReferralPriority) -> DateTime<Utc> {
    let window = match priority {
        ReferralPriority::Emergency => chrono::Duration::hours(1),
        ReferralPriority::Urgent => chrono::Duration::hours(24),
        ReferralPriority::Routine => chrono::Duration::days(7),
    };
    Utc::now() + window
}
