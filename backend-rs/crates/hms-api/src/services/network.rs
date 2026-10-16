use crate::{
    error::ApiError,
    extractors::NetworkContext,
    network_access,
    response::{object, ObjectResponse},
    state::AppState,
};
use chrono::Utc;
use hms_domain::{
    deployment::{FeatureKey, PermissionCode},
    network::*,
};

fn admin(ctx: &hms_access::RequestContext) -> Result<(), ApiError> {
    hms_access::require_feature(ctx, FeatureKey::Admin)?;
    hms_access::require_facility_permission(
        ctx,
        ctx.facility_id,
        PermissionCode::AdminAuthorityManage,
    )?;
    Ok(())
}
fn fresh_admin(ctx: &hms_access::RequestContext) -> Result<(), ApiError> {
    admin(ctx)?;
    hms_access::require_high_risk_facility_permission(
        ctx,
        ctx.facility_id,
        PermissionCode::AdminAuthorityManage,
        Utc::now(),
    )?;
    Ok(())
}

pub async fn settings(
    ctx: NetworkContext,
) -> Result<ObjectResponse<NetworkPolicySettings>, ApiError> {
    admin(&ctx.context)?;
    let current_access = ctx.network.decision;
    let can_update = ctx.network.policy.configured
        && current_access.classification != NetworkClassification::Unknown
        && current_access.access_allowed
        && (current_access.classification == NetworkClassification::Onsite
            || current_access.mode == Some(NetworkOffsiteMode::FreshReauth));
    Ok(object(NetworkPolicySettings {
        policy: ctx.network.policy,
        current_access,
        can_update,
    }))
}
pub async fn preview(
    ctx: NetworkContext,
    input: NetworkPolicyCandidate,
) -> Result<ObjectResponse<NetworkPolicyPreview>, ApiError> {
    fresh_admin(&ctx.context)?;
    let candidate = hms_db::network::normalize_candidate(input).map_err(write_error)?;
    let retained = ctx.network.client.address().is_some_and(|address| {
        NetworkRanges::parse(&candidate.onsite_cidrs, false)
            .is_ok_and(|ranges| ranges.contains(address))
    });
    let policy = NetworkPolicy {
        configured: true,
        version: 1,
        onsite_cidrs: candidate.onsite_cidrs.clone(),
        offsite_mode: candidate.offsite_mode,
        updated_at: None,
        updated_by_user_id: None,
    };
    let mut candidate_access =
        network_access::evaluate(ctx.network.client, &policy, &ctx.context.reauth, Utc::now());
    candidate_access.policy_version = None;
    Ok(object(NetworkPolicyPreview {
        candidate,
        current_connection_retained_onsite: retained,
        candidate_access,
    }))
}
pub async fn update(
    state: AppState,
    ctx: NetworkContext,
    input: UpdateNetworkPolicyRequest,
) -> Result<ObjectResponse<NetworkPolicyWriteResult>, ApiError> {
    fresh_admin(&ctx.context)?;
    let result = hms_db::network::update_policy(
        state.db_pool(),
        hms_db::network::NetworkPolicyActor {
            facility_id: ctx.context.facility_id,
            user_id: Some(ctx.context.user_id),
            request_id: Some(ctx.context.request_id),
            reauth_deadline: Some(
                ctx.context
                    .reauth
                    .required_after
                    .min(ctx.authorization_deadline),
            ),
            auth_versions: Some((ctx.context.session_version, ctx.context.permission_version)),
            session_id: Some(ctx.context.session_id),
            active_profile: Some(ctx.context.active_profile),
            resolved_policy_version: Some(ctx.network.policy.version),
        },
        input,
        ctx.network.client.address(),
    )
    .await
    .map_err(write_error)?;
    Ok(object(result))
}
fn write_error(error: anyhow::Error) -> ApiError {
    use hms_db::network::NetworkPolicyError as E;
    if let Some(value) = error.downcast_ref::<E>() {
        return match value {
            E::InvalidPolicy => ApiError::bad_request("invalid_network_policy", value.message()),
            E::VersionChanged => ApiError::conflict("network_policy_changed", value.message()),
            E::RequestConflict => {
                ApiError::conflict("network_policy_request_conflict", value.message())
            }
            E::WouldLockOut => ApiError::conflict("network_policy_would_lock_out", value.message()),
            E::InvalidActor => ApiError::forbidden("network_policy_actor_invalid", value.message()),
            E::ReauthExpired => ApiError::forbidden("reauth_required", value.message()),
        };
    }
    ApiError::conflict("network_policy_write_unconfirmed","This change may already be saved. Review the current policy before making another change, or retry the exact original request after confirming your sign-in.")
}
