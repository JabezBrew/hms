use chrono::{DateTime, Duration, TimeZone, Utc};
use hms_db::{test_support::TestDb, ward::*};
use hms_domain::ward::*;
use serde_json::json;
use uuid::Uuid;

fn day(day: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 6, day, 0, 0, 0).unwrap()
}

struct KnownMove {
    db: TestDb,
    source: Uuid,
    destination: Uuid,
}

impl KnownMove {
    /// A trusted synthetic ledger fixture, with original episode chronology and
    /// both actual placement intervals. Public command authorization is covered
    /// by the actual admission move API contract suite.
    async fn new() -> Self {
        let db = TestDb::hospital()
            .await
            .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
        let source = db
            .scenario("placement-source")
            .ward_with_available_bed()
            .await
            .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
        let destination = db
            .scenario("placement-dest")
            .ward_with_available_bed()
            .await
            .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
        let patient = db
            .scenario("placement-patient")
            .registered_patient()
            .await
            .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
        let owner_name: String =
            sqlx::query_scalar("SELECT display_name FROM users WHERE facility_id=$1 AND id=$2")
                .bind(db.facility_id())
                .bind(db.owner_user_id())
                .fetch_one(db.pool())
                .await
                .unwrap_or_else(|_| panic!("synthetic owner display snapshot loads"));
        let case = Uuid::new_v4();
        let discharge = Uuid::new_v4();
        let movement = Uuid::new_v4();
        let source_interval = Uuid::new_v4();
        let destination_interval = Uuid::new_v4();
        let source_labels = json!({"ward_id":source.ward.id,"ward_name":source.ward.name,
            "bed_id":source.bed.id,"bed_code":source.bed.bed_code,
            "section_id":source.section.id,"section_name":source.section.name});
        let destination_labels = json!({"ward_id":destination.ward.id,"ward_name":destination.ward.name,
            "bed_id":destination.bed.id,"bed_code":destination.bed.bed_code,
            "section_id":destination.section.id,"section_name":destination.section.name});
        let detail = json!({"id":movement,"patient_id":patient.id,"admission_case_id":case,
            "placement_revision":2,"moved_at":day(2),"recorded_by_user_id":db.owner_user_id(),
            "recorded_by_display_name":owner_name,"source":source_labels,"destination":destination_labels,
            "routed_task_count":0,"cleared_assignee_count":0,
            "episode":{"encounter_id":null,"visit_id":null,"admitted_at":day(1),"status":"admitted"},
            "source_placement":{"id":source_interval,"placement_revision":1,"labels":source_labels,
                "started_at":day(1),"origin":"activation","legacy_unknown_prefix":false},
            "destination_placement":{"id":destination_interval,"placement_revision":2,"labels":destination_labels,
                "started_at":day(2),"origin":"move","legacy_unknown_prefix":false},
            "reason":"Synthetic known placement fixture","task_policy":"route_all_clear_assignees",
            "task_result":{"open_task_count":0,"routed_task_count":0,"cleared_assignee_count":0},
            "source_bed_release":{"status":"cleaning","cleaning_minutes":60,"cleaning_due_at":day(2)+Duration::hours(1)},
            "placement_history_partial":false});
        // Three real transaction phases exercise the same deferred invariants as
        // activation -> move -> later discharge. No historical guard is disabled.
        let mut tx = db
            .pool()
            .begin()
            .await
            .unwrap_or_else(|_| panic!("known activation transaction opens"));
        sqlx::query("INSERT INTO admission_cases(id,facility_id,patient_id,ward_id,bed_id,status,admitted_at,created_by_user_id,placement_revision,placement_known_from) VALUES($1,$2,$3,$4,$5,'admitted',$6,$7,1,$6)")
            .bind(case).bind(db.facility_id()).bind(patient.id).bind(source.ward.id).bind(source.bed.id).bind(day(1)).bind(db.owner_user_id())
            .execute(&mut *tx).await.unwrap_or_else(|_| panic!("known activation root inserts"));
        sqlx::query("INSERT INTO admission_placements(id,facility_id,admission_case_id,patient_id,ward_id,bed_id,placement_revision,started_at,origin,legacy_unknown_prefix) VALUES($1,$2,$3,$4,$5,$6,1,$7,'activation',false)")
            .bind(source_interval).bind(db.facility_id()).bind(case).bind(patient.id).bind(source.ward.id).bind(source.bed.id).bind(day(1))
            .execute(&mut *tx).await.unwrap_or_else(|_| panic!("known activation interval inserts"));
        sqlx::query("UPDATE beds SET status='occupied',updated_at=$2 WHERE id=$1")
            .bind(source.bed.id)
            .bind(day(1))
            .execute(&mut *tx)
            .await
            .unwrap_or_else(|_| panic!("known initial bed is occupied"));
        tx.commit()
            .await
            .unwrap_or_else(|_| panic!("complete known activation commits"));
        let mut tx = db
            .pool()
            .begin()
            .await
            .unwrap_or_else(|_| panic!("known move transaction opens"));
        sqlx::query("INSERT INTO admission_moves(id,facility_id,admission_case_id,patient_id,placement_revision,actor_user_id,actor_display_name,moved_at,source_ward_id,source_bed_id,destination_ward_id,destination_bed_id,reason,source_cleaning_minutes,source_cleaning_due_at,routed_task_count,cleared_assignee_count,reviewed_task_ids,detail) VALUES($1,$2,$3,$4,2,$5,$13,$6,$7,$8,$9,$10,'Synthetic known placement fixture',60,$11,0,0,ARRAY[]::uuid[],$12)")
            .bind(movement).bind(db.facility_id()).bind(case).bind(patient.id).bind(db.owner_user_id()).bind(day(2)).bind(source.ward.id).bind(source.bed.id)
            .bind(destination.ward.id).bind(destination.bed.id).bind(day(2)+Duration::hours(1)).bind(detail).bind(owner_name)
            .execute(&mut *tx).await.unwrap_or_else(|_| panic!("known immutable move header inserts"));
        sqlx::query("UPDATE admission_placements SET ended_at=$2,close_kind='move',closing_move_id=$3 WHERE id=$1")
            .bind(source_interval).bind(day(2)).bind(movement).execute(&mut *tx).await.unwrap_or_else(|_| panic!("known source interval closes"));
        sqlx::query("INSERT INTO admission_placements(id,facility_id,admission_case_id,patient_id,ward_id,bed_id,placement_revision,started_at,origin,legacy_unknown_prefix,opening_move_id) VALUES($1,$2,$3,$4,$5,$6,2,$7,'move',false,$8)")
            .bind(destination_interval).bind(db.facility_id()).bind(case).bind(patient.id).bind(destination.ward.id).bind(destination.bed.id).bind(day(2)).bind(movement)
            .execute(&mut *tx).await.unwrap_or_else(|_| panic!("known destination interval opens"));
        sqlx::query("UPDATE admission_cases SET ward_id=$2,bed_id=$3,placement_revision=2,updated_at=$4 WHERE id=$1")
            .bind(case).bind(destination.ward.id).bind(destination.bed.id).bind(day(2)).execute(&mut *tx).await.unwrap_or_else(|_| panic!("known move advances canonical placement"));
        sqlx::query("UPDATE beds SET status='cleaning',cleaning_due_at=$2+INTERVAL '1 hour',updated_at=$2 WHERE id=$1")
            .bind(source.bed.id).bind(day(2)).execute(&mut *tx).await.unwrap_or_else(|_| panic!("known move releases source to cleaning"));
        sqlx::query("UPDATE beds SET status='occupied',updated_at=$2 WHERE id=$1")
            .bind(destination.bed.id)
            .bind(day(2))
            .execute(&mut *tx)
            .await
            .unwrap_or_else(|_| panic!("known move occupies destination"));
        tx.commit()
            .await
            .unwrap_or_else(|_| panic!("complete known move commits"));
        let mut tx = db
            .pool()
            .begin()
            .await
            .unwrap_or_else(|_| panic!("known discharge transaction opens"));
        sqlx::query("INSERT INTO discharge_cases(id,facility_id,admission_case_id,patient_id,status,discharged_at,created_by_user_id) VALUES($1,$2,$3,$4,'discharged',$5,$6)")
            .bind(discharge).bind(db.facility_id()).bind(case).bind(patient.id).bind(day(4)).bind(db.owner_user_id()).execute(&mut *tx).await.unwrap_or_else(|_| panic!("known final discharge inserts"));
        sqlx::query("UPDATE admission_placements SET ended_at=$2,close_kind='discharge',closing_discharge_case_id=$3 WHERE id=$1")
            .bind(destination_interval).bind(day(4)).bind(discharge).execute(&mut *tx).await.unwrap_or_else(|_| panic!("known final interval closes"));
        sqlx::query("UPDATE admission_cases SET status='discharged',discharged_at=$2,placement_revision=3,updated_at=$2 WHERE id=$1")
            .bind(case).bind(day(4)).execute(&mut *tx).await.unwrap_or_else(|_| panic!("known discharge keeps original episode chronology"));
        sqlx::query("UPDATE beds SET status='cleaning',cleaning_due_at=$2+INTERVAL '1 hour',updated_at=$2 WHERE id=$1")
            .bind(destination.bed.id).bind(day(4)).execute(&mut *tx).await.unwrap_or_else(|_| panic!("known discharge releases destination"));
        tx.commit()
            .await
            .unwrap_or_else(|_| panic!("complete known discharge commits"));
        Self {
            db,
            source: source.ward.id,
            destination: destination.ward.id,
        }
    }
}

