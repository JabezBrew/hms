use chrono::{Duration, TimeZone, Utc};
use hms_db::test_support::TestDb;
use hms_db::ward::{FluidBalanceFilters, WardCursor};
use uuid::Uuid;

#[tokio::test]
async fn fluid_lists_and_aggregates_are_scoped_complete_and_cursor_bounded() {
    let db = TestDb::hospital().await.unwrap();
    let care = db
        .scenario("fluid-selected")
        .admission_case_with_available_bed()
        .await
        .unwrap();
    let other = db
        .scenario("fluid-other")
        .admission_case_with_available_bed()
        .await
        .unwrap();
    let prior = Uuid::new_v4();
    sqlx::query("INSERT INTO admission_cases (id, facility_id, patient_id, ward_id, status) VALUES ($1, $2, $3, $4, 'discharged')")
        .bind(prior).bind(db.facility_id()).bind(care.patient.id).bind(care.ward.id).execute(db.pool()).await.unwrap();
    let start = Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap();
    let end = start + Duration::days(125);
    for (patient, admission, count, offset) in [
        (other.patient.id, other.admission.id, 150_i32, -150_i32),
        (care.patient.id, prior, 150, 0),
        (care.patient.id, care.admission.id, 125, 0),
    ] {
        sqlx::query("INSERT INTO fluid_balance_entries (id, facility_id, admission_case_id, patient_id, recorded_at, intake_ml, output_ml) SELECT gen_random_uuid(), $1, $2, $3, $4 + (sequence + $6) * interval '1 day', 10, 4 FROM generate_series(0, $5 - 1) AS sequence")
            .bind(db.facility_id()).bind(admission).bind(patient).bind(start).bind(count).bind(offset).execute(db.pool()).await.unwrap();
    }
    for timestamp in [start - Duration::seconds(1), end] {
        sqlx::query("INSERT INTO fluid_balance_entries (id, facility_id, admission_case_id, patient_id, recorded_at, intake_ml, output_ml) VALUES ($1, $2, $3, $4, $5, 99999, 0)")
            .bind(Uuid::new_v4()).bind(db.facility_id()).bind(care.admission.id).bind(care.patient.id).bind(timestamp).execute(db.pool()).await.unwrap();
    }
    let filters = FluidBalanceFilters {
        patient_id: Some(care.patient.id),
        admission_case_id: Some(care.admission.id),
        recorded_from: Some(start),
        recorded_before: Some(end),
        ..Default::default()
    };
    let mut cursor = None;
    let mut ids = Vec::new();
    loop {
        let (rows, query_count) = hms_observability::with_request_query_counter(
            hms_db::ward::list_fluid_balance_entries_scoped(
                db.pool(),
                db.facility_id(),
                filters.clone(),
                cursor,
                50,
            ),
        )
        .await;
        let rows = rows.unwrap();
        assert_eq!(query_count, 1);
        assert!(rows.len() <= 50);
        assert!(rows.iter().all(|row| row.patient_id == care.patient.id
            && row.admission_case_id == care.admission.id
            && row.recorded_at >= start
            && row.recorded_at < end));
        let Some(last) = rows.last() else { break };
        cursor = Some(WardCursor {
            occurred_at: last.recorded_at,
            id: last.id,
        });
        ids.extend(rows.into_iter().map(|row| row.id));
    }
    assert_eq!(ids.len(), 125);
    assert_eq!(
        ids.iter().collect::<std::collections::HashSet<_>>().len(),
        125
    );
    let descending = hms_db::ward::list_fluid_balance_entries_scoped(
        db.pool(),
        db.facility_id(),
        FluidBalanceFilters {
            descending: true,
            ..filters.clone()
        },
        None,
        101,
    )
    .await
    .unwrap();
    assert_eq!(descending[0].id, *ids.last().unwrap());
    let (summary, count) = hms_observability::with_request_query_counter(
        hms_db::ward::fluid_balance_summary(db.pool(), db.facility_id(), filters.clone()),
    )
    .await;
    let summary = summary.unwrap();
    assert_eq!(count, 1);
    assert_eq!(
        (
            summary.entry_count,
            summary.total_intake_ml,
            summary.total_output_ml,
            summary.net_ml
        ),
        (125, 1250, 500, 750)
    );
    let mut cursor = None;
    let mut days = Vec::new();
    loop {
        let (rows, count) =
            hms_observability::with_request_query_counter(hms_db::ward::fluid_balance_trends(
                db.pool(),
                db.facility_id(),
                filters.clone(),
                cursor,
                50,
            ))
            .await;
        let rows = rows.unwrap();
        assert_eq!(count, 1);
        assert!(rows.len() <= 50);
        let Some(last) = rows.last() else { break };
        cursor = Some(WardCursor {
            occurred_at: last.date.and_time(chrono::NaiveTime::MIN).and_utc(),
            id: Uuid::nil(),
        });
        days.extend(rows);
    }
    assert_eq!(days.len(), 125);
    assert_eq!(
        days.iter().map(|day| day.total_intake_ml).sum::<i64>(),
        1250
    );
    assert_eq!(days.first().unwrap().date, start.date_naive());
    assert_eq!(
        days.last().unwrap().date,
        (end - Duration::days(1)).date_naive()
    );
    let foreign = hms_db::ward::fluid_balance_summary(db.pool(), Uuid::new_v4(), filters.clone())
        .await
        .unwrap();
    assert_eq!(foreign.entry_count, 0);
    let empty = hms_db::ward::fluid_balance_summary(
        db.pool(),
        db.facility_id(),
        FluidBalanceFilters {
            recorded_from: Some(end + Duration::days(1)),
            recorded_before: Some(end + Duration::days(2)),
            ..filters
        },
    )
    .await
    .unwrap();
    assert_eq!(
        (empty.entry_count, empty.total_intake_ml, empty.net_ml),
        (0, 0, 0)
    );
}
