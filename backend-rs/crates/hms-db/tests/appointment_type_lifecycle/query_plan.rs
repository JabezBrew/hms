use super::*;

fn scanned_templates(value: &serde_json::Value) -> u64 {
    match value {
        serde_json::Value::Object(object) => {
            let own = if object.get("Relation Name").and_then(|v| v.as_str())
                == Some("clinic_session_templates")
            {
                let rows = object
                    .get("Actual Rows")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                let filtered = object
                    .get("Rows Removed by Filter")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                (rows + filtered)
                    * object
                        .get("Actual Loops")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(1)
            } else {
                0
            };
            own + object.values().map(scanned_templates).sum::<u64>()
        }
        serde_json::Value::Array(values) => values.iter().map(scanned_templates).sum(),
        _ => 0,
    }
}

#[tokio::test]
async fn exact_retirement_blocker_does_not_scan_unrelated_active_templates() {
    let (_db, pool, baseline, actor) = fixture().await;
    let facility = baseline.facility_id;
    let negative = publication::new_type(&pool, facility, actor).await;
    let positive = publication::new_type(&pool, facility, actor).await;
    sqlx::query("INSERT INTO clinic_session_templates(id,facility_id,owner_type,owner_id,name,mode,weekdays,starts_on,start_time,end_time,capacity)SELECT gen_random_uuid(),$1,'facility',$1,'Synthetic unrelated template','capacity_block',ARRAY[1,2,3,4,5,6,7]::smallint[],CURRENT_DATE,'08:00','12:00',1 FROM generate_series(1,5000)")
        .bind(facility).execute(&pool).await.unwrap();
    hms_db::scheduling::create_bookable_session_template(
        &pool,
        template(facility, actor, Some(positive), vec![]),
    )
    .await
    .unwrap();
    sqlx::raw_sql(
        "ANALYZE clinic_session_templates;ANALYZE clinic_session_template_appointment_types;",
    )
    .execute(&pool)
    .await
    .unwrap();
    let point = Utc::now();
    let yes: bool = sqlx::query_scalar("SELECT appointment_type_has_future_generator($1,$2,$3)")
        .bind(facility)
        .bind(positive)
        .bind(point)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(yes);
    let no: bool = sqlx::query_scalar("SELECT appointment_type_has_future_generator($1,$2,$3)")
        .bind(facility)
        .bind(negative)
        .bind(point)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(!no);
    // Explain the actual committed helper BODY. A bare VOLATILE function call
    // hides its nested plan and cannot establish indexed retirement work.
    let body:String=sqlx::query_scalar("SELECT prosrc FROM pg_proc WHERE oid='appointment_type_has_future_generator(uuid,uuid,timestamptz)'::regprocedure").fetch_one(&pool).await.unwrap();
    let body = body
        .replace("=facility", "=$1::uuid")
        .replace("=target", "=$2::uuid")
        .replace("point AT TIME", "$3::timestamptz AT TIME");
    let plan: serde_json::Value =
        sqlx::query_scalar(&format!("EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) {body}"))
            .bind(facility)
            .bind(negative)
            .bind(point)
            .fetch_one(&pool)
            .await
            .unwrap();
    let scanned = scanned_templates(&plan);
    let positive_plan: serde_json::Value =
        sqlx::query_scalar(&format!("EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) {body}"))
            .bind(facility)
            .bind(positive)
            .bind(point)
            .fetch_one(&pool)
            .await
            .unwrap();
    let positive_scanned = scanned_templates(&positive_plan);
    println!("type23 actual committed helper-body plan: unrelated_templates=5000; positive=true; negative=false; negative_template_rows_examined={scanned}; positive_template_rows_examined={positive_scanned}");
    assert!(
        scanned < 100 && positive_scanned < 100,
        "Exact no-reference retirement must not walk unrelated facility templates"
    );
}
