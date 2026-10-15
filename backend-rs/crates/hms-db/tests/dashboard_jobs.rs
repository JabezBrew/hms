use hms_db::dashboard::{
    self, DashboardProjectionJobClaim, DashboardProjectionRefreshFailure,
    DashboardProjectionRefreshJob,
};
use hms_db::test_support::TestDb;
use hms_domain::deployment::DeploymentProfile;
use uuid::Uuid;

async fn queue(db: &TestDb) {
    assert!(
        dashboard::queue_dashboard_projection_refresh(
            db.pool(),
            db.facility_id(),
            DeploymentProfile::Hospital,
        )
        .await
        .expect("refresh queues")
        .inserted
    );
}

async fn claim(db: &TestDb, worker: &str) -> DashboardProjectionRefreshJob {
    match dashboard::lock_next_dashboard_projection_refresh_job(db.pool(), worker)
        .await
        .expect("job claim succeeds")
        .expect("job is available")
    {
        DashboardProjectionJobClaim::Ready(job) => job,
        other => panic!("expected a ready job, got {other:?}"),
    }
}

async fn expire_lease(db: &TestDb, job_id: Uuid) {
    sqlx::query("UPDATE jobs SET locked_at = now() - INTERVAL '121 seconds' WHERE id = $1")
        .bind(job_id)
        .execute(db.pool())
        .await
        .expect("abandoned lease is simulated");
}

#[tokio::test]
async fn abandoned_refresh_is_reclaimed_and_old_owner_cannot_finish_or_fail_it() {
    let db = TestDb::hospital().await.expect("test database provisions");
    queue(&db).await;
    let old_job = claim(&db, "old-worker").await;
    assert!(
        dashboard::lock_next_dashboard_projection_refresh_job(db.pool(), "other-worker")
            .await
            .expect("active lease check succeeds")
            .is_none()
    );
    assert!(
        !dashboard::queue_dashboard_projection_refresh(
            db.pool(),
            db.facility_id(),
            DeploymentProfile::Hospital,
        )
        .await
        .expect("active refresh stays deduplicated")
        .inserted
    );

    expire_lease(&db, old_job.id).await;
    // An expired owner cannot finalize even before another worker reclaims it.
    assert!(
        !dashboard::complete_dashboard_projection_refresh_job(db.pool(), &old_job)
            .await
            .expect("expired completion is fenced")
    );
    // Worker identifiers can repeat after a restart or across containers. The
    // attempt fence must still reject a handle from the previous claim.
    let new_job = claim(&db, "old-worker").await;
    assert_eq!(old_job.id, new_job.id);
    assert!(
        !dashboard::complete_dashboard_projection_refresh_job(db.pool(), &old_job)
            .await
            .expect("old completion is fenced")
    );
    assert!(!dashboard::fail_dashboard_projection_refresh_job(
        db.pool(),
        &old_job,
        DashboardProjectionRefreshFailure::RefreshFailed,
    )
    .await
    .expect("old failure is fenced"));

    let state: (String, i32, Option<String>) =
        sqlx::query_as("SELECT status, attempts, locked_by FROM jobs WHERE id = $1")
            .bind(new_job.id)
            .fetch_one(db.pool())
            .await
            .expect("new lease state loads");
    assert_eq!(
        state,
        ("running".to_owned(), 2, Some("old-worker".to_owned()))
    );
    assert!(
        dashboard::complete_dashboard_projection_refresh_job(db.pool(), &new_job)
            .await
            .expect("new owner completes")
    );
    assert!(
        !dashboard::complete_dashboard_projection_refresh_job(db.pool(), &new_job)
            .await
            .expect("completion cannot be replayed")
    );
    queue(&db).await;
}

#[tokio::test]
async fn repeated_worker_crashes_exhaust_attempts_and_release_the_refresh_slot() {
    let db = TestDb::hospital().await.expect("test database provisions");
    queue(&db).await;
    let job = claim(&db, "worker-1").await;
    expire_lease(&db, job.id).await;
    let job = claim(&db, "worker-2").await;
    expire_lease(&db, job.id).await;
    let job = claim(&db, "worker-3").await;
    expire_lease(&db, job.id).await;

    assert!(matches!(
        dashboard::lock_next_dashboard_projection_refresh_job(db.pool(), "worker-4")
            .await
            .expect("exhausted job is retired"),
        Some(DashboardProjectionJobClaim::Rejected)
    ));
    let state: (
        String,
        i32,
        Option<String>,
        Option<chrono::DateTime<chrono::Utc>>,
        String,
    ) = sqlx::query_as(
        "SELECT status, attempts, locked_by, locked_at, last_error FROM jobs WHERE id = $1",
    )
    .bind(job.id)
    .fetch_one(db.pool())
    .await
    .expect("terminal state loads");
    assert_eq!(state.0, "failed");
    assert_eq!(state.1, 3);
    assert!(state.2.is_none());
    assert!(state.3.is_none());
    assert_eq!(state.4, "dashboard_projection_attempts_exhausted");
    queue(&db).await;
}

