use crate::{
    error::{ApiError, ApiErrorResponse},
    extractors::NetworkContext,
    response::{ListResponse, ObjectResponse},
    state::AppState,
};
use axum::{
    extract::{
        rejection::{JsonRejection, PathRejection, QueryRejection},
        Path, Query, State,
    },
    Json,
};
use hms_domain::admission_advisories::*;
use uuid::Uuid;

#[utoipa::path(get,path="/api/v2/patients/{patient_id}/chronicle/admission-advisory-cases",operation_id="getPatientChronicleAdmissionAdvisoryCases",tag="wards",security(("bearerAuth"=[])),params(("patient_id"=Uuid,Path,description="Authorized patient"),AdmissionAdvisoryCaseQuery),responses((status=200,description="Bounded authorized case choices",body=ListResponse<AdmissionAdvisoryCase>),(status=400,description="Invalid query",body=ApiErrorResponse),(status=401,description="Authentication required",body=ApiErrorResponse),(status=403,description="Current clinical and ward authority required",body=ApiErrorResponse),(status=404,description="Patient not found",body=ApiErrorResponse),(status=409,description="Read unavailable",body=ApiErrorResponse)))]
pub async fn cases(
    State(s): State<AppState>,
    n: NetworkContext,
    p: Result<Path<Uuid>, PathRejection>,
    q: Result<Query<AdmissionAdvisoryCaseQuery>, QueryRejection>,
) -> Result<Json<ListResponse<AdmissionAdvisoryCase>>, ApiError> {
    let Path(patient) = p.map_err(|_| invalid())?;
    let Query(q) = q.map_err(|_| invalid())?;
    Ok(Json(
        s.ward_services()
            .admission_advisories()
            .cases(&n.context, n.authorization_deadline, patient, q)
            .await?,
    ))
}
#[utoipa::path(get,path="/api/v2/patients/{patient_id}/chronicle/admissions/{case_id}/advisories",operation_id="getPatientChronicleAdmissionAdvisories",tag="wards",security(("bearerAuth"=[])),params(("patient_id"=Uuid,Path,description="Authorized patient"),("case_id"=Uuid,Path,description="Explicit admission case")),responses((status=200,description="Complete eight-kind checklist and current context",body=ObjectResponse<AdmissionAdvisoryContext>),(status=400,description="Invalid scope",body=ApiErrorResponse),(status=401,description="Authentication required",body=ApiErrorResponse),(status=403,description="Current clinical and ward authority required",body=ApiErrorResponse),(status=404,description="Case not found",body=ApiErrorResponse),(status=409,description="Read unavailable",body=ApiErrorResponse)))]
pub async fn context(
    State(s): State<AppState>,
    n: NetworkContext,
    p: Result<Path<(Uuid, Uuid)>, PathRejection>,
) -> Result<Json<ObjectResponse<AdmissionAdvisoryContext>>, ApiError> {
    let Path((patient, case_id)) = p.map_err(|_| invalid())?;
    Ok(Json(
        s.ward_services()
            .admission_advisories()
            .context(&n.context, n.authorization_deadline, patient, case_id)
            .await?,
    ))
}
#[utoipa::path(post,path="/api/v2/patients/{patient_id}/chronicle/admissions/{case_id}/advisories",operation_id="postPatientChronicleAdmissionAdvisory",tag="wards",security(("bearerAuth"=[])),params(("patient_id"=Uuid,Path,description="Authorized patient"),("case_id"=Uuid,Path,description="Explicit admission case")),request_body=CreateAdmissionAdvisoryRequest,responses((status=200,description="Immutable original advisory receipt",body=ObjectResponse<AdmissionAdvisoryReceipt>),(status=400,description="Invalid supported input",body=ApiErrorResponse),(status=401,description="Authentication required",body=ApiErrorResponse),(status=403,description="Current clinical and ward authority required",body=ApiErrorResponse),(status=404,description="Case not found",body=ApiErrorResponse),(status=409,description="Conflict or explicitly unconfirmed write",body=ApiErrorResponse)))]
pub async fn create(
    State(s): State<AppState>,
    n: NetworkContext,
    p: Result<Path<(Uuid, Uuid)>, PathRejection>,
    input: Result<Json<CreateAdmissionAdvisoryRequest>, JsonRejection>,
) -> Result<Json<ObjectResponse<AdmissionAdvisoryReceipt>>, ApiError> {
    let Path((patient, case_id)) = p.map_err(|_| invalid())?;
    let Json(input) = input.map_err(|_| invalid())?;
    Ok(Json(
        s.ward_services()
            .admission_advisories()
            .create(
                &n.context,
                n.authorization_deadline,
                patient,
                case_id,
                input,
            )
            .await?,
    ))
}
#[utoipa::path(get,path="/api/v2/patients/{patient_id}/chronicle/admissions/{case_id}/advisories/{advisory_id}",operation_id="getPatientChronicleAdmissionAdvisory",tag="wards",security(("bearerAuth"=[])),params(("patient_id"=Uuid,Path,description="Authorized patient"),("case_id"=Uuid,Path,description="Explicit admission case"),("advisory_id"=Uuid,Path,description="Follow-up evidence")),responses((status=200,description="Protected follow-up detail",body=ObjectResponse<AdmissionAdvisoryDetail>),(status=400,description="Invalid scope",body=ApiErrorResponse),(status=401,description="Authentication required",body=ApiErrorResponse),(status=403,description="Current clinical and ward authority required",body=ApiErrorResponse),(status=404,description="Follow-up not found",body=ApiErrorResponse),(status=409,description="Read unavailable",body=ApiErrorResponse)))]
pub async fn detail(
    State(s): State<AppState>,
    n: NetworkContext,
    p: Result<Path<(Uuid, Uuid, Uuid)>, PathRejection>,
) -> Result<Json<ObjectResponse<AdmissionAdvisoryDetail>>, ApiError> {
    let Path((patient, case_id, id)) = p.map_err(|_| invalid())?;
    Ok(Json(
        s.ward_services()
            .admission_advisories()
            .get(&n.context, n.authorization_deadline, patient, case_id, id)
            .await?,
    ))
}
#[utoipa::path(post,path="/api/v2/patients/{patient_id}/chronicle/admissions/{case_id}/advisories/{advisory_id}/decision",operation_id="postPatientChronicleAdmissionAdvisoryDecision",tag="wards",security(("bearerAuth"=[])),params(("patient_id"=Uuid,Path,description="Authorized patient"),("case_id"=Uuid,Path,description="Explicit admission case"),("advisory_id"=Uuid,Path,description="Follow-up evidence")),request_body=DecideAdmissionAdvisoryRequest,responses((status=200,description="Immutable original terminal decision receipt",body=ObjectResponse<AdmissionAdvisoryReceipt>),(status=400,description="Invalid decision or reason",body=ApiErrorResponse),(status=401,description="Authentication required",body=ApiErrorResponse),(status=403,description="Current clinical and ward authority required",body=ApiErrorResponse),(status=404,description="Follow-up not found",body=ApiErrorResponse),(status=409,description="Conflict or explicitly unconfirmed write",body=ApiErrorResponse)))]
pub async fn decide(
    State(s): State<AppState>,
    n: NetworkContext,
    p: Result<Path<(Uuid, Uuid, Uuid)>, PathRejection>,
    input: Result<Json<DecideAdmissionAdvisoryRequest>, JsonRejection>,
) -> Result<Json<ObjectResponse<AdmissionAdvisoryReceipt>>, ApiError> {
    let Path((patient, case_id, id)) = p.map_err(|_| invalid())?;
    let Json(input) = input.map_err(|_| invalid())?;
    Ok(Json(
        s.ward_services()
            .admission_advisories()
            .decide(
                &n.context,
                n.authorization_deadline,
                patient,
                case_id,
                id,
                input,
            )
            .await?,
    ))
}
#[utoipa::path(get,path="/api/v2/patients/{patient_id}/chronicle/admissions/{case_id}/advisories/requests/{request_id}",operation_id="getPatientChronicleAdmissionAdvisoryRequest",tag="wards",security(("bearerAuth"=[])),params(("patient_id"=Uuid,Path,description="Authorized patient"),("case_id"=Uuid,Path,description="Explicit admission case"),("request_id"=Uuid,Path,description="Original request reference")),responses((status=200,description="Immutable original actor-scoped result",body=ObjectResponse<AdmissionAdvisoryReceipt>),(status=400,description="Invalid scope",body=ApiErrorResponse),(status=401,description="Authentication required",body=ApiErrorResponse),(status=403,description="Current clinical and ward authority required",body=ApiErrorResponse),(status=404,description="Request not found",body=ApiErrorResponse),(status=409,description="Read unavailable",body=ApiErrorResponse)))]
pub async fn receipt(
    State(s): State<AppState>,
    n: NetworkContext,
    p: Result<Path<(Uuid, Uuid, Uuid)>, PathRejection>,
) -> Result<Json<ObjectResponse<AdmissionAdvisoryReceipt>>, ApiError> {
    let Path((patient, case_id, key)) = p.map_err(|_| invalid())?;
    Ok(Json(
        s.ward_services()
            .admission_advisories()
            .receipt(&n.context, n.authorization_deadline, patient, case_id, key)
            .await?,
    ))
}
fn invalid() -> ApiError {
    ApiError::bad_request(
        "invalid_admission_advisory",
        "Use only the supported identifiers, fields and explicit reviewed decision.",
    )
}
