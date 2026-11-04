//! Strict HTTP shapes for availability-only laboratory administration.
use axum::extract::{Path, Query, State};
use axum::Json;
use hms_domain::laboratory_catalog::*;
use uuid::Uuid;

use crate::error::{ApiError, ApiErrorResponse};
use crate::extractors::{NetworkContext, RequestContext};
use crate::response::{ListResponse, ObjectResponse};
use crate::state::AppState;

#[utoipa::path(
    get,
    path = "/api/v2/laboratory/test-administration",
    operation_id = "getLaboratoryTestAdministration",
    tag = "laboratory",
    security(("bearerAuth" = [])),
    params(LaboratoryTestAdministrationQuery),
    responses(
        (status = 200, body = ListResponse<LaboratoryCatalogAdministrationListItem>),
        (status = 400, body = ApiErrorResponse),
        (status = 401, body = ApiErrorResponse),
        (status = 403, body = ApiErrorResponse),
        (status = 404, body = ApiErrorResponse),
        (status = 409, body = ApiErrorResponse)
    )
)]
pub async fn list_test_administration(
    State(state): State<AppState>,
    RequestContext(ctx): RequestContext,
    input: Result<
        Query<LaboratoryTestAdministrationQuery>,
        axum::extract::rejection::QueryRejection,
    >,
) -> Result<Json<ListResponse<LaboratoryCatalogAdministrationListItem>>, ApiError> {
    let Query(input) = input.map_err(|_| invalid())?;
    Ok(Json(
        state
            .laboratory_services()
            .administration()
            .list_tests(&ctx, input)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/laboratory/test-catalog/{id}/administration",
    operation_id = "getLaboratoryTestAdministrationById",
    tag = "laboratory",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path)),
    responses(
        (status = 200, body = ObjectResponse<LaboratoryCatalogAdministration>),
        (status = 400, body = ApiErrorResponse),
        (status = 401, body = ApiErrorResponse),
        (status = 403, body = ApiErrorResponse),
        (status = 404, body = ApiErrorResponse),
        (status = 409, body = ApiErrorResponse)
    )
)]
pub async fn get_test_administration(
    State(state): State<AppState>,
    RequestContext(ctx): RequestContext,
    path: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
) -> Result<Json<ObjectResponse<LaboratoryCatalogAdministration>>, ApiError> {
    let Path(id) = path.map_err(|_| invalid())?;
    Ok(Json(
        state
            .laboratory_services()
            .administration()
            .detail(&ctx, LabCatalogKind::Test, id)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/laboratory/test-catalog/{id}/history",
    operation_id = "getLaboratoryTestHistory",
    tag = "laboratory",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path), LaboratoryCatalogHistoryQuery),
    responses(
        (status = 200, body = ListResponse<LaboratoryCatalogHistoryItem>),
        (status = 400, body = ApiErrorResponse),
        (status = 401, body = ApiErrorResponse),
        (status = 403, body = ApiErrorResponse),
        (status = 404, body = ApiErrorResponse),
        (status = 409, body = ApiErrorResponse)
    )
)]
pub async fn test_history(
    State(state): State<AppState>,
    RequestContext(ctx): RequestContext,
    path: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
    input: Result<Query<LaboratoryCatalogHistoryQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<ListResponse<LaboratoryCatalogHistoryItem>>, ApiError> {
    let Path(id) = path.map_err(|_| invalid())?;
    let Query(input) = input.map_err(|_| invalid())?;
    Ok(Json(
        state
            .laboratory_services()
            .administration()
            .history(&ctx, LabCatalogKind::Test, id, input)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/laboratory/test-catalog/{id}/availability",
    operation_id = "postLaboratoryTestAvailability",
    tag = "laboratory",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path)),
    request_body = SetLaboratoryAvailabilityRequest,
    responses(
        (status = 200, body = ObjectResponse<LaboratoryCatalogCommandReceipt>),
        (status = 400, body = ApiErrorResponse),
        (status = 401, body = ApiErrorResponse),
        (status = 403, body = ApiErrorResponse),
        (status = 404, body = ApiErrorResponse),
        (status = 409, body = ApiErrorResponse)
    )
)]
pub async fn set_test_availability(
    State(state): State<AppState>,
    network: NetworkContext,
    path: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
    input: Result<Json<SetLaboratoryAvailabilityRequest>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<ObjectResponse<LaboratoryCatalogCommandReceipt>>, ApiError> {
    let Path(id) = path.map_err(|_| invalid())?;
    let Json(input) = input.map_err(|_| invalid())?;
    Ok(Json(
        state
            .laboratory_services()
            .administration()
            .command(
                &network.context,
                network.authorization_deadline,
                reviewed_input(LabCatalogKind::Test, id, input),
            )
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/laboratory/panel-administration",
    operation_id = "getLaboratoryPanelAdministration",
    tag = "laboratory",
    security(("bearerAuth" = [])),
    params(LaboratoryPanelAdministrationQuery),
    responses(
        (status = 200, body = ListResponse<LaboratoryCatalogAdministrationListItem>),
        (status = 400, body = ApiErrorResponse),
        (status = 401, body = ApiErrorResponse),
        (status = 403, body = ApiErrorResponse),
        (status = 404, body = ApiErrorResponse),
        (status = 409, body = ApiErrorResponse)
    )
)]
pub async fn list_panel_administration(
    State(state): State<AppState>,
    RequestContext(ctx): RequestContext,
    input: Result<
        Query<LaboratoryPanelAdministrationQuery>,
        axum::extract::rejection::QueryRejection,
    >,
) -> Result<Json<ListResponse<LaboratoryCatalogAdministrationListItem>>, ApiError> {
    let Query(input) = input.map_err(|_| invalid())?;
    Ok(Json(
        state
            .laboratory_services()
            .administration()
            .list_panels(&ctx, input)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/laboratory/panels/{id}/administration",
    operation_id = "getLaboratoryPanelAdministrationById",
    tag = "laboratory",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path)),
    responses(
        (status = 200, body = ObjectResponse<LaboratoryCatalogAdministration>),
        (status = 400, body = ApiErrorResponse),
        (status = 401, body = ApiErrorResponse),
        (status = 403, body = ApiErrorResponse),
        (status = 404, body = ApiErrorResponse),
        (status = 409, body = ApiErrorResponse)
    )
)]
pub async fn get_panel_administration(
    State(state): State<AppState>,
    RequestContext(ctx): RequestContext,
    path: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
) -> Result<Json<ObjectResponse<LaboratoryCatalogAdministration>>, ApiError> {
    let Path(id) = path.map_err(|_| invalid())?;
    Ok(Json(
        state
            .laboratory_services()
            .administration()
            .detail(&ctx, LabCatalogKind::Panel, id)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/laboratory/panels/{id}/history",
    operation_id = "getLaboratoryPanelHistory",
    tag = "laboratory",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path), LaboratoryCatalogHistoryQuery),
    responses(
        (status = 200, body = ListResponse<LaboratoryCatalogHistoryItem>),
        (status = 400, body = ApiErrorResponse),
        (status = 401, body = ApiErrorResponse),
        (status = 403, body = ApiErrorResponse),
        (status = 404, body = ApiErrorResponse),
        (status = 409, body = ApiErrorResponse)
    )
)]
pub async fn panel_history(
    State(state): State<AppState>,
    RequestContext(ctx): RequestContext,
    path: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
    input: Result<Query<LaboratoryCatalogHistoryQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<ListResponse<LaboratoryCatalogHistoryItem>>, ApiError> {
    let Path(id) = path.map_err(|_| invalid())?;
    let Query(input) = input.map_err(|_| invalid())?;
    Ok(Json(
        state
            .laboratory_services()
            .administration()
            .history(&ctx, LabCatalogKind::Panel, id, input)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/laboratory/panels/{id}/availability",
    operation_id = "postLaboratoryPanelAvailability",
    tag = "laboratory",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path)),
    request_body = SetLaboratoryAvailabilityRequest,
    responses(
        (status = 200, body = ObjectResponse<LaboratoryCatalogCommandReceipt>),
        (status = 400, body = ApiErrorResponse),
        (status = 401, body = ApiErrorResponse),
        (status = 403, body = ApiErrorResponse),
        (status = 404, body = ApiErrorResponse),
        (status = 409, body = ApiErrorResponse)
    )
)]
pub async fn set_panel_availability(
    State(state): State<AppState>,
    network: NetworkContext,
    path: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
    input: Result<Json<SetLaboratoryAvailabilityRequest>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<ObjectResponse<LaboratoryCatalogCommandReceipt>>, ApiError> {
    let Path(id) = path.map_err(|_| invalid())?;
    let Json(input) = input.map_err(|_| invalid())?;
    Ok(Json(
        state
            .laboratory_services()
            .administration()
            .command(
                &network.context,
                network.authorization_deadline,
                reviewed_input(LabCatalogKind::Panel, id, input),
            )
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/laboratory/catalog-commands/{client_request_id}",
    operation_id = "getLaboratoryCatalogCommandReceipt",
    tag = "laboratory",
    security(("bearerAuth" = [])),
    params(("client_request_id" = Uuid, Path)),
    responses(
        (status = 200, body = ObjectResponse<LaboratoryCatalogCommandReceipt>),
        (status = 400, body = ApiErrorResponse),
        (status = 401, body = ApiErrorResponse),
        (status = 403, body = ApiErrorResponse),
        (status = 404, body = ApiErrorResponse),
        (status = 409, body = ApiErrorResponse)
    )
)]
pub async fn command_receipt(
    State(state): State<AppState>,
    network: NetworkContext,
    path: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
) -> Result<Json<ObjectResponse<LaboratoryCatalogCommandReceipt>>, ApiError> {
    let Path(key) = path.map_err(|_| invalid())?;
    Ok(Json(
        state
            .laboratory_services()
            .administration()
            .receipt(&network.context, network.authorization_deadline, key)
            .await?,
    ))
}

fn reviewed_input(
    subject_kind: LabCatalogKind,
    subject_id: Uuid,
    input: SetLaboratoryAvailabilityRequest,
) -> LaboratoryCatalogReviewedInput {
    LaboratoryCatalogReviewedInput {
        action: LaboratoryCatalogAction::SetAvailability,
        subject_kind,
        subject_id,
        client_request_id: input.client_request_id,
        expected_version: input.expected_version,
        is_active: input.is_active,
        reason: input.reason,
    }
}

fn invalid() -> ApiError {
    ApiError::bad_request(
        "invalid_laboratory_catalog_request",
        "Provide the supported fields, current version and request reference.",
    )
}
