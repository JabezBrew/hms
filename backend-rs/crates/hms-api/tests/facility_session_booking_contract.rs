mod support;
use support::*;
async fn send(
    app: &TestApp,
    token: &str,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(body.map(|v| v.to_string()).unwrap_or_default()))
                .unwrap(),
        )
        .await
        .unwrap();
    let s = r.status();
    (s, json_body(r).await)
}
#[tokio::test]
async fn canonical_facility_sessions_are_bookable_as_independent_clinic_and_service_sessions_are() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let pool = app.db_pool().await;
    let f = app.state().facility_id();
    let patient:Uuid=sqlx::query_scalar("SELECT id FROM patients WHERE facility_id=$1 AND record_status='registered' AND vital_status<>'deceased' ORDER BY id LIMIT 1").bind(f).fetch_one(&pool).await.unwrap();
    let clinic: Uuid = sqlx::query_scalar(
        "SELECT id FROM clinics WHERE facility_id=$1 AND is_active ORDER BY id LIMIT 1",
    )
    .bind(f)
    .fetch_one(&pool)
    .await
    .unwrap();
    let(s,b)=send(&app,&token,Method::POST,"/api/v2/scheduling/services",Some(json!({"client_request_id":Uuid::new_v4(),"code":"SYNTH23OWNERBASE","name":"Synthetic actual owner baseline","default_duration_minutes":30}))).await;
    assert_eq!(s, StatusCode::OK);
    let typ: Uuid = b["data"]["service"]["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let mut facts = Vec::new();
    for (kind, owner) in [
        ("clinic", Some(clinic)),
        ("service", Some(typ)),
        ("facility", Some(f)),
        ("facility", None),
    ] {
        let mut occurrences = Vec::new();
        let mut ids = Vec::new();
        for day in [2, 3] {
            let at = Utc::now()
                .date_naive()
                .and_hms_opt(9, 0, 0)
                .unwrap()
                .and_utc()
                + Duration::days(day);
            let(s,b)=send(&app,&token,Method::POST,"/api/v2/scheduling/sessions",Some(json!({"clinic_id":clinic,"owner_type":kind,"owner_id":owner,"name":"Synthetic exact owner baseline session","mode":"capacity_block","starts_at":at,"ends_at":at+Duration::hours(1),"capacity":4,"allowed_service_ids":[typ]}))).await;
            assert_eq!(
                s,
                StatusCode::OK,
                "canonical publisher positive: {}",
                b["error"]["code"]
            );
            ids.push(b["data"]["id"].as_str().unwrap().parse::<Uuid>().unwrap());
            occurrences.push(json!({"session_id":b["data"]["id"],"starts_at":at,"ends_at":at+Duration::hours(1)}));
        }
        let date = Utc::now().date_naive() + Duration::days(2);
        let last = Utc::now().date_naive() + Duration::days(3);
        let(s,b)=send(&app,&token,Method::GET,&format!("/api/v2/scheduling/availability?start_date={date}&end_date={last}&clinic_id={clinic}&service_id={typ}&limit=100"),None).await;
        assert_eq!(s, StatusCode::OK);
        assert!(
            ids.iter().all(|id| b["data"]["slots"]
                .as_array()
                .unwrap()
                .iter()
                .any(|slot| slot["session_id"] == id.to_string())),
            "all published sources must actually be offered"
        );
        let first = &occurrences[0];
        let(book,b)=send(&app,&token,Method::POST,"/api/v2/appointments",Some(json!({"patient_id":patient,"clinic_id":clinic,"clinic_session_id":first["session_id"],"appointment_type_id":typ,"starts_at":first["starts_at"],"ends_at":first["ends_at"]}))).await;
        let book_code = b["error"]["code"].as_str().unwrap_or("none").to_owned();
        let(series,b)=send(&app,&token,Method::POST,"/api/v2/scheduling/appointment-series",Some(json!({"client_request_id":Uuid::new_v4(),"patient_id":patient,"clinic_id":clinic,"service_id":typ,"occurrences":occurrences}))).await;
        let series_code = b["error"]["code"].as_str().unwrap_or("none").to_owned();
        facts.push((kind, book.as_u16(), series.as_u16(), book_code, series_code));
    }
    println!("facility23 actual corrected canonical sources200/availability200, book/series statuses+staticcodes by independent owner={facts:?}");
    assert_eq!(
        (facts[0].1, facts[0].2, facts[1].1, facts[1].2),
        (200, 200, 200, 200)
    );
    for fact in facts {
        assert_eq!((fact.1,fact.2),(200,200),"actual offered source including Facility(None) must decode and book through both canonical seams");
    }
}