#[tokio::test]
async fn placement_intervals_keep_original_admission_final_discharge_and_episode_los() {
    let f = KnownMove::new().await;
    let result = ward_analytics(f.db.pool(), f.db.facility_id(), None, day(1), day(4))
        .await
        .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    assert_eq!(result.meta.occupancy_basis, "known_placement_intervals");
    assert_eq!(
        result.meta.capacity_basis,
        "current_active_ward_nonclosed_beds"
    );
    assert_eq!(result.meta.placement_attribution, "complete");
    assert!(result.meta.partial_metrics.is_empty());
    let totals = result.facility_episode_totals.as_ref().unwrap();
    assert_eq!((totals.admissions, totals.discharges), (Some(1), Some(0))); // discharge exactly end is excluded
    let source = result
        .ward_utilization
        .iter()
        .find(|r| r.ward_id == f.source)
        .unwrap();
    let destination = result
        .ward_utilization
        .iter()
        .find(|r| r.ward_id == f.destination)
        .unwrap();
    assert!((source.bed_days - 1.0).abs() < 0.0001);
    assert!((destination.bed_days - 2.0).abs() < 0.0001);
    assert!((source.occupancy_rate.unwrap() - 100.0 / 3.0).abs() < 0.0001);
    let source_admissions = result
        .admissions_by_ward
        .iter()
        .find(|r| r.ward_id == f.source)
        .unwrap();
    let destination_admissions = result
        .admissions_by_ward
        .iter()
        .find(|r| r.ward_id == f.destination)
        .unwrap();
    assert_eq!(
        (
            source_admissions.admissions,
            source_admissions.discharges,
            source_admissions.transfers
        ),
        (Some(1), Some(0), Some(1))
    );
    assert_eq!(
        (
            destination_admissions.admissions,
            destination_admissions.discharges,
            destination_admissions.transfers
        ),
        (Some(0), Some(0), Some(1))
    );
    // The unused ward/day LEFT JOIN contributes no phantom occupied day.
    assert_eq!(
        result
            .occupancy_trends
            .iter()
            .find(|r| r.ward_id == f.source && r.date == day(3).date_naive())
            .unwrap()
            .occupied_bed_days,
        0.0
    );
    let final_range = ward_analytics(
        f.db.pool(),
        f.db.facility_id(),
        Some(f.destination),
        day(1),
        day(5),
    )
    .await
    .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    assert!(final_range.facility_episode_totals.is_none());
    assert_eq!(final_range.admissions_by_ward[0].discharges, Some(1));
    assert_eq!(final_range.ward_utilization[0].avg_los, Some(3.0));
    assert_eq!(
        final_range
            .length_of_stay
            .iter()
            .find(|r| r.range == "3-5 days")
            .unwrap()
            .count,
        Some(1)
    );
    let source_only = ward_analytics(
        f.db.pool(),
        f.db.facility_id(),
        Some(f.source),
        day(1),
        day(5),
    )
    .await
    .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    assert_eq!(source_only.admissions_by_ward[0].discharges, Some(0));
    assert!(source_only
        .length_of_stay
        .iter()
        .all(|r| r.count == Some(0)));
    let foreign = ward_analytics(f.db.pool(), Uuid::new_v4(), Some(f.source), day(1), day(5))
        .await
        .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    assert!(
        foreign.occupancy_trends.is_empty()
            && foreign.ward_utilization.is_empty()
            && foreign.admissions_by_ward.is_empty()
    );
}

