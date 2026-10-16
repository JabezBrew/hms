use chrono::{DateTime, NaiveDate, Utc};
use hms_domain::ward::{
    FluidBalanceListItem, FluidBalanceSummary, FluidBalanceTrendPoint, MonitoringEventKind,
    MonitoringEventListItem, NursingAlertListItem, NursingAlertSeverity, NursingAlertStatus,
    PatientVitalsListItem,
};
use hms_observability::observe_db_query;
use sqlx::{FromRow, Postgres, QueryBuilder};
use uuid::Uuid;

use crate::codec;
use crate::PgPool;

use super::WardCursor;

#[derive(Clone, Debug)]
pub struct NewPatientVitals {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub admission_case_id: Uuid,
    pub patient_id: Uuid,
    pub recorded_at: DateTime<Utc>,
    pub temperature_c: Option<f32>,
    pub systolic_bp: Option<i32>,
    pub diastolic_bp: Option<i32>,
    pub pulse: Option<i32>,
    pub respiratory_rate: Option<i32>,
    pub oxygen_saturation: Option<i32>,
    pub recorded_by_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewNursingAlert {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub admission_case_id: Uuid,
    pub patient_id: Uuid,
    pub severity: NursingAlertSeverity,
    pub title: String,
    pub created_by_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewMonitoringEvent {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub admission_case_id: Uuid,
    pub patient_id: Uuid,
    pub event_kind: MonitoringEventKind,
    pub summary: String,
    pub recorded_at: DateTime<Utc>,
    pub recorded_by_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewFluidBalanceEntry {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub admission_case_id: Uuid,
    pub patient_id: Uuid,
    pub recorded_at: DateTime<Utc>,
    pub intake_ml: i32,
    pub output_ml: i32,
    pub recorded_by_user_id: Uuid,
}

#[derive(Clone, Debug, FromRow)]
struct PatientVitalsRow {
    id: Uuid,
    admission_case_id: Uuid,
    patient_id: Uuid,
    patient_code: String,
    patient_display_name: String,
    recorded_at: DateTime<Utc>,
    temperature_c: Option<f32>,
    systolic_bp: Option<i32>,
    diastolic_bp: Option<i32>,
    pulse: Option<i32>,
    respiratory_rate: Option<i32>,
    oxygen_saturation: Option<i32>,
}

#[derive(Clone, Debug, FromRow)]
struct NursingAlertRow {
    id: Uuid,
    admission_case_id: Uuid,
    patient_id: Uuid,
    patient_code: String,
    patient_display_name: String,
    severity: String,
    title: String,
    status: String,
    created_at: DateTime<Utc>,
    acknowledged_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, FromRow)]
struct MonitoringEventRow {
    id: Uuid,
    admission_case_id: Uuid,
    patient_id: Uuid,
    patient_code: String,
    patient_display_name: String,
    event_kind: String,
    summary: String,
    recorded_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct FluidBalanceRow {
    id: Uuid,
    admission_case_id: Uuid,
    patient_id: Uuid,
    patient_code: String,
    patient_display_name: String,
    recorded_at: DateTime<Utc>,
    intake_ml: i32,
    output_ml: i32,
    net_ml: i32,
}

#[derive(Clone, Debug, Default)]
pub struct FluidBalanceFilters {
    pub patient_id: Option<Uuid>,
    pub admission_case_id: Option<Uuid>,
    pub recorded_from: Option<DateTime<Utc>>,
    pub recorded_before: Option<DateTime<Utc>>,
    pub descending: bool,
}

#[derive(FromRow)]
struct FluidSummaryRow {
    entry_count: i64,
    total_intake_ml: i64,
    total_output_ml: i64,
    net_ml: i64,
}

#[derive(FromRow)]
struct FluidTrendRow {
    date: NaiveDate,
    entry_count: i64,
    total_intake_ml: i64,
    total_output_ml: i64,
    net_ml: i64,
}

pub async fn list_patient_vitals(
    pool: &PgPool,
    facility_id: Uuid,
    patient_id: Option<Uuid>,
    admission_case_id: Option<Uuid>,
    recorded_since: Option<DateTime<Utc>>,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<PatientVitalsListItem>> {
    let mut query = patient_vitals_query();
    query.push(" WHERE patient_vitals.facility_id = ");
    query.push_bind(facility_id);
    if let Some(patient_id) = patient_id {
        query.push(" AND patient_vitals.patient_id = ");
        query.push_bind(patient_id);
    }
    if let Some(admission_case_id) = admission_case_id {
        query.push(" AND patient_vitals.admission_case_id = ");
        query.push_bind(admission_case_id);
    }
    if let Some(recorded_since) = recorded_since {
        query.push(" AND patient_vitals.recorded_at >= ");
        query.push_bind(recorded_since);
    }
    append_forward_cursor(
        &mut query,
        "patient_vitals.recorded_at",
        "patient_vitals.id",
        cursor,
    );
    query.push(" ORDER BY patient_vitals.recorded_at ASC, patient_vitals.id ASC LIMIT ");
    query.push_bind(limit);
    let rows = observe_db_query(
        "ward.observations.patient_vitals.list",
        query.build_query_as::<PatientVitalsRow>().fetch_all(pool),
    )
    .await?;
    Ok(rows.into_iter().map(patient_vitals_from_row).collect())
}

pub async fn create_patient_vitals(
    pool: &PgPool,
    vitals: NewPatientVitals,
) -> anyhow::Result<PatientVitalsListItem> {
    observe_db_query(
        "ward.observations.patient_vitals.create",
        sqlx::query(
            r#"
        INSERT INTO patient_vitals (
            id, facility_id, admission_case_id, patient_id, recorded_at, temperature_c,
            systolic_bp, diastolic_bp, pulse, respiratory_rate, oxygen_saturation,
            recorded_by_user_id
        )
        SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
        WHERE EXISTS (
            SELECT 1
            FROM admission_cases
            WHERE admission_cases.facility_id = $2
              AND admission_cases.id = $3
              AND admission_cases.patient_id = $4
        )
        "#,
        )
        .bind(vitals.id)
        .bind(vitals.facility_id)
        .bind(vitals.admission_case_id)
        .bind(vitals.patient_id)
        .bind(vitals.recorded_at)
        .bind(vitals.temperature_c)
        .bind(vitals.systolic_bp)
        .bind(vitals.diastolic_bp)
        .bind(vitals.pulse)
        .bind(vitals.respiratory_rate)
        .bind(vitals.oxygen_saturation)
        .bind(vitals.recorded_by_user_id)
        .execute(pool),
    )
    .await?;
    patient_vitals_by_id(pool, vitals.facility_id, vitals.id).await
}

#[derive(Clone, Debug, Default)]
pub struct NursingAlertFilters {
    pub patient_id: Option<Uuid>,
    pub admission_case_id: Option<Uuid>,
    pub ward_id: Option<Uuid>,
    pub status: Option<NursingAlertStatus>,
    pub severity: Option<NursingAlertSeverity>,
    pub critical_only: bool,
    pub created_from: Option<DateTime<Utc>>,
    pub created_before: Option<DateTime<Utc>>,
    pub descending: bool,
}

pub async fn list_nursing_alerts(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<NursingAlertListItem>> {
    list_nursing_alerts_scoped(
        pool,
        facility_id,
        cursor,
        limit,
        NursingAlertFilters::default(),
    )
    .await
}

pub async fn list_nursing_alerts_scoped(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<WardCursor>,
    limit: i64,
    filters: NursingAlertFilters,
) -> anyhow::Result<Vec<NursingAlertListItem>> {
    let mut query = nursing_alert_query();
    query
        .push(" WHERE nursing_alerts.facility_id = ")
        .push_bind(facility_id);
    if let Some(id) = filters.patient_id {
        query
            .push(" AND nursing_alerts.patient_id = ")
            .push_bind(id);
    }
    if let Some(id) = filters.admission_case_id {
        query
            .push(" AND nursing_alerts.admission_case_id = ")
            .push_bind(id);
    }
    if let Some(id) = filters.ward_id {
        query.push(" AND alert_admission.ward_id = ").push_bind(id);
    }
    if filters.critical_only && filters.status == Some(NursingAlertStatus::Open) {
        // Fixed typed hot path: a generic prepared plan can prove the partial
        // priority-index predicate without inspecting a bound status value.
        query.push(" AND nursing_alerts.status = 'open'");
    } else if let Some(status) = filters.status {
        query
            .push(" AND nursing_alerts.status = ")
            .push_bind(codec::encode(status)?);
    }
    if let Some(severity) = filters.severity {
        query
            .push(" AND nursing_alerts.severity = ")
            .push_bind(codec::encode(severity)?);
    }
    if filters.critical_only {
        query.push(" AND nursing_alerts.severity IN ('high', 'critical')");
    }
    if let Some(from) = filters.created_from {
        query
            .push(" AND nursing_alerts.created_at >= ")
            .push_bind(from);
    }
    if let Some(before) = filters.created_before {
        query
            .push(" AND nursing_alerts.created_at < ")
            .push_bind(before);
    }
    if let Some(cursor) = cursor {
        query.push(if filters.descending {
            " AND (nursing_alerts.created_at, nursing_alerts.id) < ("
        } else {
            " AND (nursing_alerts.created_at, nursing_alerts.id) > ("
        });
        query
            .push_bind(cursor.occurred_at)
            .push(", ")
            .push_bind(cursor.id)
            .push(")");
    }
    query
        .push(if filters.descending {
            " ORDER BY nursing_alerts.created_at DESC, nursing_alerts.id DESC LIMIT "
        } else {
            " ORDER BY nursing_alerts.created_at ASC, nursing_alerts.id ASC LIMIT "
        })
        .push_bind(limit);
    let rows = observe_db_query(
        "ward.observations.nursing_alerts.list",
        query.build_query_as::<NursingAlertRow>().fetch_all(pool),
    )
    .await?;
    rows.into_iter().map(nursing_alert_from_row).collect()
}

pub async fn create_nursing_alert(
    pool: &PgPool,
    alert: NewNursingAlert,
) -> anyhow::Result<NursingAlertListItem> {
    observe_db_query(
        "ward.observations.nursing_alerts.create",
        sqlx::query(
            r#"
        INSERT INTO nursing_alerts (
            id, facility_id, admission_case_id, patient_id, severity, title, status,
            created_by_user_id
        )
        SELECT $1, $2, $3, $4, $5, $6, $7, $8
        WHERE EXISTS (
            SELECT 1
            FROM admission_cases
            WHERE admission_cases.facility_id = $2
              AND admission_cases.id = $3
              AND admission_cases.patient_id = $4
        )
        "#,
        )
        .bind(alert.id)
        .bind(alert.facility_id)
        .bind(alert.admission_case_id)
        .bind(alert.patient_id)
        .bind(codec::encode(alert.severity)?)
        .bind(alert.title)
        .bind(codec::encode(NursingAlertStatus::Open)?)
        .bind(alert.created_by_user_id)
        .execute(pool),
    )
    .await?;
    nursing_alert_by_id(pool, alert.facility_id, alert.id).await
}

pub async fn acknowledge_nursing_alert(
    pool: &PgPool,
    facility_id: Uuid,
    alert_id: Uuid,
    actor_user_id: Uuid,
) -> anyhow::Result<Option<NursingAlertListItem>> {
    acknowledge_nursing_alert_with_request(pool, facility_id, alert_id, actor_user_id, None).await
}

pub async fn acknowledge_nursing_alert_with_request(
    pool: &PgPool,
    facility_id: Uuid,
    alert_id: Uuid,
    actor_user_id: Uuid,
    request_id: Option<String>,
) -> anyhow::Result<Option<NursingAlertListItem>> {
    let mut transaction = pool.begin().await?;
    // PostgreSQL rechecks this predicate after waiting for a concurrent update.
    // Only the winning open -> acknowledged transition records provenance.
    let changed = observe_db_query(
        "ward.observations.nursing_alerts.acknowledge",
        sqlx::query(
            r#"
        UPDATE nursing_alerts
        SET status = $1,
            acknowledged_by_user_id = $2,
            acknowledged_at = clock_timestamp(),
            updated_at = clock_timestamp()
        WHERE facility_id = $3 AND id = $4 AND status = 'open'
        "#,
        )
        .bind(codec::encode(NursingAlertStatus::Acknowledged)?)
        .bind(actor_user_id)
        .bind(facility_id)
        .bind(alert_id)
        .execute(&mut *transaction),
    )
    .await?;
    if changed.rows_affected() == 1 {
        sqlx::query("INSERT INTO audit_events(id,facility_id,actor_user_id,request_id,event_type,resource_type,resource_id,metadata) VALUES($1,$2,$3,$4,'nursing.alert.acknowledged','nursing_alert',$5,'{}'::jsonb)")
            .bind(Uuid::new_v4()).bind(facility_id).bind(actor_user_id).bind(request_id).bind(alert_id).execute(&mut *transaction).await?;
    }
    let mut query = nursing_alert_query();
    query
        .push(" WHERE nursing_alerts.facility_id = ")
        .push_bind(facility_id);
    query.push(" AND nursing_alerts.id = ").push_bind(alert_id);
    let row = observe_db_query(
        "ward.observations.nursing_alerts.receipt",
        query
            .build_query_as::<NursingAlertRow>()
            .fetch_optional(&mut *transaction),
    )
    .await?;
    let receipt = row.map(nursing_alert_from_row).transpose()?;
    transaction.commit().await?;
    Ok(receipt)
}

pub async fn get_nursing_alert(
    pool: &PgPool,
    facility_id: Uuid,
    alert_id: Uuid,
) -> anyhow::Result<Option<NursingAlertListItem>> {
    optional_nursing_alert_by_id(pool, facility_id, alert_id).await
}

pub async fn list_monitoring_events(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<MonitoringEventListItem>> {
    let mut query = monitoring_event_query();
    query.push(" WHERE monitoring_events.facility_id = ");
    query.push_bind(facility_id);
    append_forward_cursor(
        &mut query,
        "monitoring_events.recorded_at",
        "monitoring_events.id",
        cursor,
    );
    query.push(" ORDER BY monitoring_events.recorded_at ASC, monitoring_events.id ASC LIMIT ");
    query.push_bind(limit);
    let rows = observe_db_query(
        "ward.observations.monitoring_events.list",
        query.build_query_as::<MonitoringEventRow>().fetch_all(pool),
    )
    .await?;
    rows.into_iter().map(monitoring_event_from_row).collect()
}

pub async fn create_monitoring_event(
    pool: &PgPool,
    event: NewMonitoringEvent,
) -> anyhow::Result<MonitoringEventListItem> {
    observe_db_query(
        "ward.observations.monitoring_events.create",
        sqlx::query(
            r#"
        INSERT INTO monitoring_events (
            id, facility_id, admission_case_id, patient_id, event_kind, summary,
            recorded_at, recorded_by_user_id
        )
        SELECT $1, $2, $3, $4, $5, $6, $7, $8
        WHERE EXISTS (
            SELECT 1
            FROM admission_cases
            WHERE admission_cases.facility_id = $2
              AND admission_cases.id = $3
              AND admission_cases.patient_id = $4
        )
        "#,
        )
        .bind(event.id)
        .bind(event.facility_id)
        .bind(event.admission_case_id)
        .bind(event.patient_id)
        .bind(codec::encode(event.event_kind)?)
        .bind(event.summary)
        .bind(event.recorded_at)
        .bind(event.recorded_by_user_id)
        .execute(pool),
    )
    .await?;
    monitoring_event_by_id(pool, event.facility_id, event.id).await
}

pub async fn list_fluid_balance_entries(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<FluidBalanceListItem>> {
    list_fluid_balance_entries_scoped(
        pool,
        facility_id,
        FluidBalanceFilters::default(),
        cursor,
        limit,
    )
    .await
}

pub async fn list_fluid_balance_entries_scoped(
    pool: &PgPool,
    facility_id: Uuid,
    filters: FluidBalanceFilters,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<FluidBalanceListItem>> {
    let mut query = fluid_balance_query();
    append_fluid_scope(&mut query, facility_id, &filters);
    if let Some(cursor) = cursor {
        query.push(" AND (fluid_balance_entries.recorded_at, fluid_balance_entries.id) ");
        query.push(if filters.descending { "< (" } else { "> (" });
        query
            .push_bind(cursor.occurred_at)
            .push(", ")
            .push_bind(cursor.id)
            .push(")");
    }
    query.push(if filters.descending {
        " ORDER BY fluid_balance_entries.recorded_at DESC, fluid_balance_entries.id DESC LIMIT "
    } else {
        " ORDER BY fluid_balance_entries.recorded_at ASC, fluid_balance_entries.id ASC LIMIT "
    });
    query.push_bind(limit.clamp(1, 101));
    let rows = observe_db_query(
        "ward.observations.fluid_balance.list",
        query.build_query_as::<FluidBalanceRow>().fetch_all(pool),
    )
    .await?;
    Ok(rows.into_iter().map(fluid_balance_from_row).collect())
}

pub async fn fluid_balance_summary(
    pool: &PgPool,
    facility_id: Uuid,
    filters: FluidBalanceFilters,
) -> anyhow::Result<FluidBalanceSummary> {
    let mut query = QueryBuilder::<Postgres>::new(
        "SELECT COUNT(*) AS entry_count, COALESCE(SUM(intake_ml), 0)::bigint AS total_intake_ml, COALESCE(SUM(output_ml), 0)::bigint AS total_output_ml, (COALESCE(SUM(intake_ml), 0) - COALESCE(SUM(output_ml), 0))::bigint AS net_ml FROM fluid_balance_entries JOIN patients ON patients.id = fluid_balance_entries.patient_id AND patients.facility_id = fluid_balance_entries.facility_id"
    );
    append_fluid_scope(&mut query, facility_id, &filters);
    let row = observe_db_query(
        "ward.observations.fluid_balance.summary",
        query.build_query_as::<FluidSummaryRow>().fetch_one(pool),
    )
    .await?;
    Ok(FluidBalanceSummary {
        entry_count: row.entry_count,
        total_intake_ml: row.total_intake_ml,
        total_output_ml: row.total_output_ml,
        net_ml: row.net_ml,
    })
}

pub async fn fluid_balance_trends(
    pool: &PgPool,
    facility_id: Uuid,
    filters: FluidBalanceFilters,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<FluidBalanceTrendPoint>> {
    let mut query = QueryBuilder::<Postgres>::new(
        "SELECT (recorded_at AT TIME ZONE 'UTC')::date AS date, COUNT(*) AS entry_count, SUM(intake_ml)::bigint AS total_intake_ml, SUM(output_ml)::bigint AS total_output_ml, (SUM(intake_ml) - SUM(output_ml))::bigint AS net_ml FROM fluid_balance_entries JOIN patients ON patients.id = fluid_balance_entries.patient_id AND patients.facility_id = fluid_balance_entries.facility_id"
    );
    append_fluid_scope(&mut query, facility_id, &filters);
    query.push(" GROUP BY (recorded_at AT TIME ZONE 'UTC')::date");
    if let Some(cursor) = cursor {
        query.push(" HAVING (recorded_at AT TIME ZONE 'UTC')::date ");
        query.push(if filters.descending { "< " } else { "> " });
        query.push_bind(cursor.occurred_at.date_naive());
    }
    query.push(if filters.descending {
        " ORDER BY date DESC LIMIT "
    } else {
        " ORDER BY date ASC LIMIT "
    });
    query.push_bind(limit.clamp(1, 101));
    let rows = observe_db_query(
        "ward.observations.fluid_balance.trends",
        query.build_query_as::<FluidTrendRow>().fetch_all(pool),
    )
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| FluidBalanceTrendPoint {
            date: row.date,
            entry_count: row.entry_count,
            total_intake_ml: row.total_intake_ml,
            total_output_ml: row.total_output_ml,
            net_ml: row.net_ml,
        })
        .collect())
}

fn append_fluid_scope(
    query: &mut QueryBuilder<'_, Postgres>,
    facility_id: Uuid,
    filters: &FluidBalanceFilters,
) {
    query
        .push(" WHERE EXISTS (SELECT 1 FROM admission_cases a WHERE a.id=fluid_balance_entries.admission_case_id AND a.facility_id=fluid_balance_entries.facility_id AND a.patient_id=fluid_balance_entries.patient_id) AND EXISTS (SELECT 1 FROM fluid_observation_roots r WHERE r.facility_id=fluid_balance_entries.facility_id AND r.current_entry_id=fluid_balance_entries.id) AND fluid_balance_entries.facility_id = ")
        .push_bind(facility_id);
    if let Some(id) = filters.patient_id {
        query
            .push(" AND fluid_balance_entries.patient_id = ")
            .push_bind(id);
    }
    if let Some(id) = filters.admission_case_id {
        query
            .push(" AND fluid_balance_entries.admission_case_id = ")
            .push_bind(id);
    }
    if let Some(from) = filters.recorded_from {
        query
            .push(" AND fluid_balance_entries.recorded_at >= ")
            .push_bind(from);
    }
    if let Some(before) = filters.recorded_before {
        query
            .push(" AND fluid_balance_entries.recorded_at < ")
            .push_bind(before);
    }
}

pub async fn create_fluid_balance_entry(
    pool: &PgPool,
    entry: NewFluidBalanceEntry,
) -> anyhow::Result<FluidBalanceListItem> {
    let mut tx = pool.begin().await?;
    observe_db_query(
        "ward.observations.fluid_balance.create",
        sqlx::query(
            r#"
        INSERT INTO fluid_balance_entries (
            id, facility_id, admission_case_id, patient_id, recorded_at, intake_ml,
            output_ml, recorded_by_user_id
        )
        SELECT $1, $2, $3, $4, $5, $6, $7, $8
        WHERE EXISTS (
            SELECT 1
            FROM admission_cases
            WHERE admission_cases.facility_id = $2
              AND admission_cases.id = $3
              AND admission_cases.patient_id = $4
        )
        "#,
        )
        .bind(entry.id)
        .bind(entry.facility_id)
        .bind(entry.admission_case_id)
        .bind(entry.patient_id)
        .bind(entry.recorded_at)
        .bind(entry.intake_ml)
        .bind(entry.output_ml)
        .bind(entry.recorded_by_user_id)
        .execute(&mut *tx),
    )
    .await?;
    sqlx::query("INSERT INTO audit_events(id,facility_id,actor_user_id,event_type,resource_type,resource_id,metadata) VALUES($1,$2,$3,'fluid.observation.created','fluid_observation',$4,jsonb_build_object('revision',1))").bind(Uuid::new_v4()).bind(entry.facility_id).bind(entry.recorded_by_user_id).bind(entry.id).execute(&mut *tx).await?;
    let mut query = fluid_balance_query();
    query
        .push(" WHERE fluid_balance_entries.facility_id=")
        .push_bind(entry.facility_id)
        .push(" AND fluid_balance_entries.id=")
        .push_bind(entry.id);
    let row = query
        .build_query_as::<FluidBalanceRow>()
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(fluid_balance_from_row(row))
}

fn authorized_scope(
    q: &mut QueryBuilder<'static, Postgres>,
    actor: &super::nursing_access::NursingActor,
    wards: Option<Vec<Uuid>>,
    table: &str,
    admission_alias: &str,
    patient: Option<Uuid>,
    admission: Option<Uuid>,
    ward: Option<Uuid>,
) {
    q.push(format!(" WHERE {table}.facility_id="))
        .push_bind(actor.facility_id);
    if let Some(ids) = wards {
        q.push(format!(" AND {admission_alias}.ward_id=ANY("))
            .push_bind(ids)
            .push(")");
    }
    if let Some(id) = patient {
        q.push(format!(" AND {table}.patient_id=")).push_bind(id);
    }
    if let Some(id) = admission {
        q.push(format!(" AND {table}.admission_case_id="))
            .push_bind(id);
    }
    if let Some(id) = ward {
        q.push(format!(" AND {admission_alias}.ward_id="))
            .push_bind(id);
    }
}
fn observation_page(
    q: &mut QueryBuilder<'static, Postgres>,
    table: &str,
    time: &str,
    from: Option<DateTime<Utc>>,
    before: Option<DateTime<Utc>>,
    desc: bool,
    cursor: Option<WardCursor>,
    limit: i64,
) {
    if let Some(value) = from {
        q.push(format!(" AND {table}.{time}>=")).push_bind(value);
    }
    if let Some(value) = before {
        q.push(format!(" AND {table}.{time}<")).push_bind(value);
    }
    if let Some(c) = cursor {
        q.push(format!(
            " AND ({table}.{time},{table}.id){}(",
            if desc { "<" } else { ">" }
        ))
        .push_bind(c.occurred_at)
        .push(",")
        .push_bind(c.id)
        .push(")");
    }
    q.push(format!(
        " ORDER BY {table}.{time} {},{table}.id {} LIMIT ",
        if desc { "DESC" } else { "ASC" },
        if desc { "DESC" } else { "ASC" }
    ))
    .push_bind(limit.clamp(1, 101));
}
pub async fn list_patient_vitals_for_actor(
    pool: &PgPool,
    mut actor: super::nursing_access::NursingActor,
    f: &hms_domain::ward::PatientVitalsListQuery,
    from: Option<DateTime<Utc>>,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<PatientVitalsListItem>> {
    use super::nursing_access as access;
    let mut tx = pool.begin().await?;
    let wards = access::verify(&mut tx, &mut actor).await?;
    if let Some(id) = f.ward_id {
        access::ward(&wards, id)?;
    }
    let mut q = patient_vitals_query();
    authorized_scope(
        &mut q,
        &actor,
        wards,
        "patient_vitals",
        "observation_admission",
        f.patient_id,
        f.admission_case_id,
        f.ward_id,
    );
    observation_page(
        &mut q,
        "patient_vitals",
        "recorded_at",
        from,
        f.recorded_before,
        f.descending.unwrap_or(false),
        cursor,
        limit,
    );
    let rows = observe_db_query(
        "ward.observations.patient_vitals.list",
        q.build_query_as::<PatientVitalsRow>().fetch_all(&mut *tx),
    )
    .await?;
    let result = rows.into_iter().map(patient_vitals_from_row).collect();
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
pub async fn list_monitoring_events_for_actor(
    pool: &PgPool,
    mut actor: super::nursing_access::NursingActor,
    f: &hms_domain::ward::MonitoringEventListQuery,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<MonitoringEventListItem>> {
    use super::nursing_access as access;
    let mut tx = pool.begin().await?;
    let wards = access::verify(&mut tx, &mut actor).await?;
    if let Some(id) = f.ward_id {
        access::ward(&wards, id)?;
    }
    let mut q = monitoring_event_query();
    authorized_scope(
        &mut q,
        &actor,
        wards,
        "monitoring_events",
        "observation_admission",
        f.patient_id,
        f.admission_case_id,
        f.ward_id,
    );
    if let Some(kind) = f.event_kind {
        q.push(" AND monitoring_events.event_kind=")
            .push_bind(codec::encode(kind)?);
    }
    observation_page(
        &mut q,
        "monitoring_events",
        "recorded_at",
        f.recorded_from,
        f.recorded_before,
        f.descending.unwrap_or(false),
        cursor,
        limit,
    );
    let rows = observe_db_query(
        "ward.observations.monitoring_events.list",
        q.build_query_as::<MonitoringEventRow>().fetch_all(&mut *tx),
    )
    .await?;
    let result = rows
        .into_iter()
        .map(monitoring_event_from_row)
        .collect::<anyhow::Result<Vec<_>>>()?;
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
pub async fn list_nursing_alerts_for_actor(
    pool: &PgPool,
    mut actor: super::nursing_access::NursingActor,
    f: &hms_domain::ward::NursingAlertListQuery,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<NursingAlertListItem>> {
    use super::nursing_access as access;
    let mut tx = pool.begin().await?;
    let wards = access::verify(&mut tx, &mut actor).await?;
    if let Some(id) = f.ward_id {
        access::ward(&wards, id)?;
    }
    let mut q = nursing_alert_query();
    authorized_scope(
        &mut q,
        &actor,
        wards,
        "nursing_alerts",
        "alert_admission",
        f.patient_id,
        f.admission_case_id,
        f.ward_id,
    );
    if f.critical_only.unwrap_or(false) {
        q.push(" AND nursing_alerts.severity IN ('high','critical')");
    }
    // Keep the fixed Open enum literal so PostgreSQL generic plans can use the
    // open/high-critical partial index for the actual critical monitor request.
    if f.status == Some(NursingAlertStatus::Open)
        || (f.critical_only.unwrap_or(false) && f.status.is_none())
    {
        q.push(" AND nursing_alerts.status='open'");
    } else if let Some(status) = f.status {
        q.push(" AND nursing_alerts.status=")
            .push_bind(codec::encode(status)?);
    }
    if let Some(severity) = f.severity {
        q.push(" AND nursing_alerts.severity=")
            .push_bind(codec::encode(severity)?);
    }
    observation_page(
        &mut q,
        "nursing_alerts",
        "created_at",
        f.created_from,
        f.created_before,
        f.descending.unwrap_or(false),
        cursor,
        limit,
    );
    let rows = observe_db_query(
        "ward.observations.nursing_alerts.list",
        q.build_query_as::<NursingAlertRow>().fetch_all(&mut *tx),
    )
    .await?;
    let result = rows
        .into_iter()
        .map(nursing_alert_from_row)
        .collect::<anyhow::Result<Vec<_>>>()?;
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
pub async fn create_patient_vitals_for_actor(
    pool: &PgPool,
    mut actor: super::nursing_access::NursingActor,
    v: NewPatientVitals,
) -> anyhow::Result<PatientVitalsListItem> {
    use super::nursing_access as access;
    let mut tx = pool.begin().await?;
    let wards = access::verify(&mut tx, &mut actor).await?;
    access::admission(
        &mut tx,
        &actor,
        &wards,
        v.admission_case_id,
        v.patient_id,
        None,
        true,
    )
    .await?;
    sqlx::query("INSERT INTO patient_vitals(id,facility_id,admission_case_id,patient_id,recorded_at,temperature_c,systolic_bp,diastolic_bp,pulse,respiratory_rate,oxygen_saturation,recorded_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)")
        .bind(v.id).bind(actor.facility_id).bind(v.admission_case_id).bind(v.patient_id).bind(v.recorded_at).bind(v.temperature_c).bind(v.systolic_bp).bind(v.diastolic_bp).bind(v.pulse).bind(v.respiratory_rate).bind(v.oxygen_saturation).bind(actor.user_id).execute(&mut *tx).await?;
    access::audit(
        &mut tx,
        &actor,
        v.id,
        "nursing.vitals.recorded",
        "patient_vitals",
    )
    .await?;
    let mut q = patient_vitals_query();
    q.push(" WHERE patient_vitals.facility_id=")
        .push_bind(actor.facility_id)
        .push(" AND patient_vitals.id=")
        .push_bind(v.id);
    let result = patient_vitals_from_row(
        q.build_query_as::<PatientVitalsRow>()
            .fetch_one(&mut *tx)
            .await?,
    );
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
pub async fn create_monitoring_event_for_actor(
    pool: &PgPool,
    mut actor: super::nursing_access::NursingActor,
    v: NewMonitoringEvent,
) -> anyhow::Result<MonitoringEventListItem> {
    use super::nursing_access as access;
    let mut tx = pool.begin().await?;
    let wards = access::verify(&mut tx, &mut actor).await?;
    access::admission(
        &mut tx,
        &actor,
        &wards,
        v.admission_case_id,
        v.patient_id,
        None,
        true,
    )
    .await?;
    sqlx::query("INSERT INTO monitoring_events(id,facility_id,admission_case_id,patient_id,event_kind,summary,recorded_at,recorded_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)")
        .bind(v.id).bind(actor.facility_id).bind(v.admission_case_id).bind(v.patient_id).bind(codec::encode(v.event_kind)?).bind(v.summary).bind(v.recorded_at).bind(actor.user_id).execute(&mut *tx).await?;
    access::audit(
        &mut tx,
        &actor,
        v.id,
        "nursing.monitoring.recorded",
        "monitoring_event",
    )
    .await?;
    let mut q = monitoring_event_query();
    q.push(" WHERE monitoring_events.facility_id=")
        .push_bind(actor.facility_id)
        .push(" AND monitoring_events.id=")
        .push_bind(v.id);
    let result = monitoring_event_from_row(
        q.build_query_as::<MonitoringEventRow>()
            .fetch_one(&mut *tx)
            .await?,
    )?;
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
pub async fn create_nursing_alert_for_actor(
    pool: &PgPool,
    mut actor: super::nursing_access::NursingActor,
    v: NewNursingAlert,
) -> anyhow::Result<NursingAlertListItem> {
    use super::nursing_access as access;
    let mut tx = pool.begin().await?;
    let wards = access::verify(&mut tx, &mut actor).await?;
    access::admission(
        &mut tx,
        &actor,
        &wards,
        v.admission_case_id,
        v.patient_id,
        None,
        true,
    )
    .await?;
    sqlx::query("INSERT INTO nursing_alerts(id,facility_id,admission_case_id,patient_id,severity,title,status,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,'open',$7)")
        .bind(v.id).bind(actor.facility_id).bind(v.admission_case_id).bind(v.patient_id).bind(codec::encode(v.severity)?).bind(v.title).bind(actor.user_id).execute(&mut *tx).await?;
    access::audit(
        &mut tx,
        &actor,
        v.id,
        "nursing.alert.created",
        "nursing_alert",
    )
    .await?;
    let result = alert_tx(&mut tx, actor.facility_id, v.id).await?;
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
pub async fn acknowledge_nursing_alert_for_actor(
    pool: &PgPool,
    mut actor: super::nursing_access::NursingActor,
    id: Uuid,
) -> anyhow::Result<NursingAlertListItem> {
    use super::nursing_access::{self as access, NursingError};
    let mut tx = pool.begin().await?;
    let source:Option<(Uuid,Uuid,String)>=sqlx::query_as("SELECT patient_id,admission_case_id,status FROM nursing_alerts WHERE facility_id=$1 AND id=$2 FOR UPDATE").bind(actor.facility_id).bind(id).fetch_optional(&mut *tx).await?;
    let (patient, admission, status) = source.ok_or(NursingError::NotFound)?;
    let wards = access::verify(&mut tx, &mut actor).await?;
    access::admission(&mut tx, &actor, &wards, admission, patient, None, false).await?;
    if status == "open" {
        sqlx::query("UPDATE nursing_alerts SET status='acknowledged',acknowledged_by_user_id=$3,acknowledged_at=clock_timestamp(),updated_at=clock_timestamp() WHERE facility_id=$1 AND id=$2 AND status='open'").bind(actor.facility_id).bind(id).bind(actor.user_id).execute(&mut *tx).await?;
        access::audit(
            &mut tx,
            &actor,
            id,
            "nursing.alert.acknowledged",
            "nursing_alert",
        )
        .await?;
    } else if status != "acknowledged" {
        return Err(NursingError::TerminalConflict.into());
    }
    let result = alert_tx(&mut tx, actor.facility_id, id).await?;
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
async fn alert_tx(
    tx: &mut sqlx::Transaction<'_, Postgres>,
    facility: Uuid,
    id: Uuid,
) -> anyhow::Result<NursingAlertListItem> {
    let mut q = nursing_alert_query();
    q.push(" WHERE nursing_alerts.facility_id=")
        .push_bind(facility)
        .push(" AND nursing_alerts.id=")
        .push_bind(id);
    nursing_alert_from_row(
        q.build_query_as::<NursingAlertRow>()
            .fetch_optional(&mut **tx)
            .await?
            .ok_or(super::nursing_access::NursingError::NotFound)?,
    )
}

fn patient_vitals_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::<Postgres>::new(
        r#"
        SELECT patient_vitals.id,
               patient_vitals.admission_case_id,
               patient_vitals.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               patient_vitals.recorded_at,
               patient_vitals.temperature_c,
               patient_vitals.systolic_bp,
               patient_vitals.diastolic_bp,
               patient_vitals.pulse,
               patient_vitals.respiratory_rate,
               patient_vitals.oxygen_saturation
        FROM patient_vitals
        JOIN admission_cases observation_admission ON observation_admission.id=patient_vitals.admission_case_id AND observation_admission.facility_id=patient_vitals.facility_id AND observation_admission.patient_id=patient_vitals.patient_id
        JOIN wards observation_ward ON observation_ward.id=observation_admission.ward_id AND observation_ward.facility_id=observation_admission.facility_id
        JOIN patients
          ON patients.id = patient_vitals.patient_id
         AND patients.facility_id = patient_vitals.facility_id
        "#,
    )
}

fn nursing_alert_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::<Postgres>::new(
        r#"
        SELECT nursing_alerts.id,
               nursing_alerts.admission_case_id,
               nursing_alerts.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               nursing_alerts.severity,
               nursing_alerts.title,
               nursing_alerts.status,
               nursing_alerts.created_at,
               nursing_alerts.acknowledged_at
        FROM nursing_alerts
        JOIN admission_cases alert_admission
          ON alert_admission.id = nursing_alerts.admission_case_id
         AND alert_admission.facility_id = nursing_alerts.facility_id
         AND alert_admission.patient_id = nursing_alerts.patient_id
        JOIN wards alert_ward ON alert_ward.id=alert_admission.ward_id AND alert_ward.facility_id=alert_admission.facility_id
        JOIN patients
          ON patients.id = nursing_alerts.patient_id
         AND patients.facility_id = nursing_alerts.facility_id
        "#,
    )
}

fn monitoring_event_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::<Postgres>::new(
        r#"
        SELECT monitoring_events.id,
               monitoring_events.admission_case_id,
               monitoring_events.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               monitoring_events.event_kind,
               monitoring_events.summary,
               monitoring_events.recorded_at
        FROM monitoring_events
        JOIN admission_cases observation_admission ON observation_admission.id=monitoring_events.admission_case_id AND observation_admission.facility_id=monitoring_events.facility_id AND observation_admission.patient_id=monitoring_events.patient_id
        JOIN wards observation_ward ON observation_ward.id=observation_admission.ward_id AND observation_ward.facility_id=observation_admission.facility_id
        JOIN patients
          ON patients.id = monitoring_events.patient_id
         AND patients.facility_id = monitoring_events.facility_id
        "#,
    )
}

fn fluid_balance_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::<Postgres>::new(
        r#"
        SELECT fluid_balance_entries.id,
               fluid_balance_entries.admission_case_id,
               fluid_balance_entries.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               fluid_balance_entries.recorded_at,
               fluid_balance_entries.intake_ml,
               fluid_balance_entries.output_ml,
               fluid_balance_entries.intake_ml - fluid_balance_entries.output_ml AS net_ml
        FROM fluid_balance_entries
        JOIN patients
          ON patients.id = fluid_balance_entries.patient_id
         AND patients.facility_id = fluid_balance_entries.facility_id
        "#,
    )
}

async fn patient_vitals_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    vitals_id: Uuid,
) -> anyhow::Result<PatientVitalsListItem> {
    let mut query = patient_vitals_query();
    query.push(" WHERE patient_vitals.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND patient_vitals.id = ");
    query.push_bind(vitals_id);
    let row = observe_db_query(
        "ward.observations.patient_vitals.get",
        query.build_query_as::<PatientVitalsRow>().fetch_one(pool),
    )
    .await?;
    Ok(patient_vitals_from_row(row))
}

async fn nursing_alert_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    alert_id: Uuid,
) -> anyhow::Result<NursingAlertListItem> {
    optional_nursing_alert_by_id(pool, facility_id, alert_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("nursing alert was not found after write"))
}

async fn optional_nursing_alert_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    alert_id: Uuid,
) -> anyhow::Result<Option<NursingAlertListItem>> {
    let mut query = nursing_alert_query();
    query.push(" WHERE nursing_alerts.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND nursing_alerts.id = ");
    query.push_bind(alert_id);
    let row = observe_db_query(
        "ward.observations.nursing_alerts.get",
        query
            .build_query_as::<NursingAlertRow>()
            .fetch_optional(pool),
    )
    .await?;
    row.map(nursing_alert_from_row).transpose()
}

async fn monitoring_event_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    event_id: Uuid,
) -> anyhow::Result<MonitoringEventListItem> {
    let mut query = monitoring_event_query();
    query.push(" WHERE monitoring_events.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND monitoring_events.id = ");
    query.push_bind(event_id);
    let row = observe_db_query(
        "ward.observations.monitoring_events.get",
        query.build_query_as::<MonitoringEventRow>().fetch_one(pool),
    )
    .await?;
    monitoring_event_from_row(row)
}

fn patient_vitals_from_row(row: PatientVitalsRow) -> PatientVitalsListItem {
    PatientVitalsListItem {
        id: row.id,
        admission_case_id: row.admission_case_id,
        patient_id: row.patient_id,
        patient_code: row.patient_code,
        patient_display_name: row.patient_display_name,
        recorded_at: row.recorded_at,
        temperature_c: row.temperature_c,
        systolic_bp: row.systolic_bp,
        diastolic_bp: row.diastolic_bp,
        pulse: row.pulse,
        respiratory_rate: row.respiratory_rate,
        oxygen_saturation: row.oxygen_saturation,
    }
}

fn nursing_alert_from_row(row: NursingAlertRow) -> anyhow::Result<NursingAlertListItem> {
    Ok(NursingAlertListItem {
        id: row.id,
        admission_case_id: row.admission_case_id,
        patient_id: row.patient_id,
        patient_code: row.patient_code,
        patient_display_name: row.patient_display_name,
        severity: codec::decode(&row.severity)?,
        title: row.title,
        status: codec::decode(&row.status)?,
        created_at: row.created_at,
        acknowledged_at: row.acknowledged_at,
    })
}

fn monitoring_event_from_row(row: MonitoringEventRow) -> anyhow::Result<MonitoringEventListItem> {
    Ok(MonitoringEventListItem {
        id: row.id,
        admission_case_id: row.admission_case_id,
        patient_id: row.patient_id,
        patient_code: row.patient_code,
        patient_display_name: row.patient_display_name,
        event_kind: codec::decode(&row.event_kind)?,
        summary: row.summary,
        recorded_at: row.recorded_at,
    })
}

fn fluid_balance_from_row(row: FluidBalanceRow) -> FluidBalanceListItem {
    FluidBalanceListItem {
        id: row.id,
        admission_case_id: row.admission_case_id,
        patient_id: row.patient_id,
        patient_code: row.patient_code,
        patient_display_name: row.patient_display_name,
        recorded_at: row.recorded_at,
        intake_ml: row.intake_ml,
        output_ml: row.output_ml,
        net_ml: row.net_ml,
    }
}

fn append_forward_cursor(
    query: &mut QueryBuilder<'_, Postgres>,
    time_column: &'static str,
    id_column: &'static str,
    cursor: Option<WardCursor>,
) {
    if let Some(cursor) = cursor {
        query.push(" AND (");
        query.push(time_column);
        query.push(", ");
        query.push(id_column);
        query.push(") > (");
        query.push_bind(cursor.occurred_at);
        query.push(", ");
        query.push_bind(cursor.id);
        query.push(")");
    }
}
