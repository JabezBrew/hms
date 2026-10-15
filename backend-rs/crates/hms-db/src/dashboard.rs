use chrono::{DateTime, Duration, Utc};
use hms_domain::dashboard::{
    AdminCapacityCounts, AdminCapacitySummary, AdminCapacityWaitTime, AdminCapacityWard,
    DashboardMetric, DashboardSnapshot, NotificationCounts, NotificationListItem,
    NotificationPriority,
};
use hms_domain::deployment::{DeploymentProfile, FeatureKey, NavigationManifest, PermissionCode};
use serde::Deserialize;
use sqlx::{FromRow, PgConnection, Postgres, QueryBuilder, Transaction};
use uuid::Uuid;

use crate::{codec, PgPool};

pub const DASHBOARD_PROJECTION_TTL_SECONDS: i64 = 30;
pub const DASHBOARD_REFRESH_JOB_KIND: &str = "dashboard_projection_refresh";
pub const DASHBOARD_SNAPSHOT_KEY: &str = "operations";
const DASHBOARD_REFRESH_MAX_ATTEMPTS: i32 = 3;
pub const DASHBOARD_REFRESH_LEASE_SECONDS: i64 = 120;

pub struct NotificationCursor {
    pub occurred_at: DateTime<Utc>,
    pub id: Uuid,
}

#[derive(Clone)]
pub struct DashboardProjectionRead {
    pub snapshot: Option<DashboardSnapshot>,
    pub generated_at: Option<DateTime<Utc>>,
    pub is_stale: bool,
}

pub struct DashboardRefreshQueue {
    pub queued: bool,
    pub inserted: bool,
}

#[derive(Debug, Clone)]
pub struct DashboardProjectionRefreshJob {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub deployment_profile: DeploymentProfile,
    attempt: i32,
    worker_id: String,
}

#[derive(Debug)]
pub enum DashboardProjectionJobClaim {
    Ready(DashboardProjectionRefreshJob),
    Rejected,
}

pub enum DashboardProjectionRefreshFailure {
    RefreshFailed,
    TimedOut,
}

impl DashboardProjectionRefreshFailure {
    fn as_str(&self) -> &'static str {
        match self {
            Self::RefreshFailed => "dashboard_projection_refresh_failed",
            Self::TimedOut => "dashboard_projection_refresh_timed_out",
        }
    }
}

pub struct NewNotification {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub recipient_user_id: Uuid,
    pub notification_type: String,
    pub title: String,
    pub body: String,
    pub priority: NotificationPriority,
}

#[derive(FromRow)]
struct SnapshotRow {
    id: Uuid,
    deployment_profile: String,
    metrics: serde_json::Value,
    generated_at: DateTime<Utc>,
}

#[derive(FromRow)]
struct NotificationRow {
    id: Uuid,
    notification_type: String,
    title: String,
    body: String,
    priority: String,
    read_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
struct NotificationCountsRow {
    unread: i64,
    total: i64,
}

#[derive(FromRow)]
struct AdminCapacityWardRow {
    ward_id: Uuid,
    ward_name: String,
    total_beds: i64,
    occupied_beds: i64,
    available_beds: i64,
    occupancy_pct: f64,
    ward_count: i64,
    high_occupancy_wards: i64,
}

#[derive(FromRow)]
struct JobRow {
    id: Uuid,
    payload: serde_json::Value,
    attempts: i32,
    status: String,
}

#[derive(Deserialize)]
struct DashboardProjectionRefreshPayload {
    facility_id: Uuid,
    deployment_profile: DeploymentProfile,
    snapshot_key: Option<String>,
}

pub async fn read_dashboard_projection(
    pool: &PgPool,
    facility_id: Uuid,
    navigation: NavigationManifest,
) -> anyhow::Result<DashboardProjectionRead> {
    let snapshot = cached_dashboard_snapshot(pool, facility_id, navigation).await?;
    let generated_at = snapshot.as_ref().map(|snapshot| snapshot.generated_at);
    let is_stale = generated_at
        .map(dashboard_projection_is_stale)
        .unwrap_or(true);

    Ok(DashboardProjectionRead {
        snapshot,
        generated_at,
        is_stale,
    })
}

pub async fn refresh_dashboard_projection(
    pool: &PgPool,
    facility_id: Uuid,
    profile: DeploymentProfile,
) -> anyhow::Result<DashboardSnapshot> {
    let mut transaction = begin_projection_refresh(pool).await?;
    let metrics = dashboard_metrics(&mut transaction, facility_id).await?;
    let metrics_json = serde_json::to_value(&metrics)?;
    let id = Uuid::new_v4();
    let row = hms_observability::observe_db_query(
        "dashboard.refresh_projection",
        sqlx::query_as::<_, SnapshotRow>(
            "INSERT INTO dashboard_snapshots (
            id, facility_id, snapshot_key, deployment_profile, metrics, generated_at
         )
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (facility_id, snapshot_key) DO UPDATE
         SET deployment_profile = EXCLUDED.deployment_profile,
             metrics = EXCLUDED.metrics,
             generated_at = EXCLUDED.generated_at,
             updated_at = now()
         RETURNING id, deployment_profile, metrics, generated_at",
        )
        .bind(id)
        .bind(facility_id)
        .bind(DASHBOARD_SNAPSHOT_KEY)
        .bind(codec::encode(profile)?)
        .bind(metrics_json)
        .fetch_one(&mut *transaction),
    )
    .await?;
    transaction.commit().await?;

