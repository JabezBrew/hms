use crate::{
    cursor_list,
    error::ApiError,
    response::{object, ListResponse, ObjectResponse},
    state::AppState,
};
use hms_db::admin::AdminCursor;
use hms_db::admin_access::{RevokeGrant, RevokeGrantError};
use hms_domain::admin_access::{
    AccessGrantKind, AccessGrantListItem, AccessGrantListQuery, AccessGrantRevocation,
    RevokeAccessGrantRequest,
};
use hms_domain::deployment::PermissionCode;
use uuid::Uuid;

pub async fn list(
    state: &AppState,
    ctx: &hms_access::RequestContext,
    query: AccessGrantListQuery,
) -> Result<ListResponse<AccessGrantListItem>, ApiError> {
    hms_access::require_feature(ctx, hms_domain::deployment::FeatureKey::Admin)
        .map_err(ApiError::from)?;
    hms_access::require_facility_permission(
        ctx,
        state.facility_id(),
        PermissionCode::AdminAuthorityManage,
    )
    .map_err(ApiError::from)?;
    let page = cursor_list::page_request(
        query.cursor.as_deref(),
        query.limit,
        25,
        100,
        |occurred_at, id| AdminCursor { occurred_at, id },
    )
    .map_err(|_| ApiError::bad_request("invalid_cursor", "The access grant cursor is invalid."))?;
    let limit = page.fetch_limit();
    let rows = hms_db::admin_access::list_access_grants(
        state.db_pool(),
        state.facility_id(),
        page.cursor,
        limit,
        query.kind,
    )
    .await
    .map_err(|_| {
        ApiError::conflict(
            "access_grants_unavailable",
            "Access grants could not be loaded.",
        )
    })?;
    Ok(cursor_list::page_response(rows, page.limit, |item| {
        cursor_list::encode_cursor(item.created_at, item.id)
    }))
}

pub async fn revoke(
    state: &AppState,
    ctx: &hms_access::RequestContext,
    kind: AccessGrantKind,
    id: Uuid,
    payload: RevokeAccessGrantRequest,
) -> Result<ObjectResponse<AccessGrantRevocation>, ApiError> {
    super::admin::require_high_risk_admin_access(
        ctx,
        state.facility_id(),
        PermissionCode::AdminAuthorityManage,
    )?;
    let result=hms_db::admin_access::revoke_access_grant(state.db_pool(),RevokeGrant {
        facility_id:state.facility_id(),actor_user_id:ctx.user_id,id,kind,reconciliation:payload.reconciliation,request_id:Some(ctx.request_id.clone()),
    }).await.map_err(|error|match error {
        RevokeGrantError::NotFound=>ApiError::not_found("access_grant_not_found","Access grant was not found."),
        RevokeGrantError::ReconciliationRequired=>ApiError::conflict("access_grant_reconciliation_required","Choose whether to retain independent access or remove the historical permission copy before revoking this grant."),
        _=>ApiError::conflict("access_grant_revoke_failed","The access grant could not be confirmed as revoked. Refresh its status before trying again."),
    })?;
    state.invalidate_auth_cache_for_user(state.facility_id(), result.user_id);
    Ok(object(result))
}
