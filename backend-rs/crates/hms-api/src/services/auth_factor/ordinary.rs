use super::{actor, db, error, ApiError, AppState, FactorError, LoginOutcome, NetworkContext};
use hms_domain::auth_assurance::OrdinaryPasswordConfirmationRequest;

pub async fn confirm_password(
    state: &AppState,
    ctx: &NetworkContext,
    input: OrdinaryPasswordConfirmationRequest,
) -> Result<LoginOutcome, ApiError> {
    let account = hms_db::auth::user_by_id_for_facility(
        state.db_pool(),
        ctx.context.user_id,
        ctx.context.facility_id,
    )
    .await
    .map_err(error)?
    .ok_or_else(ApiError::unauthorized)?;
    // This route preserves login's enrolled/privileged factor policy. There is
    // no fallback to password-only confirmation after a passkey refusal.
    if account.auth_security.passkey_required || account.auth_security.passkey_enrolled {
        return Err(error(FactorError::FactorRequired.into()));
    }
    let Some((matches, _permit, admitted_at)) = state
        .verify_login_password_bounded(&account, &input.current_password)
        .await
        .map_err(error)?
    else {
        return Err(ApiError::too_many_requests(
            "password_confirmation_limited",
            "Current password could not be confirmed. Wait before trying again.",
        ));
    };
    if !matches {
        return Err(ApiError::forbidden(
            "password_confirmation_failed",
            "Current password could not be verified.",
        ));
    }
    db::confirm_ordinary_password(state.db_pool(), actor(ctx), &account, admitted_at)
        .await
        .map_err(error)?;
    state.invalidate_auth_cache_for_session(
        ctx.context.facility_id,
        ctx.context.user_id,
        ctx.context.session_id,
    );
    let result = state
        .existing_session_outcome(ctx.context.user_id, ctx.context.session_id)
        .await
        .map_err(error)?
        .ok_or_else(ApiError::unauthorized)?;
    if result.user.facility_id != ctx.context.facility_id
        || result.user.id != ctx.context.user_id
        || result.user.session_version != ctx.context.session_version
        || result.user.permission_version != ctx.context.permission_version
        || result.user.active_profile != ctx.context.active_profile
        || result.user.auth_security.factor_version != account.auth_security.factor_version
        || result.user.auth_security.passkey_required
        || result.user.auth_security.passkey_enrolled
    {
        return Err(ApiError::unauthorized());
    }
    Ok(result)
}
