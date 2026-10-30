use super::*;
#[tokio::test]
async fn series_new_references_are_local_active_while_materialized_care_remains_readable_replayable_and_closable(
) {
    let (app, token) = setup().await;
    let pool = app.db_pool().await;
    let f = app.state().facility_id();
    let typ = service_id(&create(&app, &token, "SYNTH23SERIES").await);
    let patient:Uuid=sqlx::query_scalar("SELECT id FROM patients WHERE facility_id=$1 AND record_status='registered' AND vital_status<>'deceased' ORDER BY id LIMIT 1").bind(f).fetch_one(&pool).await.unwrap();
    let clinic: Uuid = sqlx::query_scalar(
        "SELECT id FROM clinics WHERE facility_id=$1 AND is_active ORDER BY id LIMIT 1",
    )
    .bind(f)
    .fetch_one(&pool)
    .await
    .unwrap();
    let mut occurrences = Vec::new();
    for day in [1, 2] {
        let at = Utc::now()
            .date_naive()
            .and_hms_opt(9, 0, 0)
            .unwrap()
            .and_utc()
            + Duration::days(day);
        let(s,b)=request(&app,&token,Method::POST,"/api/v2/scheduling/sessions",Some(json!({"clinic_id":clinic,"owner_type":"facility","owner_id":f,"name":"Synthetic exact materialized block","mode":"capacity_block","starts_at":at,"ends_at":at+Duration::hours(1),"capacity":8}))).await;
        assert_eq!(s, StatusCode::OK);
        occurrences.push(
            json!({"session_id":b["data"]["id"],"starts_at":at,"ends_at":at+Duration::hours(1)}),
        );
    }
    let key = Uuid::new_v4();
    let input = json!({"client_request_id":key,"patient_id":patient,"clinic_id":clinic,"service_id":typ,"occurrences":occurrences});
    let base = "/api/v2/scheduling/appointment-series";
    let (s, created) = request(&app, &token, Method::POST, base, Some(input.clone())).await;
    assert_eq!(s, StatusCode::OK, "static {}", created["error"]["code"]);
    let id = created["data"]["id"].as_str().unwrap();
    assert_eq!(created["data"]["appointments"].as_array().unwrap().len(), 2);
    let before:Value=sqlx::query_scalar("SELECT jsonb_agg(jsonb_build_array(id,starts_at,ends_at,status,appointment_type_id)ORDER BY id) FROM appointments WHERE series_id=$1").bind(id.parse::<Uuid>().unwrap()).fetch_one(&pool).await.unwrap();
    assert_eq!(
        request(
            &app,
            &token,
            Method::POST,
            &format!("/api/v2/scheduling/services/{typ}/retire"),
            Some(json!({"client_request_id":Uuid::new_v4(),"expected_version":1}))
        )
        .await
        .0,
        StatusCode::OK
    );
    let after:Value=sqlx::query_scalar("SELECT jsonb_agg(jsonb_build_array(id,starts_at,ends_at,status,appointment_type_id)ORDER BY id) FROM appointments WHERE series_id=$1").bind(id.parse::<Uuid>().unwrap()).fetch_one(&pool).await.unwrap();
    assert_eq!(before, after);
    let (s, replay) = request(&app, &token, Method::POST, base, Some(input.clone())).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(replay["data"], created["data"]);
    let count_before: i64 =
        sqlx::query_scalar("SELECT count(*) FROM appointment_series WHERE facility_id=$1")
            .bind(f)
            .fetch_one(&pool)
            .await
            .unwrap();
    let mut fresh = input.clone();
    fresh["client_request_id"] = json!(Uuid::new_v4());
    let (s, b) = request(&app, &token, Method::POST, base, Some(fresh.clone())).await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(
        b["error"]["code"],
        "appointment_series_references_unavailable"
    );
    let foreign = Uuid::new_v4();
    let foreign_type = Uuid::new_v4();
    sqlx::query("INSERT INTO facilities(id,code,name,deployment_profile)VALUES($1,'SYNTH23SERIESFOREIGN','Synthetic foreign series facility','hospital')").bind(foreign).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO appointment_types(id,facility_id,code,name,default_duration_minutes)VALUES($1,$2,'SYNTH23SERIESFOREIGN','Synthetic foreign series type',30)").bind(foreign_type).bind(foreign).execute(&pool).await.unwrap();
    fresh["client_request_id"] = json!(Uuid::new_v4());
    fresh["service_id"] = json!(foreign_type);
    let (s, b) = request(&app, &token, Method::POST, base, Some(fresh)).await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(
        b["error"]["code"],
        "appointment_series_references_unavailable"
    );
    let count_after: i64 =
        sqlx::query_scalar("SELECT count(*) FROM appointment_series WHERE facility_id=$1")
            .bind(f)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count_before, count_after);
    let (s, current) = request(&app, &token, Method::GET, &format!("{base}/{id}"), None).await;
    assert_eq!(s, StatusCode::OK);
    let snapshot = current["data"]["snapshot_token"].as_str().unwrap();
    let(s,b)=request(&app,&token,Method::POST,&format!("{base}/{id}/cancel-future"),Some(json!({"client_request_id":Uuid::new_v4(),"expected_snapshot_token":snapshot,"reason":"Synthetic explicit retained-care closure"}))).await;
    assert_eq!(s, StatusCode::OK, "static {}", b["error"]["code"]);
    let cancelled:i64=sqlx::query_scalar("SELECT count(*) FROM appointments WHERE series_id=$1 AND status='cancelled' AND appointment_type_id=$2").bind(id.parse::<Uuid>().unwrap()).bind(typ).fetch_one(&pool).await.unwrap();
    assert_eq!(cancelled, 2);
}
