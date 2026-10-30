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
use hms_domain::appointment_types::*;
use uuid::Uuid;
#[utoipa::path(post,path="/api/v2/scheduling/services",operation_id="postAppointmentTypeCreate",tag="scheduling",security(("bearerAuth"=[])),request_body=CreateAppointmentTypeRequest,responses((status=200,body=ObjectResponse<AppointmentTypeCommandReceipt>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn create(
    State(state): State<AppState>,
    network: crate::extractors::NetworkContext,
    input: Result<Json<CreateAppointmentTypeRequest>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<ObjectResponse<AppointmentTypeCommandReceipt>>, ApiError> {
    let Json(input) = input.map_err(|_| invalid_request())?;
    Ok(Json(
        state
            .appointment_type_service()
            .command(
                &network.context,
                network.authorization_deadline,
                AppointmentTypeReviewedInput::Create {
                    client_request_id: input.client_request_id,
                    code: input.code,
                    name: input.name,
                    default_duration_minutes: input.default_duration_minutes,
                },
            )
            .await?,
    ))
}
#[utoipa::path(post,path="/api/v2/scheduling/services/{id}/metadata",operation_id="postAppointmentTypeMetadata",tag="scheduling",security(("bearerAuth"=[])),params(("id"=Uuid,Path)),request_body=UpdateAppointmentTypeMetadataRequest,responses((status=200,body=ObjectResponse<AppointmentTypeCommandReceipt>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn metadata(
    State(state): State<AppState>,
    network: crate::extractors::NetworkContext,
    path: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
    input: Result<
        Json<UpdateAppointmentTypeMetadataRequest>,
        axum::extract::rejection::JsonRejection,
    >,
) -> Result<Json<ObjectResponse<AppointmentTypeCommandReceipt>>, ApiError> {
    let Path(id) = path.map_err(|_| invalid_request())?;
    let Json(input) = input.map_err(|_| invalid_request())?;
    Ok(Json(
        state
            .appointment_type_service()
            .command(
                &network.context,
                network.authorization_deadline,
                AppointmentTypeReviewedInput::Metadata {
                    client_request_id: input.client_request_id,
                    service_id: id,
                    expected_version: input.expected_version,
                    name: input.name,
                    default_duration_minutes: input.default_duration_minutes,
                },
            )
            .await?,
    ))
}
#[utoipa::path(post,path="/api/v2/scheduling/services/{id}/retire",operation_id="postAppointmentTypeRetire",tag="scheduling",security(("bearerAuth"=[])),params(("id"=Uuid,Path)),request_body=AppointmentTypeLifecycleRequest,responses((status=200,body=ObjectResponse<AppointmentTypeCommandReceipt>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn retire(
    State(state): State<AppState>,
    network: crate::extractors::NetworkContext,
    path: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
    input: Result<Json<AppointmentTypeLifecycleRequest>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<ObjectResponse<AppointmentTypeCommandReceipt>>, ApiError> {
    let Path(id) = path.map_err(|_| invalid_request())?;
    let Json(input) = input.map_err(|_| invalid_request())?;
    Ok(Json(
        state
            .appointment_type_service()
            .command(
                &network.context,
                network.authorization_deadline,
                AppointmentTypeReviewedInput::Retire {
                    client_request_id: input.client_request_id,
                    service_id: id,
                    expected_version: input.expected_version,
                },
            )
            .await?,
    ))
}
#[utoipa::path(post,path="/api/v2/scheduling/services/{id}/reactivate",operation_id="postAppointmentTypeReactivate",tag="scheduling",security(("bearerAuth"=[])),params(("id"=Uuid,Path)),request_body=AppointmentTypeLifecycleRequest,responses((status=200,body=ObjectResponse<AppointmentTypeCommandReceipt>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn reactivate(
    State(state): State<AppState>,
    network: crate::extractors::NetworkContext,
    path: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
    input: Result<Json<AppointmentTypeLifecycleRequest>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<ObjectResponse<AppointmentTypeCommandReceipt>>, ApiError> {
    let Path(id) = path.map_err(|_| invalid_request())?;
    let Json(input) = input.map_err(|_| invalid_request())?;
    Ok(Json(
        state
            .appointment_type_service()
            .command(
                &network.context,
                network.authorization_deadline,
                AppointmentTypeReviewedInput::Reactivate {
                    client_request_id: input.client_request_id,
                    service_id: id,
                    expected_version: input.expected_version,
                },
            )
            .await?,
    ))
}
#[utoipa::path(get,path="/api/v2/scheduling/services/commands/{client_request_id}",operation_id="getAppointmentTypeCommand",tag="scheduling",security(("bearerAuth"=[])),params(("client_request_id"=Uuid,Path)),responses((status=200,body=ObjectResponse<AppointmentTypeCommandReceipt>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn receipt(
    State(state): State<AppState>,
    network: crate::extractors::NetworkContext,
    path: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
) -> Result<Json<ObjectResponse<AppointmentTypeCommandReceipt>>, ApiError> {
    let Path(key) = path.map_err(|_| invalid_request())?;
    Ok(Json(
        state
            .appointment_type_service()
            .receipt(&network.context, network.authorization_deadline, key)
            .await?,
    ))
}
#[utoipa::path(get,path="/api/v2/scheduling/services/administration",operation_id="getAppointmentTypeAdministration",tag="scheduling",security(("bearerAuth"=[])),params(AppointmentTypeAdministrationQuery),responses((status=200,body=ListResponse<GovernedAppointmentType>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn list(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    input: Result<
        Query<AppointmentTypeAdministrationQuery>,
        axum::extract::rejection::QueryRejection,
    >,
) -> Result<Json<ListResponse<GovernedAppointmentType>>, ApiError> {
    let Query(input) = input.map_err(|_| invalid_request())?;
    Ok(Json(
        state.appointment_type_service().list(&user, input).await?,
    ))
}
#[utoipa::path(get,path="/api/v2/scheduling/services/{id}/administration",operation_id="getAppointmentTypeAdministrationById",tag="scheduling",security(("bearerAuth"=[])),params(("id"=Uuid,Path)),responses((status=200,body=ObjectResponse<GovernedAppointmentType>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn detail(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    path: Result<Path<Uuid>, axum::extract::rejection::PathRejection>,
) -> Result<Json<ObjectResponse<GovernedAppointmentType>>, ApiError> {
    let Path(id) = path.map_err(|_| invalid_request())?;
    Ok(Json(
        state.appointment_type_service().detail(&user, id).await?,
    ))
}

fn invalid_request() -> ApiError {
    ApiError::bad_request(
        "invalid_appointment_type_command",
        "Review the supported appointment type fields, exact identifier and bounded filters.",
    )
}
