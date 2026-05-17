use chrono::{DateTime, Utc};
use hms_access::require_patient_demographics_access;
use hms_db::referrals::ReferralCursor;
use hms_domain::care::CursorListQuery;
use hms_domain::patients::PatientRecord;
use hms_domain::referrals::{
    AcceptReferralRequest, ClinicWaitlistEntryListItem, CompleteReferralRequest,
    CreateClinicWaitlistEntryRequest, CreateReferralRequest, DeclineReferralRequest,
    OfferNextClinicWaitlistEntryRequest, ReferralListItem, ReferralListQuery, ReferralSlaDashboard,
    ReferralSlaState,
};
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

    pub async fn list_referrals(
        &self,
        ctx: &hms_access::RequestContext,
        query: ReferralListQuery,
    ) -> Result<ListResponse<ReferralListItem>, ApiError> {
        require_patient_workflow_access(ctx, self.state.facility_id())?;
        let status = query.status;
        let (cursor, page_size) = page_request(CursorListQuery {
            cursor: query.cursor,
            limit: query.limit,
        })?;
        let rows = self
            .state
            .list_referrals(cursor, page_size as i64 + 1, status)
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
        require_referral_permission(ctx, self.state.facility_id())?;
        let _patient = load_patient_for_access(&self.state, ctx, payload.patient_id).await?;
        let to_service = required_text(payload.to_service, "to_service")?;
        let reason = optional_text(payload.reason);
        let referral = self
            .state
            .create_referral(
                payload.patient_id,
                to_service,
                payload.priority,
                reason,
                ctx.user_id,
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
        require_referral_permission(ctx, self.state.facility_id())?;
        let referral = load_referral_for_access(&self.state, ctx, id).await?;
        Ok(object(referral))
    }

    pub async fn accept_referral(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        payload: AcceptReferralRequest,
    ) -> Result<ObjectResponse<ReferralListItem>, ApiError> {
        require_referral_permission(ctx, self.state.facility_id())?;
        let _existing = load_referral_for_access(&self.state, ctx, id).await?;
        let referral = self
            .state
            .accept_referral(id, ctx.user_id, optional_text(payload.acceptance_notes))
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
        require_referral_permission(ctx, self.state.facility_id())?;
        let _existing = load_referral_for_access(&self.state, ctx, id).await?;
        let decline_reason = required_text(payload.decline_reason, "decline_reason")?;
        let referral = self
            .state
            .decline_referral(id, decline_reason)
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
        require_referral_permission(ctx, self.state.facility_id())?;
        let _existing = load_referral_for_access(&self.state, ctx, id).await?;
        let specialist_notes = required_text(payload.specialist_notes, "specialist_notes")?;
        let referral = self
            .state
            .complete_referral(id, specialist_notes, optional_text(payload.recommendations))
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

    pub async fn get_referral_sla_state(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<ReferralSlaState>, ApiError> {
        require_referral_permission(ctx, self.state.facility_id())?;
        let _existing = load_referral_for_access(&self.state, ctx, id).await?;
        let sla_state = self
            .state
            .referral_sla_state(id)
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
        require_patient_workflow_access(ctx, self.state.facility_id())?;
        let dashboard = self.state.referral_sla_dashboard().await.map_err(|_| {
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
        require_patient_workflow_access(ctx, self.state.facility_id())?;
        let (cursor, page_size) = page_request(query)?;
        let rows = self
            .state
            .list_clinic_waitlist_entries(cursor, page_size as i64 + 1)
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
        require_referral_permission(ctx, self.state.facility_id())?;
        let _patient = load_patient_for_access(&self.state, ctx, payload.patient_id).await?;
        let service = required_text(payload.service, "service")?;
        let entry = self
            .state
            .create_clinic_waitlist_entry(
                payload.patient_id,
                service,
                payload.priority,
                ctx.user_id,
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
        require_patient_workflow_access(ctx, self.state.facility_id())?;
        let service = required_text(payload.service, "service")?;
        let entry = self
            .state
            .offer_next_clinic_waitlist_entry(&service, ctx.user_id)
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

async fn load_referral_for_access(
    state: &AppState,
    ctx: &hms_access::RequestContext,
    referral_id: Uuid,
) -> Result<ReferralListItem, ApiError> {
    let referral = state
        .get_referral(referral_id)
        .await
        .map_err(|_| ApiError::conflict("referral_load_failed", "Referral could not be loaded."))?
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
