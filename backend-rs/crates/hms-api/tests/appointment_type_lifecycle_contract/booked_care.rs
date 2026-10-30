use super::*;
async fn care_snapshot(pool: &hms_db::PgPool, typ: Uuid) -> Value {
    sqlx::query_scalar("SELECT COALESCE(jsonb_agg(jsonb_build_array(id,starts_at,ends_at,status,appointment_type_id)ORDER BY id),'[]'::jsonb)FROM appointments WHERE appointment_type_id=$1")
        .bind(typ).fetch_one(pool).await.unwrap()
}
#[tokio::test]
async fn metadata_and_retirement_preserve_booked_times_and_allow_existing_reschedule_arrival_and_cancel(
) {
    let (app, token) = setup().await;
    let pool = app.db_pool().await;
    let created = create(&app, &token, "SYNTH23BOOKED").await;
    let typ = service_id(&created);
    let patient: Uuid =
        sqlx::query_scalar("SELECT id FROM patients WHERE facility_id=$1 ORDER BY id LIMIT 1")
            .bind(app.state().facility_id())
            .fetch_one(&pool)
            .await
            .unwrap();
    let start = Utc::now() + Duration::days(10);
    let mut ids = Vec::new();
    for offset in [0, 1, 2] {
        let at = start + Duration::days(offset);
        let(s,b)=request(&app,&token,Method::POST,"/api/v2/appointments",Some(json!({"patient_id":patient,"appointment_type_id":typ,"starts_at":at,"ends_at":at+Duration::minutes(20)}))).await;
        assert_eq!(s, StatusCode::OK, "static {}", b["error"]["code"]);
        ids.push(b["data"]["id"].as_str().unwrap().parse::<Uuid>().unwrap());
    }
    let before = care_snapshot(&pool, typ).await;
    let(s,_)=request(&app,&token,Method::POST,&format!("/api/v2/scheduling/services/{typ}/metadata"),Some(json!({"client_request_id":Uuid::new_v4(),"expected_version":1,"name":"Synthetic edited default only","default_duration_minutes":65}))).await;
    assert_eq!(s, StatusCode::OK);
    assert!(
        care_snapshot(&pool, typ).await == before,
        "Metadata must not change booked times/status/type"
    );
    let (s, _) = request(
        &app,
        &token,
        Method::POST,
        &format!("/api/v2/scheduling/services/{typ}/retire"),
        Some(json!({"client_request_id":Uuid::new_v4(),"expected_version":2})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert!(
        care_snapshot(&pool, typ).await == before,
        "Retirement must not change booked times/status/type"
    );
    let before_count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM appointments WHERE facility_id=$1")
            .bind(app.state().facility_id())
            .fetch_one(&pool)
            .await
            .unwrap();
    let(s,_)=request(&app,&token,Method::POST,"/api/v2/appointments",Some(json!({"patient_id":patient,"appointment_type_id":typ,"starts_at":start+Duration::days(4),"ends_at":start+Duration::days(4)+Duration::minutes(20)}))).await;
    assert_eq!(s, StatusCode::CONFLICT);
    let after_count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM appointments WHERE facility_id=$1")
            .bind(app.state().facility_id())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(before_count, after_count);
    assert_eq!(request(&app,&token,Method::PATCH,&format!("/api/v2/appointments/{}",ids[0]),Some(json!({"starts_at":start+Duration::hours(1),"ends_at":start+Duration::hours(1)+Duration::minutes(20)}))).await.0,StatusCode::OK);
    assert_eq!(
        request(
            &app,
            &token,
            Method::POST,
            &format!("/api/v2/scheduling/appointments/{}/arrive", ids[1]),
            Some(json!({}))
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        request(
            &app,
            &token,
            Method::POST,
            &format!("/api/v2/appointments/{}/cancel", ids[2]),
            Some(json!({"reason":"Synthetic unchanged care closure"}))
        )
        .await
        .0,
        StatusCode::OK
    );
    let facts:(i64,i64,i64,bool)=sqlx::query_as("SELECT count(*)FILTER(WHERE status='scheduled'),count(*)FILTER(WHERE status='checked_in'),count(*)FILTER(WHERE status='cancelled'),(SELECT NOT is_active AND version=3 AND default_duration_minutes=65 FROM appointment_types WHERE id=$1)FROM appointments WHERE appointment_type_id=$1").bind(typ).fetch_one(&pool).await.unwrap();
    assert_eq!(facts, (1, 1, 1, true));
}

#[tokio::test]
async fn retired_finite_service_owner_stops_new_offers_but_preserves_existing_null_selected_type_care(
) {
    let (app, token) = setup().await;
    let pool = app.db_pool().await;
    let typ = service_id(&create(&app, &token, "SYNTH23FINITEOWNER").await);
    let patient: Uuid =
        sqlx::query_scalar("SELECT id FROM patients WHERE facility_id=$1 ORDER BY id LIMIT 1")
            .bind(app.state().facility_id())
            .fetch_one(&pool)
            .await
            .unwrap();
    let start = Utc::now() + Duration::days(3);
    let end = start + Duration::hours(3);
    let(s,b)=request(&app,&token,Method::POST,"/api/v2/scheduling/sessions",Some(json!({"owner_type":"service","owner_id":typ,"name":"Synthetic finite retained service block","mode":"capacity_block","starts_at":start,"ends_at":end,"capacity":8}))).await;
    assert_eq!(s, StatusCode::OK);
    let session: Uuid = b["data"]["id"].as_str().unwrap().parse().unwrap();
    let mut ids = Vec::new();
    for offset in [0, 20, 40] {
        let at = start + Duration::minutes(offset);
        let(s,b)=request(&app,&token,Method::POST,"/api/v2/appointments",Some(json!({"patient_id":patient,"clinic_session_id":session,"starts_at":at,"ends_at":at+Duration::minutes(15)}))).await;
        assert_eq!(s, StatusCode::OK, "static {}", b["error"]["code"]);
        ids.push(b["data"]["id"].as_str().unwrap().parse::<Uuid>().unwrap());
    }
    let before:Value=sqlx::query_scalar("SELECT jsonb_agg(jsonb_build_array(id,starts_at,ends_at,status,appointment_type_id)ORDER BY id) FROM appointments WHERE clinic_session_id=$1").bind(session).fetch_one(&pool).await.unwrap();
    let (s, b) = request(
        &app,
        &token,
        Method::POST,
        &format!("/api/v2/scheduling/services/{typ}/retire"),
        Some(json!({"client_request_id":Uuid::new_v4(),"expected_version":1})),
    )
    .await;
    assert_eq!(
        s,
        StatusCode::OK,
        "finite booked session is not a future template generator: {}",
        b["error"]["code"]
    );
    let after:Value=sqlx::query_scalar("SELECT jsonb_agg(jsonb_build_array(id,starts_at,ends_at,status,appointment_type_id)ORDER BY id) FROM appointments WHERE clinic_session_id=$1").bind(session).fetch_one(&pool).await.unwrap();
    assert_eq!(before, after);
    let (s, b) = request(
        &app,
        &token,
        Method::GET,
        &format!(
            "/api/v2/scheduling/availability?start_date={}&limit=100",
            start.date_naive()
        ),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert!(
        !b["data"]["slots"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v["session_id"] == session.to_string()),
        "retired service owner must not offer new slots even without selected type"
    );
    let (s, b) = request(
        &app,
        &token,
        Method::GET,
        "/api/v2/scheduling/sessions?limit=100",
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert!(
        b["data"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v["id"] == session.to_string()),
        "historical/session management read remains available"
    );
    let(s,_)=request(&app,&token,Method::POST,"/api/v2/appointments",Some(json!({"patient_id":patient,"clinic_session_id":session,"starts_at":start+Duration::minutes(80),"ends_at":start+Duration::minutes(95)}))).await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(request(&app,&token,Method::PATCH,&format!("/api/v2/appointments/{}",ids[0]),Some(json!({"starts_at":start+Duration::minutes(100),"ends_at":start+Duration::minutes(115)}))).await.0,StatusCode::OK);
    assert_eq!(
        request(
            &app,
            &token,
            Method::POST,
            &format!("/api/v2/scheduling/appointments/{}/arrive", ids[1]),
            Some(json!({}))
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        request(
            &app,
            &token,
            Method::POST,
            &format!("/api/v2/appointments/{}/cancel", ids[2]),
            Some(json!({"reason":"Synthetic preserved finite care closure"}))
        )
        .await
        .0,
        StatusCode::OK
    );
    let facts:(i64,i64,i64,i64)=sqlx::query_as("SELECT count(*)FILTER(WHERE status='scheduled'),count(*)FILTER(WHERE status='checked_in'),count(*)FILTER(WHERE status='cancelled'),count(*)FILTER(WHERE appointment_type_id IS NULL) FROM appointments WHERE clinic_session_id=$1").bind(session).fetch_one(&pool).await.unwrap();
    assert_eq!(facts, (1, 1, 1, 3));
}
