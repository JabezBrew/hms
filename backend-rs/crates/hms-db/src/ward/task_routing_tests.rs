use super::*;
use crate::test_support::{AdmissionScenario, TestDb, WardBedScenario};
use hms_observability::with_request_query_counter;
use serde_json::json;

async fn seed(db: &TestDb, count: i32) -> (AdmissionScenario, WardBedScenario) {
    let mut admission = db
        .scenario("route-membership")
        .admission_case_with_available_bed()
        .await
        .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    let destination = db
        .scenario("route-destination")
        .ward_with_available_bed()
        .await
        .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    super::super::reserve_admission_bed(
        db.pool(),
        db.facility_id(),
        admission.admission.id,
        Some(admission.bed.id),
        db.owner_user_id(),
    )
    .await
    .unwrap_or_else(|_| panic!("routing fixture reserves its real source bed"))
    .expect("source reservation exists");
    admission.admission = super::super::activate_admission_case(
        db.pool(),
        db.facility_id(),
        admission.admission.id,
        db.owner_user_id(),
    )
    .await
    .unwrap_or_else(|_| panic!("routing fixture activates its real source placement"))
    .expect("active admission exists");
    sqlx::query("INSERT INTO nursing_tasks(id,facility_id,admission_case_id,patient_id,ward_id,task_type,status,due_at,title,instruction,assigned_to_user_id,created_by_user_id) SELECT gen_random_uuid(),$1,$2,$3,$4,'observation','open',clock_timestamp(),'Synthetic task','Preserve original instruction',$5,$5 FROM generate_series(1,$6)")
        .bind(db.facility_id()).bind(admission.admission.id).bind(admission.patient.id).bind(admission.ward.id)
        .bind(db.owner_user_id()).bind(count).execute(db.pool()).await.unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    (admission, destination)
}

async fn stage_header(
    tx: &mut Transaction<'_, Postgres>,
    db: &TestDb,
    admission: &AdmissionScenario,
    destination: &WardBedScenario,
    reviewed: &[OpenTaskRoute],
    at: DateTime<Utc>,
) -> Uuid {
    let id = Uuid::new_v4();
    let owner_name: String =
        sqlx::query_scalar("SELECT display_name FROM users WHERE facility_id=$1 AND id=$2")
            .bind(db.facility_id())
            .bind(db.owner_user_id())
            .fetch_one(&mut **tx)
            .await
            .unwrap_or_else(|_| panic!("synthetic owner display snapshot loads"));
    // This complete staged header is never committed: these tests inspect the
    // internal bulk seam under real source locks, not public command authority.
    let source:(Uuid,i64,DateTime<Utc>,String,bool)=sqlx::query_as("SELECT id,placement_revision,started_at,origin,legacy_unknown_prefix FROM admission_placements WHERE facility_id=$1 AND admission_case_id=$2 AND ended_at IS NULL")
        .bind(db.facility_id()).bind(admission.admission.id).fetch_one(&mut **tx).await.unwrap_or_else(|_| panic!("exact current source interval loads"));
    let revision = admission.admission.placement_revision + 1;
    let source_labels = json!({"ward_id":admission.ward.id,"ward_name":admission.ward.name,"bed_id":admission.bed.id,"bed_code":admission.bed.bed_code,"section_id":admission.section.id,"section_name":admission.section.name});
    let destination_labels = json!({"ward_id":destination.ward.id,"ward_name":destination.ward.name,"bed_id":destination.bed.id,"bed_code":destination.bed.bed_code,"section_id":destination.section.id,"section_name":destination.section.name});
    let detail = json!({"id":id,"patient_id":admission.patient.id,"admission_case_id":admission.admission.id,
        "recorded_by_user_id":db.owner_user_id(),"recorded_by_display_name":owner_name,"placement_revision":revision,
        "moved_at":at,"source":source_labels,"destination":destination_labels,"routed_task_count":reviewed.len(),"cleared_assignee_count":reviewed.len(),
        "episode":{"encounter_id":admission.admission.encounter_id,"visit_id":admission.admission.visit_id,"admitted_at":admission.admission.admitted_at,"status":admission.admission.status},
        "source_placement":{"id":source.0,"placement_revision":source.1,"labels":source_labels,"started_at":source.2,"origin":source.3,"legacy_unknown_prefix":source.4},
        "destination_placement":{"id":Uuid::new_v4(),"placement_revision":revision,"labels":destination_labels,"started_at":at,"origin":"move","legacy_unknown_prefix":false},
        "reason":"Synthetic routing fixture","task_policy":"route_all_clear_assignees",
        "task_result":{"open_task_count":reviewed.len(),"routed_task_count":reviewed.len(),"cleared_assignee_count":reviewed.len()},
        "source_bed_release":{"status":"cleaning","cleaning_minutes":60,"cleaning_due_at":at+chrono::Duration::hours(1)},"placement_history_partial":false});
    sqlx::query("INSERT INTO admission_moves(id,facility_id,admission_case_id,patient_id,placement_revision,actor_user_id,actor_display_name,moved_at,source_ward_id,source_bed_id,destination_ward_id,destination_bed_id,reason,source_cleaning_minutes,source_cleaning_due_at,routed_task_count,cleared_assignee_count,reviewed_task_ids,detail) VALUES($1,$2,$3,$4,$15,$5,$14,$6,$7,$8,$9,$10,'Synthetic routing fixture',60,$6+INTERVAL '1 hour',$11,$11,$12,$13)")
        .bind(id).bind(db.facility_id()).bind(admission.admission.id).bind(admission.patient.id).bind(db.owner_user_id())
        .bind(at).bind(admission.ward.id).bind(admission.bed.id).bind(destination.ward.id).bind(destination.bed.id)
        .bind(reviewed.len() as i32).bind(reviewed.iter().map(|t|t.id).collect::<Vec<_>>()).bind(detail)
        .bind(owner_name)
        .bind(revision)
        .execute(&mut **tx).await.unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    id
}

