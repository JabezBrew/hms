use crate::{
    error::{ApiError, ApiErrorResponse},
    extractors::NetworkContext,
    response::{ListResponse, ObjectResponse},
    state::AppState,
};
use axum::{
    extract::{
        rejection::{JsonRejection, QueryRejection},
        Path, Query, State,
    },
    Json,
};
use hms_domain::clinical_notes::*;
use uuid::Uuid;
fn body<T>(v: Result<Json<T>, JsonRejection>) -> Result<T, ApiError> {
    v.map(|Json(x)| x).map_err(|_| {
        ApiError::bad_request(
            "invalid_clinical_note_request",
            "Provide only supported note fields using the required request format.",
        )
    })
}
pub(crate) fn query<T>(v: Result<Query<T>, QueryRejection>) -> Result<T, ApiError> {
    v.map(|Query(x)| x).map_err(|_| {
        ApiError::bad_request(
            "invalid_clinical_note_query",
            "Use supported note query fields and a valid page cursor.",
        )
    })
}
#[utoipa::path(post,path="/api/v2/patients/{patient_id}/clinical/notes/record",operation_id="postClinicalNoteRecord",tag="clinical",security(("bearerAuth"=[])),params(("patient_id"=Uuid,Path)),request_body=RecordClinicalNoteRequest,responses((status=200,body=ObjectResponse<ClinicalNoteCommandReceipt>),(status=400,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn record(
    State(s): State<AppState>,
    n: NetworkContext,
    Path(patient_id): Path<Uuid>,
    payload: Result<Json<RecordClinicalNoteRequest>, JsonRejection>,
) -> Result<Json<ObjectResponse<ClinicalNoteCommandReceipt>>, ApiError> {
    Ok(Json(
        s.clinical_service()
            .record_note(
                &n.context,
                patient_id,
                body(payload)?,
                n.authorization_deadline,
            )
            .await?,
    ))
}
#[utoipa::path(post,path="/api/v2/clinical/notes/{note_id}/amendments",operation_id="postClinicalNoteAmendment",tag="clinical",security(("bearerAuth"=[])),params(("note_id"=Uuid,Path)),request_body=AmendClinicalNoteRequest,responses((status=200,body=ObjectResponse<ClinicalNoteCommandReceipt>),(status=400,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn amend(
    State(s): State<AppState>,
    n: NetworkContext,
    Path(note_id): Path<Uuid>,
    payload: Result<Json<AmendClinicalNoteRequest>, JsonRejection>,
) -> Result<Json<ObjectResponse<ClinicalNoteCommandReceipt>>, ApiError> {
    Ok(Json(
        s.clinical_service()
            .amend_note(
                &n.context,
                note_id,
                body(payload)?,
                n.authorization_deadline,
            )
            .await?,
    ))
}
#[utoipa::path(get,path="/api/v2/patients/{patient_id}/clinical/note-requests/{request_id}",operation_id="getClinicalNoteRequestReceipt",tag="clinical",security(("bearerAuth"=[])),params(("patient_id"=Uuid,Path),("request_id"=Uuid,Path)),responses((status=200,body=ObjectResponse<ClinicalNoteCommandReceipt>),(status=400,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn receipt(
    State(s): State<AppState>,
    n: NetworkContext,
    Path((patient_id, request_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<ObjectResponse<ClinicalNoteCommandReceipt>>, ApiError> {
    Ok(Json(
        s.clinical_service()
            .note_receipt(&n.context, patient_id, request_id, n.authorization_deadline)
            .await?,
    ))
}
#[utoipa::path(get,path="/api/v2/clinical/notes/{note_id}/history",operation_id="getClinicalNoteHistory",tag="clinical",security(("bearerAuth"=[])),params(("note_id"=Uuid,Path),ClinicalNoteHistoryQuery),responses((status=200,body=ListResponse<ClinicalNoteHistoryItem>),(status=400,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn history(
    State(s): State<AppState>,
    n: NetworkContext,
    Path(note_id): Path<Uuid>,
    q: Result<Query<ClinicalNoteHistoryQuery>, QueryRejection>,
) -> Result<Json<ListResponse<ClinicalNoteHistoryItem>>, ApiError> {
    Ok(Json(
        s.clinical_service()
            .note_history(&n.context, note_id, query(q)?, n.authorization_deadline)
            .await?,
    ))
}
#[utoipa::path(get,path="/api/v2/clinical/notes/{note_id}/versions/{version_id}",operation_id="getClinicalNoteVersion",tag="clinical",security(("bearerAuth"=[])),params(("note_id"=Uuid,Path),("version_id"=Uuid,Path)),responses((status=200,body=ObjectResponse<ClinicalNoteVersionDetail>),(status=400,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn version(
    State(s): State<AppState>,
    n: NetworkContext,
    Path((note_id, version_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<ObjectResponse<ClinicalNoteVersionDetail>>, ApiError> {
    Ok(Json(
        s.clinical_service()
            .note_version(&n.context, note_id, version_id, n.authorization_deadline)
            .await?,
    ))
}
#[utoipa::path(post,path="/api/v2/clinical/note-templates/record",operation_id="postClinicalNoteTemplateRecord",tag="clinical",security(("bearerAuth"=[])),request_body=RecordNoteTemplateRequest,responses((status=200,body=ObjectResponse<NoteTemplateCommandReceipt>),(status=400,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn record_template(
    State(s): State<AppState>,
    n: NetworkContext,
    payload: Result<Json<RecordNoteTemplateRequest>, JsonRejection>,
) -> Result<Json<ObjectResponse<NoteTemplateCommandReceipt>>, ApiError> {
    Ok(Json(
        s.clinical_service()
            .record_template(&n.context, body(payload)?, n.authorization_deadline)
            .await?,
    ))
}
#[utoipa::path(post,path="/api/v2/clinical/note-templates/{id}/changes",operation_id="postClinicalNoteTemplateChange",tag="clinical",security(("bearerAuth"=[])),params(("id"=Uuid,Path)),request_body=ChangeNoteTemplateRequest,responses((status=200,body=ObjectResponse<NoteTemplateCommandReceipt>),(status=400,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn change_template(
    State(s): State<AppState>,
    n: NetworkContext,
    Path(id): Path<Uuid>,
    payload: Result<Json<ChangeNoteTemplateRequest>, JsonRejection>,
) -> Result<Json<ObjectResponse<NoteTemplateCommandReceipt>>, ApiError> {
    Ok(Json(
        s.clinical_service()
            .change_template(&n.context, id, body(payload)?, n.authorization_deadline)
            .await?,
    ))
}
#[utoipa::path(get,path="/api/v2/clinical/note-templates/requests/{request_id}",operation_id="getClinicalNoteTemplateRequestReceipt",tag="clinical",security(("bearerAuth"=[])),params(("request_id"=Uuid,Path)),responses((status=200,body=ObjectResponse<NoteTemplateCommandReceipt>),(status=400,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn template_receipt(
    State(s): State<AppState>,
    n: NetworkContext,
    Path(request_id): Path<Uuid>,
) -> Result<Json<ObjectResponse<NoteTemplateCommandReceipt>>, ApiError> {
    Ok(Json(
        s.clinical_service()
            .template_receipt(&n.context, request_id, n.authorization_deadline)
            .await?,
    ))
}
