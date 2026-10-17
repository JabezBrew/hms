use crate::{
    error::{ApiError, ApiErrorResponse},
    extractors::NetworkContext,
    response::{ListResponse, ObjectResponse},
    services::ward::treatment_courses as service,
    state::AppState,
};
use axum::{
    extract::{
        rejection::{JsonRejection, QueryRejection},
        Path, Query, State,
    },
    Json,
};
use hms_domain::treatment_courses::*;
use uuid::Uuid;
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EmptyQuery {}
fn body<T>(v: Result<Json<T>, JsonRejection>) -> Result<T, ApiError> {
    v.map(|Json(x)| x).map_err(|_| {
        ApiError::bad_request(
            "invalid_treatment_course_request",
            "Use the supported medication-course fields and required request format.",
        )
    })
}
fn query<T>(v: Result<Query<T>, QueryRejection>) -> Result<T, ApiError> {
    v.map(|Query(x)| x).map_err(|_| {
        ApiError::bad_request(
            "invalid_treatment_course_query",
            "Use the supported medication-course query fields and valid scope.",
        )
    })
}
#[utoipa::path(get,path="/api/v2/patients/{patient_id}/chronicle/admissions/{admission_case_id}/medication-courses/context",operation_id="getPatientChronicleMedicationCoursesContext",tag="nursing",security(("bearerAuth"=[])),params(("patient_id"=Uuid,Path),("admission_case_id"=Uuid,Path)),responses((status=200,body=ObjectResponse<TreatmentCoursesContext>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn context(
    State(s): State<AppState>,
    network: NetworkContext,
    Path((patient_id, admission_case_id)): Path<(Uuid, Uuid)>,
    q: Result<Query<EmptyQuery>, QueryRejection>,
) -> Result<Json<ObjectResponse<TreatmentCoursesContext>>, ApiError> {
    query(q)?;
    Ok(Json(
        service::context(
            &s,
            &network.context,
            patient_id,
            admission_case_id,
            network.authorization_deadline,
        )
        .await?,
    ))
}
#[utoipa::path(get,path="/api/v2/patients/{patient_id}/chronicle/admissions/{admission_case_id}/medication-courses",operation_id="getPatientChronicleMedicationCourses",tag="nursing",security(("bearerAuth"=[])),params(("patient_id"=Uuid,Path),("admission_case_id"=Uuid,Path),TreatmentCourseListQuery),responses((status=200,body=ListResponse<TreatmentCourseListItem>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn list(
    State(s): State<AppState>,
    network: NetworkContext,
    Path((patient_id, admission_case_id)): Path<(Uuid, Uuid)>,
    q: Result<Query<TreatmentCourseListQuery>, QueryRejection>,
) -> Result<Json<ListResponse<TreatmentCourseListItem>>, ApiError> {
    Ok(Json(
        service::list(
            &s,
            &network.context,
            patient_id,
            admission_case_id,
            query(q)?,
            network.authorization_deadline,
        )
        .await?,
    ))
}
#[utoipa::path(get,path="/api/v2/patients/{patient_id}/chronicle/admissions/{admission_case_id}/medication-courses/{course_id}",operation_id="getPatientChronicleMedicationCourse",tag="nursing",security(("bearerAuth"=[])),params(("patient_id"=Uuid,Path),("admission_case_id"=Uuid,Path),("course_id"=Uuid,Path)),responses((status=200,body=ObjectResponse<TreatmentCourseDetail>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn detail(
    State(s): State<AppState>,
    network: NetworkContext,
    Path((patient_id, admission_case_id, course_id)): Path<(Uuid, Uuid, Uuid)>,
    q: Result<Query<EmptyQuery>, QueryRejection>,
) -> Result<Json<ObjectResponse<TreatmentCourseDetail>>, ApiError> {
    query(q)?;
    Ok(Json(
        service::detail(
            &s,
            &network.context,
            patient_id,
            admission_case_id,
            course_id,
            network.authorization_deadline,
        )
        .await?,
    ))
}
#[utoipa::path(get,path="/api/v2/patients/{patient_id}/chronicle/admissions/{admission_case_id}/medication-courses/{course_id}/doses",operation_id="getPatientChronicleMedicationCourseDoses",tag="nursing",security(("bearerAuth"=[])),params(("patient_id"=Uuid,Path),("admission_case_id"=Uuid,Path),("course_id"=Uuid,Path),TreatmentCourseDoseQuery),responses((status=200,body=ListResponse<TreatmentCourseDose>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn doses(
    State(s): State<AppState>,
    network: NetworkContext,
    Path((patient_id, admission_case_id, course_id)): Path<(Uuid, Uuid, Uuid)>,
    q: Result<Query<TreatmentCourseDoseQuery>, QueryRejection>,
) -> Result<Json<ListResponse<TreatmentCourseDose>>, ApiError> {
    Ok(Json(
        service::doses(
            &s,
            &network.context,
            patient_id,
            admission_case_id,
            course_id,
            query(q)?,
            network.authorization_deadline,
        )
        .await?,
    ))
}
#[utoipa::path(get,path="/api/v2/patients/{patient_id}/chronicle/admissions/{admission_case_id}/medication-courses/{course_id}/supply",operation_id="getPatientChronicleMedicationCourseSupply",tag="nursing",security(("bearerAuth"=[])),params(("patient_id"=Uuid,Path),("admission_case_id"=Uuid,Path),("course_id"=Uuid,Path),TreatmentCourseSupplyQuery),responses((status=200,body=ListResponse<TreatmentCourseSupplyWindow>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn supply(
    State(s): State<AppState>,
    network: NetworkContext,
    Path((patient_id, admission_case_id, course_id)): Path<(Uuid, Uuid, Uuid)>,
    q: Result<Query<TreatmentCourseSupplyQuery>, QueryRejection>,
) -> Result<Json<ListResponse<TreatmentCourseSupplyWindow>>, ApiError> {
    Ok(Json(
        service::supply(
            &s,
            &network.context,
            patient_id,
            admission_case_id,
            course_id,
            query(q)?,
            network.authorization_deadline,
        )
        .await?,
    ))
}
#[utoipa::path(post,path="/api/v2/patients/{patient_id}/chronicle/admissions/{admission_case_id}/medication-courses/{course_id}/stop",operation_id="postPatientChronicleMedicationCourseStop",tag="nursing",security(("bearerAuth"=[])),params(("patient_id"=Uuid,Path),("admission_case_id"=Uuid,Path),("course_id"=Uuid,Path)),request_body=StopTreatmentCourseRequest,responses((status=200,body=ObjectResponse<TreatmentCourseReceipt>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn stop(
    State(s): State<AppState>,
    network: NetworkContext,
    Path((patient_id, admission_case_id, course_id)): Path<(Uuid, Uuid, Uuid)>,
    input: Result<Json<StopTreatmentCourseRequest>, JsonRejection>,
) -> Result<Json<ObjectResponse<TreatmentCourseReceipt>>, ApiError> {
    Ok(Json(
        service::stop(
            &s,
            &network.context,
            patient_id,
            admission_case_id,
            course_id,
            body(input)?,
            network.authorization_deadline,
        )
        .await?,
    ))
}
#[utoipa::path(post,path="/api/v2/patients/{patient_id}/chronicle/admissions/{admission_case_id}/medication-courses/{course_id}/supply-windows",operation_id="postPatientChronicleMedicationCourseSupplyWindow",tag="nursing",security(("bearerAuth"=[])),params(("patient_id"=Uuid,Path),("admission_case_id"=Uuid,Path),("course_id"=Uuid,Path)),request_body=CreateTreatmentSupplyWindowRequest,responses((status=200,body=ObjectResponse<TreatmentCourseReceipt>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn window(
    State(s): State<AppState>,
    network: NetworkContext,
    Path((patient_id, admission_case_id, course_id)): Path<(Uuid, Uuid, Uuid)>,
    input: Result<Json<CreateTreatmentSupplyWindowRequest>, JsonRejection>,
) -> Result<Json<ObjectResponse<TreatmentCourseReceipt>>, ApiError> {
    Ok(Json(
        service::window(
            &s,
            &network.context,
            patient_id,
            admission_case_id,
            course_id,
            body(input)?,
            network.authorization_deadline,
        )
        .await?,
    ))
}
#[utoipa::path(get,path="/api/v2/patients/{patient_id}/chronicle/admissions/{admission_case_id}/medication-courses/{course_id}/requests/{client_request_id}",operation_id="getPatientChronicleMedicationCourseRequest",tag="nursing",security(("bearerAuth"=[])),params(("patient_id"=Uuid,Path),("admission_case_id"=Uuid,Path),("course_id"=Uuid,Path),("client_request_id"=Uuid,Path)),responses((status=200,body=ObjectResponse<TreatmentCourseReceipt>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn receipt(
    State(s): State<AppState>,
    network: NetworkContext,
    Path((patient_id, admission_case_id, course_id, client_request_id)): Path<(
        Uuid,
        Uuid,
        Uuid,
        Uuid,
    )>,
    q: Result<Query<EmptyQuery>, QueryRejection>,
) -> Result<Json<ObjectResponse<TreatmentCourseReceipt>>, ApiError> {
    query(q)?;
    Ok(Json(
        service::receipt(
            &s,
            &network.context,
            patient_id,
            admission_case_id,
            course_id,
            client_request_id,
            network.authorization_deadline,
        )
        .await?,
    ))
}
