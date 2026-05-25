use hms_db::provision::{provision_baseline, BaselineProvisioning};
use hms_domain::capabilities::deployment_capabilities;
use hms_domain::deployment::DeploymentProfile;
use hms_domain::ward::BedStatus;
use std::time::Duration;
use uuid::Uuid;

#[tokio::test]
async fn dashboard_projection_read_is_one_query_and_does_not_refresh_fresh_projection() {
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
    let navigation =
        deployment_capabilities(DeploymentProfile::Hospital, facility_id, "HMS").navigation;

    let refreshed = hms_db::dashboard::refresh_dashboard_projection(
        &pool,
        facility_id,
        DeploymentProfile::Hospital,
    )
    .await
    .expect("dashboard projection refreshes");
    let first_updated_at: chrono::DateTime<chrono::Utc> = sqlx::query_scalar(
        "SELECT updated_at FROM dashboard_snapshots WHERE facility_id = $1 AND snapshot_key = 'operations'",
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("snapshot updated_at can be read");

    tokio::time::sleep(Duration::from_millis(10)).await;

    let (read, observed_queries) = hms_observability::with_request_query_counter(async {
        hms_db::dashboard::read_dashboard_projection(&pool, facility_id, navigation).await
    })
    .await;
    let read = read.expect("fresh dashboard projection reads");
    let second_updated_at: chrono::DateTime<chrono::Utc> = sqlx::query_scalar(
        "SELECT updated_at FROM dashboard_snapshots WHERE facility_id = $1 AND snapshot_key = 'operations'",
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("snapshot updated_at can be read again");

    let snapshot = read.snapshot.expect("fresh projection is present");
    assert_eq!(observed_queries, 1);
    assert!(!read.is_stale);
    assert_eq!(read.generated_at, Some(refreshed.generated_at));
    assert_eq!(refreshed.id, snapshot.id);
    assert_eq!(refreshed.generated_at, snapshot.generated_at);
    assert_eq!(first_updated_at, second_updated_at);
    let queued_refresh_count: i64 = sqlx::query_scalar(
        "SELECT count(*)::bigint FROM jobs WHERE kind = $1 AND status IN ('queued', 'running')",
    )
    .bind(hms_db::dashboard::DASHBOARD_REFRESH_JOB_KIND)
    .fetch_one(&pool)
    .await
    .expect("queued refresh count loads");
    assert_eq!(queued_refresh_count, 0);
}

#[tokio::test]
async fn stale_dashboard_projection_queues_one_refresh_without_snapshot_write() {
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
    let navigation =
        deployment_capabilities(DeploymentProfile::Hospital, facility_id, "HMS").navigation;
    hms_db::dashboard::refresh_dashboard_projection(
        &pool,
        facility_id,
        DeploymentProfile::Hospital,
    )
    .await
    .expect("dashboard projection refreshes");
    sqlx::query(
        "UPDATE dashboard_snapshots
         SET generated_at = now() - INTERVAL '31 seconds'
         WHERE facility_id = $1 AND snapshot_key = 'operations'",
    )
    .bind(facility_id)
    .execute(&pool)
    .await
    .expect("projection is aged");
    let aged_updated_at: chrono::DateTime<chrono::Utc> = sqlx::query_scalar(
        "SELECT updated_at FROM dashboard_snapshots WHERE facility_id = $1 AND snapshot_key = 'operations'",
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("snapshot updated_at can be read");

    let read = hms_db::dashboard::read_dashboard_projection(&pool, facility_id, navigation)
        .await
        .expect("stale dashboard projection reads");
    assert!(read.snapshot.is_some());
    assert!(read.is_stale);

    let first_queue = hms_db::dashboard::queue_dashboard_projection_refresh(
        &pool,
        facility_id,
        DeploymentProfile::Hospital,
    )
    .await
    .expect("first refresh queues");
    let second_queue = hms_db::dashboard::queue_dashboard_projection_refresh(
        &pool,
        facility_id,
        DeploymentProfile::Hospital,
    )
    .await
    .expect("duplicate refresh is deduped");
    let queued_refresh_count: i64 = sqlx::query_scalar(
        "SELECT count(*)::bigint FROM jobs WHERE kind = $1 AND status = 'queued'",
    )
    .bind(hms_db::dashboard::DASHBOARD_REFRESH_JOB_KIND)
    .fetch_one(&pool)
    .await
    .expect("queued refresh count loads");
    let current_updated_at: chrono::DateTime<chrono::Utc> = sqlx::query_scalar(
        "SELECT updated_at FROM dashboard_snapshots WHERE facility_id = $1 AND snapshot_key = 'operations'",
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("snapshot updated_at can be read again");

    assert!(first_queue.queued);
    assert!(first_queue.inserted);
    assert!(second_queue.queued);
    assert!(!second_queue.inserted);
    assert_eq!(queued_refresh_count, 1);
    assert_eq!(aged_updated_at, current_updated_at);
}

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

#[tokio::test]
async fn notification_counts_are_user_and_facility_scoped() {
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
    let owner_user_id = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
    let limited_user_id = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    let other_facility_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO facilities (id, code, name, deployment_profile, is_active)
         VALUES ($1, 'NOTIFY-OTHER', 'Notify Other Facility', 'hospital', true)",
    )
    .bind(other_facility_id)
    .execute(&pool)
    .await
    .expect("other facility inserts");

    for (recipient_user_id, scoped_facility_id, title, read) in [
        (owner_user_id, facility_id, "Owner unread", false),
        (owner_user_id, facility_id, "Owner read", true),
        (limited_user_id, facility_id, "Limited unread", false),
        (
            owner_user_id,
            other_facility_id,
            "Other facility unread",
            false,
        ),
    ] {
        sqlx::query(
            "INSERT INTO notifications (
                id, facility_id, recipient_user_id, notification_type, title, body, priority, read_at
             ) VALUES ($1, $2, $3, 'system', $4, 'Body', 'normal', CASE WHEN $5 THEN now() ELSE NULL END)",
        )
        .bind(Uuid::new_v4())
        .bind(scoped_facility_id)
        .bind(recipient_user_id)
        .bind(title)
        .bind(read)
        .execute(&pool)
        .await
        .expect("notification inserts");
    }

    let counts = hms_db::dashboard::notification_counts(&pool, facility_id, owner_user_id)
        .await
        .expect("notification counts aggregate");

    assert_eq!(counts.total, 3);
    assert_eq!(counts.unread, 2);
    assert_eq!(counts.action_required, 0);
}
