use chrono::{Duration, Utc};
use hms_db::clinical::{ChronicleTimelineFilters, NewPrescription};
use hms_db::test_support::TestDb;
use hms_domain::clinical::PrescriptionStatus;
use uuid::Uuid;

#[tokio::test]
async fn chronicle_active_medications_filter_before_limit_and_preserve_scoped_history() {
    let db = TestDb::hospital().await.expect("test database provisions");
    let patient = db
        .scenario("active-medications")
        .registered_patient()
        .await
        .unwrap();
    let other = db
        .scenario("other-medications")
        .registered_patient()
        .await
        .unwrap();
    let mut active_ids = Vec::new();
    for patient_id in [patient.id, patient.id, other.id] {
        let prescription = hms_db::clinical::create_prescription(
            db.pool(),
            NewPrescription {
                id: Uuid::new_v4(),
                facility_id: db.facility_id(),
                patient_id,
                encounter_id: None,
                visit_id: None,
                discharge_case_id: None,
                medication_name: "Synthetic active medication".to_owned(),
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
        if patient_id == patient.id {
            active_ids.push(prescription.id);
        }
    }
    // A complete first history page contains only newer held/ended orders. The
    // active slice must independently find the older active orders in SQL.
    let historical_ids = (0..5000).map(|_| Uuid::new_v4()).collect::<Vec<_>>();
    sqlx::query(r#"
        INSERT INTO prescriptions (id, facility_id, patient_id, medication_name, dose, route, frequency, status, prescribed_at)
        SELECT id, $2, $3, 'Synthetic historical medication', '1 tablet', 'oral', 'daily',
            CASE sequence % 3 WHEN 0 THEN 'on_hold' WHEN 1 THEN 'stopped' ELSE 'completed' END,
            $4 + sequence * interval '1 second'
        FROM unnest($1::uuid[]) WITH ORDINALITY AS seeds(id, sequence)
    "#).bind(&historical_ids).bind(db.facility_id()).bind(patient.id).bind(Utc::now() + Duration::hours(1))
        .execute(db.pool()).await.unwrap();
    let foreign_facility = Uuid::new_v4();
    sqlx::query("INSERT INTO facilities (id, code, name, deployment_profile) VALUES ($1, 'MED-PROJECTION-OTHER', 'Synthetic other facility', 'hospital')")
        .bind(foreign_facility).execute(db.pool()).await.unwrap();
    sqlx::query("INSERT INTO prescriptions (id, facility_id, patient_id, medication_name, dose, frequency, status) VALUES ($1, $2, $3, 'Synthetic foreign medication', '1 tablet', 'daily', 'active')")
        .bind(Uuid::new_v4()).bind(foreign_facility).bind(patient.id).execute(db.pool()).await.unwrap();
    sqlx::query("ANALYZE prescriptions")
        .execute(db.pool())
        .await
        .unwrap();
    let plan: serde_json::Value = sqlx::query_scalar(
        r#"
        EXPLAIN (FORMAT JSON)
        SELECT id, patient_id, encounter_id, visit_id, discharge_case_id,
               medication_name, dose, route, frequency, inventory_item_id,
               start_date, duration_days, first_dose_at, status, prescribed_at
        FROM prescriptions
        WHERE facility_id = $1 AND patient_id = $2 AND status = 'active'
        ORDER BY prescribed_at DESC, id ASC LIMIT 20
    "#,
    )
    .bind(db.facility_id())
    .bind(patient.id)
    .fetch_one(db.pool())
    .await
    .unwrap();
    let plan = plan.to_string();
    assert!(
        plan.contains("prescriptions_patient_status_idx"),
        "long history should use the existing status-scoped index"
    );
    assert!(
        !plan.contains("Seq Scan"),
        "inactive history must not require a table scan"
    );
    let (startup, query_count) = hms_observability::with_request_query_counter(
        hms_db::clinical::patient_chronicle_startup_for_patient(
            db.pool(),
            &patient,
            20,
            100,
            None,
            ChronicleTimelineFilters::default(),
        ),
    )
    .await;
    let startup = startup.unwrap();
    assert_eq!(
        query_count, 1,
        "independent active slice stays in the shaped startup query"
    );
    assert_eq!(startup.prescriptions.len(), 20);
    assert!(startup
        .prescriptions
        .iter()
        .all(|rx| rx.status != PrescriptionStatus::Active));
    assert_eq!(startup.active_medications.len(), 2);
    assert!(startup
        .active_medications
        .iter()
        .all(|rx| rx.status == PrescriptionStatus::Active && active_ids.contains(&rx.id)));
    for status in ["on_hold", "stopped", "completed"] {
        assert!(startup
            .timeline_entries
            .iter()
            .any(|entry| entry.entry_type == "prescription" && entry.data["status"] == status));
    }
    let bounded = hms_db::clinical::patient_chronicle_startup_for_patient(
        db.pool(),
        &patient,
        1,
        1,
        None,
        ChronicleTimelineFilters::default(),
    )
    .await
    .unwrap();
    assert_eq!(bounded.prescriptions.len(), 1);
    assert_eq!(bounded.active_medications.len(), 1);
    assert!(active_ids.contains(&bounded.active_medications[0].id));
}
