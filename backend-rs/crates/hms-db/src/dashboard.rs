use chrono::{DateTime, Utc};
use hms_domain::dashboard::{
    AdminCapacityCounts, AdminCapacitySummary, AdminCapacityWaitTime, AdminCapacityWard,
    DashboardMetric, DashboardSnapshot, NotificationCounts, NotificationListItem,
    NotificationPriority,
};
use hms_domain::deployment::{DeploymentProfile, FeatureKey, NavigationManifest, PermissionCode};
use sqlx::{FromRow, QueryBuilder};
use uuid::Uuid;

use crate::{codec, PgPool};

pub struct NotificationCursor {
    pub occurred_at: DateTime<Utc>,
    pub id: Uuid,
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

pub async fn dashboard_snapshot(
    pool: &PgPool,
    facility_id: Uuid,
    profile: DeploymentProfile,
    navigation: NavigationManifest,
) -> anyhow::Result<DashboardSnapshot> {
    let metrics = dashboard_metrics(pool, facility_id).await?;
    let metrics_json = serde_json::to_value(&metrics)?;
    let id = Uuid::new_v4();
    let row = sqlx::query_as::<_, SnapshotRow>(
        "INSERT INTO dashboard_snapshots (
            id, facility_id, snapshot_key, deployment_profile, metrics, generated_at
         )
         VALUES ($1, $2, 'operations', $3, $4, now())
         ON CONFLICT (facility_id, snapshot_key) DO UPDATE
         SET deployment_profile = EXCLUDED.deployment_profile,
             metrics = EXCLUDED.metrics,
             generated_at = EXCLUDED.generated_at,
             updated_at = now()
         RETURNING id, deployment_profile, metrics, generated_at",
    )
    .bind(id)
    .bind(facility_id)
    .bind(codec::encode(profile)?)
    .bind(metrics_json)
    .fetch_one(pool)
    .await?;

    Ok(DashboardSnapshot {
        id: row.id,
        deployment_profile: codec::decode(&row.deployment_profile)?,
        generated_at: row.generated_at,
        metrics: serde_json::from_value(row.metrics)?,
        navigation,
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
    pool: &PgPool,
    facility_id: Uuid,
) -> anyhow::Result<Vec<DashboardMetric>> {
    let active_patients = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM patients WHERE facility_id = $1 AND status = 'active'",
    )
    .bind(facility_id)
    .fetch_one(pool)
    .await?;
    let waiting_visits = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM visits WHERE facility_id = $1 AND status IN ('waiting', 'called')",
    )
    .bind(facility_id)
    .fetch_one(pool)
    .await?;
    let open_invoices = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM invoices WHERE facility_id = $1 AND status IN ('issued', 'partially_paid')",
    )
    .bind(facility_id)
    .fetch_one(pool)
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
