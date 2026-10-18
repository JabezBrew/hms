use super::*;
use crate::test_support::TestDb;
use std::collections::BTreeSet;

fn indexes(value: &serde_json::Value, out: &mut BTreeSet<String>) {
    if let Some(name) = value.get("Index Name").and_then(serde_json::Value::as_str) {
        out.insert(name.to_owned());
    }
    if let Some(object) = value.as_object() {
        for child in object.values() {
            indexes(child, out);
        }
    }
    if let Some(array) = value.as_array() {
        for child in array {
            indexes(child, out);
        }
    }
}

#[tokio::test]
async fn all_three_reference_branches_use_indexes_in_one_actual_query_at_cardinality() {
    let db = TestDb::hospital().await.unwrap();
    let pool = db.pool();
    let f = db.facility_id();
    let owner = db.owner_user_id();
    let root = Uuid::from_u128(crate::provision::DEFAULT_ORG_UNIT_CLINICAL_ID);
    let target = Uuid::new_v4();
    sqlx::query("INSERT INTO organization_units(id,facility_id,code,name,unit_type) VALUES($1,$2,'ORG20_PLAN_TARGET','Synthetic plan target','department')").bind(target).bind(f).execute(pool).await.unwrap();
    sqlx::query("INSERT INTO organization_units(id,facility_id,parent_unit_id,code,name,unit_type,is_active) SELECT gen_random_uuid(),$1,$2,'ORG20_PLAN_CHILD_'||g,'Synthetic plan child','service',false FROM generate_series(1,10000) g").bind(f).bind(root).execute(pool).await.unwrap();
    sqlx::query("INSERT INTO positions(id,facility_id,org_unit_id,code,title,status) SELECT gen_random_uuid(),$1,$2,'ORG20_PLAN_POSITION_'||g,'Synthetic plan position','inactive' FROM generate_series(1,10000) g").bind(f).bind(root).execute(pool).await.unwrap();
    sqlx::query("INSERT INTO permission_assignments(id,facility_id,grantee_user_id,permission_code,scope_type,scope_id,granted_by_user_id,status) SELECT gen_random_uuid(),$1,$2,'auth.me.view','organization_unit',$3,$2,'revoked' FROM generate_series(1,10000)").bind(f).bind(owner).bind(root).execute(pool).await.unwrap();
    sqlx::raw_sql("ANALYZE organization_units; ANALYZE positions; ANALYZE permission_assignments;")
        .execute(pool)
        .await
        .unwrap();
    let (result, count) = hms_observability::with_request_query_counter(async {
        hms_observability::observe_db_query(
            "admin.organization_unit.blockers",
            sqlx::query_as::<_, (bool, bool, bool)>(BLOCKERS_SQL)
                .bind(target)
                .fetch_one(pool),
        )
        .await
        .unwrap()
    })
    .await;
    assert_eq!(result, (false, false, false));
    assert_eq!(count, 1);
    let plan: serde_json::Value = sqlx::query_scalar(&format!(
        "EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) {BLOCKERS_SQL}"
    ))
    .bind(target)
    .fetch_one(pool)
    .await
    .unwrap();
    let mut used = BTreeSet::new();
    indexes(&plan, &mut used);
    for required in [
        "organization_children_reference_idx",
        "organization_positions_reference_idx",
        "organization_permission_scope_reference_idx",
    ] {
        assert!(
            used.contains(required),
            "actual production branch uses its intended index: {required}"
        );
    }
    println!("organization20 cardinality reference query: fixture_rows_per_branch=10000, observed_query_count={}, all_three_indexed=true",count);
}
