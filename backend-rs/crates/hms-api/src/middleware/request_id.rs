use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::header::{HeaderName, HeaderValue};
use axum::middleware::Next;
use axum::response::Response;
use uuid::Uuid;

use crate::state::AppState;

pub const REQUEST_ID_HEADER: &str = "x-request-id";
static REQUEST_ID_HEADER_NAME: HeaderName = HeaderName::from_static(REQUEST_ID_HEADER);

#[derive(Clone, Debug)]
pub struct RequestId(pub String);

tokio::task_local! {
    static CURRENT_REQUEST_ID: RequestId;
}

pub fn current_request_id() -> String {
    CURRENT_REQUEST_ID
        .try_with(|request_id| request_id.0.clone())
        .unwrap_or_else(|_| Uuid::new_v4().to_string())
}

pub async fn layer(
    State(_state): State<AppState>,
    mut request: Request<Body>,
    next: Next,
) -> Response {
    let request_id = request
        .headers()
        .get(&REQUEST_ID_HEADER_NAME)
        .and_then(|value| value.to_str().ok())
        .filter(|value| is_safe_request_id(value))
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let request_id = RequestId(request_id);
    request.extensions_mut().insert(request_id.clone());

    let mut response = CURRENT_REQUEST_ID
        .scope(request_id.clone(), async move { next.run(request).await })
        .await;

    if let Ok(value) = HeaderValue::from_str(&request_id.0) {
        response
            .headers_mut()
            .insert(&REQUEST_ID_HEADER_NAME, value);
    }

    response
}

fn is_safe_request_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
}
