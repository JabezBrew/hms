use super::*;
async fn counted_request(
    app: &TestApp,
    token: &str,
    uri: &str,
    body: Value,
) -> ((StatusCode, Value), u64) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(uri)
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let count = response
        .extensions()
        .get::<hms_observability::RequestMetricsSnapshot>()
        .expect("real production telemetry retains its internal request recorder")
        .db_query_count;
    assert!(
        count > 0,
        "actual HTTP snapshot must observe the instrumented DB queries"
    );
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    ((status, serde_json::from_slice(&bytes).unwrap()), count)
}

fn payload(app: &TestApp, template: bool, allowed: &[Uuid]) -> Value {
    let at = Utc::now() + Duration::days(4);
    if template {
        json!({"owner_type":"facility","owner_id":app.state().facility_id(),"name":"Synthetic exact bulk template","mode":"capacity_block","weekdays":[1,2,3,4,5,6,7],"starts_on":at.date_naive(),"start_time":"08:00:00","end_time":"12:00:00","capacity":4,"allowed_service_ids":allowed})
    } else {
        json!({"owner_type":"facility","owner_id":app.state().facility_id(),"name":"Synthetic exact bulk session","mode":"capacity_block","starts_at":at,"ends_at":at+Duration::hours(2),"capacity":4,"allowed_service_ids":allowed})
    }
}
fn path(template: bool) -> &'static str {
    if template {
        "/api/v2/scheduling/templates"
    } else {
        "/api/v2/scheduling/sessions"
    }
}
async fn memberships(app: &TestApp, template: bool, id: Uuid) -> Vec<Uuid> {
    let sql = if template {
        "SELECT appointment_type_id FROM clinic_session_template_appointment_types WHERE clinic_session_template_id=$1 ORDER BY appointment_type_id"
    } else {
        "SELECT appointment_type_id FROM clinic_session_appointment_types WHERE clinic_session_id=$1 ORDER BY appointment_type_id"
    };
    sqlx::query_scalar(sql)
        .bind(id)
        .fetch_all(&app.db_pool().await)
        .await
        .unwrap()
}
async fn local_ids(app: &TestApp) -> Vec<Uuid> {
    let pool = app.db_pool().await;
    sqlx::query("INSERT INTO appointment_types(id,facility_id,code,name,default_duration_minutes)SELECT gen_random_uuid(),$1,'SYNTH23BULK'||g,'Synthetic exact bulk type',30 FROM generate_series(1,500)g").bind(app.state().facility_id()).execute(&pool).await.unwrap();
    sqlx::query_scalar("SELECT id FROM appointment_types WHERE facility_id=$1 AND code LIKE 'SYNTH23BULK%' ORDER BY id").bind(app.state().facility_id()).fetch_all(&pool).await.unwrap()
}
#[tokio::test]
async fn both_publishers_use_constant_observed_round_trips_and_keep_every_exact_allowed_identity() {
    let (app, token) = setup().await;
    let ids = local_ids(&app).await;
    let mut facts = Vec::new();
    for template in [false, true] {
        // Warm ordinary access resolution before measuring the same actual HTTP seam.
        let (s, b) = request(
            &app,
            &token,
            Method::POST,
            path(template),
            Some(payload(&app, template, &[])),
        )
        .await;
        assert_eq!(s, StatusCode::OK);
        let empty: Uuid = b["data"]["id"].as_str().unwrap().parse().unwrap();
        assert!(memberships(&app, template, empty).await.is_empty());
        let mut counts = Vec::new();
        for allowed in [
            ids[..1].to_vec(),
            ids.clone(),
            ids.iter().chain(ids.iter()).copied().collect(),
        ] {
            let ((s, b), count) = counted_request(
                &app,
                &token,
                path(template),
                payload(&app, template, &allowed),
            )
            .await;
            assert_eq!(s, StatusCode::OK, "static {}", b["error"]["code"]);
            let id: Uuid = b["data"]["id"].as_str().unwrap().parse().unwrap();
            let mut exact = allowed;
            exact.sort();
            exact.dedup();
            assert_eq!(
                memberships(&app, template, id).await,
                exact,
                "never silently drop/prune an allowed identity"
            );
            counts.push(count);
        }
        facts.push(counts);
    }
    println!("type23 actual session/template observed round trips at1/500/1000duplicates={facts:?}; exact fullsets and explicitempty positives passed");
    for counts in facts {
        assert_eq!(
            counts[0], counts[1],
            "one vs500 exact identities must use constant database round trips"
        );
        assert_eq!(
            counts[1], counts[2],
            "accepted duplicate identities must not increase query round trips"
        );
    }
}
async fn source_effects(app: &TestApp) -> Value {
    sqlx::query_scalar("SELECT jsonb_build_array((SELECT count(*) FROM clinic_sessions WHERE facility_id=$1),(SELECT count(*) FROM clinic_session_templates WHERE facility_id=$1),(SELECT count(*) FROM clinic_session_appointment_types WHERE facility_id=$1),(SELECT count(*) FROM clinic_session_template_appointment_types WHERE facility_id=$1))").bind(app.state().facility_id()).fetch_one(&app.db_pool().await).await.unwrap()
}
#[tokio::test]
async fn unavailable_member_among_valid_ids_keeps_original_errors_and_rolls_back_entire_source() {
    let (app, token) = setup().await;
    let pool = app.db_pool().await;
    let ids = local_ids(&app).await;
    let f = app.state().facility_id();
    let retired = Uuid::new_v4();
    let foreign_f = Uuid::new_v4();
    let foreign = Uuid::new_v4();
    let missing = Uuid::new_v4();
    sqlx::query("INSERT INTO facilities(id,code,name,deployment_profile)VALUES($1,'SYNTH23BULKFOREIGN','Synthetic other publisher facility','hospital')").bind(foreign_f).execute(&pool).await.unwrap();
    for (id, fac, active, code) in [
        (retired, f, false, "SYNTH23RETIREDMEMBER"),
        (foreign, foreign_f, true, "SYNTH23FOREIGNMEMBER"),
    ] {
        sqlx::query("INSERT INTO appointment_types(id,facility_id,code,name,default_duration_minutes,is_active)VALUES($1,$2,$3,'Synthetic unavailable member',30,$4)").bind(id).bind(fac).bind(code).bind(active).execute(&pool).await.unwrap();
    }
    for template in [false, true] {
        for bad in [retired, foreign, missing] {
            let mut allowed = ids.clone();
            allowed.insert(250, bad);
            let before = source_effects(&app).await;
            let (s, b) = request(
                &app,
                &token,
                Method::POST,
                path(template),
                Some(payload(&app, template, &allowed)),
            )
            .await;
            assert_eq!(s, StatusCode::BAD_REQUEST);
            assert_eq!(b["error"]["code"], "bookable_service_not_found");
            assert_eq!(
                source_effects(&app).await,
                before,
                "invalid membership must never publish parent or valid subset"
            );
        }
        let mut owner = payload(&app, template, &ids[..1]);
        owner["owner_type"] = json!("service");
        owner["owner_id"] = json!(retired);
        let before = source_effects(&app).await;
        let (s, b) = request(&app, &token, Method::POST, path(template), Some(owner)).await;
        assert_eq!(s, StatusCode::BAD_REQUEST);
        assert_eq!(b["error"]["code"], "bookable_service_not_found");
        assert_eq!(source_effects(&app).await, before);
    }
}
