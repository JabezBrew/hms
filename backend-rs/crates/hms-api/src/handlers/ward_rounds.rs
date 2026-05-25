use axum::extract::{Path, State};
use axum::Json;
use hms_domain::ward_rounds::{
    CommitWardRoundRequest, CommitWardRoundResponse, CreateWardRoundActionRequest,
    CreateWardRoundRequest, UpdateWardRoundActionRequest, UpdateWardRoundRequest, WardRoundDetail,
};
use uuid::Uuid;

use crate::error::{ApiError, ApiErrorResponse};
use crate::extractors::RequestContext;
use crate::response::ObjectResponse;
use crate::state::AppState;

#[utoipa::path(
    get,
    path = "/api/v2/patients/{patient_id}/chronicle/ward-rounds/current",
    operation_id = "getPatientChronicleCurrentWardRound",
    tag = "clinical",
    security(("bearerAuth" = [])),
    params(("patient_id" = Uuid, Path, description = "Patient id")),
    responses(
        (status = 200, description = "Current Ward Round", body = ObjectResponse<WardRoundDetail>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Ward Round not found", body = ApiErrorResponse)
    )
)]
pub async fn current(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(patient_id): Path<Uuid>,
) -> Result<Json<ObjectResponse<WardRoundDetail>>, ApiError> {
    Ok(Json(
        state
            .ward_rounds_service()
            .current(&user, patient_id)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/patients/{patient_id}/chronicle/ward-rounds",
    operation_id = "postPatientChronicleWardRounds",
    tag = "clinical",
    security(("bearerAuth" = [])),
    params(("patient_id" = Uuid, Path, description = "Patient id")),
    request_body = CreateWardRoundRequest,
    responses(
        (status = 200, description = "Ward Round draft", body = ObjectResponse<WardRoundDetail>),
        (status = 400, description = "Invalid Ward Round request", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse)
    )
)]
pub async fn create(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(patient_id): Path<Uuid>,
    Json(payload): Json<CreateWardRoundRequest>,
) -> Result<Json<ObjectResponse<WardRoundDetail>>, ApiError> {
    Ok(Json(
        state
            .ward_rounds_service()
            .create(&user, patient_id, payload)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/patients/{patient_id}/chronicle/ward-rounds/{round_id}",
    operation_id = "getPatientChronicleWardRound",
    tag = "clinical",
    security(("bearerAuth" = [])),
    params(
        ("patient_id" = Uuid, Path, description = "Patient id"),
        ("round_id" = Uuid, Path, description = "Ward Round id")
    ),
    responses(
        (status = 200, description = "Ward Round detail", body = ObjectResponse<WardRoundDetail>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Ward Round not found", body = ApiErrorResponse)
    )
)]
pub async fn get(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path((patient_id, round_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<ObjectResponse<WardRoundDetail>>, ApiError> {
    Ok(Json(
        state
            .ward_rounds_service()
            .get(&user, patient_id, round_id)
            .await?,
    ))
}

#[utoipa::path(
    patch,
    path = "/api/v2/patients/{patient_id}/chronicle/ward-rounds/{round_id}",
    operation_id = "patchPatientChronicleWardRound",
    tag = "clinical",
    security(("bearerAuth" = [])),
    params(
        ("patient_id" = Uuid, Path, description = "Patient id"),
        ("round_id" = Uuid, Path, description = "Ward Round id")
    ),
    request_body = UpdateWardRoundRequest,
    responses(
        (status = 200, description = "Ward Round detail", body = ObjectResponse<WardRoundDetail>),
        (status = 400, description = "Invalid Ward Round request", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 409, description = "Ward Round version conflict", body = ApiErrorResponse)
    )
)]
pub async fn update(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path((patient_id, round_id)): Path<(Uuid, Uuid)>,
    Json(payload): Json<UpdateWardRoundRequest>,
) -> Result<Json<ObjectResponse<WardRoundDetail>>, ApiError> {
    Ok(Json(
        state
            .ward_rounds_service()
            .update(&user, patient_id, round_id, payload)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/patients/{patient_id}/chronicle/ward-rounds/{round_id}/actions",
    operation_id = "postPatientChronicleWardRoundActions",
    tag = "clinical",
    security(("bearerAuth" = [])),
    params(
        ("patient_id" = Uuid, Path, description = "Patient id"),
        ("round_id" = Uuid, Path, description = "Ward Round id")
    ),
    request_body = CreateWardRoundActionRequest,
    responses(
        (status = 200, description = "Ward Round detail", body = ObjectResponse<WardRoundDetail>),
        (status = 400, description = "Invalid Ward Round action", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn create_action(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path((patient_id, round_id)): Path<(Uuid, Uuid)>,
    Json(payload): Json<CreateWardRoundActionRequest>,
) -> Result<Json<ObjectResponse<WardRoundDetail>>, ApiError> {
    Ok(Json(
        state
            .ward_rounds_service()
            .create_action(&user, patient_id, round_id, payload)
            .await?,
    ))
}

#[utoipa::path(
    patch,
    path = "/api/v2/patients/{patient_id}/chronicle/ward-rounds/{round_id}/actions/{action_id}",
    operation_id = "patchPatientChronicleWardRoundAction",
    tag = "clinical",
    security(("bearerAuth" = [])),
    params(
        ("patient_id" = Uuid, Path, description = "Patient id"),
        ("round_id" = Uuid, Path, description = "Ward Round id"),
        ("action_id" = Uuid, Path, description = "Ward Round action id")
    ),
    request_body = UpdateWardRoundActionRequest,
    responses(
        (status = 200, description = "Ward Round detail", body = ObjectResponse<WardRoundDetail>),
        (status = 400, description = "Invalid Ward Round action", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn update_action(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path((patient_id, round_id, action_id)): Path<(Uuid, Uuid, Uuid)>,
    Json(payload): Json<UpdateWardRoundActionRequest>,
) -> Result<Json<ObjectResponse<WardRoundDetail>>, ApiError> {
    Ok(Json(
        state
            .ward_rounds_service()
            .update_action(&user, patient_id, round_id, action_id, payload)
            .await?,
    ))
}

#[utoipa::path(
    delete,
    path = "/api/v2/patients/{patient_id}/chronicle/ward-rounds/{round_id}/actions/{action_id}",
    operation_id = "deletePatientChronicleWardRoundAction",
    tag = "clinical",
    security(("bearerAuth" = [])),
    params(
        ("patient_id" = Uuid, Path, description = "Patient id"),
        ("round_id" = Uuid, Path, description = "Ward Round id"),
        ("action_id" = Uuid, Path, description = "Ward Round action id")
    ),
    responses(
        (status = 200, description = "Ward Round detail", body = ObjectResponse<WardRoundDetail>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Ward Round action not found", body = ApiErrorResponse)
    )
)]
pub async fn delete_action(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path((patient_id, round_id, action_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Json<ObjectResponse<WardRoundDetail>>, ApiError> {
    Ok(Json(
        state
            .ward_rounds_service()
            .delete_action(&user, patient_id, round_id, action_id)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/patients/{patient_id}/chronicle/ward-rounds/{round_id}/commit",
    operation_id = "postPatientChronicleWardRoundCommit",
    tag = "clinical",
    security(("bearerAuth" = [])),
    params(
        ("patient_id" = Uuid, Path, description = "Patient id"),
        ("round_id" = Uuid, Path, description = "Ward Round id")
    ),
    request_body = CommitWardRoundRequest,
    responses(
        (status = 200, description = "Committed Ward Round", body = ObjectResponse<CommitWardRoundResponse>),
        (status = 400, description = "Invalid Ward Round commit", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 409, description = "Ward Round version conflict", body = ApiErrorResponse)
    )
)]
pub async fn commit(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path((patient_id, round_id)): Path<(Uuid, Uuid)>,
    Json(payload): Json<CommitWardRoundRequest>,
) -> Result<Json<ObjectResponse<CommitWardRoundResponse>>, ApiError> {
    Ok(Json(
        state
            .ward_rounds_service()
            .commit(&user, patient_id, round_id, payload)
            .await?,
    ))
}
