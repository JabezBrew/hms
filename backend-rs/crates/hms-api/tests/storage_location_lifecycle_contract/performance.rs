use super::*;
fn indexes(v: &Value, out: &mut std::collections::BTreeSet<String>) {
    if let Some(n) = v.get("Index Name").and_then(Value::as_str) {
        out.insert(n.to_owned());
    }
    if let Some(o) = v.as_object() {
        for c in o.values() {
            indexes(c, out);
        }
    }
    if let Some(a) = v.as_array() {
        for c in a {
            indexes(c, out);
        }
    }
}
#[tokio::test]
async fn operational_history_is_one_actual_query_and_all_thirteen_edges_use_direct_indexes_at_cardinality(
) {
    let (app, token) = setup().await;
    let pool = app.db_pool().await;
    let filler = location_id(&create(&app, &token, "SYNTH21_PLAN_FILLER").await);
    let target = location_id(&create(&app, &token, "SYNTH21_PLAN_TARGET").await);
    for (edge, (table, _)) in super::references::EDGES.iter().enumerate() {
        let seed = super::references::publish(&app, filler, edge)
            .await
            .unwrap();
        let extra = if edge == 10 {
            ",'source_kind','scheduled_window','coverage_start',t.coverage_start+g*interval '2 days','coverage_end',t.coverage_end+g*interval '2 days'"
        } else {
            ""
        };
        let sql=format!("INSERT INTO {table} SELECT(jsonb_populate_record(NULL::{table},to_jsonb(t)||jsonb_build_object('id',gen_random_uuid(){extra}))).* FROM {table} t CROSS JOIN generate_series(1,3000)g WHERE t.id=$1");
        sqlx::query(&sql).bind(seed).execute(&pool).await.unwrap();
        sqlx::raw_sql(&format!("ANALYZE {table}"))
            .execute(&pool)
            .await
            .unwrap();
    }
    // Exact production function call is counted; its installed SELECT is explained
    // separately because PostgreSQL does not expose nested scalar-function plans.
    let (used, count) = hms_observability::with_request_query_counter(async {
        hms_observability::observe_db_query(
            "inventory.location.operational_history",
            sqlx::query_scalar::<_, bool>("SELECT storage_location_has_operational_history($1)")
                .bind(target)
                .fetch_one(&pool),
        )
        .await
        .unwrap()
    })
    .await;
    assert!(!used);
    assert_eq!(count, 1);
    let body:String=sqlx::query_scalar("SELECT prosrc FROM pg_proc WHERE oid='storage_location_has_operational_history(uuid)'::regprocedure").fetch_one(&pool).await.unwrap();
    let query = body.trim().trim_end_matches(';').replace("target", "$1");
    let plan: Value = sqlx::query_scalar(&format!("EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON){query}"))
        .bind(target)
        .fetch_one(&pool)
        .await
        .unwrap();
    let mut observed = std::collections::BTreeSet::new();
    indexes(&plan, &mut observed);
    for name in [
        "storage_location_batch_location_id_reference_idx",
        "storage_location_movement_location_id_reference_idx",
        "storage_location_transfer_from_location_id_reference_idx",
        "storage_location_transfer_to_location_id_reference_idx",
        "storage_location_requisition_requesting_reference_idx",
        "storage_location_requisition_fulfilling_reference_idx",
        "storage_location_controlled_location_id_reference_idx",
        "storage_location_dispense_location_id_reference_idx",
        "storage_location_standing_requesting_location_id_reference_idx",
        "storage_location_check_location_id_reference_idx",
        "storage_location_fulfillment_dispensing_reference_idx",
        "storage_location_template_requesting_location_id_reference_idx",
        "storage_location_template_fulfilling_location_id_reference_idx",
    ] {
        assert!(
            observed.contains(name),
            "actual installed branch uses direct index: {name}"
        );
    }
    println!("storage21 history projection: observed_query_count={count}; synthetic_rows_per_edge=3000; all13installed_branches_indexed=true");
}
