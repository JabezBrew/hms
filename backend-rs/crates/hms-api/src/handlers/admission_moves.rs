use crate::{
    error::{ApiError, ApiErrorResponse},
    extractors::NetworkContext,
    response::{ListResponse, ObjectResponse},
    services::admission_moves::{invalid, AdmissionMovesService},
    state::AppState,
};
use axum::{
    extract::{
        rejection::{JsonRejection, PathRejection, QueryRejection},
        Path, Query, State,
    },
    Json,
};
use hms_domain::ward_moves::*;
use uuid::Uuid;

#[utoipa::path(get,path="/api/v2/patients/{patient_id}/chronicle/admissions/{admission_case_id}/placement",operation_id="getAdmissionPlacementContext",tag="wards",security(("bearerAuth"=[])),params(("patient_id"=Uuid,Path),("admission_case_id"=Uuid,Path)),responses((status=200,body=ObjectResponse<AdmissionPlacementContext>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn context(
    State(s): State<AppState>,
    n: NetworkContext,
    p: Result<Path<(Uuid, Uuid)>, PathRejection>,
) -> Result<Json<ObjectResponse<AdmissionPlacementContext>>, ApiError> {
    let Path((patient, case)) = p.map_err(|_| invalid())?;
    Ok(Json(
        AdmissionMovesService::new(s)
            .context(&n.context, n.authorization_deadline, patient, case)
            .await?,
    ))
}

#[utoipa::path(get,path="/api/v2/patients/{patient_id}/chronicle/admissions/{admission_case_id}/move-destinations",operation_id="getAdmissionMoveDestinations",tag="wards",security(("bearerAuth"=[])),params(("patient_id"=Uuid,Path),("admission_case_id"=Uuid,Path),("cursor"=Option<String>,Query),("limit"=Option<u8>,Query),("ward_id"=Option<Uuid>,Query),("search"=Option<String>,Query)),responses((status=200,body=ListResponse<AdmissionMoveDestination>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn destinations(
    State(s): State<AppState>,
    n: NetworkContext,
    p: Result<Path<(Uuid, Uuid)>, PathRejection>,
    q: Result<Query<AdmissionMoveDestinationQuery>, QueryRejection>,
) -> Result<Json<ListResponse<AdmissionMoveDestination>>, ApiError> {
    let Path((patient, case)) = p.map_err(|_| invalid())?;
    let Query(q) = q.map_err(|_| invalid())?;
    Ok(Json(
        AdmissionMovesService::new(s)
            .destinations(&n.context, n.authorization_deadline, patient, case, q)
            .await?,
    ))
}

#[utoipa::path(post,path="/api/v2/patients/{patient_id}/chronicle/admissions/{admission_case_id}/moves",operation_id="postAdmissionMove",tag="wards",security(("bearerAuth"=[])),params(("patient_id"=Uuid,Path),("admission_case_id"=Uuid,Path)),request_body=AdmissionMoveRequest,responses((status=200,body=ObjectResponse<AdmissionMoveReceipt>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn command(
    State(s): State<AppState>,
    n: NetworkContext,
    p: Result<Path<(Uuid, Uuid)>, PathRejection>,
    input: Result<Json<AdmissionMoveRequest>, JsonRejection>,
) -> Result<Json<ObjectResponse<AdmissionMoveReceipt>>, ApiError> {
    let Path((patient, case)) = p.map_err(|_| invalid())?;
    let Json(input) = input.map_err(|_| invalid())?;
    Ok(Json(
        AdmissionMovesService::new(s)
            .command(&n.context, n.authorization_deadline, patient, case, input)
            .await?,
    ))
}

#[utoipa::path(get,path="/api/v2/patients/{patient_id}/chronicle/admissions/{admission_case_id}/moves",operation_id="getAdmissionMoveHistory",tag="wards",security(("bearerAuth"=[])),params(("patient_id"=Uuid,Path),("admission_case_id"=Uuid,Path),("cursor"=Option<String>,Query),("limit"=Option<u8>,Query)),responses((status=200,body=ListResponse<AdmissionMoveHistoryItem>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn history(
    State(s): State<AppState>,
    n: NetworkContext,
    p: Result<Path<(Uuid, Uuid)>, PathRejection>,
    q: Result<Query<AdmissionMoveHistoryQuery>, QueryRejection>,
) -> Result<Json<ListResponse<AdmissionMoveHistoryItem>>, ApiError> {
    let Path((patient, case)) = p.map_err(|_| invalid())?;
    let Query(q) = q.map_err(|_| invalid())?;
    Ok(Json(
        AdmissionMovesService::new(s)
            .history(&n.context, n.authorization_deadline, patient, case, q)
            .await?,
    ))
}

#[utoipa::path(get,path="/api/v2/patients/{patient_id}/chronicle/admissions/{admission_case_id}/moves/{move_id}",operation_id="getAdmissionMove",tag="wards",security(("bearerAuth"=[])),params(("patient_id"=Uuid,Path),("admission_case_id"=Uuid,Path),("move_id"=Uuid,Path)),responses((status=200,body=ObjectResponse<AdmissionMoveDetail>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn detail(
    State(s): State<AppState>,
    n: NetworkContext,
    p: Result<Path<(Uuid, Uuid, Uuid)>, PathRejection>,
) -> Result<Json<ObjectResponse<AdmissionMoveDetail>>, ApiError> {
    let Path((patient, case, id)) = p.map_err(|_| invalid())?;
    Ok(Json(
        AdmissionMovesService::new(s)
            .detail(&n.context, n.authorization_deadline, patient, case, id)
            .await?,
    ))
}

#[utoipa::path(get,path="/api/v2/patients/{patient_id}/chronicle/admissions/{admission_case_id}/move-requests/{request_id}",operation_id="getAdmissionMoveRequestReceipt",tag="wards",security(("bearerAuth"=[])),params(("patient_id"=Uuid,Path),("admission_case_id"=Uuid,Path),("request_id"=Uuid,Path)),responses((status=200,body=ObjectResponse<AdmissionMoveReceipt>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn receipt(
    State(s): State<AppState>,
    n: NetworkContext,
    p: Result<Path<(Uuid, Uuid, Uuid)>, PathRejection>,
) -> Result<Json<ObjectResponse<AdmissionMoveReceipt>>, ApiError> {
    let Path((patient, case, id)) = p.map_err(|_| invalid())?;
    Ok(Json(
        AdmissionMovesService::new(s)
            .receipt(&n.context, n.authorization_deadline, patient, case, id)
            .await?,
    ))
}
