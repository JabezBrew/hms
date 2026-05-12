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
