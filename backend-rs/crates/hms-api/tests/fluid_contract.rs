mod support;
use support::*;

#[tokio::test]
async fn fluid_patient_scope_pages_and_complete_totals_require_authorized_matching_context() {
    let app = app().await;
    let pool = app.db_pool().await;
    let facility_id = app.state().facility_id();
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let ward_id: Uuid = sqlx::query_scalar("SELECT id FROM wards WHERE facility_id = $1 LIMIT 1")
        .bind(facility_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let patients: Vec<Uuid> =
        sqlx::query_scalar("SELECT id FROM patients WHERE facility_id = $1 ORDER BY id LIMIT 2")
            .bind(facility_id)
            .fetch_all(&pool)
            .await
            .unwrap();
    assert!(!patients.is_empty());
    let patient = patients[0];
    let admission = Uuid::new_v4();
    sqlx::query("INSERT INTO admission_cases (id, facility_id, patient_id, ward_id, status) VALUES ($1, $2, $3, $4, 'discharged')").bind(admission).bind(facility_id).bind(patient).bind(ward_id).execute(&pool).await.unwrap();
    let start = Utc::now();
    sqlx::query("INSERT INTO fluid_balance_entries (id, facility_id, admission_case_id, patient_id, recorded_at, intake_ml, output_ml) SELECT gen_random_uuid(), $1, $2, $3, $4 + sequence * interval '1 day', 100, 20 FROM generate_series(0, 124) AS sequence")
        .bind(facility_id).bind(admission).bind(patient).bind(start).execute(&pool).await.unwrap();
    let request = |path: &str, query: String| {
        Request::builder()
            .uri(format!("/api/v2/nursing/fluid-balance{path}?{query}"))
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .body(Body::empty())
            .unwrap()
    };
    let scope = format!("patient_id={patient}&admission_case_id={admission}");
    let summary = app
        .clone()
        .oneshot(request("/summary", scope.clone()))
        .await
        .unwrap();
    assert_eq!(summary.status(), StatusCode::OK);
    let summary = json_body(summary).await;
    assert_eq!(summary["data"]["entry_count"], 125);
    assert_eq!(summary["data"]["total_intake_ml"], 12500);
    assert_eq!(summary["data"]["net_ml"], 10000);
    for path in ["", "/trends"] {
        let first = app
            .clone()
            .oneshot(request(path, format!("{scope}&limit=100")))
            .await
            .unwrap();
        assert_eq!(first.status(), StatusCode::OK);
        let first = json_body(first).await;
        assert_eq!(first["data"].as_array().unwrap().len(), 100);
        assert_eq!(first["page"]["has_next"], true);
        let cursor = first["page"]["next_cursor"].as_str().unwrap();
        let second = app
            .clone()
            .oneshot(request(path, format!("{scope}&limit=100&cursor={cursor}")))
            .await
            .unwrap();
        let second = json_body(second).await;
        assert_eq!(second["data"].as_array().unwrap().len(), 25);
        assert_eq!(second["page"]["has_next"], false);
    }
    for path in ["", "/summary", "/trends"] {
        let mismatched = app
            .clone()
            .oneshot(request(
                path,
                format!(
                    "patient_id={}&admission_case_id={admission}",
                    Uuid::new_v4()
                ),
            ))
            .await
            .unwrap();
        assert_eq!(mismatched.status(), StatusCode::BAD_REQUEST);
        let absent = app
            .clone()
            .oneshot(request(path, format!("patient_id={}", Uuid::new_v4())))
            .await
            .unwrap();
        assert_eq!(absent.status(), StatusCode::NOT_FOUND);
        let invalid = app.clone().oneshot(request(path, format!("{scope}&recorded_from=2026-06-02T00:00:00Z&recorded_before=2026-06-01T00:00:00Z"))).await.unwrap();
        assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);
    }
    let unscoped = app
        .clone()
        .oneshot(request("/summary", String::new()))
        .await
        .unwrap();
    assert_eq!(unscoped.status(), StatusCode::BAD_REQUEST);
    let (limited, _, _) = login(app.clone(), "limited@hms.local").await;
    let denied = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/v2/nursing/fluid-balance/summary?{scope}"))
                .header(AUTHORIZATION, format!("Bearer {limited}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
}
