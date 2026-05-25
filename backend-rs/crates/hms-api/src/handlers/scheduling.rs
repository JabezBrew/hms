use axum::extract::{Path, Query, State};
use axum::Json;
use hms_domain::care::VisitListItem;
use hms_domain::scheduling::{
    ArriveAppointmentRequest, AvailabilityQuery, AvailabilityResponse, BookAppointmentRequest,
    BookAppointmentResponse, BookableServiceListItem, BookableSessionListItem,
    BookableSessionListQuery, CancelBookableSessionRequest, CreateBookableServiceRequest,
    CreateBookableSessionRequest, SchedulingExceptionItem, SchedulingExceptionRequest,
    SchedulingListQuery,
};
use uuid::Uuid;

use crate::error::{ApiError, ApiErrorResponse};
use crate::extractors::RequestContext;
use crate::response::{ListResponse, ObjectResponse};
use crate::state::AppState;

#[utoipa::path(
    get,
    path = "/api/v2/scheduling/services",
    operation_id = "getSchedulingServices",
    tag = "scheduling",
    security(("bearerAuth" = [])),
    params(SchedulingListQuery),
    responses(
        (status = 200, description = "Bookable services", body = ListResponse<BookableServiceListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_services(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<SchedulingListQuery>,
) -> Result<Json<ListResponse<BookableServiceListItem>>, ApiError> {
    Ok(Json(
        state
            .scheduling_service()
            .list_services(&user, query)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/scheduling/services",
    operation_id = "postSchedulingServices",
    tag = "scheduling",
    security(("bearerAuth" = [])),
    request_body = CreateBookableServiceRequest,
    responses(
        (status = 200, description = "Bookable service created", body = ObjectResponse<BookableServiceListItem>),
        (status = 400, description = "Invalid service request", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn create_service(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<CreateBookableServiceRequest>,
) -> Result<Json<ObjectResponse<BookableServiceListItem>>, ApiError> {
    Ok(Json(
        state
            .scheduling_service()
            .create_service(&user, payload)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/scheduling/sessions",
    operation_id = "getSchedulingSessions",
    tag = "scheduling",
    security(("bearerAuth" = [])),
    params(BookableSessionListQuery),
    responses(
        (status = 200, description = "Bookable sessions", body = ListResponse<BookableSessionListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_sessions(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<BookableSessionListQuery>,
) -> Result<Json<ListResponse<BookableSessionListItem>>, ApiError> {
    Ok(Json(
        state
            .scheduling_service()
            .list_sessions(&user, query)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/scheduling/sessions",
    operation_id = "postSchedulingSessions",
    tag = "scheduling",
    security(("bearerAuth" = [])),
    request_body = CreateBookableSessionRequest,
    responses(
        (status = 200, description = "Bookable session created", body = ObjectResponse<BookableSessionListItem>),
        (status = 400, description = "Invalid session request", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn create_session(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<CreateBookableSessionRequest>,
) -> Result<Json<ObjectResponse<BookableSessionListItem>>, ApiError> {
    Ok(Json(
        state
            .scheduling_service()
            .create_session(&user, payload)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/scheduling/sessions/{id}/cancel",
    operation_id = "postSchedulingSessionCancel",
    tag = "scheduling",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Bookable session id")),
    request_body = CancelBookableSessionRequest,
    responses(
        (status = 200, description = "Bookable session cancelled", body = ObjectResponse<BookableSessionListItem>),
        (status = 400, description = "Invalid session request", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Bookable session not found", body = ApiErrorResponse)
    )
)]
pub async fn cancel_session(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(payload): Json<CancelBookableSessionRequest>,
) -> Result<Json<ObjectResponse<BookableSessionListItem>>, ApiError> {
    Ok(Json(
        state
            .scheduling_service()
            .cancel_session(&user, id, payload)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/scheduling/availability",
    operation_id = "getSchedulingAvailability",
    tag = "scheduling",
    security(("bearerAuth" = [])),
    params(AvailabilityQuery),
    responses(
        (status = 200, description = "Backend-authoritative scheduling availability", body = ObjectResponse<AvailabilityResponse>),
        (status = 400, description = "Invalid availability request", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn availability(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<AvailabilityQuery>,
) -> Result<Json<ObjectResponse<AvailabilityResponse>>, ApiError> {
    Ok(Json(
        state
            .scheduling_service()
            .availability(&user, query)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/scheduling/appointments/book",
    operation_id = "postSchedulingAppointmentBook",
    tag = "scheduling",
    security(("bearerAuth" = [])),
    request_body = BookAppointmentRequest,
    responses(
        (status = 200, description = "Appointment booked", body = ObjectResponse<BookAppointmentResponse>),
        (status = 400, description = "Invalid booking request", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 409, description = "Appointment could not be booked", body = ApiErrorResponse)
    )
)]
pub async fn book_appointment(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<BookAppointmentRequest>,
) -> Result<Json<ObjectResponse<BookAppointmentResponse>>, ApiError> {
    Ok(Json(
        state
            .scheduling_service()
            .book_appointment(&user, payload)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/scheduling/exceptions",
    operation_id = "postSchedulingExceptions",
    tag = "scheduling",
    security(("bearerAuth" = [])),
    request_body = SchedulingExceptionRequest,
    responses(
        (status = 200, description = "Scheduling exception created", body = ObjectResponse<SchedulingExceptionItem>),
        (status = 400, description = "Invalid exception request", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn create_exception(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<SchedulingExceptionRequest>,
) -> Result<Json<ObjectResponse<SchedulingExceptionItem>>, ApiError> {
    Ok(Json(
        state
            .scheduling_service()
            .create_exception(&user, payload)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/scheduling/appointments/{id}/arrive",
    operation_id = "postSchedulingAppointmentArrive",
    tag = "scheduling",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Appointment id")),
    request_body = ArriveAppointmentRequest,
    responses(
        (status = 200, description = "Appointment arrival checked in", body = ObjectResponse<VisitListItem>),
        (status = 400, description = "Invalid arrival request", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Appointment not found", body = ApiErrorResponse)
    )
)]
pub async fn arrive_appointment(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(payload): Json<ArriveAppointmentRequest>,
) -> Result<Json<ObjectResponse<VisitListItem>>, ApiError> {
    Ok(Json(
        state
            .scheduling_service()
            .arrive_appointment(&user, id, payload)
            .await?,
    ))
}
