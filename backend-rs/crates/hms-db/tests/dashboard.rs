use hms_db::provision::{provision_baseline, BaselineProvisioning};
use hms_domain::deployment::DeploymentProfile;
use hms_domain::ward::BedStatus;

#[tokio::test]
async fn admin_capacity_summary_uses_facility_scoped_aggregates() {
    let database =
        hms_db::test_support::TestDatabase::create().expect("test database is available");
    let pool = hms_db::connect(database.database_url())
        .await
        .expect("database connects");

    hms_db::migrate::run(&pool).await.expect("migrations apply");
    provision_baseline(
        &pool,
        &BaselineProvisioning::hms_local(DeploymentProfile::Hospital),
    )
    .await
    .expect("baseline provisions");

    let facility_id = hms_db::facilities::facility_id_by_code(&pool, "HMS")
        .await
        .expect("facility query succeeds")
        .expect("facility exists");
    sqlx::query("UPDATE wards SET status = 'inactive' WHERE facility_id = $1")
        .bind(facility_id)
        .execute(&pool)
        .await
        .expect("baseline wards are deactivated for deterministic capacity test");
    let other_facility_id = uuid::Uuid::new_v4();
    sqlx::query(
        "INSERT INTO facilities (id, code, name, deployment_profile, is_active)
         VALUES ($1, 'OTHER', 'Other Facility', 'hospital', true)",
    )
    .bind(other_facility_id)
    .execute(&pool)
    .await
    .expect("other facility inserts");

    let first_ward_id = uuid::Uuid::new_v4();
    let second_ward_id = uuid::Uuid::new_v4();
    let inactive_ward_id = uuid::Uuid::new_v4();
    let other_ward_id = uuid::Uuid::new_v4();
    for (ward_id, scoped_facility_id, code, name, status) in [
        (
            first_ward_id,
            facility_id,
            "CAP-1",
            "Capacity Ward 1",
            "active",
        ),
        (
            second_ward_id,
            facility_id,
            "CAP-2",
            "Capacity Ward 2",
            "active",
        ),
        (
            inactive_ward_id,
            facility_id,
            "CAP-X",
            "Inactive Capacity Ward",
            "inactive",
        ),
        (
            other_ward_id,
            other_facility_id,
            "OTHER-CAP",
            "Other Facility Capacity Ward",
            "active",
        ),
    ] {
        sqlx::query(
            "INSERT INTO wards (id, facility_id, code, name, status)
             VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(ward_id)
        .bind(scoped_facility_id)
        .bind(code)
        .bind(name)
        .bind(status)
        .execute(&pool)
        .await
        .expect("ward inserts");
    }

    for (ward_id, scoped_facility_id, prefix, statuses) in [
        (
            first_ward_id,
            facility_id,
            "A",
            vec![
                BedStatus::Occupied,
                BedStatus::Occupied,
                BedStatus::Occupied,
                BedStatus::Occupied,
                BedStatus::Occupied,
                BedStatus::Occupied,
                BedStatus::Occupied,
                BedStatus::Occupied,
                BedStatus::Occupied,
                BedStatus::Available,
            ],
        ),
        (
            second_ward_id,
            facility_id,
            "B",
            vec![
                BedStatus::Occupied,
                BedStatus::Occupied,
                BedStatus::Available,
                BedStatus::Available,
            ],
        ),
        (
            inactive_ward_id,
            facility_id,
            "X",
            vec![BedStatus::Occupied, BedStatus::Available],
        ),
        (
            other_ward_id,
            other_facility_id,
            "O",
            vec![BedStatus::Occupied, BedStatus::Occupied],
        ),
    ] {
        for (index, status) in statuses.into_iter().enumerate() {
            sqlx::query(
                "INSERT INTO beds (id, facility_id, ward_id, bed_code, status)
                 VALUES ($1, $2, $3, $4, $5)",
            )
            .bind(uuid::Uuid::new_v4())
            .bind(scoped_facility_id)
            .bind(ward_id)
            .bind(format!("{prefix}-{}", index + 1))
            .bind(hms_db::codec::encode(status).expect("bed status encodes"))
            .execute(&pool)
            .await
            .expect("bed inserts");
        }
    }

    let summary = hms_db::dashboard::admin_capacity_summary(&pool, facility_id, 10)
        .await
        .expect("capacity summary aggregates");

    assert_eq!(summary.summary.ward_count, 2);
    assert_eq!(summary.summary.high_occupancy_wards, 1);
    assert_eq!(summary.wait_time.median_minutes, 0);
    assert_eq!(summary.wait_time.p95_minutes, 0);
    assert_eq!(summary.wards.len(), 2);
    assert!(summary
        .wards
        .iter()
        .any(|ward| ward.ward_id == first_ward_id
            && ward.total_beds == 10
            && ward.occupied_beds == 9
            && ward.available_beds == 1
            && (ward.occupancy_pct - 90.0).abs() < f64::EPSILON));
    assert!(summary
        .wards
        .iter()
        .any(|ward| ward.ward_id == second_ward_id
            && ward.total_beds == 4
            && ward.occupied_beds == 2
            && ward.available_beds == 2
            && (ward.occupancy_pct - 50.0).abs() < f64::EPSILON));
    assert!(!summary
        .wards
        .iter()
        .any(|ward| ward.ward_id == inactive_ward_id || ward.ward_id == other_ward_id));

    let bounded_summary = hms_db::dashboard::admin_capacity_summary(&pool, facility_id, 1)
        .await
        .expect("bounded capacity summary aggregates");
    assert_eq!(bounded_summary.summary.ward_count, 2);
    assert_eq!(bounded_summary.summary.high_occupancy_wards, 1);
    assert_eq!(bounded_summary.wards.len(), 1);
}