#[tokio::test]
async fn refresh_failure_backs_off_and_stops_after_three_attempts() {
    let db = TestDb::hospital().await.expect("test database provisions");
    queue(&db).await;
    let mut job = claim(&db, "worker").await;
    for attempt in 1..=3 {
        assert!(dashboard::fail_dashboard_projection_refresh_job(
            db.pool(),
            &job,
            DashboardProjectionRefreshFailure::TimedOut,
        )
        .await
        .expect("failure is recorded"));
        assert!(!dashboard::fail_dashboard_projection_refresh_job(
            db.pool(),
            &job,
            DashboardProjectionRefreshFailure::RefreshFailed,
        )
        .await
        .expect("failure cannot be replayed"));
        assert!(
            dashboard::lock_next_dashboard_projection_refresh_job(db.pool(), "worker")
                .await
                .expect("retry waits for backoff")
                .is_none()
        );
        let state: (String, i32, String) =
            sqlx::query_as("SELECT status, attempts, last_error FROM jobs WHERE id = $1")
                .bind(job.id)
                .fetch_one(db.pool())
                .await
                .expect("retry state loads");
        assert_eq!(state.0, if attempt == 3 { "failed" } else { "queued" });
        assert_eq!(state.1, attempt);
        assert_eq!(state.2, "dashboard_projection_refresh_timed_out");
        if attempt < 3 {
            sqlx::query("UPDATE jobs SET available_at = now() - INTERVAL '1 second' WHERE id = $1")
                .bind(job.id)
                .execute(db.pool())
                .await
                .expect("backoff expiry is simulated");
            job = claim(&db, "worker").await;
        }
    }
    queue(&db).await;
}

#[tokio::test]
async fn malformed_refresh_is_failed_without_echoing_payload_or_blocking_a_replacement() {
    let db = TestDb::hospital().await.expect("test database provisions");
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO jobs (id, kind, payload) VALUES ($1, $2, $3)")
        .bind(id)
        .bind(dashboard::DASHBOARD_REFRESH_JOB_KIND)
        .bind(serde_json::json!({
            "facility_id": db.facility_id(),
            "snapshot_key": dashboard::DASHBOARD_SNAPSHOT_KEY,
            "deployment_profile": "synthetic-sensitive-value",
        }))
        .execute(db.pool())
        .await
        .expect("malformed job inserts");

    assert!(matches!(
        dashboard::lock_next_dashboard_projection_refresh_job(db.pool(), "worker")
            .await
            .expect("malformed job is handled"),
        Some(DashboardProjectionJobClaim::Rejected)
    ));
    let state: (String, String, Option<String>) =
        sqlx::query_as("SELECT status, last_error, locked_by FROM jobs WHERE id = $1")
            .bind(id)
            .fetch_one(db.pool())
            .await
            .expect("malformed job state loads");
    assert_eq!(
        state,
        (
            "failed".to_owned(),
            "invalid_dashboard_projection_payload".to_owned(),
            None
        )
    );
    queue(&db).await;
    claim(&db, "worker").await;
}

#[tokio::test]
async fn concurrent_workers_claim_a_refresh_once_and_leave_other_job_families_untouched() {
    let db = TestDb::hospital().await.expect("test database provisions");
    queue(&db).await;
    let other_id = Uuid::new_v4();
    sqlx::query("INSERT INTO jobs (id, kind, status, locked_at, attempts) VALUES ($1, 'other_kind', 'running', now() - INTERVAL '1 day', 3)")
        .bind(other_id)
        .execute(db.pool())
        .await
        .expect("other job family inserts");
    let (first, second) = tokio::join!(
        dashboard::lock_next_dashboard_projection_refresh_job(db.pool(), "worker-1"),
        dashboard::lock_next_dashboard_projection_refresh_job(db.pool(), "worker-2"),
    );
    let claims = [
        first.expect("first claim succeeds"),
        second.expect("second claim succeeds"),
    ];
    assert_eq!(
        claims
            .iter()
            .filter(|claim| matches!(claim, Some(DashboardProjectionJobClaim::Ready(_))))
            .count(),
        1
    );
    assert_eq!(claims.iter().filter(|claim| claim.is_none()).count(), 1);
    let status: String = sqlx::query_scalar("SELECT status FROM jobs WHERE id = $1")
        .bind(other_id)
        .fetch_one(db.pool())
        .await
        .expect("other job state loads");
    assert_eq!(status, "running");
}