    Ok(DashboardSnapshot {
        id: row.id,
        deployment_profile: codec::decode(&row.deployment_profile)?,
        generated_at: row.generated_at,
        metrics: serde_json::from_value(row.metrics)?,
        navigation: NavigationManifest { groups: Vec::new() },
    })
}

/// Refresh and finalize only the current worker claim. The final statement locks
/// the job before touching the snapshot, so a reclaimed attempt cannot persist
/// stale metrics or complete another worker's job.
pub async fn refresh_dashboard_projection_for_job(
    pool: &PgPool,
    job: &DashboardProjectionRefreshJob,
) -> anyhow::Result<bool> {
    let mut transaction = begin_projection_refresh(pool).await?;
    // This read holds no job-row lock. Expensive aggregates cannot prevent
    // another worker from recovering an expired claim.
    let metrics = dashboard_metrics(&mut transaction, job.facility_id).await?;
    let result = hms_observability::observe_db_query(
        "dashboard.refresh_claimed_projection",
        sqlx::query(
            "WITH owned_job AS MATERIALIZED (
                 SELECT id FROM jobs
                 WHERE id = $1 AND kind = $2 AND status = 'running'
                   AND attempts = $3 AND locked_by = $4
                   AND locked_at > clock_timestamp() - make_interval(secs => $5)
                 FOR UPDATE
             ), persisted_snapshot AS (
                 INSERT INTO dashboard_snapshots (
                     id, facility_id, snapshot_key, deployment_profile, metrics, generated_at
                 )
                 SELECT $6, $7, $8, $9, $10, clock_timestamp() FROM owned_job
                 ON CONFLICT (facility_id, snapshot_key) DO UPDATE
                 SET deployment_profile = EXCLUDED.deployment_profile,
                     metrics = EXCLUDED.metrics,
                     generated_at = EXCLUDED.generated_at,
                     updated_at = clock_timestamp()
                 RETURNING id
             )
             UPDATE jobs SET status = 'completed', locked_by = NULL, locked_at = NULL,
                 last_error = NULL, updated_at = clock_timestamp()
             FROM owned_job, persisted_snapshot
             WHERE jobs.id = owned_job.id",
        )
        .bind(job.id)
        .bind(DASHBOARD_REFRESH_JOB_KIND)
        .bind(job.attempt)
        .bind(&job.worker_id)
        .bind(DASHBOARD_REFRESH_LEASE_SECONDS as f64)
        .bind(Uuid::new_v4())
        .bind(job.facility_id)
        .bind(DASHBOARD_SNAPSHOT_KEY)
        .bind(codec::encode(job.deployment_profile)?)
        .bind(serde_json::to_value(metrics)?)
        .execute(&mut *transaction),
    )
    .await?;
    transaction.commit().await?;
    Ok(result.rows_affected() == 1)
}

async fn begin_projection_refresh(pool: &PgPool) -> anyhow::Result<Transaction<'_, Postgres>> {
    let mut transaction = pool.begin().await?;
    // These settings apply only to this DB-only refresh transaction. PostgreSQL
    // must bound the work itself; dropping a SQLx future does not cancel a query.
    sqlx::query(
        "SELECT set_config('statement_timeout', '25s', true),
                set_config('lock_timeout', '3s', true),
                set_config('idle_in_transaction_session_timeout', '30s', true)",
    )
    .execute(&mut *transaction)
    .await?;
    Ok(transaction)
}

