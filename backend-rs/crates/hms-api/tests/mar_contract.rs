mod support;
use support::*;

#[tokio::test]
async fn mar_patient_and_admission_filters_page_without_unrelated_doses() {
    let app = app().await;
    let pool = app.db_pool().await;
    let facility_id = app.state().facility_id();
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let owner_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM users WHERE facility_id = $1 AND email = 'owner@hms.local'",
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let ward_id: Uuid = sqlx::query_scalar("SELECT id FROM wards WHERE facility_id = $1 LIMIT 1")
        .bind(facility_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let start = Utc::now();
    let mut scopes = Vec::new();
    for suffix in ["selected", "unrelated"] {
        let patient = hms_db::patients::create_patient(
            &pool,
            hms_db::patients::NewPatient {
                id: Uuid::new_v4(),
                facility_id,
                created_by_user_id: owner_id,
                request_id: None,
                patient_code: format!("SYN-MAR-{suffix}"),
                first_name: format!("Synthetic{suffix}"),
                last_name: "Fixture".to_owned(),
                date_of_birth: chrono::NaiveDate::from_ymd_opt(1990, 1, 1).unwrap(),
                sex: hms_domain::patients::Sex::Female,
                duplicate_override: None,
            },
        )
        .await
        .unwrap();
        let admission_id = Uuid::new_v4();
        sqlx::query("INSERT INTO admission_cases (id, facility_id, patient_id, ward_id, status) VALUES ($1, $2, $3, $4, 'admitted')")
            .bind(admission_id).bind(facility_id).bind(patient.id).bind(ward_id).execute(&pool).await.unwrap();
        let count = if suffix == "selected" { 3 } else { 150 };
        sqlx::query("INSERT INTO medication_administrations (id, facility_id, admission_case_id, patient_id, medication_name, scheduled_at, status) SELECT gen_random_uuid(), $1, $2, $3, 'Synthetic scoped dose', $4 + sequence * interval '1 minute', 'scheduled' FROM generate_series(0, $5 - 1) AS sequence")
            .bind(facility_id).bind(admission_id).bind(patient.id)
            .bind(if suffix == "selected" { start } else { start - Duration::hours(6) })
            .bind(count).execute(&pool).await.unwrap();
        scopes.push((patient.id, admission_id));
    }
    let (patient_id, admission_id) = scopes[0];
    let request = |query: String| {
        Request::builder()
            .uri(format!(
                "/api/v2/nursing/medication-administrations?{query}"
            ))
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .body(Body::empty())
            .unwrap()
    };
    let first = app
        .clone()
        .oneshot(request(format!(
            "patient_id={patient_id}&admission_case_id={admission_id}&limit=2&descending=true"
        )))
        .await
        .unwrap();
    assert_eq!(first.status(), StatusCode::OK);
    let first = json_body(first).await;
    assert_eq!(first["data"].as_array().unwrap().len(), 2);
    assert_eq!(first["page"]["has_next"], true);
    assert!(first["data"]
        .as_array()
        .unwrap()
        .iter()
        .all(|row| row["patient_id"] == patient_id.to_string()));
    let cursor = first["page"]["next_cursor"].as_str().unwrap();
    let second = app.clone().oneshot(request(format!("patient_id={patient_id}&admission_case_id={admission_id}&limit=2&descending=true&cursor={cursor}"))).await.unwrap();
    let second = json_body(second).await;
    assert_eq!(second["data"].as_array().unwrap().len(), 1);
    assert_eq!(second["page"]["has_next"], false);
    assert_ne!(first["data"][0]["id"], second["data"][0]["id"]);
    let from = (start + Duration::minutes(1)).to_rfc3339_opts(chrono::SecondsFormat::Micros, true);
    let before =
        (start + Duration::minutes(2)).to_rfc3339_opts(chrono::SecondsFormat::Micros, true);
    let window = app
        .clone()
        .oneshot(request(format!(
            "patient_id={patient_id}&scheduled_from={from}&scheduled_before={before}&limit=100"
        )))
        .await
        .unwrap();
    assert_eq!(window.status(), StatusCode::OK);
    let window = json_body(window).await;
    assert_eq!(window["data"].as_array().unwrap().len(), 1);
    assert_eq!(window["page"]["has_next"], false);
    let mismatched = app
        .clone()
        .oneshot(request(format!(
            "patient_id={}&admission_case_id={admission_id}",
            scopes[1].0
        )))
        .await
        .unwrap();
    assert_eq!(mismatched.status(), StatusCode::BAD_REQUEST);
    let absent = app
        .clone()
        .oneshot(request(format!("patient_id={}", Uuid::new_v4())))
        .await
        .unwrap();
    assert_eq!(absent.status(), StatusCode::NOT_FOUND);
    let invalid_range = app
        .clone()
        .oneshot(request(
            "scheduled_from=2026-06-02T00:00:00Z&scheduled_before=2026-06-01T00:00:00Z".to_owned(),
        ))
        .await
        .unwrap();
    assert_eq!(invalid_range.status(), StatusCode::BAD_REQUEST);
    let (limited, _, _) = login(app.clone(), "limited@hms.local").await;
    let denied = app
        .oneshot(
            Request::builder()
                .uri(format!(
                    "/api/v2/nursing/medication-administrations?patient_id={patient_id}"
                ))
                .header(AUTHORIZATION, format!("Bearer {limited}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
}
