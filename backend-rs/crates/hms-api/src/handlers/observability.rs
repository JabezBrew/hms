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
    pub facility_safe: Option<String>,
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
    RequestContext(ctx): RequestContext,
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
        let route_pattern = hms_observability::normalize_browser_route_pattern(&event.route);
        let status_bucket = event
            .status
            .as_deref()
            .map(hms_observability::normalize_status_bucket)
            .unwrap_or_else(|| "unknown".to_owned());
        let facility_safe = hms_observability::sanitize_facility_safe(&ctx.facility_code);
        let duration = Duration::from_millis(event.value.round() as u64);

        hms_observability::record_browser_rum_event(
            &event.event_type,
            &event.name,
            &route_pattern,
            &status_bucket,
            &facility_safe,
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
        validate_status_bucket(status)?;
    }
    if let Some(facility_safe) = &event.facility_safe {
        validate_facility_safe(facility_safe)?;
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

fn validate_status_bucket(status: &str) -> Result<(), ApiError> {
    let status = status.trim().to_ascii_lowercase();
    match status.as_str() {
        "2xx" | "3xx" | "4xx" | "5xx" | "network" | "timeout" | "cancelled" | "unknown" => Ok(()),
        _ => status
            .parse::<u16>()
            .ok()
            .filter(|code| (100..=599).contains(code))
            .map(|_| ())
            .ok_or_else(|| {
                ApiError::bad_request("rum_status_invalid", "RUM status labels are invalid.")
            }),
    }
}

fn validate_facility_safe(facility_safe: &str) -> Result<(), ApiError> {
    if hms_observability::sanitize_facility_safe(facility_safe) == "_unknown" {
        Err(ApiError::bad_request(
            "rum_facility_invalid",
            "RUM facility labels are invalid.",
        ))
    } else {
        Ok(())
    }
}