#[tokio::test]
async fn route_bulk_cost_and_immutable_origin_are_bounded_for_one_and_five_hundred() {
    let db = TestDb::hospital()
        .await
        .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    for count in [1, 500] {
        let (admission, destination) = seed(&db, count).await;
        let mut tx = db
            .pool()
            .begin()
            .await
            .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
        let (reviewed, read_count) = with_request_query_counter(read_open_routes_tx(
            &mut tx,
            db.facility_id(),
            admission.admission.id,
        ))
        .await;
        let reviewed = reviewed.unwrap_or_else(|_| panic!("actual routing helper succeeds"));
        assert_eq!(reviewed.len(), count as usize);
        assert!(reviewed.iter().all(|t| t.ward_id == admission.ward.id
            && t.service_ward_id == admission.ward.id
            && t.route_version == 0));
        let (locked, lock_count) = with_request_query_counter(lock_reviewed_routes_tx(
            &mut tx,
            db.facility_id(),
            admission.admission.id,
            &reviewed,
        ))
        .await;
        locked.unwrap_or_else(|_| panic!("actual routing helper succeeds"));
        sqlx::query(
            "SELECT id FROM admission_cases WHERE facility_id=$1 AND id=$2 FOR UPDATE NOWAIT",
        )
        .bind(db.facility_id())
        .bind(admission.admission.id)
        .fetch_one(&mut *tx)
        .await
        .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
        let at = Utc::now();
        let movement = stage_header(&mut tx, &db, &admission, &destination, &reviewed, at).await;
        let (applied, apply_count) = with_request_query_counter(apply_reviewed_routes_tx(
            &mut tx,
            db.facility_id(),
            admission.admission.id,
            admission.patient.id,
            &reviewed,
            movement,
            db.owner_user_id(),
            at,
            destination.ward.id,
        ))
        .await;
        applied.unwrap_or_else(|_| panic!("actual routing helper succeeds"));
        assert_eq!((read_count, lock_count, apply_count), (1, 1, 2));
        let facts:(i64,i64,i64)=sqlx::query_as("SELECT count(*) FILTER(WHERE ward_id=$3 AND service_ward_id=$4 AND assigned_to_user_id IS NULL AND route_version=1),count(*) FILTER(WHERE instruction='Preserve original instruction'),count(*) FILTER(WHERE status='open' AND completed_at IS NULL AND cancelled_at IS NULL) FROM nursing_tasks WHERE facility_id=$1 AND admission_case_id=$2")
            .bind(db.facility_id()).bind(admission.admission.id).bind(admission.ward.id).bind(destination.ward.id).fetch_one(&mut *tx).await.unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
        assert_eq!(facts, (count as i64, count as i64, count as i64));
        let events:i64=sqlx::query_scalar("SELECT count(*) FROM nursing_task_routes WHERE facility_id=$1 AND move_id=$2 AND origin_ward_id=$3 AND from_service_ward_id=$3 AND to_service_ward_id=$4 AND from_assigned_to_user_id=$5 AND to_assigned_to_user_id IS NULL AND route_version=1")
            .bind(db.facility_id()).bind(movement).bind(admission.ward.id).bind(destination.ward.id).bind(db.owner_user_id()).fetch_one(&mut *tx).await.unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
        assert_eq!(events, count as i64);
        tx.rollback()
            .await
            .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
        let unchanged:i64=sqlx::query_scalar("SELECT count(*) FROM nursing_tasks WHERE facility_id=$1 AND admission_case_id=$2 AND ward_id=service_ward_id AND route_version=0 AND assigned_to_user_id=$3")
            .bind(db.facility_id()).bind(admission.admission.id).bind(db.owner_user_id()).fetch_one(db.pool()).await.unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
        assert_eq!(unchanged, count as i64);
    }
}

