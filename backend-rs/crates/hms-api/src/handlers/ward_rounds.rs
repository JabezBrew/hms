use axum::extract::{
    rejection::{JsonRejection, QueryRejection},
    Path, Query, State,
};
use axum::Json;
use hms_domain::ward_rounds::{
    CommitWardRoundRequest, CreateWardRoundActionRequest, CreateWardRoundRequest,
    SaveWardRoundDraftRequest, UpdateWardRoundActionRequest, UpdateWardRoundRequest,
    WardRoundCommandReceipt, WardRoundCurrentQuery, WardRoundDetail, WardRoundWorkspace,
};
use uuid::Uuid;

use crate::error::{ApiError, ApiErrorResponse};
use crate::extractors::{NetworkContext, RequestContext};
use crate::response::ObjectResponse;
use crate::state::AppState;

#[utoipa::path(
    get,
    path = "/api/v2/patients/{patient_id}/chronicle/ward-rounds/current",
    operation_id = "getPatientChronicleCurrentWardRound",
    tag = "clinical",
    security(("bearerAuth" = [])),
    params(("patient_id" = Uuid, Path, description = "Patient id"),WardRoundCurrentQuery),
    responses(
        (status = 200, description = "Protected selected-admission workspace and current draft", body = ObjectResponse<WardRoundWorkspace>),
        (status = 400, description = "Invalid selected admission query", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Ward Round not found", body = ApiErrorResponse),
        (status = 409, description = "Preserved evidence requires review or the context changed", body = ApiErrorResponse)
    )
)]
pub async fn current(
    State(state): State<AppState>,
    proof: NetworkContext,
    Path(patient_id): Path<Uuid>,
    query: Result<Query<WardRoundCurrentQuery>, QueryRejection>,
) -> Result<Json<ObjectResponse<WardRoundWorkspace>>, ApiError> {
    let Query(query) = query.map_err(|_| invalid_request())?;
    Ok(Json(
        state
            .ward_rounds_service()
            .current(
                &proof.context,
                patient_id,
                query,
                proof.authorization_deadline,
            )
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
        (status = 409, description = "Retired individual mutation; use the complete draft command", body = ApiErrorResponse),
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
        (status = 404, description = "Ward Round not found", body = ApiErrorResponse),
        (status = 409, description = "Preserved evidence requires review", body = ApiErrorResponse)
    )
)]
pub async fn get(
    State(state): State<AppState>,
    proof: NetworkContext,
    Path((patient_id, round_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<ObjectResponse<WardRoundDetail>>, ApiError> {
    Ok(Json(
        state
            .ward_rounds_service()
            .get(
                &proof.context,
                patient_id,
                round_id,
                proof.authorization_deadline,
            )
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
        (status = 400, description = "Invalid Ward Round request", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 409, description = "Retired individual mutation; use the complete draft command", body = ApiErrorResponse)
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
        (status = 409, description = "Retired individual mutation; use the complete draft command", body = ApiErrorResponse),
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
        (status = 409, description = "Retired individual mutation; use the complete draft command", body = ApiErrorResponse),
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
        (status = 409, description = "Retired individual mutation; use the complete draft command", body = ApiErrorResponse),
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
        (status = 200, description = "Immutable original Ward Round commit receipt", body = ObjectResponse<WardRoundCommandReceipt>),
        (status = 400, description = "Invalid Ward Round commit", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 409, description = "Ward Round version conflict", body = ApiErrorResponse)
    )
)]
pub async fn commit(
    State(state): State<AppState>,
    proof: NetworkContext,
    Path((patient_id, round_id)): Path<(Uuid, Uuid)>,
    payload: Result<Json<CommitWardRoundRequest>, JsonRejection>,
) -> Result<Json<ObjectResponse<WardRoundCommandReceipt>>, ApiError> {
    let Json(payload) = payload.map_err(|_| invalid_request())?;
    Ok(Json(
        state
            .ward_rounds_service()
            .commit(
                &proof.context,
                patient_id,
                round_id,
                payload,
                proof.authorization_deadline,
            )
            .await?,
    ))
}

#[utoipa::path(
    post,path="/api/v2/patients/{patient_id}/chronicle/ward-rounds/draft",
    operation_id="postPatientChronicleWardRoundDraft",tag="clinical",security(("bearerAuth"=[])),
    params(("patient_id"=Uuid,Path,description="Patient id")),request_body=SaveWardRoundDraftRequest,
    responses((status=200,description="Immutable original complete-draft receipt",body=ObjectResponse<WardRoundCommandReceipt>),
        (status=400,description="Invalid supported draft",body=ApiErrorResponse),(status=401,description="Authentication required",body=ApiErrorResponse),
        (status=403,description="Current clinical/action authority required",body=ApiErrorResponse),(status=409,description="Source conflict or explicitly unconfirmed command",body=ApiErrorResponse))
)]
pub async fn save_draft(
    State(state): State<AppState>,
    proof: NetworkContext,
    Path(patient): Path<Uuid>,
    payload: Result<Json<SaveWardRoundDraftRequest>, JsonRejection>,
) -> Result<Json<ObjectResponse<WardRoundCommandReceipt>>, ApiError> {
    let Json(payload) = payload.map_err(|_| invalid_request())?;
    Ok(Json(
        state
            .ward_rounds_service()
            .save(
                &proof.context,
                patient,
                payload,
                proof.authorization_deadline,
            )
            .await?,
    ))
}

#[utoipa::path(
    get,path="/api/v2/patients/{patient_id}/chronicle/ward-rounds/requests/{request_id}",
    operation_id="getPatientChronicleWardRoundRequest",tag="clinical",security(("bearerAuth"=[])),
    params(("patient_id"=Uuid,Path,description="Patient id"),("request_id"=Uuid,Path,description="Original command reference")),
    responses((status=200,description="Immutable original actor-scoped command receipt",body=ObjectResponse<WardRoundCommandReceipt>),
        (status=401,description="Authentication required",body=ApiErrorResponse),(status=403,description="Current clinical authority required",body=ApiErrorResponse),(status=404,description="Command not found in this scope",body=ApiErrorResponse),(status=409,description="Protected original receipt could not be loaded",body=ApiErrorResponse))
)]
pub async fn receipt(
    State(state): State<AppState>,
    proof: NetworkContext,
    Path((patient, key)): Path<(Uuid, Uuid)>,
) -> Result<Json<ObjectResponse<WardRoundCommandReceipt>>, ApiError> {
    Ok(Json(
        state
            .ward_rounds_service()
            .receipt(&proof.context, patient, key, proof.authorization_deadline)
            .await?,
    ))
}

fn invalid_request() -> ApiError {
    ApiError::bad_request(
        "invalid_ward_round",
        "Use only the supported fields and valid identifiers for the reviewed Ward Round command.",
    )
}
