use axum::Json;
use hms_access::require_permission;
use hms_domain::capabilities::DeploymentCapabilities;
use hms_domain::deployment::PermissionCode;

use crate::error::{ApiError, ApiErrorResponse};
use crate::extractors::AuthenticatedUser;
use crate::response::{object, ObjectResponse};
use crate::state::AppState;
use axum::extract::State;

#[utoipa::path(
    get,
    path = "/api/v2/system/deployment-capabilities",
    operation_id = "getSystemDeploymentCapabilities",
    tag = "system",
    security(("bearerAuth" = [])),
    responses(
        (status = 200, description = "Deployment capabilities", body = ObjectResponse<DeploymentCapabilities>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn deployment_capabilities(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<Json<ObjectResponse<DeploymentCapabilities>>, ApiError> {
    require_permission(&user, PermissionCode::SystemDeploymentCapabilitiesView).map_err(|_| {
        ApiError::forbidden(
            "permission_denied",
            "You do not have permission to view deployment capabilities.",
        )
    })?;

    let capabilities = state.deployment_capabilities().await.map_err(|_| {
        ApiError::conflict(
            "deployment_capabilities_failed",
            "Deployment capabilities could not be loaded.",
        )
    })?;
    Ok(Json(object(capabilities)))
}
