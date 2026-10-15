use crate::{
    error::{ApiError, ApiErrorResponse},
    extractors::RequestContext,
    response::{ListResponse, ObjectResponse},
    state::AppState,
};
use axum::{
    extract::{Path, Query, State},
    Json,
};
use hms_domain::admin_access::{
    AccessGrantKind, AccessGrantListItem, AccessGrantListQuery, AccessGrantRevocation,
    RevokeAccessGrantRequest,
};
use uuid::Uuid;

#[utoipa::path(get,path="/api/v2/admin/access-grants",operation_id="getAdminAccessGrants",tag="admin",security(("bearerAuth"=[])),params(AccessGrantListQuery),responses((status=200,body=ListResponse<AccessGrantListItem>),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse)))]
pub async fn list(
    State(state): State<AppState>,
    RequestContext(ctx): RequestContext,
    Query(query): Query<AccessGrantListQuery>,
) -> Result<Json<ListResponse<AccessGrantListItem>>, ApiError> {
    Ok(Json(
        crate::services::admin_access::list(&state, &ctx, query).await?,
    ))
}

#[utoipa::path(post,path="/api/v2/admin/access-grants/{kind}/{id}/revoke",operation_id="postAdminAccessGrantRevoke",tag="admin",security(("bearerAuth"=[])),params(("kind"=AccessGrantKind,Path),("id"=Uuid,Path)),request_body=RevokeAccessGrantRequest,responses((status=200,body=ObjectResponse<AccessGrantRevocation>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn revoke(
    State(state): State<AppState>,
    RequestContext(ctx): RequestContext,
    Path((kind, id)): Path<(AccessGrantKind, Uuid)>,
    Json(payload): Json<RevokeAccessGrantRequest>,
) -> Result<Json<ObjectResponse<AccessGrantRevocation>>, ApiError> {
    Ok(Json(
        crate::services::admin_access::revoke(&state, &ctx, kind, id, payload).await?,
    ))
}
