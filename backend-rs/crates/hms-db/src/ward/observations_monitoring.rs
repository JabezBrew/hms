use chrono::{DateTime, Utc};
use hms_domain::ward::{
    FluidBalanceListItem, MonitoringEventKind, MonitoringEventListItem, NursingAlertListItem,
    NursingAlertSeverity, NursingAlertStatus, PatientVitalsListItem,
};
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
    let rows = query
        .build_query_as::<PatientVitalsRow>()
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().map(patient_vitals_from_row).collect())
}

pub async fn create_patient_vitals(
    pool: &PgPool,
    vitals: NewPatientVitals,
) -> anyhow::Result<PatientVitalsListItem> {
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
    .execute(pool)
    .await?;
    patient_vitals_by_id(pool, vitals.facility_id, vitals.id).await
}

pub async fn list_nursing_alerts(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<NursingAlertListItem>> {
    let mut query = nursing_alert_query();
    query.push(" WHERE nursing_alerts.facility_id = ");
    query.push_bind(facility_id);
    append_forward_cursor(
        &mut query,
        "nursing_alerts.created_at",
        "nursing_alerts.id",
        cursor,
    );
    query.push(" ORDER BY nursing_alerts.created_at ASC, nursing_alerts.id ASC LIMIT ");
    query.push_bind(limit);
    let rows = query
        .build_query_as::<NursingAlertRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(nursing_alert_from_row).collect()
}

pub async fn create_nursing_alert(
    pool: &PgPool,
    alert: NewNursingAlert,
) -> anyhow::Result<NursingAlertListItem> {
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
    .execute(pool)
    .await?;
    nursing_alert_by_id(pool, alert.facility_id, alert.id).await
}

pub async fn acknowledge_nursing_alert(
    pool: &PgPool,
    facility_id: Uuid,
    alert_id: Uuid,
    actor_user_id: Uuid,
) -> anyhow::Result<Option<NursingAlertListItem>> {
    sqlx::query(
        r#"
        UPDATE nursing_alerts
        SET status = $1,
            acknowledged_by_user_id = $2,
            acknowledged_at = COALESCE(acknowledged_at, now()),
            updated_at = now()
        WHERE facility_id = $3 AND id = $4
        "#,
    )
    .bind(codec::encode(NursingAlertStatus::Acknowledged)?)
    .bind(actor_user_id)
    .bind(facility_id)
    .bind(alert_id)
    .execute(pool)
    .await?;
    optional_nursing_alert_by_id(pool, facility_id, alert_id).await
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
    let rows = query
        .build_query_as::<MonitoringEventRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(monitoring_event_from_row).collect()
}

pub async fn create_monitoring_event(
    pool: &PgPool,
    event: NewMonitoringEvent,
) -> anyhow::Result<MonitoringEventListItem> {
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
    .execute(pool)
    .await?;
    monitoring_event_by_id(pool, event.facility_id, event.id).await
}

pub async fn list_fluid_balance_entries(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<FluidBalanceListItem>> {
    let mut query = fluid_balance_query();
    query.push(" WHERE fluid_balance_entries.facility_id = ");
    query.push_bind(facility_id);
    append_forward_cursor(
        &mut query,
        "fluid_balance_entries.recorded_at",
        "fluid_balance_entries.id",
        cursor,
    );
    query.push(
        " ORDER BY fluid_balance_entries.recorded_at ASC, fluid_balance_entries.id ASC LIMIT ",
    );
    query.push_bind(limit);
    let rows = query
        .build_query_as::<FluidBalanceRow>()
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().map(fluid_balance_from_row).collect())
}

pub async fn create_fluid_balance_entry(
    pool: &PgPool,
    entry: NewFluidBalanceEntry,
) -> anyhow::Result<FluidBalanceListItem> {
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
    .execute(pool)
    .await?;
    fluid_balance_by_id(pool, entry.facility_id, entry.id).await
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
    let row = query
        .build_query_as::<PatientVitalsRow>()
        .fetch_one(pool)
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
    let row = query
        .build_query_as::<NursingAlertRow>()
        .fetch_optional(pool)
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
    let row = query
        .build_query_as::<MonitoringEventRow>()
        .fetch_one(pool)
        .await?;
    monitoring_event_from_row(row)
}

async fn fluid_balance_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    entry_id: Uuid,
) -> anyhow::Result<FluidBalanceListItem> {
    let mut query = fluid_balance_query();
    query.push(" WHERE fluid_balance_entries.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND fluid_balance_entries.id = ");
    query.push_bind(entry_id);
    let row = query
        .build_query_as::<FluidBalanceRow>()
        .fetch_one(pool)
        .await?;
    Ok(fluid_balance_from_row(row))
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