pub async fn queue_dashboard_projection_refresh(
    pool: &PgPool,
    facility_id: Uuid,
    profile: DeploymentProfile,
) -> anyhow::Result<DashboardRefreshQueue> {
    let id = Uuid::new_v4();
    let payload = serde_json::json!({
        "facility_id": facility_id,
        "deployment_profile": profile,
        "snapshot_key": DASHBOARD_SNAPSHOT_KEY,
    });
    let inserted_id = hms_observability::observe_db_query(
        "dashboard.queue_projection_refresh",
        sqlx::query_scalar::<_, Uuid>(
            "INSERT INTO jobs (id, kind, payload)
             VALUES ($1, $2, $3)
             ON CONFLICT DO NOTHING
             RETURNING id",
        )
        .bind(id)
        .bind(DASHBOARD_REFRESH_JOB_KIND)
        .bind(payload)
        .fetch_optional(pool),
    )
    .await?;

    Ok(DashboardRefreshQueue {
        queued: true,
        inserted: inserted_id.is_some(),
    })
}

pub async fn lock_next_dashboard_projection_refresh_job(
    pool: &PgPool,
    worker_id: &str,
) -> anyhow::Result<Option<DashboardProjectionJobClaim>> {
    let row = hms_observability::observe_db_query(
        "dashboard.lock_projection_refresh_job",
        sqlx::query_as::<_, JobRow>(
            r#"
            WITH next_job AS (
                SELECT id
                FROM jobs
                WHERE kind = $1
                  AND (
                      (status = 'queued' AND available_at <= now())
                      OR (status = 'running' AND
                          (locked_at IS NULL OR locked_at <= now() - make_interval(secs => $3)))
                  )
                ORDER BY available_at ASC, created_at ASC, id ASC
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            )
            UPDATE jobs
            SET status = CASE WHEN attempts >= $4 THEN 'failed' ELSE 'running' END,
                attempts = CASE WHEN attempts >= $4 THEN attempts ELSE attempts + 1 END,
                locked_by = CASE WHEN attempts >= $4 THEN NULL ELSE $2 END,
                locked_at = CASE WHEN attempts >= $4 THEN NULL ELSE now() END,
                last_error = CASE WHEN attempts >= $4
                    THEN 'dashboard_projection_attempts_exhausted' ELSE last_error END,
                updated_at = now()
            FROM next_job
            WHERE jobs.id = next_job.id
            RETURNING jobs.id, jobs.payload, jobs.attempts, jobs.status
            "#,
        )
        .bind(DASHBOARD_REFRESH_JOB_KIND)
        .bind(worker_id)
        .bind(DASHBOARD_REFRESH_LEASE_SECONDS as f64)
        .bind(DASHBOARD_REFRESH_MAX_ATTEMPTS)
        .fetch_optional(pool),
    )
    .await?;

    let Some(row) = row else { return Ok(None) };
    if row.status == "failed" {
        return Ok(Some(DashboardProjectionJobClaim::Rejected));
    }
    let job_id = row.id;
    let attempt = row.attempts;
    match dashboard_projection_job_from_row(row, worker_id) {
        Ok(job) => Ok(Some(DashboardProjectionJobClaim::Ready(job))),
        Err(_) => {
            // A poison payload must release the active-job deduplication slot. Never
            // persist serde errors: they can contain arbitrary payload values.
            hms_observability::observe_db_query(
                "dashboard.reject_projection_refresh_job",
                sqlx::query(
                    "UPDATE jobs SET status = 'failed', locked_by = NULL, locked_at = NULL,
                         last_error = 'invalid_dashboard_projection_payload', updated_at = now()
                     WHERE id = $1 AND kind = $2 AND status = 'running'
                       AND attempts = $3 AND locked_by = $4",
                )
                .bind(job_id)
                .bind(DASHBOARD_REFRESH_JOB_KIND)
                .bind(attempt)
                .bind(worker_id)
                .execute(pool),
            )
            .await?;
            Ok(Some(DashboardProjectionJobClaim::Rejected))
        }
    }
}

