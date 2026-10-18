use super::*;
pub(super) const EDGES: [(&str, &str); 13] = [
    ("stock_batches", "location_id"),
    ("stock_movements", "location_id"),
    ("stock_transfers", "from_location_id"),
    ("stock_transfers", "to_location_id"),
    ("stock_requisitions", "requesting_location_id"),
    ("stock_requisitions", "fulfilling_location_id"),
    ("controlled_substance_register", "location_id"),
    ("pharmacy_dispenses", "location_id"),
    ("inventory_standing_orders", "requesting_location_id"),
    ("stock_check_queue", "location_id"),
    ("pharmacy_fulfillments", "dispensing_location_id"),
    (
        "inventory_standing_order_templates",
        "requesting_location_id",
    ),
    (
        "inventory_standing_order_templates",
        "fulfilling_location_id",
    ),
];
pub(super) async fn publish(app: &TestApp, target: Uuid, edge: usize) -> Result<Uuid, sqlx::Error> {
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let item: Uuid = sqlx::query_scalar(
        "SELECT id FROM inventory_items WHERE facility_id=$1 AND controlled=$2 LIMIT 1",
    )
    .bind(facility)
    .bind(edge == 6)
    .fetch_one(&pool)
    .await
    .unwrap();
    let other = Uuid::from_u128(hms_db::provision::DEFAULT_PHARMACY_STORE_ID);
    let patient = Uuid::from_u128(hms_db::provision::PATIENT_ONE_ID);
    let mut prefix="WITH f AS(SELECT $1::uuid facility,$2::uuid location,$3::uuid item,$4::uuid other,$5::uuid patient) ".to_owned();
    let sql=match edge{
 0=>"INSERT INTO stock_batches(id,facility_id,item_id,location_id,batch_number,quantity_on_hand)SELECT gen_random_uuid(),facility,item,location,'SYNTHETIC-HISTORY',0 FROM f RETURNING id",
 1=>"INSERT INTO stock_movements(id,facility_id,item_id,location_id,movement_type,quantity,balance_after,reason)SELECT gen_random_uuid(),facility,item,location,'adjustment',0,0,'synthetic history' FROM f RETURNING id",
 2|3=>if edge==2{"INSERT INTO stock_transfers(id,facility_id,item_id,from_location_id,to_location_id,quantity,status)SELECT gen_random_uuid(),facility,item,location,other,1,'completed' FROM f RETURNING id"}else{"INSERT INTO stock_transfers(id,facility_id,item_id,from_location_id,to_location_id,quantity,status)SELECT gen_random_uuid(),facility,item,other,location,1,'completed' FROM f RETURNING id"},
 4|5=>if edge==4{"INSERT INTO stock_requisitions(id,facility_id,requesting_location_id,status)SELECT gen_random_uuid(),facility,location,'cancelled' FROM f RETURNING id"}else{"INSERT INTO stock_requisitions(id,facility_id,requesting_location_id,fulfilling_location_id,status)SELECT gen_random_uuid(),facility,other,location,'cancelled' FROM f RETURNING id"},
 6=>"INSERT INTO controlled_substance_register(id,facility_id,item_id,location_id,movement_type,quantity_delta,balance_after)SELECT gen_random_uuid(),facility,item,location,'count',0,0 FROM f RETURNING id",
 7=>"INSERT INTO pharmacy_dispenses(id,facility_id,patient_id,item_id,location_id,quantity,status)SELECT gen_random_uuid(),facility,patient,item,location,1,'dispensed' FROM f RETURNING id",
 8=>"INSERT INTO inventory_standing_orders(id,facility_id,requesting_location_id,frequency,status,next_run_on)SELECT gen_random_uuid(),facility,location,'daily','cancelled',current_date FROM f RETURNING id",
 9=>"INSERT INTO stock_check_queue(id,facility_id,location_id,status,reason)SELECT gen_random_uuid(),facility,location,'completed','synthetic history' FROM f RETURNING id",
 10=>{prefix.push_str(",a AS(INSERT INTO admission_cases(id,facility_id,patient_id,ward_id,status)SELECT gen_random_uuid(),facility,patient,(SELECT id FROM wards WHERE facility_id=f.facility LIMIT 1),'admitted' FROM f RETURNING id),p AS(INSERT INTO prescriptions(id,facility_id,patient_id,medication_name,dose,frequency,status)SELECT gen_random_uuid(),facility,patient,'Synthetic history','historical','daily','active' FROM f RETURNING id),c AS(INSERT INTO medication_courses(id,facility_id,patient_id,admission_case_id,prescription_id,medication_name,dose,route,frequency,first_dose_at,generation_window_start,generation_window_end,status)SELECT gen_random_uuid(),facility,patient,a.id,p.id,'Synthetic history','historical','oral','daily',now(),now(),now()+interval '1 day','active' FROM f,a,p RETURNING id) ");"INSERT INTO pharmacy_fulfillments(id,facility_id,patient_id,admission_case_id,prescription_id,medication_course_id,status,medication_name,dose,route,frequency,coverage_start,coverage_end,requested_dose_count,dispensing_location_id)SELECT gen_random_uuid(),facility,patient,a.id,p.id,c.id,'cancelled','Synthetic history','historical','oral','daily',now(),now()+interval '1 day',0,location FROM f,a,p,c RETURNING id"},
 11|12=>if edge==11{"INSERT INTO inventory_standing_order_templates(id,facility_id,name,requesting_location_id,fulfilling_location_id,frequency,status,next_run_on,line_count)SELECT gen_random_uuid(),facility,'Synthetic historical template',location,other,'daily','cancelled',current_date,1 FROM f RETURNING id"}else{"INSERT INTO inventory_standing_order_templates(id,facility_id,name,requesting_location_id,fulfilling_location_id,frequency,status,next_run_on,line_count)SELECT gen_random_uuid(),facility,'Synthetic historical template',other,location,'daily','cancelled',current_date,1 FROM f RETURNING id"},_=>unreachable!()};
    prefix.push_str(sql);
    let result = sqlx::query_scalar(&prefix)
        .bind(facility)
        .bind(target)
        .bind(item)
        .bind(other)
        .bind(patient)
        .fetch_one(&pool)
        .await;
    if let Ok(id) = result {
        if edge >= 11 {
            sqlx::query("INSERT INTO inventory_standing_order_template_items(id,facility_id,template_id,item_id,item_code,item_name,unit,quantity)SELECT gen_random_uuid(),$1,$2,id,code,name,unit,1 FROM inventory_items WHERE id=$3").bind(facility).bind(id).bind(item).execute(&pool).await?;
        }
    }
    result
}
#[tokio::test]
async fn every_operational_edge_blocks_unused_state_change_but_used_name_correction_preserves_history(
) {
    let (app, token) = setup().await;
    let pool = app.db_pool().await;
    for (edge, (table, _)) in EDGES.iter().enumerate() {
        let r = create(&app, &token, &format!("SYNTH21_EDGE_{edge}")).await;
        let id = location_id(&r);
        let row = publish(&app, id, edge).await.unwrap();
        let sql = format!("SELECT to_jsonb(r) FROM {table} r WHERE id=$1");
        let before: Value = sqlx::query_scalar(&sql)
            .bind(row)
            .fetch_one(&pool)
            .await
            .unwrap();
        let before_effects = effects(&app).await;
        let (s, b) = command(&app, &token, id, "retire", 1).await;
        assert_eq!(s, StatusCode::CONFLICT, "edge {edge}");
        assert_eq!(
            b["error"]["code"],
            "storage_location_has_operational_history"
        );
        assert_eq!(effects(&app).await, before_effects);
        let(s,b)=request(&app,&token,Method::POST,&format!("/api/v2/inventory/storage-locations/{id}/rename"),Some(json!({"client_request_id":Uuid::new_v4(),"expected_version":1,"name":"Synthetic corrected used location"}))).await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(b["data"]["location"]["version"], 2);
        let after: Value = sqlx::query_scalar(&sql)
            .bind(row)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(before, after);
    }
    println!("storage21 all13 isolated operational edges refused state changes; used rename preserved exact historical rows");
}
#[tokio::test]
async fn all_thirteen_new_operational_edges_require_exact_active_local_location() {
    let (app, token) = setup().await;
    let r = create(&app, &token, "SYNTH21_REFS").await;
    let id = location_id(&r);
    assert_eq!(
        command(&app, &token, id, "retire", 1).await.0,
        StatusCode::OK
    );
    for edge in 0..13 {
        assert!(
            publish(&app, id, edge).await.is_err(),
            "inactive edge {edge}"
        );
    }
    let pool = app.db_pool().await;
    let foreign = Uuid::new_v4();
    sqlx::query("INSERT INTO facilities(id,code,name,deployment_profile)VALUES($1,'SYNTH21_EDGE_FOREIGN','Synthetic facility','hospital')").bind(foreign).execute(&pool).await.unwrap();
    let foreign_location = Uuid::new_v4();
    sqlx::query("INSERT INTO storage_locations(id,facility_id,code,name)VALUES($1,$2,'SYNTH21_FOREIGN','Synthetic foreign location')").bind(foreign_location).bind(foreign).execute(&pool).await.unwrap();
    for edge in 0..13 {
        assert!(
            publish(&app, foreign_location, edge).await.is_err(),
            "foreign edge {edge}"
        );
    }
    println!("storage21 active-reference guards reject13inactive+13foreign operational edges");
}
