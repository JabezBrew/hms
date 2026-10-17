use super::*;
use hms_db::clinical::{
    medication_access::MedicationAccessError, prescription_courses::PrescriptionCourseError,
};
use hms_db::referrals::response_records::{self as db, ReferralResponseActor, ResponseError};
use hms_domain::auth::PatientDataVisibility;
use hms_domain::referrals::*;
pub(super) fn response_error(error: anyhow::Error, write: bool) -> ApiError {
    if let Some(error) = ApiError::network_publication(&error) {
        return error;
    }
    if error.is::<PrescriptionCourseError>() || error.is::<MedicationAccessError>() {
        return ApiError::forbidden(
            "referral_response_unavailable",
            "Current referral and patient authorization is required.",
        );
    }
    if error.is::<hms_db::care::BookingRejection>() {
        return ApiError::conflict(
            "referral_response_source_changed",
            "The selected appointment slot is unavailable. Reload the current scheduling options before reviewing again.",
        );
    }
    if let Some(reason) = error.downcast_ref::<ResponseError>() {
        return match reason{
 ResponseError::InvalidInput=>ApiError::bad_request("invalid_referral_response","Review the supported response fields, selected source and bounded clinical text."),
 ResponseError::NotFound=>ApiError::not_found("referral_response_not_found","The selected referral response evidence was not found."),
 ResponseError::Unavailable=>ApiError::forbidden("referral_response_unavailable","Current full clinical access and an ordinary care relationship are required."),
 ResponseError::SourceChanged=>ApiError::conflict("referral_response_source_changed","The referral changed or this action is unavailable. Reload its current context before reviewing again."),
 ResponseError::RequestConflict=>ApiError::conflict("referral_response_request_conflict","This request reference belongs to another reviewed response action."),};
    }
    if write {
        ApiError::conflict("referral_response_write_unconfirmed","The response outcome could not be confirmed. Refresh its saved response and review the recovery notice before another change.")
    } else {
        ApiError::conflict(
            "referral_response_failed",
            "The selected response could not be confirmed. Reload current access and try again.",
        )
    }
}
pub(super) fn actor(
    ctx: &hms_access::RequestContext,
    facility: Uuid,
    deadline: DateTime<Utc>,
    full: bool,
) -> Result<ReferralResponseActor, ApiError> {
    require_referral_permission(ctx, facility)?;
    if full && !ctx.has_patient_visibility(PatientDataVisibility::FullClinical) {
        return Err(ApiError::forbidden(
            "referral_response_unavailable",
            "Full clinical access is required to review referral response content.",
        ));
    }
    Ok(ReferralResponseActor {
        facility_id: ctx.facility_id,
        user_id: ctx.user_id,
        request_id: Some(ctx.request_id.clone()),
        authorization: crate::services::clinical::prescription_courses::authorization(
            ctx, deadline,
        ),
    })
}
pub(super) fn routing_actor(
    ctx: &hms_access::RequestContext,
    facility: Uuid,
) -> Result<ReferralResponseActor, ApiError> {
    let deadline = ctx.authorization_deadline.ok_or_else(|| {
        ApiError::forbidden(
            "referral_response_unavailable",
            "Current referral authorization is required.",
        )
    })?;
    actor(ctx, facility, deadline, false)
}
impl ReferralsService {
    pub async fn response_context(
        &self,
        ctx: &hms_access::RequestContext,
        patient: Uuid,
        id: Uuid,
        deadline: DateTime<Utc>,
    ) -> Result<ObjectResponse<ReferralResponseContext>, ApiError> {
        let actor = actor(ctx, self.facility_id(), deadline, true)?;
        Ok(object(
            db::context(self.pool(), actor, patient, id)
                .await
                .map_err(|e| response_error(e, false))?,
        ))
    }
    pub async fn response_command(
        &self,
        ctx: &hms_access::RequestContext,
        patient: Uuid,
        id: Uuid,
        input: ReferralResponseCommandRequest,
        deadline: DateTime<Utc>,
    ) -> Result<ObjectResponse<ReferralResponseReceipt>, ApiError> {
        let actor = actor(ctx, self.facility_id(), deadline, true)?;
        let result = db::command(self.pool(), actor, patient, id, input).await;
        self.state.invalidate_patient_chronicle_cache();
        Ok(object(result.map_err(|e| response_error(e, true))?))
    }
    pub async fn response_history(
        &self,
        ctx: &hms_access::RequestContext,
        patient: Uuid,
        id: Uuid,
        q: ReferralResponseHistoryQuery,
        deadline: DateTime<Utc>,
    ) -> Result<ListResponse<ReferralResponseHistoryItem>, ApiError> {
        let actor = actor(ctx, self.facility_id(), deadline, true)?;
        let before = q
            .cursor
            .as_deref()
            .map(|c| {
                c.strip_prefix("v:")
                    .filter(|v| {
                        !v.is_empty() && v.len() <= 19 && v.bytes().all(|b| b.is_ascii_digit())
                    })
                    .and_then(|v| v.parse::<i64>().ok())
                    .filter(|v| *v > 0)
                    .ok_or_else(|| {
                        ApiError::bad_request(
                            "invalid_referral_response_cursor",
                            "Use a valid response history cursor.",
                        )
                    })
            })
            .transpose()?;
        let limit = q.limit.unwrap_or(25).clamp(1, 100);
        let rows = db::history(
            self.pool(),
            actor,
            patient,
            id,
            before,
            i64::from(limit) + 1,
        )
        .await
        .map_err(|e| response_error(e, false))?;
        Ok(cursor_list::page_response(rows, limit, |r| {
            format!("v:{}", r.version)
        }))
    }
    pub async fn response_version(
        &self,
        ctx: &hms_access::RequestContext,
        patient: Uuid,
        id: Uuid,
        version: Uuid,
        deadline: DateTime<Utc>,
    ) -> Result<ObjectResponse<ReferralResponseRevision>, ApiError> {
        let actor = actor(ctx, self.facility_id(), deadline, true)?;
        Ok(object(
            db::get_version(self.pool(), actor, patient, id, version)
                .await
                .map_err(|e| response_error(e, false))?,
        ))
    }
    pub async fn response_receipt(
        &self,
        ctx: &hms_access::RequestContext,
        patient: Uuid,
        id: Uuid,
        key: Uuid,
        deadline: DateTime<Utc>,
    ) -> Result<ObjectResponse<ReferralResponseReceipt>, ApiError> {
        let actor = actor(ctx, self.facility_id(), deadline, true)?;
        Ok(object(
            db::receipt(self.pool(), actor, patient, id, key)
                .await
                .map_err(|e| response_error(e, false))?,
        ))
    }
}