#[tokio::test]
async fn inactive_historical_ward_retains_bed_days_without_inventing_current_capacity() {
    let f = KnownMove::new().await;
    sqlx::query("UPDATE wards SET status='inactive' WHERE facility_id=$1 AND id=$2")
        .bind(f.db.facility_id())
        .bind(f.source)
        .execute(f.db.pool())
        .await
        .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    let result = ward_analytics(
        f.db.pool(),
        f.db.facility_id(),
        Some(f.source),
        day(1),
        day(5),
    )
    .await
    .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    assert_eq!(result.ward_utilization.len(), 1);
    assert_eq!(result.ward_utilization[0].bed_days, 1.0);
    assert_eq!(result.ward_utilization[0].total_beds, 0);
    assert_eq!(result.ward_utilization[0].occupancy_rate, None);
    assert!(result
        .occupancy_trends
        .iter()
        .all(|row| row.occupancy_rate.is_none()));
    assert_eq!(result.admissions_by_ward[0].admissions, Some(1));
}

#[tokio::test]
async fn imported_current_and_closed_history_are_partial_without_fabricated_starts_or_ward_totals()
{
    let db = TestDb::hospital()
        .await
        .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    let current = db
        .scenario("legacy-current")
        .ward_with_available_bed()
        .await
        .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    let patient = db
        .scenario("legacy-current")
        .registered_patient()
        .await
        .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    sqlx::query("INSERT INTO admission_cases(id,facility_id,patient_id,ward_id,bed_id,status,admitted_at,created_by_user_id) VALUES($1,$2,$3,$4,$5,'admitted',$6,$7)")
        .bind(Uuid::new_v4()).bind(db.facility_id()).bind(patient.id).bind(current.ward.id).bind(current.bed.id)
        .bind(day(1)).bind(db.owner_user_id()).execute(db.pool()).await.unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    sqlx::query("UPDATE beds SET status='occupied' WHERE id=$1")
        .bind(current.bed.id)
        .execute(db.pool())
        .await
        .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    let map = get_ward_bed_map(db.pool(), db.facility_id(), current.ward.id)
        .await
        .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    let bed = map
        .sections
        .iter()
        .flat_map(|s| &s.beds)
        .find(|b| b.id == current.bed.id)
        .unwrap();
    assert_eq!(bed.occupied_since, None);
    assert!(!bed.occupancy_start_known);
    assert!(bed.occupancy_observed_at.is_some());
    let observed = bed.occupancy_observed_at.unwrap();
    let historical = ward_analytics(
        db.pool(),
        db.facility_id(),
        Some(current.ward.id),
        day(1),
        day(4),
    )
    .await
    .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    assert_eq!(historical.meta.placement_attribution, "partial");
    assert!(historical
        .meta
        .partial_metrics
        .iter()
        .any(|m| m == "occupancy_trends"));
    assert_eq!(historical.admissions_by_ward[0].admissions, None);
    assert_eq!(historical.ward_utilization[0].bed_days, 0.0);
    let known_end: DateTime<Utc> = sqlx::query_scalar("SELECT clock_timestamp()")
        .fetch_one(db.pool())
        .await
        .unwrap_or_else(|_| panic!("known observed range clock loads"));
    let known = ward_analytics(
        db.pool(),
        db.facility_id(),
        Some(current.ward.id),
        observed,
        known_end,
    )
    .await
    .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    assert_eq!(known.meta.placement_attribution, "complete");
    let closed_patient = db
        .scenario("legacy-closed")
        .registered_patient()
        .await
        .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    sqlx::query("INSERT INTO admission_cases(id,facility_id,patient_id,ward_id,status,admitted_at,discharged_at,created_by_user_id) VALUES($1,$2,$3,$4,'discharged',$5,$6,$7)")
        .bind(Uuid::new_v4()).bind(db.facility_id()).bind(closed_patient.id).bind(current.ward.id)
        .bind(day(1)).bind(day(3)).bind(db.owner_user_id()).execute(db.pool()).await.unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    let unknown = ward_analytics(
        db.pool(),
        db.facility_id(),
        Some(current.ward.id),
        day(1),
        day(4),
    )
    .await
    .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    assert_eq!(unknown.admissions_by_ward[0].discharges, None);
    assert!(unknown
        .length_of_stay
        .iter()
        .all(|b| b.count.is_none() && b.percentage.is_none()));
    assert_eq!(unknown.ward_utilization[0].avg_los, None);
    let canonical = ward_analytics(db.pool(), db.facility_id(), None, day(1), day(4))
        .await
        .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    let totals = canonical.facility_episode_totals.unwrap();
    assert_eq!((totals.admissions, totals.discharges), (Some(2), Some(1)));
    assert_eq!(
        canonical
            .length_of_stay
            .iter()
            .find(|r| r.range == "0-2 days")
            .unwrap()
            .count,
        Some(1)
    );
}

