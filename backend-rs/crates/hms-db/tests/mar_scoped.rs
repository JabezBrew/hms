use chrono::{Duration, TimeZone, Utc};
use hms_db::test_support::TestDb;
use hms_db::ward::{MedicationAdministrationFilters, WardCursor};
use hms_domain::ward::MedicationAdministrationStatus;
use uuid::Uuid;

#[tokio::test]
async fn mar_scopes_schedule_before_limit_and_pages_in_both_directions() {
    let db = TestDb::hospital().await.unwrap();
    let care = db
        .scenario("mar-selected")
        .admission_case_with_available_bed()
        .await
        .unwrap();
    let other = db
        .scenario("mar-unrelated")
        .admission_case_with_available_bed()
        .await
        .unwrap();
    let start = Utc.with_ymd_and_hms(2026, 6, 1, 0, 0, 0).unwrap();
    let end = start + Duration::minutes(125);
    let prior_admission = Uuid::new_v4();
    sqlx::query("INSERT INTO admission_cases (id, facility_id, patient_id, ward_id, status) VALUES ($1, $2, $3, $4, 'discharged')")
        .bind(prior_admission).bind(db.facility_id()).bind(care.patient.id).bind(care.ward.id).execute(db.pool()).await.unwrap();
    for (admission, patient, count, offset) in [
        (other.admission.id, other.patient.id, 250_i32, -250_i64),
        (prior_admission, care.patient.id, 150_i32, 0_i64),
        (care.admission.id, care.patient.id, 125_i32, 0_i64),
    ] {
        sqlx::query("INSERT INTO medication_administrations (id, facility_id, admission_case_id, patient_id, medication_name, scheduled_at, status) SELECT gen_random_uuid(), $1, $2, $3, 'Synthetic scoped dose', $4 + (sequence + $6) * interval '1 minute', CASE WHEN sequence % 2 = 0 THEN 'scheduled' ELSE 'administered' END FROM generate_series(0, $5 - 1) AS sequence")
            .bind(db.facility_id()).bind(admission).bind(patient).bind(start).bind(count).bind(offset)
            .execute(db.pool()).await.unwrap();
    }
    // Both bounds have adjacent records; end is exclusive.
    for timestamp in [start - Duration::minutes(1), end] {
        sqlx::query("INSERT INTO medication_administrations (id, facility_id, admission_case_id, patient_id, medication_name, scheduled_at, status) VALUES ($1, $2, $3, $4, 'Synthetic outside window', $5, 'scheduled')")
            .bind(Uuid::new_v4()).bind(db.facility_id()).bind(care.admission.id).bind(care.patient.id).bind(timestamp)
            .execute(db.pool()).await.unwrap();
    }
    let filters = MedicationAdministrationFilters {
        patient_id: Some(care.patient.id),
        admission_case_id: Some(care.admission.id),
        scheduled_from: Some(start),
        scheduled_before: Some(end),
        ..Default::default()
    };
    let mut ascending = Vec::new();
    let mut cursor = None;
    loop {
        let (page, count) = hms_observability::with_request_query_counter(
            hms_db::ward::list_medication_administrations_scoped(
                db.pool(),
                db.facility_id(),
                filters.clone(),
                cursor,
                50,
            ),
        )
        .await;
        let page = page.unwrap();
        assert_eq!(count, 1);
        assert!(page.len() <= 50);
        assert!(page.iter().all(|row| row.patient_id == care.patient.id
            && row.admission_case_id == care.admission.id
            && row.scheduled_at >= start
            && row.scheduled_at < end));
        let Some(last) = page.last() else { break };
        cursor = Some(WardCursor {
            occurred_at: last.scheduled_at,
            id: last.id,
        });
        ascending.extend(page.into_iter().map(|row| row.id));
    }
    assert_eq!(ascending.len(), 125);
    assert_eq!(
        ascending
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len(),
        125
    );
    let descending = hms_db::ward::list_medication_administrations_scoped(
        db.pool(),
        db.facility_id(),
        MedicationAdministrationFilters {
            descending: true,
            ..filters.clone()
        },
        None,
        101,
    )
    .await
    .unwrap();
    assert_eq!(descending.len(), 101);
    assert_eq!(descending[0].id, *ascending.last().unwrap());
    let last = descending.last().unwrap();
    let next = hms_db::ward::list_medication_administrations_scoped(
        db.pool(),
        db.facility_id(),
        MedicationAdministrationFilters {
            descending: true,
            ..filters.clone()
        },
        Some(WardCursor {
            occurred_at: last.scheduled_at,
            id: last.id,
        }),
        101,
    )
    .await
    .unwrap();
    let reversed = descending
        .into_iter()
        .chain(next)
        .map(|row| row.id)
        .collect::<Vec<_>>();
    assert_eq!(reversed, ascending.into_iter().rev().collect::<Vec<_>>());
    let scheduled = hms_db::ward::list_medication_administrations_scoped(
        db.pool(),
        db.facility_id(),
        MedicationAdministrationFilters {
            status: Some(MedicationAdministrationStatus::Scheduled),
            ..filters.clone()
        },
        None,
        101,
    )
    .await
    .unwrap();
    assert_eq!(scheduled.len(), 63);
    // A linked legacy dose without a valid course projects as held. Filtering
    // must use that effective state rather than the unsafe raw scheduled row.
    let prescription = hms_db::clinical::create_prescription(
        db.pool(),
        hms_db::clinical::NewPrescription {
            id: Uuid::new_v4(),
            facility_id: db.facility_id(),
            patient_id: care.patient.id,
            encounter_id: None,
            visit_id: None,
            discharge_case_id: None,
            medication_name: "Synthetic scoped dose".to_owned(),
            dose: "1 tablet".to_owned(),
            route: "oral".to_owned(),
            frequency: "daily".to_owned(),
            inventory_item_id: None,
            start_date: None,
            duration_days: None,
            first_dose_at: None,
            actor_user_id: db.owner_user_id(),
        },
    )
    .await
    .unwrap();
    let stale_id = scheduled[0].id;
    sqlx::query("UPDATE medication_administrations SET prescription_id = $1 WHERE id = $2")
        .bind(prescription.id)
        .bind(stale_id)
        .execute(db.pool())
        .await
        .unwrap();
    let scheduled = hms_db::ward::list_medication_administrations_scoped(
        db.pool(),
        db.facility_id(),
        MedicationAdministrationFilters {
            status: Some(MedicationAdministrationStatus::Scheduled),
            ..filters.clone()
        },
        None,
        101,
    )
    .await
    .unwrap();
    assert_eq!(scheduled.len(), 62);
    assert!(scheduled.iter().all(|row| row.id != stale_id));
    let held = hms_db::ward::list_medication_administrations_scoped(
        db.pool(),
        db.facility_id(),
        MedicationAdministrationFilters {
            status: Some(MedicationAdministrationStatus::Held),
            ..filters.clone()
        },
        None,
        101,
    )
    .await
    .unwrap();
    assert_eq!(held.len(), 1);
    assert_eq!(held[0].id, stale_id);
    let foreign = hms_db::ward::list_medication_administrations_scoped(
        db.pool(),
        Uuid::new_v4(),
        filters,
        None,
        101,
    )
    .await
    .unwrap();
    assert!(foreign.is_empty());
}
