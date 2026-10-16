use crate::{
    error::{ApiError, ApiErrorResponse},
    extractors::NetworkContext,
    response::{object, ObjectResponse},
    state::AppState,
};
use axum::{extract::State, Json};
use hms_domain::network::*;

#[utoipa::path(get,path="/api/v2/auth/network-access",operation_id="getAuthNetworkAccess",tag="auth",security(("bearerAuth"=[])),responses((status=200,body=ObjectResponse<NetworkAccessDecision>),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse)))]
pub async fn current(
    ctx: NetworkContext,
) -> Result<Json<ObjectResponse<NetworkAccessDecision>>, ApiError> {
    Ok(Json(object(ctx.network.decision)))
}

#[utoipa::path(get,path="/api/v2/admin/network-policy",operation_id="getAdminNetworkPolicy",tag="admin",security(("bearerAuth"=[])),responses((status=200,body=ObjectResponse<NetworkPolicySettings>),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse)))]
pub async fn settings(
    ctx: NetworkContext,
) -> Result<Json<ObjectResponse<NetworkPolicySettings>>, ApiError> {
    Ok(Json(crate::services::network::settings(ctx).await?))
}

#[utoipa::path(post,path="/api/v2/admin/network-policy/preview",operation_id="postAdminNetworkPolicyPreview",tag="admin",security(("bearerAuth"=[])),request_body=NetworkPolicyCandidate,responses((status=200,body=ObjectResponse<NetworkPolicyPreview>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse)))]
pub async fn preview(
    ctx: NetworkContext,
    Json(input): Json<NetworkPolicyCandidate>,
) -> Result<Json<ObjectResponse<NetworkPolicyPreview>>, ApiError> {
    Ok(Json(crate::services::network::preview(ctx, input).await?))
}

#[utoipa::path(put,path="/api/v2/admin/network-policy",operation_id="putAdminNetworkPolicy",tag="admin",security(("bearerAuth"=[])),request_body=UpdateNetworkPolicyRequest,responses((status=200,body=ObjectResponse<NetworkPolicyWriteResult>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn update(
    State(state): State<AppState>,
    ctx: NetworkContext,
    Json(input): Json<UpdateNetworkPolicyRequest>,
) -> Result<Json<ObjectResponse<NetworkPolicyWriteResult>>, ApiError> {
    Ok(Json(
        crate::services::network::update(state, ctx, input).await?,
    ))
}
