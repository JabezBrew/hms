use super::*;
async fn publish_reference(app: &TestApp, id: Uuid, edge: usize) -> (Uuid, &'static str) {
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let location = Uuid::from_u128(hms_db::provision::DEFAULT_MAIN_STORE_ID);
    let other = Uuid::from_u128(hms_db::provision::DEFAULT_PHARMACY_STORE_ID);
    let patient = Uuid::from_u128(hms_db::provision::PATIENT_ONE_ID);
    let mut prefix="WITH f AS(SELECT $1::uuid facility,$2::uuid item,$3::uuid location,$4::uuid other,$5::uuid patient) ".to_owned();
    let (table,sql)=match edge{
      0=>("stock_batches","INSERT INTO stock_batches(id,facility_id,item_id,location_id,batch_number,quantity_on_hand)SELECT gen_random_uuid(),facility,item,location,'SYNTHETIC-HISTORY',0 FROM f RETURNING id"),
      1=>("stock_movements","INSERT INTO stock_movements(id,facility_id,item_id,location_id,movement_type,quantity,balance_after,reason)SELECT gen_random_uuid(),facility,item,location,'adjustment',0,0,'Synthetic history' FROM f RETURNING id"),
      2=>("stock_transfers","INSERT INTO stock_transfers(id,facility_id,item_id,from_location_id,to_location_id,quantity,status,requested_unit)SELECT gen_random_uuid(),facility,item,location,other,1,'completed','tablet' FROM f RETURNING id"),
      3=>("controlled_substance_register","INSERT INTO controlled_substance_register(id,facility_id,item_id,location_id,movement_type,quantity_delta,balance_after)SELECT gen_random_uuid(),facility,item,location,'count',0,0 FROM f RETURNING id"),
      4=>("pharmacy_dispenses","INSERT INTO pharmacy_dispenses(id,facility_id,patient_id,item_id,location_id,quantity,status)SELECT gen_random_uuid(),facility,patient,item,location,1,'dispensed' FROM f RETURNING id"),
      5=>("prescriptions","INSERT INTO prescriptions(id,facility_id,patient_id,medication_name,dose,frequency,status,inventory_item_id)SELECT gen_random_uuid(),facility,patient,'Synthetic history','historical','daily','stopped',item FROM f RETURNING id"),
      6|7=>{
        prefix.push_str(",a AS(INSERT INTO admission_cases(id,facility_id,patient_id,ward_id,status)SELECT gen_random_uuid(),facility,patient,(SELECT id FROM wards WHERE facility_id=f.facility LIMIT 1),'cancelled' FROM f RETURNING id),p AS(INSERT INTO prescriptions(id,facility_id,patient_id,medication_name,dose,frequency,status)SELECT gen_random_uuid(),facility,patient,'Synthetic history','historical','daily','active' FROM f RETURNING id) ");
        if edge==6{("medication_courses","INSERT INTO medication_courses(id,facility_id,patient_id,admission_case_id,prescription_id,medication_name,dose,route,frequency,first_dose_at,generation_window_start,generation_window_end,status,inventory_item_id)SELECT gen_random_uuid(),facility,patient,a.id,p.id,'Synthetic history','historical','oral','daily',now(),now(),now()+interval '1 day','stopped',item FROM f,a,p RETURNING id")}
        else{prefix.push_str(",c AS(INSERT INTO medication_courses(id,facility_id,patient_id,admission_case_id,prescription_id,medication_name,dose,route,frequency,first_dose_at,generation_window_start,generation_window_end,status)SELECT gen_random_uuid(),facility,patient,a.id,p.id,'Synthetic history','historical','oral','daily',now(),now(),now()+interval '1 day','active' FROM f,a,p RETURNING id) ");("pharmacy_fulfillments","INSERT INTO pharmacy_fulfillments(id,facility_id,patient_id,admission_case_id,prescription_id,medication_course_id,status,medication_name,dose,route,frequency,coverage_start,coverage_end,requested_dose_count,inventory_item_id)SELECT gen_random_uuid(),facility,patient,a.id,p.id,c.id,'cancelled','Synthetic history','historical','oral','daily',now(),now()+interval '1 day',0,item FROM f,a,p,c RETURNING id")}
      },
      8=>{prefix.push_str(",p AS(INSERT INTO inventory_standing_order_templates(id,facility_id,name,requesting_location_id,fulfilling_location_id,frequency,status,next_run_on,line_count)SELECT gen_random_uuid(),facility,'Synthetic historical template',location,other,'daily','cancelled',current_date,1 FROM f RETURNING id) ");("inventory_standing_order_template_items","INSERT INTO inventory_standing_order_template_items(id,facility_id,template_id,item_id,item_code,item_name,unit,quantity)SELECT gen_random_uuid(),facility,p.id,item,'Synthetic','Synthetic history','tablet',1 FROM f,p RETURNING id")},
      9=>{prefix.push_str(",p AS(INSERT INTO stock_requisitions(id,facility_id,requesting_location_id,status)SELECT gen_random_uuid(),facility,location,'cancelled' FROM f RETURNING id) ");("stock_requisition_items","INSERT INTO stock_requisition_items(id,facility_id,requisition_id,item_id,item_code,item_name,unit,quantity_requested,quantity_issued)SELECT gen_random_uuid(),facility,p.id,item,'Synthetic','Synthetic history','tablet',1,0 FROM f,p RETURNING id")},
      _=>unreachable!()
    };
    prefix.push_str(sql);
    let row: Uuid = sqlx::query_scalar(&prefix)
        .bind(facility)
        .bind(id)
        .bind(location)
        .bind(other)
        .bind(patient)
        .fetch_one(&pool)
        .await
        .expect("guarded historical-state reference fixture satisfies current schema");
    (row, table)
}