#[tokio::test]
async fn expired_and_reclaimed_attempts_cannot_create_or_overwrite_a_snapshot() {
    let db = TestDb::hospital().await.expect("test database provisions");
    queue(&db).await;
    let old_job = claim(&db, "worker").await;
    expire_lease(&db, old_job.id).await;
    assert!(
        !dashboard::refresh_dashboard_projection_for_job(db.pool(), &old_job)
            .await
            .expect("expired projection write is fenced")
    );
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM dashboard_snapshots")
        .fetch_one(db.pool())
        .await
        .expect("snapshot count loads");
    assert_eq!(count, 0);

    let new_job = claim(&db, "worker").await;
    assert!(
        !dashboard::refresh_dashboard_projection_for_job(db.pool(), &old_job)
            .await
            .expect("previous attempt cannot use the replacement lease")
    );
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM dashboard_snapshots")
        .fetch_one(db.pool())
        .await
        .expect("snapshot count reloads");
    assert_eq!(count, 0);
    assert!(
        dashboard::refresh_dashboard_projection_for_job(db.pool(), &new_job)
            .await
            .expect("current claim persists and completes atomically")
    );
    let before: (
        serde_json::Value,
        chrono::DateTime<chrono::Utc>,
        chrono::DateTime<chrono::Utc>,
    ) = sqlx::query_as(
        "SELECT metrics, generated_at, updated_at FROM dashboard_snapshots WHERE facility_id = $1",
    )
    .bind(db.facility_id())
    .fetch_one(db.pool())
    .await
    .expect("new snapshot loads");
    assert!(
        !dashboard::refresh_dashboard_projection_for_job(db.pool(), &old_job)
            .await
            .expect("previous attempt cannot overwrite the new snapshot")
    );
    let after: (
        serde_json::Value,
        chrono::DateTime<chrono::Utc>,
        chrono::DateTime<chrono::Utc>,
    ) = sqlx::query_as(
        "SELECT metrics, generated_at, updated_at FROM dashboard_snapshots WHERE facility_id = $1",
    )
    .bind(db.facility_id())
    .fetch_one(db.pool())
    .await
    .expect("snapshot reloads");
    assert_eq!(before, after);
    let status: String = sqlx::query_scalar("SELECT status FROM jobs WHERE id = $1")
        .bind(new_job.id)
        .fetch_one(db.pool())
        .await
        .expect("job status loads");
    assert_eq!(status, "completed");
}

#[tokio::test]
async fn blocked_snapshot_write_is_cancelled_by_postgres_and_does_not_complete_the_job() {
    let db = TestDb::hospital().await.expect("test database provisions");
    let initial = dashboard::refresh_dashboard_projection(
        db.pool(),
        db.facility_id(),
        DeploymentProfile::Hospital,
    )
    .await
    .expect("initial snapshot persists");
    queue(&db).await;
    let job = claim(&db, "worker").await;
    let refresh_pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect_with(db.pool().connect_options().as_ref().clone())
        .await
        .expect("single refresh connection opens");
    let original_settings: (String, String, String) = sqlx::query_as(
        "SELECT current_setting('statement_timeout'), current_setting('lock_timeout'), current_setting('idle_in_transaction_session_timeout')"
    ).fetch_one(&refresh_pool).await.expect("original session settings load");
    let mut blocker = db.pool().begin().await.expect("snapshot lock opens");
    sqlx::query("UPDATE dashboard_snapshots SET updated_at = updated_at WHERE facility_id = $1")
        .bind(db.facility_id())
        .execute(&mut *blocker)
        .await
        .expect("snapshot row is locked");

    let started = std::time::Instant::now();
    let error = dashboard::refresh_dashboard_projection_for_job(&refresh_pool, &job)
        .await
        .expect_err("Postgres must cancel the blocked write");
    let code = error
        .downcast_ref::<sqlx::Error>()
        .and_then(|error| error.as_database_error())
        .and_then(|error| error.code());
    assert_eq!(code.as_deref(), Some("55P03"));
    assert!(started.elapsed() < std::time::Duration::from_secs(15));
    let settings_after: (String, String, String) = sqlx::query_as(
        "SELECT current_setting('statement_timeout'), current_setting('lock_timeout'), current_setting('idle_in_transaction_session_timeout')"
    ).fetch_one(&refresh_pool).await.expect("connection recovers and local settings reset");
    assert_eq!(original_settings, settings_after);
    let status: String = sqlx::query_scalar("SELECT status FROM jobs WHERE id = $1")
        .bind(job.id)
        .fetch_one(db.pool())
        .await
        .expect("job status loads");
    assert_eq!(status, "running");
    let generated_at: chrono::DateTime<chrono::Utc> =
        sqlx::query_scalar("SELECT generated_at FROM dashboard_snapshots WHERE facility_id = $1")
            .bind(db.facility_id())
            .fetch_one(db.pool())
            .await
            .expect("original snapshot remains");
    assert_eq!(generated_at, initial.generated_at);
    blocker.rollback().await.expect("snapshot lock is released");
    assert!(
        dashboard::refresh_dashboard_projection_for_job(&refresh_pool, &job)
            .await
            .expect("same valid claim can complete after lock release")
    );
    refresh_pool.close().await;
}
