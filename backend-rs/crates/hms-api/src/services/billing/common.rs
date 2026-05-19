use std::collections::HashSet;

use chrono::{DateTime, Utc};
use hms_access::require_patient_demographics_access;
use hms_db::billing::BillingCursor;
use hms_domain::billing::BillingListQuery;
use hms_domain::deployment::PermissionCode;
use hms_domain::patients::PatientRecord;
use serde_json::json;
use uuid::Uuid;

use crate::cursor_list;
use crate::error::ApiError;
use crate::response::ListResponse;
use crate::state::AppState;

pub(super) const DEFAULT_LIMIT: u8 = 25;
pub(super) const MAX_LIMIT: u8 = 100;
const MAX_TEXT_LEN: usize = 160;

pub(super) fn require_billing_access(
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
    permission: PermissionCode,
) -> Result<(), ApiError> {
    hms_access::require_billing_access(ctx, facility_id, permission).map_err(|_| {
        ApiError::forbidden(
            "permission_denied",
            "You do not have permission for this billing action.",
        )
    })
}

pub(super) fn require_billing_high_risk_access(
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
) -> Result<(), ApiError> {
    hms_access::require_high_risk_facility_permission(
        ctx,
        facility_id,
        PermissionCode::BillingManage,
        Utc::now(),
    )
    .map_err(|_| {
        ApiError::forbidden(
            "high_risk_billing_denied",
            "Fresh reauthentication and billing approval are required for this action.",
        )
    })
}

pub(super) fn require_nhis_access(
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
) -> Result<(), ApiError> {
    hms_access::require_nhis_access(ctx, facility_id).map_err(|_| {
        ApiError::forbidden(
            "permission_denied",
            "You do not have permission for this billing action.",
        )
    })
}

pub(super) async fn load_patient_for_access(
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

pub(super) async fn require_invoice_patient_access(
    state: &AppState,
    ctx: &hms_access::RequestContext,
    invoice_id: Uuid,
) -> Result<(), ApiError> {
    let invoice =
        hms_db::billing::invoice_context(state.db_pool(), state.facility_id(), invoice_id)
            .await
            .map_err(|_| ApiError::conflict("invoice_load_failed", "Invoice could not be loaded."))?
            .ok_or_else(|| ApiError::not_found("invoice_not_found", "Invoice was not found."))?;
    let _patient = load_patient_for_access(state, ctx, invoice.patient_id).await?;
    Ok(())
}

pub(super) fn page_request(
    query: BillingListQuery,
) -> Result<(Option<BillingCursor>, u8), ApiError> {
    decode_page(query.cursor.as_deref(), query.limit)
}

pub(super) fn decode_page(
    cursor: Option<&str>,
    limit: Option<u8>,
) -> Result<(Option<BillingCursor>, u8), ApiError> {
    let page = cursor_list::page_request(
        cursor,
        limit,
        DEFAULT_LIMIT,
        MAX_LIMIT,
        |occurred_at, id| BillingCursor { occurred_at, id },
    )?;
    Ok((page.cursor, page.limit))
}

pub(super) fn page_response<T, F>(rows: Vec<T>, page_size: u8, cursor_for: F) -> ListResponse<T>
where
    F: Fn(&T) -> String,
{
    cursor_list::page_response(rows, page_size, cursor_for)
}

pub(super) fn static_list<T>(items: Vec<T>) -> ListResponse<T> {
    cursor_list::static_list(items, MAX_LIMIT)
}

pub(super) fn encode_cursor(occurred_at: DateTime<Utc>, id: Uuid) -> String {
    cursor_list::encode_cursor(occurred_at, id)
}

pub(super) fn validate_claim_ids(claim_ids: &[Uuid]) -> Result<(), ApiError> {
    if claim_ids.is_empty() {
        return Err(validation_error(
            "claim_ids",
            "At least one claim is required.",
        ));
    }
    if claim_ids.len() > MAX_LIMIT as usize {
        return Err(validation_error(
            "claim_ids",
            "Too many claims were supplied.",
        ));
    }
    let unique = claim_ids.iter().collect::<HashSet<_>>();
    if unique.len() != claim_ids.len() {
        return Err(validation_error(
            "claim_ids",
            "Duplicate claims are not allowed.",
        ));
    }
    Ok(())
}

pub(super) fn normalize_text(value: String, field: &'static str) -> Result<String, ApiError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(validation_error(field, "This field is required."));
    }
    if value.chars().count() > MAX_TEXT_LEN {
        return Err(validation_error(field, "This field is too long."));
    }
    Ok(value.to_owned())
}

pub(super) fn require_positive(value: i64, field: &'static str) -> Result<(), ApiError> {
    if value <= 0 {
        return Err(validation_error(
            field,
            "This value must be greater than zero.",
        ));
    }
    Ok(())
}

pub(super) fn require_non_negative(value: i64, field: &'static str) -> Result<(), ApiError> {
    if value < 0 {
        return Err(validation_error(field, "This value cannot be negative."));
    }
    Ok(())
}

pub(super) fn validation_error(field: &'static str, message: &'static str) -> ApiError {
    let mut error = ApiError::bad_request("invalid_billing_request", "Billing request is invalid.");
    error.details = json!({ field: [message] });
    error
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use hms_access::{OffsiteState, ReauthState, RequestContext};
    use hms_domain::auth::{AuthSecurityState, AuthUser, PatientDataVisibility};
    use hms_domain::deployment::{DeploymentProfile, FeatureKey, PermissionCode};
    use uuid::Uuid;

    use super::require_billing_high_risk_access;

    fn ctx() -> RequestContext {
        let facility_id = Uuid::new_v4();
        let user = AuthUser {
            id: Uuid::new_v4(),
            email: "billing@hms.local".to_owned(),
            display_name: "Billing Officer".to_owned(),
            facility_id,
            facility_code: "HMS".to_owned(),
            active_profile: DeploymentProfile::Hospital,
            permissions: vec![
                PermissionCode::PatientDemographicsView,
                PermissionCode::BillingManage,
            ],
            features: vec![],
            patient_visibility: vec![
                PatientDataVisibility::Demographics,
                PatientDataVisibility::Billing,
            ],
            session_version: 1,
            permission_version: 1,
            password_change_required: false,
            auth_security: AuthSecurityState::from_permissions(
                &[
                    PermissionCode::PatientDemographicsView,
                    PermissionCode::BillingManage,
                ],
                true,
                4,
            ),
        };
        RequestContext::new(
            "request-1".to_owned(),
            Uuid::new_v4(),
            user,
            vec![FeatureKey::Patients, FeatureKey::Billing],
            OffsiteState::Onsite,
            ReauthState::from_authentication_time(Utc::now()),
        )
    }

    #[test]
    fn high_risk_billing_action_requires_permission_and_fresh_reauth() {
        let valid = ctx();
        assert!(require_billing_high_risk_access(&valid, valid.facility_id).is_ok());

        let mut missing_permission = ctx();
        missing_permission
            .permissions
            .retain(|permission| *permission != PermissionCode::BillingManage);
        assert!(require_billing_high_risk_access(
            &missing_permission,
            missing_permission.facility_id
        )
        .is_err());

        let mut stale_reauth = ctx();
        stale_reauth.reauth = ReauthState::missing(Utc::now());
        assert!(require_billing_high_risk_access(&stale_reauth, stale_reauth.facility_id).is_err());
    }
}
