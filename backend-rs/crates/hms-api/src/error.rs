use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use utoipa::ToSchema;

use crate::middleware::request_id::current_request_id;

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ApiErrorBody {
    pub code: String,
    pub message: String,
    pub details: Value,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ApiErrorResponse {
    pub error: ApiErrorBody,
    pub request_id: String,
}

#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub code: &'static str,
    pub message: &'static str,
    pub details: Value,
}

impl ApiError {
    pub fn bad_request(code: &'static str, message: &'static str) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            code,
            message,
            details: json!({}),
        }
    }

    pub fn unauthorized() -> Self {
        Self {
            status: StatusCode::UNAUTHORIZED,
            code: "authentication_required",
            message: "Authentication is required.",
            details: json!({}),
        }
    }

    pub fn forbidden(code: &'static str, message: &'static str) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            code,
            message,
            details: json!({}),
        }
    }

    pub fn not_found(code: &'static str, message: &'static str) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            code,
            message,
            details: json!({}),
        }
    }

    pub fn conflict(code: &'static str, message: &'static str) -> Self {
        Self {
            status: StatusCode::CONFLICT,
            code,
            message,
            details: json!({}),
        }
    }
}

impl From<hms_access::AccessError> for ApiError {
    fn from(error: hms_access::AccessError) -> Self {
        match error {
            hms_access::AccessError::MissingFacility
            | hms_access::AccessError::WrongFacility
            | hms_access::AccessError::MissingPermission => ApiError::forbidden(
                "permission_denied",
                "You do not have permission to perform this action.",
            ),
            hms_access::AccessError::FeatureDisabled => {
                ApiError::forbidden("feature_disabled", "This feature is not enabled.")
            }
            hms_access::AccessError::PatientAccessDenied
            | hms_access::AccessError::PatientWorkflowAccessDenied => ApiError::forbidden(
                "patient_access_denied",
                "You do not have access to this patient workflow.",
            ),
            hms_access::AccessError::BillingAccessDenied => ApiError::forbidden(
                "permission_denied",
                "You do not have permission for this billing action.",
            ),
            hms_access::AccessError::LaboratoryAccessDenied => ApiError::forbidden(
                "permission_denied",
                "You do not have permission to perform this laboratory action.",
            ),
            hms_access::AccessError::InventoryAccessDenied => ApiError::forbidden(
                "permission_denied",
                "You do not have permission for this inventory action.",
            ),
            hms_access::AccessError::AdminAuthorityAccessDenied => ApiError::forbidden(
                "permission_denied",
                "You do not have permission to manage HMS authority.",
            ),
            hms_access::AccessError::ReauthRequired => ApiError::forbidden(
                "reauth_required",
                "Fresh reauthentication is required for this action.",
            ),
            hms_access::AccessError::PasskeyRequired => ApiError::forbidden(
                "passkey_required",
                "Passkey enrollment is required for this privileged action.",
            ),
            hms_access::AccessError::OffsiteReadOnly => ApiError::forbidden(
                "offsite_read_only",
                "This action is not allowed from an offsite context.",
            ),
        }
    }
}

impl From<crate::cursor_list::CursorListError> for ApiError {
    fn from(_: crate::cursor_list::CursorListError) -> Self {
        ApiError::bad_request("invalid_cursor", "Cursor is invalid.")
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = ApiErrorResponse {
            error: ApiErrorBody {
                code: self.code.to_owned(),
                message: self.message.to_owned(),
                details: self.details,
            },
            request_id: current_request_id(),
        };

        (self.status, Json(body)).into_response()
    }
}
