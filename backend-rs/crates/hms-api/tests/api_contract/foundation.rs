use super::*;

#[tokio::test]
async fn health_endpoints_use_standard_envelope_and_request_id() {
    let response = app()
        .await
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/health/alive")
                .header("x-request-id", "test-request-1")
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("health request succeeds");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers().get("x-request-id").unwrap(),
        "test-request-1"
    );
    let body = json_body(response).await;
    assert_eq!(body["data"]["service"], "hms-api");
    assert_eq!(body["data"]["status"], "alive");
    assert!(body["meta"].is_object());
}

#[tokio::test]
async fn openapi_contains_foundation_paths() {
    let response = app()
        .await
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/openapi.json")
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("openapi request succeeds");

    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    let paths = body["paths"].as_object().expect("paths object exists");
    for path in [
        "/api/v2/health/alive",
        "/api/v2/health/ready",
        "/api/v2/metrics",
        "/api/v2/observability/rum",
        "/api/v2/ops/overview",
        "/api/v2/ops/performance",
        "/api/v2/ops/database",
        "/api/v2/ops/frontend",
        "/api/v2/auth/login",
        "/api/v2/auth/refresh",
        "/api/v2/auth/logout",
        "/api/v2/auth/me",
        "/api/v2/auth/password",
        "/api/v2/auth/password-reset/request",
        "/api/v2/auth/password-reset/complete",
        "/api/v2/auth/sessions",
        "/api/v2/auth/sessions/{session_id}/revoke",
        "/api/v2/auth/sessions/revoke-all",
        "/api/v2/system/deployment-capabilities",
        "/api/v2/admin/org-units",
        "/api/v2/admin/org-units/{id}",
        "/api/v2/admin/org-units/{id}/ancestors",
        "/api/v2/admin/org-units/{id}/children",
        "/api/v2/admin/org-units/{id}/descendants",
        "/api/v2/admin/position-templates",
        "/api/v2/admin/positions",
        "/api/v2/admin/authority-appointments",
        "/api/v2/admin/permission-assignments",
        "/api/v2/admin/features",
        "/api/v2/admin/features/{key}",
        "/api/v2/admin/staff",
        "/api/v2/admin/staff/{id}",
        "/api/v2/admin/staff/{id}/force-password-reset",
        "/api/v2/admin/staff/{id}/deactivate",
        "/api/v2/admin/staff/{id}/reactivate",
        "/api/v2/admin/staff/{id}/practitioner-profile",
        "/api/v2/admin/practitioners",
        "/api/v2/admin/committees",
        "/api/v2/admin/delegations",
        "/api/v2/admin/audit-events",
        "/api/v2/dashboards/snapshot",
        "/api/v2/notifications",
        "/api/v2/notifications/counts",
        "/api/v2/notifications/{id}/read",
        "/api/v2/realtime/subscriptions",
        "/api/v2/patients",
        "/api/v2/patients/context",
        "/api/v2/patients/validation-rules",
        "/api/v2/patients/{id}",
        "/api/v2/patients/{id}/chronicle",
        "/api/v2/patients/{id}/chronicle/print",
        "/api/v2/appointments",
        "/api/v2/appointments/{id}",
        "/api/v2/appointments/{id}/cancel",
        "/api/v2/clinics",
        "/api/v2/clinics/{id}",
        "/api/v2/visits",
        "/api/v2/visits/{id}",
        "/api/v2/visits/check-in",
        "/api/v2/visits/{id}/call",
        "/api/v2/visits/{id}/start-consultation",
        "/api/v2/visits/{id}/checkout",
        "/api/v2/triage",
        "/api/v2/triage/{id}/assign",
        "/api/v2/encounters",
        "/api/v2/encounters/{id}",
        "/api/v2/encounters/{id}/complete",
        "/api/v2/encounters/{id}/cancel",
        "/api/v2/encounters/{id}/care-team",
        "/api/v2/clinical/note-templates",
        "/api/v2/patients/{patient_id}/clinical/notes",
        "/api/v2/clinical/notes/{note_id}/versions",
        "/api/v2/patients/{patient_id}/clinical/problems",
        "/api/v2/patients/{patient_id}/clinical/allergies",
        "/api/v2/patients/{patient_id}/clinical/prescriptions",
        "/api/v2/patients/{patient_id}/clinical/chart-entries",
        "/api/v2/laboratory/test-catalog",
        "/api/v2/laboratory/test-catalog/{id}",
        "/api/v2/laboratory/panels",
        "/api/v2/laboratory/panels/{id}",
        "/api/v2/laboratory/orders",
        "/api/v2/laboratory/orders/{id}",
        "/api/v2/laboratory/specimens",
        "/api/v2/laboratory/specimens/{id}",
        "/api/v2/laboratory/results",
        "/api/v2/laboratory/results/{id}",
        "/api/v2/laboratory/results/{id}/verify",
        "/api/v2/inventory/categories",
        "/api/v2/inventory/items",
        "/api/v2/inventory/items/{id}",
        "/api/v2/inventory/items/{id}/stock-batches",
        "/api/v2/inventory/items/{id}/stock-movements",
        "/api/v2/inventory/items/{id}/stock-by-location",
        "/api/v2/inventory/storage-locations",
        "/api/v2/inventory/storage-locations/{id}",
        "/api/v2/inventory/storage-locations/{id}/stock",
        "/api/v2/inventory/stock-batches",
        "/api/v2/inventory/stock-movements",
        "/api/v2/inventory/transfers",
        "/api/v2/inventory/transfers/{id}",
        "/api/v2/inventory/requisitions",
        "/api/v2/inventory/requisitions/{id}",
        "/api/v2/inventory/purchase-orders",
        "/api/v2/inventory/purchase-orders/{id}",
        "/api/v2/inventory/goods-received-notes",
        "/api/v2/inventory/goods-received-notes/{id}",
        "/api/v2/pharmacy/controlled-substances/register",
        "/api/v2/pharmacy/controlled-substances/register/{id}",
        "/api/v2/pharmacy/dispenses",
        "/api/v2/billing/service-catalog",
        "/api/v2/billing/service-prices",
        "/api/v2/billing/rules",
        "/api/v2/billing/invoices",
        "/api/v2/billing/payments",
        "/api/v2/billing/receipts",
        "/api/v2/billing/cash-drawers",
        "/api/v2/billing/cash-sessions",
        "/api/v2/billing/cash-sessions/{id}/close",
        "/api/v2/nhis/claims",
        "/api/v2/nhis/batches",
        "/api/v2/nhis/batches/{id}/export",
        "/api/v2/nhis/remittance-imports",
        "/api/v2/wards",
        "/api/v2/wards/{id}",
        "/api/v2/wards/{id}/beds",
        "/api/v2/wards/{id}/sections",
        "/api/v2/wards/board",
        "/api/v2/admissions",
        "/api/v2/admissions/{id}",
        "/api/v2/admissions/cases",
        "/api/v2/admissions/cases/{id}",
        "/api/v2/admissions/cases/{id}/reserve-bed",
        "/api/v2/admissions/cases/{id}/activate",
        "/api/v2/admissions/cases/{id}/cancel",
        "/api/v2/discharges",
        "/api/v2/discharges/{id}",
        "/api/v2/discharges/{id}/cancel",
        "/api/v2/discharges/{id}/complete",
        "/api/v2/nursing/tasks",
        "/api/v2/nursing/tasks/{id}/complete",
        "/api/v2/nursing/medication-administrations",
        "/api/v2/nursing/medication-administrations/{id}/administer",
        "/api/v2/nursing/handoffs",
        "/api/v2/nursing/handoffs/{id}/complete",
        "/api/v2/nursing/treatment-sheets",
        "/api/v2/nursing/vitals",
        "/api/v2/nursing/alerts",
        "/api/v2/nursing/alerts/{id}/acknowledge",
        "/api/v2/nursing/monitoring-events",
        "/api/v2/nursing/fluid-balance",
        "/api/v2/nursing/ward-stock-requests",
        "/api/v2/nursing/ward-stock-requests/{id}/approve",
        "/api/v2/nursing/ward-stock-requests/{id}/fulfill",
        "/api/v2/referrals",
        "/api/v2/referrals/sla-dashboard",
        "/api/v2/referrals/{id}",
        "/api/v2/referrals/{id}/accept",
        "/api/v2/referrals/{id}/complete",
        "/api/v2/referrals/{id}/decline",
        "/api/v2/referrals/{id}/sla-state",
        "/api/v2/referrals/clinic-waitlist",
        "/api/v2/referrals/clinic-waitlist/offer-next",
        "/api/v2/scheduling/services",
        "/api/v2/scheduling/sessions",
        "/api/v2/scheduling/sessions/{id}/cancel",
        "/api/v2/scheduling/availability",
        "/api/v2/scheduling/appointments/book",
        "/api/v2/scheduling/exceptions",
        "/api/v2/scheduling/appointments/{id}/arrive",
        "/api/v2/search/omni",
        "/api/v2/consents",
        "/api/v2/consents/{id}/revoke",
    ] {
        assert!(paths.contains_key(path), "missing OpenAPI path {path}");
    }
    assert!(
        paths["/api/v2/admin/features/{key}"]["delete"].is_object(),
        "feature override removal must be exposed as a DELETE operation"
    );
    assert!(
        paths["/api/v2/search/omni"]["post"].is_object(),
        "OmniSearch must use POST so PHI-bearing search text is not encoded into URLs"
    );
    let ward_board_parameters = paths["/api/v2/wards/board"]["get"]["parameters"]
        .as_array()
        .expect("ward board parameters exist");
    assert!(
        ward_board_parameters
            .iter()
            .any(|parameter| parameter["name"] == "ward_id"),
        "ward board exposes ward_id filter for ward-scoped UI routes"
    );
    assert!(
        ward_board_parameters
            .iter()
            .any(|parameter| parameter["name"] == "patient_id"),
        "ward board exposes patient_id filter for patient-scoped monitoring routes"
    );
    let ward_parameters = paths["/api/v2/wards"]["get"]["parameters"]
        .as_array()
        .expect("ward list parameters exist");
    assert!(
        ward_parameters
            .iter()
            .any(|parameter| parameter["name"] == "search"),
        "ward list exposes search filter for server-side ward picker search"
    );
    let patient_parameters = paths["/api/v2/patients"]["get"]["parameters"]
        .as_array()
        .expect("patient list parameters exist");
    assert!(
        patient_parameters
            .iter()
            .any(|parameter| parameter["name"] == "status"),
        "patient list exposes status filter for registry scope tabs"
    );
    assert!(
        patient_parameters
            .iter()
            .any(|parameter| parameter["name"] == "ordering"),
        "patient list exposes ordering for server-side registry table sorting"
    );
    let appointment_parameters = paths["/api/v2/appointments"]["get"]["parameters"]
        .as_array()
        .expect("appointment list parameters exist");
    assert!(
        appointment_parameters
            .iter()
            .any(|parameter| parameter["name"] == "clinic_id"),
        "appointment list exposes clinic_id filter for clinic schedule views"
    );
    let triage_parameters = paths["/api/v2/triage"]["get"]["parameters"]
        .as_array()
        .expect("triage queue parameters exist");
    for filter_name in ["status", "acuity"] {
        assert!(
            triage_parameters
                .iter()
                .any(|parameter| parameter["name"] == filter_name),
            "triage queue exposes {filter_name} filter for server-side queue filtering"
        );
    }
    let referral_parameters = paths["/api/v2/referrals"]["get"]["parameters"]
        .as_array()
        .expect("referral list parameters exist");
    assert!(
        referral_parameters
            .iter()
            .any(|parameter| parameter["name"] == "status"),
        "referral list exposes status filter for pending referral views"
    );
}