#[tokio::test]
async fn actual_activation_bed_map_uses_current_interval_and_analytics_query_count_is_constant() {
    let db = TestDb::hospital()
        .await
        .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    let a = db
        .scenario("known-start")
        .admission_case_with_available_bed()
        .await
        .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    reserve_admission_bed(
        db.pool(),
        db.facility_id(),
        a.admission.id,
        Some(a.bed.id),
        db.owner_user_id(),
    )
    .await
    .unwrap_or_else(|_| panic!("synthetic database operation succeeds"))
    .unwrap();
    let active = activate_admission_case(
        db.pool(),
        db.facility_id(),
        a.admission.id,
        db.owner_user_id(),
    )
    .await
    .unwrap_or_else(|_| panic!("synthetic database operation succeeds"))
    .unwrap();
    let map = get_ward_bed_map(db.pool(), db.facility_id(), a.ward.id)
        .await
        .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    let bed = map
        .sections
        .iter()
        .flat_map(|s| &s.beds)
        .find(|b| b.id == a.bed.id)
        .unwrap();
    assert!(bed.occupancy_start_known);
    assert!(
        bed.occupied_since == active.admitted_at,
        "known current interval is the actual occupancy start"
    );
    assert!(
        bed.occupancy_observed_at == active.admitted_at,
        "known current interval has the actual observation clock"
    );
    let start = Utc::now() - Duration::days(1);
    let end = Utc::now() + Duration::days(1);
    let (small, small_count) = hms_observability::with_request_query_counter(ward_analytics(
        db.pool(),
        db.facility_id(),
        Some(a.ward.id),
        start,
        end,
    ))
    .await;
    let small = small.unwrap_or_else(|_| panic!("actual analytics request succeeds"));
    assert_eq!(small_count, 6);
    let observed_through: DateTime<Utc> = sqlx::query_scalar("SELECT clock_timestamp()")
        .fetch_one(db.pool())
        .await
        .unwrap_or_else(|_| panic!("database observation cutoff loads"));
    let elapsed_days = (observed_through
        - active
            .admitted_at
            .expect("actual activation timestamp exists"))
    .num_microseconds()
    .expect("bounded elapsed interval fits")
    .max(0) as f64
        / 86_400_000_000.0;
    assert!(small.ward_utilization[0].bed_days<=elapsed_days+0.000001,
        "known open-placement bed-days must not extrapolate past the actual database observation cutoff");
    assert!(
        small.meta.observed_through <= observed_through,
        "server cutoff precedes later database observation"
    );
    assert_eq!(small.meta.placement_attribution, "partial");
    assert!(
        small
            .meta
            .partial_metrics
            .iter()
            .any(|path| path == "occupancy_trends"),
        "future coverage is explicitly partial"
    );
    let noise = db
        .scenario("outside-scope")
        .ward_with_available_bed()
        .await
        .unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    // Inactive historical episodes outside this time window add no fabricated
    // current placement and do not change selected-ward availability or costs.
    sqlx::query("INSERT INTO admission_cases(id,facility_id,patient_id,ward_id,bed_id,status,admitted_at,discharged_at,created_by_user_id,placement_revision) SELECT gen_random_uuid(),$1,$2,$3,$5,'discharged',TIMESTAMPTZ '2025-01-01T00:00:00Z'+n*INTERVAL '1 hour',TIMESTAMPTZ '2025-01-01T00:00:00Z'+(n+1)*INTERVAL '1 hour',$4,1 FROM generate_series(1,1000) n")
        .bind(db.facility_id()).bind(a.patient.id).bind(noise.ward.id).bind(db.owner_user_id()).bind(noise.bed.id).execute(db.pool()).await.unwrap_or_else(|_| panic!("synthetic database operation succeeds"));
    sqlx::query("INSERT INTO discharge_cases(id,facility_id,admission_case_id,patient_id,status,discharged_at,created_by_user_id) SELECT gen_random_uuid(),facility_id,id,patient_id,'discharged',discharged_at,$3 FROM admission_cases WHERE facility_id=$1 AND ward_id=$2")
        .bind(db.facility_id()).bind(noise.ward.id).bind(db.owner_user_id()).execute(db.pool()).await.unwrap_or_else(|_| panic!("synthetic noise discharge evidence inserts"));
    sqlx::query("INSERT INTO admission_placements(id,facility_id,admission_case_id,patient_id,ward_id,bed_id,placement_revision,started_at,ended_at,origin,legacy_unknown_prefix,closing_discharge_case_id,close_kind) SELECT gen_random_uuid(),c.facility_id,c.id,c.patient_id,c.ward_id,c.bed_id,1,c.admitted_at,c.discharged_at,'activation',false,d.id,'discharge' FROM admission_cases c JOIN discharge_cases d ON d.admission_case_id=c.id AND d.facility_id=c.facility_id WHERE c.facility_id=$1 AND c.ward_id=$2")
        .bind(db.facility_id()).bind(noise.ward.id).execute(db.pool()).await.unwrap_or_else(|_| panic!("synthetic nonoverlapping known noise intervals insert"));
    let (large, large_count) = hms_observability::with_request_query_counter(ward_analytics(
        db.pool(),
        db.facility_id(),
        Some(a.ward.id),
        start,
        end,
    ))
    .await;
    let large = large.unwrap_or_else(|_| panic!("actual analytics request succeeds"));
    assert_eq!(large_count, small_count);
    assert_eq!(
        large.meta.placement_attribution,
        small.meta.placement_attribution
    );
    assert_eq!(
        large.admissions_by_ward[0].admissions,
        small.admissions_by_ward[0].admissions
    );
    // The only selected open interval grows by precisely the two server-cutoff
    // difference; unrelated history cannot contribute additional bed-days.
    let cutoff_delta = (large.meta.observed_through - small.meta.observed_through)
        .num_microseconds()
        .expect("bounded cutoff difference fits") as f64
        / 86_400_000_000.0;
    assert!(
        (large.ward_utilization[0].bed_days - small.ward_utilization[0].bed_days - cutoff_delta)
            .abs()
            < 0.000001,
        "outside-scope history leaves only actual elapsed occupancy growth"
    );
    sqlx::query("ANALYZE admission_placements")
        .execute(db.pool())
        .await
        .unwrap_or_else(|_| panic!("isolated placement statistics update"));
    // Exact production overlap predicate, with ordinary planner settings. The
    // plan stays in memory: only static assertions leave this test.
    let plan:serde_json::Value=sqlx::query_scalar("EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT p.started_at,p.ended_at FROM admission_placements p WHERE p.facility_id=$1 AND p.ward_id=$2 AND p.started_at<$4 AND (p.ended_at IS NULL OR p.ended_at>$3)")
        .bind(db.facility_id()).bind(a.ward.id).bind(start).bind(end).fetch_one(db.pool()).await.unwrap_or_else(|_| panic!("actual scoped overlap plan loads"));
    fn uses_scope_index(value: &serde_json::Value) -> bool {
        match value {
            serde_json::Value::Object(map) => {
                map.get("Index Name").and_then(serde_json::Value::as_str)
                    == Some("admission_placements_ward_time_idx")
                    || map.values().any(uses_scope_index)
            }
            serde_json::Value::Array(items) => items.iter().any(uses_scope_index),
            _ => false,
        }
    }
    assert!(
        uses_scope_index(&plan),
        "natural placement overlap access uses the facility/ward/time index"
    );
    assert_eq!(plan[0]["Plan"]["Actual Rows"].as_i64(), Some(1));
}

