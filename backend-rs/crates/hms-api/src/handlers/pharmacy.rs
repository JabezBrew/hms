use axum::extract::{Path, Query, State};
use axum::Json;
use hms_domain::pharmacy::{
    DispensePharmacyFulfillmentRequest, PharmacyFulfillmentDispenseResult, PharmacyQueueItem,
    PharmacyQueueQuery,
};
use uuid::Uuid;

use crate::error::{ApiError, ApiErrorResponse};
use crate::extractors::RequestContext;
use crate::response::{ListResponse, ObjectResponse};
use crate::state::AppState;

#[utoipa::path(
    get,
    path = "/api/v2/pharmacy/dispensing-queue",
    operation_id = "getPharmacyDispensingQueue",
    tag = "pharmacy",
    security(("bearerAuth" = [])),
    params(PharmacyQueueQuery),
    responses(
        (status = 200, body = ListResponse<PharmacyQueueItem>),
        (status = 401, body = ApiErrorResponse),
        (status = 403, body = ApiErrorResponse)
    )
)]
pub async fn list_queue(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<PharmacyQueueQuery>,
) -> Result<Json<ListResponse<PharmacyQueueItem>>, ApiError> {
    Ok(Json(
        state.pharmacy_service().list_queue(&user, query).await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/pharmacy/dispensing-queue/{id}",
    operation_id = "getPharmacyDispensingQueueItem",
    tag = "pharmacy",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Pharmacy fulfillment ID")),
    responses(
        (status = 200, body = ObjectResponse<PharmacyQueueItem>),
        (status = 401, body = ApiErrorResponse),
        (status = 403, body = ApiErrorResponse),
        (status = 404, body = ApiErrorResponse)
    )
)]
pub async fn get_queue_item(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<PharmacyQueueItem>>, ApiError> {
    Ok(Json(
        state.pharmacy_service().get_queue_item(&user, id).await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/pharmacy/dispensing-queue/{id}/dispense",
    operation_id = "postPharmacyDispensingQueueDispense",
    tag = "pharmacy",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Pharmacy fulfillment ID")),
    request_body = DispensePharmacyFulfillmentRequest,
    responses(
        (status = 200, body = ObjectResponse<PharmacyFulfillmentDispenseResult>),
        (status = 400, body = ApiErrorResponse),
        (status = 401, body = ApiErrorResponse),
        (status = 403, body = ApiErrorResponse),
        (status = 404, body = ApiErrorResponse),
        (status = 409, body = ApiErrorResponse)
    )
)]
pub async fn dispense_queue_item(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(payload): Json<DispensePharmacyFulfillmentRequest>,
) -> Result<Json<ObjectResponse<PharmacyFulfillmentDispenseResult>>, ApiError> {
    Ok(Json(
        state
            .pharmacy_service()
            .dispense(&user, id, payload)
            .await?,
    ))
}