pub async fn complete_dashboard_projection_refresh_job(
    pool: &PgPool,
    job: &DashboardProjectionRefreshJob,
) -> anyhow::Result<bool> {
    let result = hms_observability::observe_db_query(
        "dashboard.complete_projection_refresh_job",
        sqlx::query(
            "UPDATE jobs
             SET status = 'completed',
                 locked_by = NULL,
                 locked_at = NULL,
                 last_error = NULL,
                 updated_at = now()
             WHERE id = $1
               AND kind = $2 AND status = 'running'
               AND attempts = $3 AND locked_by = $4
               AND locked_at > now() - make_interval(secs => $5)",
        )
        .bind(job.id)
        .bind(DASHBOARD_REFRESH_JOB_KIND)
        .bind(job.attempt)
        .bind(&job.worker_id)
        .bind(DASHBOARD_REFRESH_LEASE_SECONDS as f64)
        .execute(pool),
    )
    .await?;
    Ok(result.rows_affected() == 1)
}

pub async fn fail_dashboard_projection_refresh_job(
    pool: &PgPool,
    job: &DashboardProjectionRefreshJob,
    failure: DashboardProjectionRefreshFailure,
) -> anyhow::Result<bool> {
    let result = hms_observability::observe_db_query(
        "dashboard.fail_projection_refresh_job",
        sqlx::query(
            "UPDATE jobs
             SET status = CASE
                     WHEN attempts >= $3 THEN 'failed'
                     ELSE 'queued'
                 END,
                 available_at = CASE
                     WHEN attempts >= $3 THEN available_at
                     ELSE now() + INTERVAL '30 seconds'
                 END,
                 locked_by = NULL,
                 locked_at = NULL,
                 last_error = $2,
                 updated_at = now()
             WHERE id = $1
               AND kind = $4 AND status = 'running'
               AND attempts = $5 AND locked_by = $6
               AND locked_at > now() - make_interval(secs => $7)",
        )
        .bind(job.id)
        .bind(failure.as_str())
        .bind(DASHBOARD_REFRESH_MAX_ATTEMPTS)
        .bind(DASHBOARD_REFRESH_JOB_KIND)
        .bind(job.attempt)
        .bind(&job.worker_id)
        .bind(DASHBOARD_REFRESH_LEASE_SECONDS as f64)
        .execute(pool),
    )
    .await?;
    Ok(result.rows_affected() == 1)
}

async fn cached_dashboard_snapshot(
    pool: &PgPool,
    facility_id: Uuid,
    navigation: NavigationManifest,
) -> anyhow::Result<Option<DashboardSnapshot>> {
    let row = hms_observability::observe_db_query(
        "dashboard.cached_snapshot",
        sqlx::query_as::<_, SnapshotRow>(
            r#"
            SELECT id,
                   deployment_profile,
                   metrics,
                   generated_at
            FROM dashboard_snapshots
            WHERE facility_id = $1
              AND snapshot_key = $2
            "#,
        )
        .bind(facility_id)
        .bind(DASHBOARD_SNAPSHOT_KEY)
        .fetch_optional(pool),
    )
    .await?;

    row.map(|row| {
        Ok(DashboardSnapshot {
            id: row.id,
            deployment_profile: codec::decode(&row.deployment_profile)?,
            generated_at: row.generated_at,
            metrics: serde_json::from_value(row.metrics)?,
            navigation,
        })
    })
    .transpose()
}

fn dashboard_projection_is_stale(generated_at: DateTime<Utc>) -> bool {
    Utc::now().signed_duration_since(generated_at)
        >= Duration::seconds(DASHBOARD_PROJECTION_TTL_SECONDS)
}

fn dashboard_projection_job_from_row(
    row: JobRow,
    worker_id: &str,
) -> anyhow::Result<DashboardProjectionRefreshJob> {
    let payload: DashboardProjectionRefreshPayload = serde_json::from_value(row.payload)?;
    let snapshot_key = payload
        .snapshot_key
        .as_deref()
        .unwrap_or(DASHBOARD_SNAPSHOT_KEY);
    anyhow::ensure!(
        snapshot_key == DASHBOARD_SNAPSHOT_KEY,
        "unsupported dashboard projection snapshot key"
    );

    Ok(DashboardProjectionRefreshJob {
        id: row.id,
        facility_id: payload.facility_id,
        deployment_profile: payload.deployment_profile,
        attempt: row.attempts,
        worker_id: worker_id.to_owned(),
    })
}