#[tokio::test]
async fn all_ten_reference_families_block_units_and_lifecycle_but_allow_same_unit_labels() {
    let (app, t) = ordinary().await;
    let pool = app.db_pool().await;
    for edge in 0..10 {
        let receipt = create(&app, &t, &format!("SYNTH24_REF_{edge}")).await;
        let id = item_id(&receipt);
        let (row, table) = publish_reference(&app, id, edge).await;
        let sql = format!("SELECT to_jsonb(r) FROM {table} r WHERE id=$1");
        let before: Value = sqlx::query_scalar(&sql)
            .bind(row)
            .fetch_one(&pool)
            .await
            .unwrap();
        let before_effects = effects(&app).await;
        let (s, b) = correction(
            &app,
            &t,
            id,
            1,
            today(),
            "pack",
            "Synthetic forbidden linked unit",
        )
        .await;
        assert_eq!(s, StatusCode::CONFLICT, "fixed edge {edge}");
        assert_eq!(b["error"]["code"], "inventory_item_has_operational_history");
        assert_eq!(effects(&app).await, before_effects);
        let (s, b) = correction(
            &app,
            &t,
            id,
            1,
            today(),
            "tablet",
            "Synthetic corrected linked label",
        )
        .await;
        assert_eq!(s, StatusCode::OK);
        verify_receipt(&b["data"]);
        for action in ["retire", "reactivate"] {
            let (s, b) = lifecycle(&app, &t, id, action, 2).await;
            assert_eq!(s, StatusCode::CONFLICT);
            assert_eq!(b["error"]["code"], "inventory_item_has_operational_history");
        }
        let after: Value = sqlx::query_scalar(&sql)
            .bind(row)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert!(after == before, "retained source row remains exact");
        let state = detail(&app, &t, id).await;
        assert_eq!(
            state["eligibility"]["unit_change_blocked_by"],
            "operational_reference"
        );
    }
    println!("ITEM24 all10 independent operational families refused unit/lifecycle changes and retained exact rows; same-unit label correction passed");
}