#[tokio::test]
async fn metrics_endpoint_is_phi_safe_prometheus_text() {
    let response = app()
        .await
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/metrics")
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("metrics request succeeds");

    assert_eq!(response.status(), StatusCode::OK);
    let content_type = response
        .headers()
        .get("content-type")
        .expect("content-type exists")
        .to_str()
        .expect("content-type is ascii");
    assert!(content_type.starts_with("text/plain"));

    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("metrics response reads");
    let body = String::from_utf8(bytes.to_vec()).expect("metrics text is utf-8");
    assert!(body.contains("hms_api_up 1"));
    assert!(body.contains("hms_api_postgres_pool_size"));
    assert!(body.contains("hms_api_health_ready"));
    assert!(body.contains("hms_api_dependency_ready"));
    assert!(body.contains("hms_rum_enabled"));
    assert!(body.contains("hms_api_http_requests_total"));
    assert!(body.contains("hms_api_http_request_duration_seconds_bucket"));
    assert!(body.contains("hms_api_http_db_query_count_sum"));
    assert!(body.contains("hms_db_query_duration_seconds_bucket"));
    assert!(!body.contains("Ama"));
    assert!(!body.contains("Mensah"));
    assert!(!body.contains("P-0000000001"));
}

#[tokio::test]
async fn rum_ingest_requires_authentication() {
    let response = app()
        .await
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/observability/rum")
                .header("content-type", "application/json")
                .body(Body::from(json!({ "events": [] }).to_string()))
                .expect("request builds"),
        )
        .await
        .expect("rum request succeeds");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn rum_ingest_records_phi_safe_browser_metrics() {
    let app = app().await;
    let owner = Actor::login(&app, "owner@hms.local").await;

    let response = api_post_json(
        app.clone(),
        &owner,
        "/api/v2/observability/rum",
        json!({
            "events": [
                {
                    "type": "api",
                    "name": "duration",
                    "route": "/patients/:id/chronicle",
                    "value": 125,
                    "status": "200",
                    "method": "post",
                    "ts": 1_715_000_000_000_i64
                }
            ]
        }),
    )
    .await;

    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    let metrics = text_body(api_get(app, &owner, "/api/v2/metrics").await).await;
    assert!(metrics.contains("hms_browser_rum_events_total"));
    assert!(metrics.contains("route_pattern=\"/patients/:id/chronicle\""));
    assert!(metrics.contains("status_bucket=\"2xx\""));
    assert!(metrics.contains("facility_safe=\"HMS\""));
    assert!(metrics.contains("hms_browser_rum_duration_seconds_bucket"));
    assert!(metrics.contains("hms_browser_api_request_duration_seconds_bucket"));
    assert!(!metrics.contains("Ama"));
    assert!(!metrics.contains("Mensah"));
}

#[tokio::test]
async fn rum_ingest_rejects_unbounded_batches() {
    let app = app().await;
    let owner = Actor::login(&app, "owner@hms.local").await;
    let events = (0..21)
        .map(|_| {
            json!({
                "type": "navigation",
                "name": "load",
                "route": "/dashboard",
                "value": 50
            })
        })
        .collect::<Vec<_>>();

    let response = api_post_json(
        app,
        &owner,
        "/api/v2/observability/rum",
        json!({ "events": events }),
    )
    .await;

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}
