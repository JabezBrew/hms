use super::*;
#[tokio::test]
async fn administration_pages_are_bounded_scoped_literal_and_one_query_at_one_or_five_hundred_rows()
{
    let (app, token) = setup().await;
    let pool = app.db_pool().await;
    let f = app.state().facility_id();
    let mut counts = Vec::new();
    for total in [1, 500] {
        sqlx::query("INSERT INTO appointment_types(id,facility_id,code,name,default_duration_minutes,is_active,created_at,updated_at) SELECT gen_random_uuid(),$1,'SYNTH23PAGE'||g,'Synthetic literal%_ service '||g,30,g%2=0,'2030-01-01'::timestamptz,'2030-01-01'::timestamptz FROM generate_series($2::int,$3::int)g").bind(f).bind(if total==1{1}else{2}).bind(total).execute(&pool).await.unwrap();
        let (rows, count) =
            hms_observability::with_request_query_counter(hms_db::appointment_types::list(
                &pool,
                f,
                None,
                26,
                hms_domain::appointment_types::AppointmentTypeAdministrationQuery {
                    cursor: None,
                    limit: None,
                    search: Some("literal%_".into()),
                    is_active: None,
                },
            ))
            .await;
        assert_eq!(rows.unwrap().len(), if total == 1 { 1 } else { 26 });
        counts.push(count);
    }
    assert_eq!(counts, [1, 1]);
    let mut path =
        "/api/v2/scheduling/services/administration?limit=25&search=literal%25_".to_owned();
    let mut seen = std::collections::BTreeSet::new();
    let mut pages = 0;
    loop {
        let (s, b) = request(&app, &token, Method::GET, &path, None).await;
        assert_eq!(s, StatusCode::OK);
        let rows = b["data"].as_array().unwrap();
        assert!(rows.len() <= 25);
        assert_eq!(b["page"]["limit"], 25);
        for row in rows {
            assert!(row["name"].as_str().unwrap().contains("literal%_"));
            assert!(
                seen.insert(row["id"].as_str().unwrap().to_owned()),
                "cursor must not repeat same-timestamp IDs"
            );
        }
        pages += 1;
        if !b["page"]["has_next"].as_bool().unwrap() {
            break;
        }
        let cursor = b["page"]["next_cursor"].as_str().unwrap();
        path=format!("/api/v2/scheduling/services/administration?limit=25&search=literal%25_&cursor={cursor}");
    }
    assert_eq!(seen.len(), 500);
    assert_eq!(pages, 20);
    for (active, count) in [("true", 250), ("false", 250)] {
        let(s,b)=request(&app,&token,Method::GET,&format!("/api/v2/scheduling/services/administration?limit=100&search=literal%25_&is_active={active}"),None).await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(b["data"].as_array().unwrap().len(), 100);
        assert!(b["data"]
            .as_array()
            .unwrap()
            .iter()
            .all(|v| v["is_active"] == (active == "true")));
        let actual:i64=sqlx::query_scalar("SELECT count(*) FROM appointment_types WHERE facility_id=$1 AND code LIKE 'SYNTH23PAGE%' AND is_active=$2").bind(f).bind(active=="true").fetch_one(&pool).await.unwrap();
        assert_eq!(actual, count);
    }
    let (s, b) = request(
        &app,
        &token,
        Method::GET,
        "/api/v2/scheduling/services/administration?search=literal%25X",
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert!(
        b["data"].as_array().unwrap().is_empty(),
        "literal SQL wildcards must remain escaped"
    );
    let foreign = Uuid::new_v4();
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO facilities(id,code,name,deployment_profile)VALUES($1,'SYNTH23PAGEFOREIGN','Synthetic other facility','hospital')").bind(foreign).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO appointment_types(id,facility_id,code,name,default_duration_minutes)VALUES($1,$2,'SYNTH23PAGEFOREIGN','Synthetic literal%_ foreign',30)").bind(id).bind(foreign).execute(&pool).await.unwrap();
    assert_eq!(
        request(
            &app,
            &token,
            Method::GET,
            &format!("/api/v2/scheduling/services/{id}/administration"),
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let before = effects(&app).await;
    assert_eq!(request(&app,&token,Method::POST,&format!("/api/v2/scheduling/services/{id}/metadata"),Some(json!({"client_request_id":Uuid::new_v4(),"expected_version":1,"name":"Synthetic refused foreign","default_duration_minutes":40}))).await.0,StatusCode::NOT_FOUND);
    assert_eq!(effects(&app).await, before);
    println!("type23 actual administration list observed query counts at1/500={counts:?}; exact20 cursorpages/500 unique syntheticrows; no crossfacility detail/write");
}
