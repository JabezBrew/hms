use std::time::Duration;

use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::error::ApiError;
use crate::extractors::RequestContext;

const MAX_RUM_EVENTS: usize = 20;
const MAX_LABEL_LENGTH: usize = 80;
const MAX_ROUTE_LENGTH: usize = 160;
const MAX_RUM_DURATION_MS: f64 = 300_000.0;

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct BrowserRumIngestRequest {
    pub events: Vec<BrowserRumEvent>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct BrowserRumEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    pub name: String,
    pub route: String,
    pub value: f64,
    pub status: Option<String>,
    pub method: Option<String>,
    pub ts: Option<i64>,
}

#[utoipa::path(
    post,
    path = "/api/v2/observability/rum",
    operation_id = "ingestBrowserRum",
    tag = "observability",
    request_body = BrowserRumIngestRequest,
    responses(
        (status = 204, description = "Browser RUM events accepted"),
        (status = 400, description = "RUM payload is invalid"),
        (status = 401, description = "Authentication is required")
    ),
    security(("bearerAuth" = []))
)]
pub async fn ingest_browser_rum(
    RequestContext(_ctx): RequestContext,
    Json(payload): Json<BrowserRumIngestRequest>,
) -> Result<StatusCode, ApiError> {
    if payload.events.len() > MAX_RUM_EVENTS {
        return Err(ApiError::bad_request(
            "rum_batch_too_large",
            "RUM batches must contain at most 20 events.",
        ));
    }

    for event in payload.events {
        validate_rum_event(&event)?;
        let method = event
            .method
            .as_deref()
            .map(|value| value.trim().to_ascii_uppercase());
        let status = event.status.as_deref().map(str::trim);
        let duration = Duration::from_millis(event.value.round() as u64);

        hms_observability::record_browser_rum_event(
            &event.event_type,
            &event.name,
            &event.route,
            method.as_deref(),
            status,
            duration,
        );
    }

    Ok(StatusCode::NO_CONTENT)
}

fn validate_rum_event(event: &BrowserRumEvent) -> Result<(), ApiError> {
    validate_label("rum_type_invalid", &event.event_type)?;
    validate_label("rum_name_invalid", &event.name)?;
    validate_route(&event.route)?;
    if !event.value.is_finite() || event.value < 0.0 || event.value > MAX_RUM_DURATION_MS {
        return Err(ApiError::bad_request(
            "rum_value_invalid",
            "RUM event values must be finite positive milliseconds.",
        ));
    }
    if let Some(status) = &event.status {
        validate_label("rum_status_invalid", status)?;
    }
    if let Some(method) = &event.method {
        validate_method(method)?;
    }

    Ok(())
}

fn validate_label(code: &'static str, value: &str) -> Result<(), ApiError> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > MAX_LABEL_LENGTH
        || !value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b':' | b'_' | b'.' | b'/' | b'-')
        })
    {
        return Err(ApiError::bad_request(code, "RUM event labels are invalid."));
    }
    Ok(())
}

fn validate_route(route: &str) -> Result<(), ApiError> {
    let route = route.trim();
    if !route.starts_with('/')
        || route.len() > MAX_ROUTE_LENGTH
        || !route.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b':' | b'_' | b'.' | b'-')
        })
    {
        return Err(ApiError::bad_request(
            "rum_route_invalid",
            "RUM route labels are invalid.",
        ));
    }
    Ok(())
}

fn validate_method(method: &str) -> Result<(), ApiError> {
    match method.trim().to_ascii_uppercase().as_str() {
        "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD" => Ok(()),
        _ => Err(ApiError::bad_request(
            "rum_method_invalid",
            "RUM method labels are invalid.",
        )),
    }
}
