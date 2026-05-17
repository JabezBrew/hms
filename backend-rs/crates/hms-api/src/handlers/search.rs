use std::time::Instant;

use axum::extract::State;
use axum::Json;
use hms_domain::deployment::PermissionCode;
use hms_domain::search::{OmniSearchRequest, OmniSearchResponse};

use crate::error::{ApiError, ApiErrorResponse};
use crate::extractors::AuthenticatedUser;
use crate::response::{object, ObjectResponse};
use crate::state::AppState;

const DEFAULT_LIMIT: u8 = 8;
const MAX_LIMIT: u8 = 25;
const MAX_QUERY_CHARS: usize = 120;

#[utoipa::path(
    post,
    path = "/api/v2/search/omni",
    operation_id = "postSearchOmni",
    tag = "search",
    security(("bearerAuth" = [])),
    request_body = OmniSearchRequest,
    responses(
        (status = 200, description = "Access-scoped OmniSearch results", body = ObjectResponse<OmniSearchResponse>),
        (status = 400, description = "Invalid search request", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Search permission denied", body = ApiErrorResponse)
    )
)]
pub async fn omni_search(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(payload): Json<OmniSearchRequest>,
) -> Result<Json<ObjectResponse<OmniSearchResponse>>, ApiError> {
    if user.facility_id != state.facility_id() || !can_search_anything(&user.permissions) {
        return Err(ApiError::forbidden(
            "search_permission_denied",
            "You do not have permission to search this facility.",
        ));
    }

    let started = Instant::now();
    let limit = payload.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let query = normalize_query(payload.q);
    let types = payload.types.unwrap_or_default();
    let result = state
        .omni_search(
            &user,
            if query.is_empty() {
                None
            } else {
                Some(query.clone())
            },
            types.clone(),
            i64::from(limit),
        )
        .await
        .map_err(|_| ApiError::conflict("search_failed", "OmniSearch could not be loaded."))?;

    Ok(Json(object(OmniSearchResponse {
        query,
        types,
        limit,
        groups: result.groups,
        index_status: result.index_status,
        took_ms: started.elapsed().as_millis() as u64,
    })))
}

fn normalize_query(query: Option<String>) -> String {
    query
        .unwrap_or_default()
        .trim()
        .chars()
        .take(MAX_QUERY_CHARS)
        .collect()
}

fn can_search_anything(permissions: &[PermissionCode]) -> bool {
    const SEARCH_PERMISSIONS: [PermissionCode; 12] = [
        PermissionCode::PatientDemographicsView,
        PermissionCode::AppointmentView,
        PermissionCode::EncounterView,
        PermissionCode::WardView,
        PermissionCode::AdmissionManage,
        PermissionCode::LaboratoryOrderManage,
        PermissionCode::LaboratoryResultVerify,
        PermissionCode::InventoryView,
        PermissionCode::ControlledSubstanceManage,
        PermissionCode::BillingView,
        PermissionCode::NhisClaimManage,
        PermissionCode::ReferralManage,
    ];

    permissions.contains(&PermissionCode::AdminStaffManage)
        || SEARCH_PERMISSIONS
            .iter()
            .any(|permission| permissions.contains(permission))
}
