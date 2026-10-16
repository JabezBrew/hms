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
use hms_domain::inventory_standing::*;
use uuid::Uuid;

#[utoipa::path(post,path="/api/v2/inventory/requisitions/{id}/review/cancel",operation_id="postInventoryRequisitionCancel",tag="inventory",security(("bearerAuth"=[])),params(("id"=Uuid,Path)),request_body=StandingRequestAction,responses((status=200,body=ObjectResponse<RequisitionReview>),(status=400,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn cancel_request(
    State(state): State<AppState>,
    RequestContext(ctx): RequestContext,
    Path(id): Path<Uuid>,
    Json(body): Json<StandingRequestAction>,
) -> Result<Json<ObjectResponse<RequisitionReview>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .standing_orders()
            .cancel_request(&ctx, id, body)
            .await?,
    ))
}

#[utoipa::path(post,path="/api/v2/inventory/requisitions/{id}/review/approve",operation_id="postInventoryRequisitionApprove",tag="inventory",security(("bearerAuth"=[])),params(("id"=Uuid,Path)),request_body=StandingRequestAction,responses((status=200,body=ObjectResponse<RequisitionReview>),(status=400,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn approve_request(
    State(state): State<AppState>,
    RequestContext(ctx): RequestContext,
    Path(id): Path<Uuid>,
    Json(body): Json<StandingRequestAction>,
) -> Result<Json<ObjectResponse<RequisitionReview>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .standing_orders()
            .approve_request(&ctx, id, body)
            .await?,
    ))
}
#[utoipa::path(post,path="/api/v2/inventory/requisitions/{id}/issue",operation_id="postInventoryRequisitionIssue",tag="inventory",security(("bearerAuth"=[])),params(("id"=Uuid,Path)),request_body=StandingRequestAction,responses((status=200,body=ObjectResponse<RequisitionReview>),(status=400,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn issue_request(
    State(state): State<AppState>,
    RequestContext(ctx): RequestContext,
    Path(id): Path<Uuid>,
    Json(body): Json<StandingRequestAction>,
) -> Result<Json<ObjectResponse<RequisitionReview>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .standing_orders()
            .issue_request(&ctx, id, body)
            .await?,
    ))
}

#[utoipa::path(get,path="/api/v2/inventory/standing-order-templates",operation_id="getInventoryStandingTemplates",tag="inventory",security(("bearerAuth"=[])),params(StandingTemplateListQuery),responses((status=200,body=ListResponse<StandingTemplateListItem>),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse)))]
pub async fn list(
    State(state): State<AppState>,
    RequestContext(ctx): RequestContext,
    Query(query): Query<StandingTemplateListQuery>,
) -> Result<Json<ListResponse<StandingTemplateListItem>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .standing_orders()
            .list(&ctx, query)
            .await?,
    ))
}
#[utoipa::path(post,path="/api/v2/inventory/standing-order-templates",operation_id="postInventoryStandingTemplates",tag="inventory",security(("bearerAuth"=[])),request_body=CreateStandingTemplateRequest,responses((status=200,body=ObjectResponse<StandingTemplateDetail>),(status=400,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn create(
    State(state): State<AppState>,
    RequestContext(ctx): RequestContext,
    Json(body): Json<CreateStandingTemplateRequest>,
) -> Result<Json<ObjectResponse<StandingTemplateDetail>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .standing_orders()
            .create(&ctx, body)
            .await?,
    ))
}
#[utoipa::path(get,path="/api/v2/inventory/standing-order-templates/{id}",operation_id="getInventoryStandingTemplateById",tag="inventory",security(("bearerAuth"=[])),params(("id"=Uuid,Path)),responses((status=200,body=ObjectResponse<StandingTemplateDetail>),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse)))]
pub async fn detail(
    State(state): State<AppState>,
    RequestContext(ctx): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<StandingTemplateDetail>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .standing_orders()
            .detail(&ctx, id)
            .await?,
    ))
}
#[utoipa::path(patch,path="/api/v2/inventory/standing-order-templates/{id}",operation_id="patchInventoryStandingTemplate",tag="inventory",security(("bearerAuth"=[])),params(("id"=Uuid,Path)),request_body=UpdateStandingTemplateRequest,responses((status=200,body=ObjectResponse<StandingTemplateDetail>),(status=400,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn update(
    State(state): State<AppState>,
    RequestContext(ctx): RequestContext,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateStandingTemplateRequest>,
) -> Result<Json<ObjectResponse<StandingTemplateDetail>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .standing_orders()
            .update(&ctx, id, body)
            .await?,
    ))
}
#[utoipa::path(post,path="/api/v2/inventory/standing-order-templates/{id}/status",operation_id="postInventoryStandingTemplateStatus",tag="inventory",security(("bearerAuth"=[])),params(("id"=Uuid,Path)),request_body=StandingTemplateStatusRequest,responses((status=200,body=ObjectResponse<StandingTemplateDetail>),(status=400,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn status(
    State(state): State<AppState>,
    RequestContext(ctx): RequestContext,
    Path(id): Path<Uuid>,
    Json(body): Json<StandingTemplateStatusRequest>,
) -> Result<Json<ObjectResponse<StandingTemplateDetail>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .standing_orders()
            .status(&ctx, id, body)
            .await?,
    ))
}
#[utoipa::path(post,path="/api/v2/inventory/standing-order-templates/{id}/runs",operation_id="postInventoryStandingTemplateRun",tag="inventory",security(("bearerAuth"=[])),params(("id"=Uuid,Path)),request_body=GenerateStandingTemplateRequest,responses((status=200,body=ObjectResponse<RequisitionReview>),(status=400,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn generate(
    State(state): State<AppState>,
    RequestContext(ctx): RequestContext,
    Path(id): Path<Uuid>,
    Json(body): Json<GenerateStandingTemplateRequest>,
) -> Result<Json<ObjectResponse<RequisitionReview>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .standing_orders()
            .generate(&ctx, id, body)
            .await?,
    ))
}
#[utoipa::path(get,path="/api/v2/inventory/requisitions/{id}/review",operation_id="getInventoryRequisitionReview",tag="inventory",security(("bearerAuth"=[])),params(("id"=Uuid,Path)),responses((status=200,body=ObjectResponse<RequisitionReview>),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse)))]
pub async fn review(
    State(state): State<AppState>,
    RequestContext(ctx): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<RequisitionReview>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .standing_orders()
            .review(&ctx, id)
            .await?,
    ))
}