pub async fn admin_capacity_summary(
    pool: &PgPool,
    facility_id: Uuid,
    limit: i64,
) -> anyhow::Result<AdminCapacitySummary> {
    let rows = sqlx::query_as::<_, AdminCapacityWardRow>(
        r#"
        WITH ward_capacity AS (
            SELECT wards.id AS ward_id,
                   wards.name AS ward_name,
                   count(beds.id) FILTER (WHERE beds.status != 'closed') AS total_beds,
                   count(beds.id) FILTER (WHERE beds.status = 'occupied') AS occupied_beds
            FROM wards
            LEFT JOIN beds
              ON beds.ward_id = wards.id
             AND beds.facility_id = wards.facility_id
            WHERE wards.facility_id = $1
              AND wards.status = 'active'
            GROUP BY wards.id, wards.name
        ),
        enriched AS (
            SELECT ward_id,
                   ward_name,
                   COALESCE(total_beds, 0)::bigint AS total_beds,
                   COALESCE(occupied_beds, 0)::bigint AS occupied_beds,
                   GREATEST(COALESCE(total_beds, 0) - COALESCE(occupied_beds, 0), 0)::bigint AS available_beds,
                   CASE
                       WHEN COALESCE(total_beds, 0) > 0
                       THEN (COALESCE(occupied_beds, 0)::double precision * 100.0)
                            / COALESCE(total_beds, 0)::double precision
                       ELSE 0.0
                   END AS occupancy_pct
            FROM ward_capacity
        )
        SELECT ward_id,
               ward_name,
               total_beds,
               occupied_beds,
               available_beds,
               occupancy_pct,
               count(*) OVER ()::bigint AS ward_count,
               count(*) FILTER (WHERE occupancy_pct >= 85.0) OVER ()::bigint AS high_occupancy_wards
        FROM enriched
        ORDER BY occupancy_pct DESC, ward_name ASC, ward_id ASC
        LIMIT $2
        "#,
    )
    .bind(facility_id)
    .bind(limit)
    .fetch_all(pool)
    .await?;

    let ward_count = rows.first().map(|row| row.ward_count).unwrap_or(0);
    let high_occupancy_wards = rows
        .first()
        .map(|row| row.high_occupancy_wards)
        .unwrap_or(0);
    let wards: Vec<_> = rows.into_iter().map(admin_capacity_ward_from_row).collect();

    Ok(AdminCapacitySummary {
        summary: AdminCapacityCounts {
            ward_count,
            high_occupancy_wards,
        },
        wait_time: AdminCapacityWaitTime {
            median_minutes: 0,
            p95_minutes: 0,
        },
        wards,
    })
}

pub async fn list_notifications(
    pool: &PgPool,
    facility_id: Uuid,
    user_id: Uuid,
    cursor: Option<NotificationCursor>,
    unread_only: bool,
    limit: i64,
) -> anyhow::Result<Vec<NotificationListItem>> {
    let mut query = QueryBuilder::new(
        "SELECT id, notification_type, title, body, priority, read_at, created_at
         FROM notifications
         WHERE facility_id = ",
    );
    query.push_bind(facility_id);
    query.push(" AND recipient_user_id = ");
    query.push_bind(user_id);
    if unread_only {
        query.push(" AND read_at IS NULL");
    }
    if let Some(cursor) = cursor {
        query.push(" AND (created_at, id) < (");
        query.push_bind(cursor.occurred_at);
        query.push(", ");
        query.push_bind(cursor.id);
        query.push(")");
    }
    query.push(" ORDER BY created_at DESC, id DESC LIMIT ");
    query.push_bind(limit);
    let rows = query
        .build_query_as::<NotificationRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(notification_from_row).collect()
}

pub async fn notification_counts(
    pool: &PgPool,
    facility_id: Uuid,
    user_id: Uuid,
) -> anyhow::Result<NotificationCounts> {
    let row = sqlx::query_as::<_, NotificationCountsRow>(
        r#"
        SELECT
            COUNT(*) FILTER (WHERE read_at IS NULL) AS unread,
            COUNT(*) AS total
        FROM notifications
        WHERE facility_id = $1 AND recipient_user_id = $2
        "#,
    )
    .bind(facility_id)
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    Ok(NotificationCounts {
        unread: row.unread,
        action_required: 0,
        total: row.total,
    })
}

pub async fn mark_notification_read(
    pool: &PgPool,
    facility_id: Uuid,
    user_id: Uuid,
    notification_id: Uuid,
    read: bool,
) -> anyhow::Result<Option<NotificationListItem>> {
    sqlx::query(
        "UPDATE notifications
         SET read_at = CASE WHEN $1 THEN COALESCE(read_at, now()) ELSE NULL END
         WHERE id = $2 AND facility_id = $3 AND recipient_user_id = $4",
    )
    .bind(read)
    .bind(notification_id)
    .bind(facility_id)
    .bind(user_id)
    .execute(pool)
    .await?;
    get_notification(pool, facility_id, user_id, notification_id).await
}