#[tokio::test]
async fn facility_bookings_preserve_scope_capacity_type_proof_and_retained_care_after_retirement() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let pool = app.db_pool().await;
    let f = app.state().facility_id();
    let patient:Uuid=sqlx::query_scalar("SELECT id FROM patients WHERE facility_id=$1 AND record_status='registered' AND vital_status<>'deceased' ORDER BY id LIMIT 1").bind(f).fetch_one(&pool).await.unwrap();
    let clinic: Uuid = sqlx::query_scalar(
        "SELECT id FROM clinics WHERE facility_id=$1 AND is_active ORDER BY id LIMIT 1",
    )
    .bind(f)
    .fetch_one(&pool)
    .await
    .unwrap();
    let(s,b)=send(&app,&token,Method::POST,"/api/v2/scheduling/services",Some(json!({"client_request_id":Uuid::new_v4(),"code":"SYNTH23FACILITYGUARDS","name":"Synthetic facility-care service","default_duration_minutes":30}))).await;
    assert_eq!(s, StatusCode::OK);
    let typ: Uuid = b["data"]["service"]["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let start = Utc::now()
        .date_naive()
        .and_hms_opt(9, 0, 0)
        .unwrap()
        .and_utc()
        + Duration::days(4);
    let end = start + Duration::hours(3);
    let body = json!({"clinic_id":clinic,"owner_type":"facility","owner_id":f,"name":"Synthetic retained facility-care source","mode":"capacity_block","starts_at":start,"ends_at":end,"capacity":3,"allowed_service_ids":[typ]});
    let before: i64 =
        sqlx::query_scalar("SELECT count(*) FROM clinic_sessions WHERE facility_id=$1")
            .bind(f)
            .fetch_one(&pool)
            .await
            .unwrap();
    let mut wrong = body.clone();
    wrong["owner_id"] = json!(Uuid::new_v4());
    let (s, b) = send(
        &app,
        &token,
        Method::POST,
        "/api/v2/scheduling/sessions",
        Some(wrong),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert_eq!(b["error"]["code"], "invalid_session_owner");
    let after: i64 =
        sqlx::query_scalar("SELECT count(*) FROM clinic_sessions WHERE facility_id=$1")
            .bind(f)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(before, after);
    let foreign = Uuid::new_v4();
    sqlx::query("INSERT INTO facilities(id,code,name,deployment_profile)VALUES($1,'SYNTH23FACILITYFOREIGN','Synthetic foreign scope','hospital')").bind(foreign).execute(&pool).await.unwrap();
    let mut other = Vec::new();
    for day in [8, 9] {
        let id = Uuid::new_v4();
        let at = start + Duration::days(day);
        sqlx::query("INSERT INTO clinic_sessions(id,facility_id,owner_type,owner_id,name,mode,starts_at,ends_at,capacity)VALUES($1,$2,'facility',$2,'Synthetic foreign source','capacity_block',$3,$4,4)").bind(id).bind(foreign).bind(at).bind(at+Duration::hours(1)).execute(&pool).await.unwrap();
        other.push(json!({"session_id":id,"starts_at":at,"ends_at":at+Duration::hours(1)}));
    }
    let counts_before:(i64,i64)=sqlx::query_as("SELECT(SELECT count(*) FROM appointments WHERE facility_id=$1),(SELECT count(*) FROM appointment_series WHERE facility_id=$1)").bind(f).fetch_one(&pool).await.unwrap();
    let o = &other[0];
    assert_eq!(send(&app,&token,Method::POST,"/api/v2/appointments",Some(json!({"patient_id":patient,"clinic_id":clinic,"clinic_session_id":o["session_id"],"appointment_type_id":typ,"starts_at":o["starts_at"],"ends_at":o["ends_at"]}))).await.0,StatusCode::CONFLICT);
    assert_eq!(send(&app,&token,Method::POST,"/api/v2/scheduling/appointment-series",Some(json!({"client_request_id":Uuid::new_v4(),"patient_id":patient,"clinic_id":clinic,"service_id":typ,"occurrences":other}))).await.0,StatusCode::CONFLICT);
    let counts_after:(i64,i64)=sqlx::query_as("SELECT(SELECT count(*) FROM appointments WHERE facility_id=$1),(SELECT count(*) FROM appointment_series WHERE facility_id=$1)").bind(f).fetch_one(&pool).await.unwrap();
    assert_eq!(counts_before, counts_after);
    let (s, b) = send(
        &app,
        &token,
        Method::POST,
        "/api/v2/scheduling/sessions",
        Some(body),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let session: Uuid = b["data"]["id"].as_str().unwrap().parse().unwrap();
    let mut ids = Vec::new();
    for minute in [0, 20, 40] {
        let at = start + Duration::minutes(minute);
        let(s,b)=send(&app,&token,Method::POST,"/api/v2/appointments",Some(json!({"patient_id":patient,"clinic_id":clinic,"clinic_session_id":session,"appointment_type_id":typ,"starts_at":at,"ends_at":at+Duration::minutes(15)}))).await;
        assert_eq!(s, StatusCode::OK);
        ids.push(b["data"]["id"].as_str().unwrap().parse::<Uuid>().unwrap());
    }
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM appointments WHERE clinic_session_id=$1")
            .bind(session)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, 3);
    assert_eq!(send(&app,&token,Method::POST,"/api/v2/appointments",Some(json!({"patient_id":patient,"clinic_id":clinic,"clinic_session_id":session,"appointment_type_id":typ,"starts_at":start+Duration::minutes(60),"ends_at":start+Duration::minutes(75)}))).await.0,StatusCode::CONFLICT);
    let before:Value=sqlx::query_scalar("SELECT jsonb_agg(jsonb_build_array(id,starts_at,ends_at,status,clinic_session_id,appointment_type_id)ORDER BY id)FROM appointments WHERE clinic_session_id=$1").bind(session).fetch_one(&pool).await.unwrap();
    assert_eq!(
        send(
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
    let after:Value=sqlx::query_scalar("SELECT jsonb_agg(jsonb_build_array(id,starts_at,ends_at,status,clinic_session_id,appointment_type_id)ORDER BY id)FROM appointments WHERE clinic_session_id=$1").bind(session).fetch_one(&pool).await.unwrap();
    assert_eq!(before, after);
    assert_eq!(
        send(
            &app,
            &token,
            Method::POST,
            &format!("/api/v2/appointments/{}/cancel", ids[2]),
            Some(json!({"reason":"Synthetic explicit existing Facility care closure"}))
        )
        .await
        .0,
        StatusCode::OK
    );
    // Free capacity first, so the next two refusals prove exact type/constraint
    // policy independently of the already-tested full-capacity refusal.
    let(s,b)=send(&app,&token,Method::POST,"/api/v2/scheduling/services",Some(json!({"client_request_id":Uuid::new_v4(),"code":"SYNTH23FACILITYOTHER","name":"Synthetic independent active type","default_duration_minutes":30}))).await;
    assert_eq!(s, StatusCode::OK);
    let other = b["data"]["service"]["id"].as_str().unwrap();
    assert_eq!(send(&app,&token,Method::POST,"/api/v2/appointments",Some(json!({"patient_id":patient,"clinic_id":clinic,"clinic_session_id":session,"appointment_type_id":other,"starts_at":start+Duration::minutes(80),"ends_at":start+Duration::minutes(95)}))).await.0,StatusCode::CONFLICT);

    assert_eq!(send(&app,&token,Method::POST,"/api/v2/appointments",Some(json!({"patient_id":patient,"clinic_id":clinic,"clinic_session_id":session,"appointment_type_id":typ,"starts_at":start+Duration::minutes(80),"ends_at":start+Duration::minutes(95)}))).await.0,StatusCode::CONFLICT);
    assert_eq!(send(&app,&token,Method::PATCH,&format!("/api/v2/appointments/{}",ids[0]),Some(json!({"starts_at":start+Duration::minutes(100),"ends_at":start+Duration::minutes(115)}))).await.0,StatusCode::OK);
    assert_eq!(
        send(
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
    let facts:(i64,i64,i64,i64)=sqlx::query_as("SELECT count(*)FILTER(WHERE status='scheduled'),count(*)FILTER(WHERE status='checked_in'),count(*)FILTER(WHERE status='cancelled'),count(*)FILTER(WHERE appointment_type_id=$2)FROM appointments WHERE clinic_session_id=$1").bind(session).bind(typ).fetch_one(&pool).await.unwrap();
    assert_eq!(facts, (1, 1, 1, 3));
    let exact:bool=sqlx::query_scalar("SELECT count(*)=1 AND bool_and(appointment_type_id=$2) FROM clinic_session_appointment_types WHERE clinic_session_id=$1").bind(session).bind(typ).fetch_one(&pool).await.unwrap();
    assert!(
        exact,
        "retirement never prunes allowed identity constraints"
    );
}

#[tokio::test]
async fn pre029_mismatched_facility_owner_refuses_new_booking_and_series_but_preserves_old_care() {
    let database = Arc::new(hms_db::test_support::TestDatabase::create().unwrap());
    let pool = hms_db::connect(database.database_url()).await.unwrap();
    let historical = sqlx::migrate::Migrator {
        migrations: std::borrow::Cow::Owned(
            hms_db::migrate::MIGRATOR
                .iter()
                .filter(|m| m.version < 202610180029)
                .cloned()
                .collect(),
        ),
        ..sqlx::migrate::Migrator::DEFAULT
    };
    historical.run(&pool).await.unwrap();
    let baseline = hms_db::provision::BaselineProvisioning::hms_local(DeploymentProfile::Hospital);
    hms_db::provision::provision_baseline(&pool, &baseline)
        .await
        .unwrap();
    let f = baseline.facility_id;
    let foreign = Uuid::new_v4();
    sqlx::query("INSERT INTO facilities(id,code,name,deployment_profile)VALUES($1,'SYNTH23LEGACYOWNER','Synthetic foreign owner facility','hospital')").bind(foreign).execute(&pool).await.unwrap();
    let patient:Uuid=sqlx::query_scalar("SELECT id FROM patients WHERE facility_id=$1 AND record_status='registered' AND vital_status<>'deceased' LIMIT 1").bind(f).fetch_one(&pool).await.unwrap();
    let clinic: Uuid =
        sqlx::query_scalar("SELECT id FROM clinics WHERE facility_id=$1 AND is_active LIMIT 1")
            .bind(f)
            .fetch_one(&pool)
            .await
            .unwrap();
    let typ: Uuid = sqlx::query_scalar(
        "SELECT id FROM appointment_types WHERE facility_id=$1 AND is_active LIMIT 1",
    )
    .bind(f)
    .fetch_one(&pool)
    .await
    .unwrap();
    let actor: Uuid =
        sqlx::query_scalar("SELECT id FROM users WHERE facility_id=$1 AND email='owner@hms.local'")
            .bind(f)
            .fetch_one(&pool)
            .await
            .unwrap();
    let at = Utc::now()
        .date_naive()
        .and_hms_opt(9, 0, 0)
        .unwrap()
        .and_utc()
        + Duration::days(8);
    let mut fixtures = Vec::new();
    for (kind, owner) in [
        ("foreign", Some(foreign)),
        ("current", Some(f)),
        ("none", None),
    ] {
        let mut occurrences = Vec::new();
        let mut first = Uuid::nil();
        for day in [0, 1] {
            let id = Uuid::new_v4();
            let start = at + Duration::days(day);
            sqlx::query("INSERT INTO clinic_sessions(id,facility_id,clinic_id,owner_type,owner_id,name,mode,starts_at,ends_at,capacity)VALUES($1,$2,$3,'facility',$4,'Synthetic retained Facility owner','capacity_block',$5,$6,10)").bind(id).bind(f).bind(clinic).bind(owner).bind(start).bind(start+Duration::hours(3)).execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO clinic_session_appointment_types(facility_id,clinic_session_id,appointment_type_id)VALUES($1,$2,$3)").bind(f).bind(id).bind(typ).execute(&pool).await.unwrap();
            occurrences.push(
                json!({"session_id":id,"starts_at":start,"ends_at":start+Duration::hours(3)}),
            );
            if day == 0 {
                first = id;
            }
        }
        let old = Uuid::new_v4();
        sqlx::query("INSERT INTO appointments(id,facility_id,patient_id,clinic_id,clinic_session_id,appointment_type_id,starts_at,ends_at,status,created_by_user_id)VALUES($1,$2,$3,$4,$5,$6,$7,$8,'scheduled',$9)").bind(old).bind(f).bind(patient).bind(clinic).bind(first).bind(typ).bind(at).bind(at+Duration::minutes(15)).bind(actor).execute(&pool).await.unwrap();
        fixtures.push((kind, first, old, occurrences));
    }
    hms_db::migrate::run(&pool).await.unwrap();
    let mut config = Config::for_tests_with_database_url(database.database_url().to_owned());
    config.auto_migrate = false;
    let app = app_with_config(config, database).await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let mut facts = Vec::new();
    for (kind, session, old, occurrences) in fixtures {
        let before:(i64,i64)=sqlx::query_as("SELECT(SELECT count(*) FROM appointments WHERE clinic_session_id=$1),(SELECT count(*) FROM appointment_series WHERE facility_id=$2)").bind(session).bind(f).fetch_one(&pool).await.unwrap();
        let (book,b)=send(&app,&token,Method::POST,"/api/v2/appointments",Some(json!({"patient_id":patient,"clinic_id":clinic,"clinic_session_id":session,"appointment_type_id":typ,"starts_at":at+Duration::minutes(30),"ends_at":at+Duration::minutes(45)}))).await;
        let book_code = b["error"]["code"].as_str().unwrap_or("none").to_string();
        let (series,b)=send(&app,&token,Method::POST,"/api/v2/scheduling/appointment-series",Some(json!({"client_request_id":Uuid::new_v4(),"patient_id":patient,"clinic_id":clinic,"service_id":typ,"occurrences":occurrences}))).await;
        let series_code = b["error"]["code"].as_str().unwrap_or("none").to_string();
        let after:(i64,i64)=sqlx::query_as("SELECT(SELECT count(*) FROM appointments WHERE clinic_session_id=$1),(SELECT count(*) FROM appointment_series WHERE facility_id=$2)").bind(session).bind(f).fetch_one(&pool).await.unwrap();
        let raw_new=sqlx::query("INSERT INTO appointments(id,facility_id,patient_id,clinic_id,clinic_session_id,appointment_type_id,starts_at,ends_at,status,created_by_user_id)VALUES($1,$2,$3,$4,$5,$6,$7,$8,'scheduled',$9)").bind(Uuid::new_v4()).bind(f).bind(patient).bind(clinic).bind(session).bind(typ).bind(at+Duration::hours(2)).bind(at+Duration::hours(2)+Duration::minutes(15)).bind(actor).execute(&pool).await.is_ok();
        let reschedule=send(&app,&token,Method::PATCH,&format!("/api/v2/appointments/{old}"),Some(json!({"starts_at":at+Duration::hours(1),"ends_at":at+Duration::hours(1)+Duration::minutes(15)}))).await.0;
        let cancel = send(
            &app,
            &token,
            Method::POST,
            &format!("/api/v2/appointments/{old}/cancel"),
            Some(json!({"reason":"Synthetic unchanged legacy Facility care closure"})),
        )
        .await
        .0;
        let exact:bool=sqlx::query_scalar("SELECT clinic_session_id=$2 AND appointment_type_id=$3 AND status='cancelled' FROM appointments WHERE id=$1").bind(old).bind(session).bind(typ).fetch_one(&pool).await.unwrap();
        facts.push((
            kind,
            book.as_u16(),
            series.as_u16(),
            book_code,
            series_code,
            after.0 - before.0,
            after.1 - before.1,
            reschedule.as_u16(),
            cancel.as_u16(),
            exact,
            raw_new,
        ));
    }
    println!("facility23 honest028 actualHTTP newbook/series/staticcodes/deltas/oldreschedule/cancel/exact/rawnew facts={facts:?}");
    assert_eq!(
        (
            facts[0].1,
            facts[0].2,
            facts[0].5,
            facts[0].6,
            facts[0].7,
            facts[0].8,
            facts[0].9,
            facts[0].10
        ),
        (409, 409, 0, 0, 200, 200, true, false)
    );
    for fact in &facts[1..] {
        assert_eq!(
            (fact.1, fact.2, fact.5, fact.6, fact.7, fact.8, fact.9, fact.10),
            (200, 200, 2, 1, 200, 200, true, true)
        );
    }
}