#[tokio::test]
async fn unknown_discharge_chronology_is_unavailable_without_created_time_substitution() {
    let db = TestDb::hospital()
        .await
        .unwrap_or_else(|_| panic!("synthetic database creates"));
    let ward = db
        .scenario("unknown-time")
        .ward_with_available_bed()
        .await
        .unwrap_or_else(|_| panic!("synthetic ward creates"));
    let patient = db
        .scenario("unknown-time")
        .registered_patient()
        .await
        .unwrap_or_else(|_| panic!("synthetic patient creates"));
    sqlx::query("INSERT INTO admission_cases(id,facility_id,patient_id,ward_id,status,admitted_at,discharged_at,created_by_user_id) VALUES(gen_random_uuid(),$1,$2,$3,'discharged',$4,NULL,$5)")
        .bind(db.facility_id()).bind(patient.id).bind(ward.ward.id).bind(day(1)).bind(db.owner_user_id()).execute(db.pool()).await.unwrap_or_else(|_| panic!("synthetic unknown chronology imports"));
    let result = ward_analytics(db.pool(), db.facility_id(), None, day(1), day(4))
        .await
        .unwrap_or_else(|_| panic!("unknown chronology analytics loads"));
    let totals = result.facility_episode_totals.unwrap();
    assert_eq!(totals.admissions, Some(1));
    assert_eq!(totals.discharges, None);
    assert!(result
        .length_of_stay
        .iter()
        .all(|row| row.count.is_none() && row.percentage.is_none()));
    assert!(result
        .meta
        .unavailable_metrics
        .iter()
        .any(|name| name == "facility_episode_totals.discharges"));
    assert_eq!(result.meta.placement_attribution, "partial");
}