pub async fn insert_notification(
    pool: &PgPool,
    notification: NewNotification,
) -> anyhow::Result<()> {
    sqlx::query(
        "INSERT INTO notifications (
            id, facility_id, recipient_user_id, notification_type, title, body, priority
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING",
    )
    .bind(notification.id)
    .bind(notification.facility_id)
    .bind(notification.recipient_user_id)
    .bind(notification.notification_type)
    .bind(notification.title)
    .bind(notification.body)
    .bind(codec::encode(notification.priority)?)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn audit_realtime_open(
    pool: &PgPool,
    facility_id: Uuid,
    user_id: Uuid,
    channel_name: &str,
    channel_kind: &str,
) -> anyhow::Result<Uuid> {
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO realtime_subscription_audit (
            id, facility_id, user_id, channel_name, channel_kind
         )
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(id)
    .bind(facility_id)
    .bind(user_id)
    .bind(channel_name)
    .bind(channel_kind)
    .execute(pool)
    .await?;
    Ok(id)
}

pub async fn audit_realtime_close(pool: &PgPool, id: Uuid) -> anyhow::Result<()> {
    sqlx::query("UPDATE realtime_subscription_audit SET closed_at = now() WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

async fn dashboard_metrics(
    connection: &mut PgConnection,
    facility_id: Uuid,
) -> anyhow::Result<Vec<DashboardMetric>> {
    let (active_patients, waiting_visits, open_invoices) = hms_observability::observe_db_query(
        "dashboard.metrics",
        sqlx::query_as::<_, (i64, i64, i64)>(
            r#"
            SELECT (
                       SELECT count(*)::bigint
                       FROM patients
                       WHERE facility_id = $1
                         AND status = 'active'
                   ) AS active_patients,
                   (
                       SELECT count(*)::bigint
                       FROM visits
                       WHERE facility_id = $1
                         AND status IN ('waiting', 'called')
                   ) AS waiting_visits,
                   (
                       SELECT count(*)::bigint
                       FROM invoices
                       WHERE facility_id = $1
                         AND status IN ('issued', 'partially_paid')
                   ) AS open_invoices
            "#,
        )
        .bind(facility_id)
        .fetch_one(connection),
    )
    .await?;

    Ok(vec![
        DashboardMetric {
            key: "active_patients".to_owned(),
            label: "Active Patients".to_owned(),
            value: active_patients,
            feature: FeatureKey::Patients,
            permission: PermissionCode::PatientDemographicsView,
        },
        DashboardMetric {
            key: "waiting_visits".to_owned(),
            label: "Waiting Visits".to_owned(),
            value: waiting_visits,
            feature: FeatureKey::Appointments,
            permission: PermissionCode::AppointmentView,
        },
        DashboardMetric {
            key: "open_invoices".to_owned(),
            label: "Open Invoices".to_owned(),
            value: open_invoices,
            feature: FeatureKey::Billing,
            permission: PermissionCode::BillingView,
        },
    ])
}

fn admin_capacity_ward_from_row(row: AdminCapacityWardRow) -> AdminCapacityWard {
    AdminCapacityWard {
        ward_id: row.ward_id,
        ward_name: row.ward_name,
        total_beds: row.total_beds,
        occupied_beds: row.occupied_beds,
        available_beds: row.available_beds,
        occupancy_pct: row.occupancy_pct,
    }
}

async fn get_notification(
    pool: &PgPool,
    facility_id: Uuid,
    user_id: Uuid,
    notification_id: Uuid,
) -> anyhow::Result<Option<NotificationListItem>> {
    let row = sqlx::query_as::<_, NotificationRow>(
        "SELECT id, notification_type, title, body, priority, read_at, created_at
         FROM notifications
         WHERE id = $1 AND facility_id = $2 AND recipient_user_id = $3",
    )
    .bind(notification_id)
    .bind(facility_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    row.map(notification_from_row).transpose()
}

fn notification_from_row(row: NotificationRow) -> anyhow::Result<NotificationListItem> {
    Ok(NotificationListItem {
        id: row.id,
        notification_type: row.notification_type,
        title: row.title,
        body: row.body,
        priority: codec::decode(&row.priority)?,
        read_at: row.read_at,
        created_at: row.created_at,
    })
}
