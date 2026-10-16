use crate::{
    error::{ApiError, ApiErrorResponse},
    extractors::NetworkContext,
    response::{ListResponse, ObjectResponse},
    services::ward::patient_handover as service,
    state::AppState,
};
use axum::{
    extract::{
        rejection::{JsonRejection, QueryRejection},
        Path, Query, State,
    },
    Json,
};
use hms_domain::patient_handover::*;
use uuid::Uuid;
fn body<T>(value: Result<Json<T>, JsonRejection>) -> Result<T, ApiError> {
    value.map(|Json(v)| v).map_err(|_| {
        ApiError::bad_request(
            "invalid_patient_handover_request",
            "Provide the supported handover fields using the required request format.",
        )
    })
}
fn query<T>(value: Result<Query<T>, QueryRejection>) -> Result<T, ApiError> {
    value.map(|Query(v)| v).map_err(|_| {
        ApiError::bad_request(
            "invalid_patient_handover_query",
            "Use the supported handover query fields and a valid scope.",
        )
    })
}
#[utoipa::path(get,path="/api/v2/nursing/patient-handovers",operation_id="getPatientHandovers",tag="nursing",security(("bearerAuth"=[])),params(PatientHandoverListQuery),responses((status=200,body=ListResponse<PatientHandoverListItem>),(status=400,body=ApiErrorResponse),(status=403,body=ApiErrorResponse)))]
pub async fn list(
    State(s): State<AppState>,
    network: NetworkContext,
    q: Result<Query<PatientHandoverListQuery>, QueryRejection>,
) -> Result<Json<ListResponse<PatientHandoverListItem>>, ApiError> {
    Ok(Json(
        service::list(
            &s,
            &network.context,
            query(q)?,
            network.authorization_deadline,
        )
        .await?,
    ))
}
#[utoipa::path(get,path="/api/v2/nursing/patient-handovers/{id}",operation_id="getPatientHandover",tag="nursing",security(("bearerAuth"=[])),params(("id"=Uuid,Path)),responses((status=200,body=ObjectResponse<PatientHandoverDetail>),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse)))]
pub async fn detail(
    State(s): State<AppState>,
    network: NetworkContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<PatientHandoverDetail>>, ApiError> {
    Ok(Json(
        service::get(&s, &network.context, id, network.authorization_deadline).await?,
    ))
}
#[utoipa::path(get,path="/api/v2/nursing/patient-handovers/{id}/history",operation_id="getPatientHandoverHistory",tag="nursing",security(("bearerAuth"=[])),params(("id"=Uuid,Path),PatientHandoverHistoryQuery),responses((status=200,body=ListResponse<PatientHandoverHistoryItem>),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse)))]
pub async fn history(
    State(s): State<AppState>,
    network: NetworkContext,
    Path(id): Path<Uuid>,
    q: Result<Query<PatientHandoverHistoryQuery>, QueryRejection>,
) -> Result<Json<ListResponse<PatientHandoverHistoryItem>>, ApiError> {
    Ok(Json(
        service::history(
            &s,
            &network.context,
            id,
            query(q)?,
            network.authorization_deadline,
        )
        .await?,
    ))
}
#[utoipa::path(get,path="/api/v2/nursing/patient-handovers/{id}/revisions/{revision_id}",operation_id="getPatientHandoverRevision",tag="nursing",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("revision_id"=Uuid,Path)),responses((status=200,body=ObjectResponse<PatientHandoverRevision>),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse)))]
pub async fn revision(
    State(s): State<AppState>,
    network: NetworkContext,
    Path((id, r)): Path<(Uuid, Uuid)>,
) -> Result<Json<ObjectResponse<PatientHandoverRevision>>, ApiError> {
    Ok(Json(
        service::revision(&s, &network.context, id, r, network.authorization_deadline).await?,
    ))
}
#[utoipa::path(get,path="/api/v2/nursing/patient-handovers/recipients",operation_id="getPatientHandoverRecipients",tag="nursing",security(("bearerAuth"=[])),params(HandoverRecipientQuery),responses((status=200,body=ListResponse<HandoverRecipient>),(status=403,body=ApiErrorResponse)))]
pub async fn recipients(
    State(s): State<AppState>,
    network: NetworkContext,
    q: Result<Query<HandoverRecipientQuery>, QueryRejection>,
) -> Result<Json<ListResponse<HandoverRecipient>>, ApiError> {
    Ok(Json(
        service::recipients(
            &s,
            &network.context,
            query(q)?,
            network.authorization_deadline,
        )
        .await?,
    ))
}
#[utoipa::path(get,path="/api/v2/nursing/patient-handovers/requests/{request_id}",operation_id="getPatientHandoverReceipt",tag="nursing",security(("bearerAuth"=[])),params(("request_id"=Uuid,Path),PatientHandoverReceiptQuery),responses((status=200,body=ObjectResponse<PatientHandoverReceipt>),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse)))]
pub async fn receipt(
    State(s): State<AppState>,
    network: NetworkContext,
    Path(key): Path<Uuid>,
    q: Result<Query<PatientHandoverReceiptQuery>, QueryRejection>,
) -> Result<Json<ObjectResponse<PatientHandoverReceipt>>, ApiError> {
    Ok(Json(
        service::receipt(
            &s,
            &network.context,
            key,
            query(q)?.patient_id,
            network.authorization_deadline,
        )
        .await?,
    ))
}
#[utoipa::path(post,path="/api/v2/nursing/patient-handovers",operation_id="postPatientHandover",tag="nursing",security(("bearerAuth"=[])),request_body=CreatePatientHandoverRequest,responses((status=200,body=ObjectResponse<PatientHandoverReceipt>),(status=400,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn create(
    State(s): State<AppState>,
    network: NetworkContext,
    data: Result<Json<CreatePatientHandoverRequest>, JsonRejection>,
) -> Result<Json<ObjectResponse<PatientHandoverReceipt>>, ApiError> {
    Ok(Json(
        service::create(
            &s,
            &network.context,
            body(data)?,
            network.authorization_deadline,
        )
        .await?,
    ))
}
#[utoipa::path(post,path="/api/v2/nursing/patient-handovers/{id}/amend",operation_id="postPatientHandoverAmend",tag="nursing",security(("bearerAuth"=[])),params(("id"=Uuid,Path)),request_body=AmendPatientHandoverRequest,responses((status=200,body=ObjectResponse<PatientHandoverReceipt>),(status=400,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn amend(
    State(s): State<AppState>,
    network: NetworkContext,
    Path(id): Path<Uuid>,
    data: Result<Json<AmendPatientHandoverRequest>, JsonRejection>,
) -> Result<Json<ObjectResponse<PatientHandoverReceipt>>, ApiError> {
    Ok(Json(
        service::amend(
            &s,
            &network.context,
            id,
            body(data)?,
            network.authorization_deadline,
        )
        .await?,
    ))
}
#[utoipa::path(post,path="/api/v2/nursing/patient-handovers/{id}/void",operation_id="postPatientHandoverVoid",tag="nursing",security(("bearerAuth"=[])),params(("id"=Uuid,Path)),request_body=VoidPatientHandoverRequest,responses((status=200,body=ObjectResponse<PatientHandoverReceipt>),(status=400,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn void(
    State(s): State<AppState>,
    network: NetworkContext,
    Path(id): Path<Uuid>,
    data: Result<Json<VoidPatientHandoverRequest>, JsonRejection>,
) -> Result<Json<ObjectResponse<PatientHandoverReceipt>>, ApiError> {
    Ok(Json(
        service::void(
            &s,
            &network.context,
            id,
            body(data)?,
            network.authorization_deadline,
        )
        .await?,
    ))
}