#[tokio::test]
async fn excess_membership_and_real_held_task_have_typed_definite_outcomes() {
    let db = TestDb::hospital()
        .await
        .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    let (over, _) = seed(&db, 501).await;
    let mut tx = db
        .pool()
        .begin()
        .await
        .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    let error = read_open_routes_tx(&mut tx, db.facility_id(), over.admission.id)
        .await
        .err()
        .expect("actual routing helper has a definite rejection");
    assert_eq!(
        error.downcast_ref::<RoutingError>(),
        Some(&RoutingError::TooMany)
    );
    tx.rollback()
        .await
        .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    let (single, _) = seed(&db, 1).await;
    let mut reader = db
        .pool()
        .begin()
        .await
        .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    let reviewed = read_open_routes_tx(&mut reader, db.facility_id(), single.admission.id)
        .await
        .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    let mut holder = db
        .pool()
        .begin()
        .await
        .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    sqlx::query("SELECT id FROM nursing_tasks WHERE facility_id=$1 AND id=$2 FOR UPDATE")
        .bind(db.facility_id())
        .bind(reviewed[0].id)
        .fetch_one(&mut *holder)
        .await
        .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    let error = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        lock_reviewed_routes_tx(
            &mut reader,
            db.facility_id(),
            single.admission.id,
            &reviewed,
        ),
    )
    .await
    .expect("NOWAIT is bounded")
    .err()
    .expect("held task returns a definite busy rejection");
    assert_eq!(
        error.downcast_ref::<RoutingError>(),
        Some(&RoutingError::Busy)
    );
    reader
        .rollback()
        .await
        .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    holder
        .rollback()
        .await
        .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    let events: i64 =
        sqlx::query_scalar("SELECT count(*) FROM nursing_task_routes WHERE facility_id=$1")
            .bind(db.facility_id())
            .fetch_one(db.pool())
            .await
            .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    assert_eq!(events, 0);
}

#[tokio::test]
async fn terminal_change_since_review_is_exact_source_conflict_and_empty_membership_is_zero_cost() {
    let db = TestDb::hospital()
        .await
        .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    let (single, _) = seed(&db, 1).await;
    let mut reader = db
        .pool()
        .begin()
        .await
        .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    let reviewed = read_open_routes_tx(&mut reader, db.facility_id(), single.admission.id)
        .await
        .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    sqlx::query("UPDATE nursing_tasks SET status='cancelled',cancelled_at=clock_timestamp(),cancelled_by_user_id=$3 WHERE facility_id=$1 AND id=$2")
        .bind(db.facility_id()).bind(reviewed[0].id).bind(db.owner_user_id()).execute(db.pool()).await.unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    let error = lock_reviewed_routes_tx(
        &mut reader,
        db.facility_id(),
        single.admission.id,
        &reviewed,
    )
    .await
    .err()
    .expect("actual routing helper has a definite rejection");
    assert_eq!(
        error.downcast_ref::<RoutingError>(),
        Some(&RoutingError::SourceChanged)
    );
    reader
        .rollback()
        .await
        .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    let mut tx = db
        .pool()
        .begin()
        .await
        .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    let (empty, count) = with_request_query_counter(async {
        lock_reviewed_routes_tx(&mut tx, db.facility_id(), single.admission.id, &[]).await?;
        apply_reviewed_routes_tx(
            &mut tx,
            db.facility_id(),
            single.admission.id,
            single.patient.id,
            &[],
            Uuid::new_v4(),
            db.owner_user_id(),
            Utc::now(),
            single.ward.id,
        )
        .await
    })
    .await;
    empty.unwrap_or_else(|_| panic!("actual routing helper succeeds"));
    assert_eq!(count, 0);
    tx.rollback()
        .await
        .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
}
