use chrono::{DateTime, NaiveDate, Utc};
use hms_domain::care::{
    AppointmentListItem, AppointmentStatus, AppointmentTypeListItem, CareTeamAssignment,
    CareTeamRole, ClinicListItem, ClinicSessionListItem, EncounterListItem, EncounterStatus,
    EncounterType, TriageAcuity, TriageAssessmentRequest, TriageListItem, TriageStatus,
    VisitListItem, VisitStatus,
};
pub use hms_domain::care::{ClinicSessionMode, ClinicSessionOwnerType};
use serde_json::json;
use sqlx::{FromRow, Postgres, QueryBuilder};
use uuid::Uuid;

use crate::codec;
use crate::PgPool;

#[derive(Clone, Debug)]
pub struct CareCursor {
    pub occurred_at: DateTime<Utc>,
    pub id: Uuid,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct TriageFilters {
    pub acuity: Option<TriageAcuity>,
    pub status: Option<TriageStatus>,
}

#[derive(Clone, Debug)]
pub struct NewAppointment {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub patient_id: Uuid,
    pub starts_at: DateTime<Utc>,
    pub ends_at: DateTime<Utc>,
    pub created_by_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewBookedAppointment {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub patient_id: Uuid,
    pub clinic_id: Option<Uuid>,
    pub clinic_session_id: Option<Uuid>,
    pub appointment_type_id: Option<Uuid>,
    pub practitioner_user_id: Option<Uuid>,
    pub starts_at: DateTime<Utc>,
    pub ends_at: DateTime<Utc>,
    pub overbook_reason: Option<String>,
    pub series_id: Option<Uuid>,
    pub created_by_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct AppointmentUpdate {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub starts_at: Option<DateTime<Utc>>,
    pub ends_at: Option<DateTime<Utc>>,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewClinic {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub code: String,
    pub name: String,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewClinicSession {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub clinic_id: Option<Uuid>,
    pub service_code: Option<String>,
    pub practitioner_user_id: Option<Uuid>,
    pub owner_type: ClinicSessionOwnerType,
    pub owner_id: Option<Uuid>,
    pub name: String,
    pub mode: ClinicSessionMode,
    pub starts_at: DateTime<Utc>,
    pub ends_at: DateTime<Utc>,
    pub slot_minutes: Option<i32>,
    pub capacity: i32,
    pub allow_overbooking: bool,
    pub overbook_limit: i32,
    pub created_by_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewAppointmentType {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub code: String,
    pub name: String,
    pub default_duration_minutes: i32,
    pub created_by_user_id: Uuid,
}

#[derive(Clone, Copy, Debug)]
pub enum BlockedTimeScope {
    Session,
    Practitioner,
}

#[derive(Clone, Debug)]
pub struct NewBlockedTime {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub scope: BlockedTimeScope,
    pub clinic_session_id: Option<Uuid>,
    pub practitioner_user_id: Option<Uuid>,
    pub starts_at: DateTime<Utc>,
    pub ends_at: DateTime<Utc>,
    pub reason: String,
    pub created_by_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct AppointmentHistoryItem {
    pub id: Uuid,
    pub appointment_id: Uuid,
    pub event_type: String,
    pub reason: Option<String>,
    pub previous_starts_at: Option<DateTime<Utc>>,
    pub previous_ends_at: Option<DateTime<Utc>>,
    pub new_starts_at: Option<DateTime<Utc>>,
    pub new_ends_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug)]
pub struct NewAppointmentSeries {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub patient_id: Uuid,
    pub clinic_id: Option<Uuid>,
    pub clinic_session_id: Option<Uuid>,
    pub appointment_type_id: Option<Uuid>,
    pub practitioner_user_id: Option<Uuid>,
    pub starts_at: Vec<DateTime<Utc>>,
    pub duration_minutes: i64,
    pub repeat_rule: Option<String>,
    pub created_by_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct AppointmentSeriesCreated {
    pub series_id: Uuid,
    pub appointments: Vec<AppointmentListItem>,
}

#[derive(Clone, Debug)]
pub struct ClinicUpdate {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub code: Option<String>,
    pub name: Option<String>,
    pub is_active: Option<bool>,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewVisit {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub patient_id: Uuid,
    pub appointment_id: Option<Uuid>,
    pub clinic_id: Option<Uuid>,
    pub created_by_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewTriage {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub visit_id: Uuid,
    pub patient_id: Uuid,
    pub acuity: TriageAcuity,
    pub created_by_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewEncounter {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub patient_id: Uuid,
    pub visit_id: Option<Uuid>,
    pub encounter_type: EncounterType,
    pub created_by_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct EncounterUpdate {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub visit_id: Option<Uuid>,
    pub encounter_type: Option<EncounterType>,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewCareTeamAssignment {
    pub id: Uuid,
    pub encounter_id: Uuid,
    pub user_id: Uuid,
    pub role: CareTeamRole,
    pub created_by_user_id: Uuid,
}

#[derive(Clone, Debug, FromRow)]
struct AppointmentRow {
    id: Uuid,
    patient_id: Uuid,
    patient_code: String,
    patient_display_name: String,
    clinic_id: Option<Uuid>,
    clinic_session_id: Option<Uuid>,
    appointment_type_id: Option<Uuid>,
    appointment_type_name: Option<String>,
    practitioner_user_id: Option<Uuid>,
    starts_at: DateTime<Utc>,
    ends_at: DateTime<Utc>,
    status: String,
    cancellation_reason: Option<String>,
    overbook_reason: Option<String>,
    series_id: Option<Uuid>,
    created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct ClinicRow {
    id: Uuid,
    code: String,
    name: String,
    is_active: bool,
    created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct ClinicSessionRow {
    id: Uuid,
    clinic_id: Option<Uuid>,
    service_code: Option<String>,
    practitioner_user_id: Option<Uuid>,
    owner_type: String,
    owner_id: Option<Uuid>,
    name: String,
    mode: String,
    starts_at: DateTime<Utc>,
    ends_at: DateTime<Utc>,
    slot_minutes: Option<i32>,
    capacity: i32,
    allow_overbooking: bool,
    overbook_limit: i32,
    is_active: bool,
    created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct AppointmentTypeRow {
    id: Uuid,
    code: String,
    name: String,
    default_duration_minutes: i32,
    is_active: bool,
    created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct AppointmentHistoryRow {
    id: Uuid,
    appointment_id: Uuid,
    event_type: String,
    reason: Option<String>,
    previous_starts_at: Option<DateTime<Utc>>,
    previous_ends_at: Option<DateTime<Utc>>,
    new_starts_at: Option<DateTime<Utc>>,
    new_ends_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct VisitRow {
    id: Uuid,
    patient_id: Uuid,
    patient_code: String,
    patient_display_name: String,
    appointment_id: Option<Uuid>,
    clinic_id: Option<Uuid>,
    status: String,
    checked_in_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct TriageRow {
    id: Uuid,
    visit_id: Uuid,
    patient_id: Uuid,
    patient_code: String,
    patient_display_name: String,
    acuity: String,
    status: String,
    triage_notes: Option<String>,
    created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct EncounterRow {
    id: Uuid,
    patient_id: Uuid,
    patient_code: String,
    patient_display_name: String,
    visit_id: Option<Uuid>,
    encounter_type: String,
    status: String,
    started_at: DateTime<Utc>,
    ended_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, FromRow)]
struct CareTeamAssignmentRow {
    id: Uuid,
    encounter_id: Uuid,
    user_id: Uuid,
    role: String,
    is_active: bool,
    created_at: DateTime<Utc>,
}

pub async fn list_appointments(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<CareCursor>,
    date: Option<NaiveDate>,
    clinic_id: Option<Uuid>,
    limit: i64,
) -> anyhow::Result<Vec<AppointmentListItem>> {
    let mut query = QueryBuilder::<Postgres>::new(
        r#"
        SELECT appointments.id,
               appointments.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               appointments.clinic_id,
               appointments.clinic_session_id,
               appointments.appointment_type_id,
               appointment_types.name AS appointment_type_name,
               appointments.practitioner_user_id,
               appointments.starts_at,
               appointments.ends_at,
               appointments.status,
               appointments.cancellation_reason,
               appointments.overbook_reason,
               appointments.series_id,
               appointments.created_at
        FROM appointments
        JOIN patients ON patients.id = appointments.patient_id
        LEFT JOIN appointment_types ON appointment_types.id = appointments.appointment_type_id
             AND appointment_types.facility_id = appointments.facility_id
        WHERE appointments.facility_id =
        "#,
    );
    query.push_bind(facility_id);
    query.push(" AND patients.facility_id = ");
    query.push_bind(facility_id);

    if let Some(date) = date {
        let starts_at = date
            .and_hms_opt(0, 0, 0)
            .expect("valid midnight for schedule date")
            .and_utc();
        let ends_before = date
            .succ_opt()
            .and_then(|next_date| next_date.and_hms_opt(0, 0, 0))
            .expect("valid next-day midnight for schedule date")
            .and_utc();
        query.push(" AND appointments.starts_at >= ");
        query.push_bind(starts_at);
        query.push(" AND appointments.starts_at < ");
        query.push_bind(ends_before);
    }

    if let Some(clinic_id) = clinic_id {
        query.push(" AND appointments.clinic_id = ");
        query.push_bind(clinic_id);
    }

    if let Some(cursor) = cursor {
        query.push(" AND (appointments.starts_at, appointments.id) > (");
        query.push_bind(cursor.occurred_at);
        query.push(", ");
        query.push_bind(cursor.id);
        query.push(")");
    }

    query.push(" ORDER BY appointments.starts_at ASC, appointments.id ASC LIMIT ");
    query.push_bind(limit);

    let rows = query
        .build_query_as::<AppointmentRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(appointment_from_row).collect()
}

pub async fn list_clinics(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<CareCursor>,
    limit: i64,
) -> anyhow::Result<Vec<ClinicListItem>> {
    let mut query = QueryBuilder::<Postgres>::new(
        r#"
        SELECT id,
               code,
               name,
               is_active,
               created_at
        FROM clinics
        WHERE facility_id =
        "#,
    );
    query.push_bind(facility_id);

    if let Some(cursor) = cursor {
        query.push(" AND (created_at, id) > (");
        query.push_bind(cursor.occurred_at);
        query.push(", ");
        query.push_bind(cursor.id);
        query.push(")");
    }

    query.push(" ORDER BY created_at ASC, id ASC LIMIT ");
    query.push_bind(limit);

    let rows = query.build_query_as::<ClinicRow>().fetch_all(pool).await?;
    Ok(rows.into_iter().map(clinic_from_row).collect())
}

pub async fn get_clinic(
    pool: &PgPool,
    facility_id: Uuid,
    clinic_id: Uuid,
) -> anyhow::Result<Option<ClinicListItem>> {
    let row = sqlx::query_as::<_, ClinicRow>(
        r#"
        SELECT id,
               code,
               name,
               is_active,
               created_at
        FROM clinics
        WHERE facility_id = $1 AND id = $2
        "#,
    )
    .bind(facility_id)
    .bind(clinic_id)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(clinic_from_row))
}

pub async fn create_clinic(pool: &PgPool, clinic: NewClinic) -> anyhow::Result<ClinicListItem> {
    let row = sqlx::query_as::<_, ClinicRow>(
        r#"
        INSERT INTO clinics (
            id,
            facility_id,
            code,
            name
        )
        VALUES ($1, $2, $3, $4)
        RETURNING id,
                  code,
                  name,
                  is_active,
                  created_at
        "#,
    )
    .bind(clinic.id)
    .bind(clinic.facility_id)
    .bind(clinic.code)
    .bind(clinic.name)
    .fetch_one(pool)
    .await?;

    let _ = clinic.actor_user_id;
    Ok(clinic_from_row(row))
}

pub async fn create_clinic_session(
    pool: &PgPool,
    session: NewClinicSession,
) -> anyhow::Result<ClinicSessionListItem> {
    if session.ends_at <= session.starts_at {
        anyhow::bail!("clinic session end time must be after start time");
    }
    if session.capacity < 1 {
        anyhow::bail!("clinic session capacity must be positive");
    }
    if let Some(slot_minutes) = session.slot_minutes {
        if slot_minutes < 1 {
            anyhow::bail!("slot duration must be positive");
        }
    }

    let row = sqlx::query_as::<_, ClinicSessionRow>(
        r#"
        INSERT INTO clinic_sessions (
            id,
            facility_id,
            clinic_id,
            service_code,
            practitioner_user_id,
            owner_type,
            owner_id,
            name,
            mode,
            starts_at,
            ends_at,
            slot_minutes,
            capacity,
            allow_overbooking,
            overbook_limit,
            created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        RETURNING id,
                  clinic_id,
                  service_code,
                  practitioner_user_id,
                  owner_type,
                  owner_id,
                  name,
                  mode,
                  starts_at,
                  ends_at,
                  slot_minutes,
                  capacity,
                  allow_overbooking,
                  overbook_limit,
                  is_active,
                  created_at
        "#,
    )
    .bind(session.id)
    .bind(session.facility_id)
    .bind(session.clinic_id)
    .bind(session.service_code)
    .bind(session.practitioner_user_id)
    .bind(codec::encode(session.owner_type)?)
    .bind(session.owner_id)
    .bind(session.name)
    .bind(codec::encode(session.mode)?)
    .bind(session.starts_at)
    .bind(session.ends_at)
    .bind(session.slot_minutes)
    .bind(session.capacity)
    .bind(session.allow_overbooking)
    .bind(session.overbook_limit)
    .bind(session.created_by_user_id)
    .fetch_one(pool)
    .await?;

    clinic_session_from_row(row)
}

pub async fn create_appointment_type(
    pool: &PgPool,
    appointment_type: NewAppointmentType,
) -> anyhow::Result<AppointmentTypeListItem> {
    let row = sqlx::query_as::<_, AppointmentTypeRow>(
        r#"
        INSERT INTO appointment_types (
            id,
            facility_id,
            code,
            name,
            default_duration_minutes,
            created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id,
                  code,
                  name,
                  default_duration_minutes,
                  is_active,
                  created_at
        "#,
    )
    .bind(appointment_type.id)
    .bind(appointment_type.facility_id)
    .bind(appointment_type.code)
    .bind(appointment_type.name)
    .bind(appointment_type.default_duration_minutes)
    .bind(appointment_type.created_by_user_id)
    .fetch_one(pool)
    .await?;

    Ok(appointment_type_from_row(row))
}

pub async fn list_appointment_types(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<CareCursor>,
    limit: i64,
) -> anyhow::Result<Vec<AppointmentTypeListItem>> {
    let mut query = QueryBuilder::<Postgres>::new(
        r#"
        SELECT id,
               code,
               name,
               default_duration_minutes,
               is_active,
               created_at
        FROM appointment_types
        WHERE facility_id =
        "#,
    );
    query.push_bind(facility_id);
    query.push(" AND is_active = TRUE");

    if let Some(cursor) = cursor {
        query.push(" AND (created_at, id) > (");
        query.push_bind(cursor.occurred_at);
        query.push(", ");
        query.push_bind(cursor.id);
        query.push(")");
    }

    query.push(" ORDER BY created_at ASC, id ASC LIMIT ");
    query.push_bind(limit);

    let rows = query
        .build_query_as::<AppointmentTypeRow>()
        .fetch_all(pool)
        .await?;

    Ok(rows.into_iter().map(appointment_type_from_row).collect())
}

pub async fn constrain_appointment_type_to_session(
    pool: &PgPool,
    facility_id: Uuid,
    clinic_session_id: Uuid,
    appointment_type_id: Uuid,
) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO clinic_session_appointment_types (
            facility_id,
            clinic_session_id,
            appointment_type_id
        )
        VALUES ($1, $2, $3)
        ON CONFLICT (clinic_session_id, appointment_type_id) DO NOTHING
        "#,
    )
    .bind(facility_id)
    .bind(clinic_session_id)
    .bind(appointment_type_id)
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn create_blocked_time(
    pool: &PgPool,
    blocked_time: NewBlockedTime,
) -> anyhow::Result<()> {
    if blocked_time.ends_at <= blocked_time.starts_at {
        anyhow::bail!("blocked time end must be after start");
    }
    let reason = blocked_time.reason.trim();
    if reason.is_empty() {
        anyhow::bail!("blocked time reason is required");
    }

    sqlx::query(
        r#"
        INSERT INTO appointment_blocked_times (
            id,
            facility_id,
            scope,
            clinic_session_id,
            practitioner_user_id,
            starts_at,
            ends_at,
            reason,
            created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        "#,
    )
    .bind(blocked_time.id)
    .bind(blocked_time.facility_id)
    .bind(match blocked_time.scope {
        BlockedTimeScope::Session => "session",
        BlockedTimeScope::Practitioner => "practitioner",
    })
    .bind(blocked_time.clinic_session_id)
    .bind(blocked_time.practitioner_user_id)
    .bind(blocked_time.starts_at)
    .bind(blocked_time.ends_at)
    .bind(reason)
    .bind(blocked_time.created_by_user_id)
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn update_clinic(
    pool: &PgPool,
    clinic: ClinicUpdate,
) -> anyhow::Result<Option<ClinicListItem>> {
    let row = sqlx::query_as::<_, ClinicRow>(
        r#"
        UPDATE clinics
        SET code = COALESCE($3, code),
            name = COALESCE($4, name),
            is_active = COALESCE($5, is_active),
            updated_at = now()
        WHERE facility_id = $1
          AND id = $2
        RETURNING id,
                  code,
                  name,
                  is_active,
                  created_at
        "#,
    )
    .bind(clinic.facility_id)
    .bind(clinic.id)
    .bind(clinic.code)
    .bind(clinic.name)
    .bind(clinic.is_active)
    .fetch_optional(pool)
    .await?;

    let _ = clinic.actor_user_id;
    Ok(row.map(clinic_from_row))
}

pub async fn deactivate_clinic(
    pool: &PgPool,
    facility_id: Uuid,
    clinic_id: Uuid,
    actor_user_id: Uuid,
) -> anyhow::Result<Option<ClinicListItem>> {
    update_clinic(
        pool,
        ClinicUpdate {
            id: clinic_id,
            facility_id,
            code: None,
            name: None,
            is_active: Some(false),
            actor_user_id,
        },
    )
    .await
}

pub async fn create_appointment(
    pool: &PgPool,
    appointment: NewAppointment,
) -> anyhow::Result<AppointmentListItem> {
    create_booked_appointment(
        pool,
        NewBookedAppointment {
            id: appointment.id,
            facility_id: appointment.facility_id,
            patient_id: appointment.patient_id,
            clinic_id: None,
            clinic_session_id: None,
            appointment_type_id: None,
            practitioner_user_id: None,
            starts_at: appointment.starts_at,
            ends_at: appointment.ends_at,
            overbook_reason: None,
            series_id: None,
            created_by_user_id: appointment.created_by_user_id,
        },
    )
    .await
}

pub async fn create_booked_appointment(
    pool: &PgPool,
    appointment: NewBookedAppointment,
) -> anyhow::Result<AppointmentListItem> {
    if appointment.ends_at <= appointment.starts_at {
        anyhow::bail!("appointment end time must be after start time");
    }
    let mut transaction = pool.begin().await?;
    let session = if let Some(session_id) = appointment.clinic_session_id {
        Some(
            load_clinic_session_for_update(&mut transaction, appointment.facility_id, session_id)
                .await?,
        )
    } else {
        None
    };
    let clinic_id = if let Some(clinic_id) = appointment.clinic_id {
        Some(clinic_id)
    } else if let Some(session) = &session {
        session.clinic_id
    } else {
        default_clinic_id(pool, appointment.facility_id).await?
    };

    if let Some(session) = &session {
        validate_session_booking(&mut transaction, session, &appointment).await?;
    }

    let row = sqlx::query_as::<_, AppointmentRow>(
        r#"
        WITH inserted AS (
            INSERT INTO appointments (
                id,
                facility_id,
                patient_id,
                clinic_id,
                clinic_session_id,
                appointment_type_id,
                practitioner_user_id,
                series_id,
                starts_at,
                ends_at,
                status,
                overbook_reason,
                overbooked_at,
                overbooked_by_user_id,
                created_by_user_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                    CASE WHEN $12::text IS NULL THEN NULL ELSE now() END,
                    CASE WHEN $12::text IS NULL THEN NULL ELSE $13 END,
                    $13)
            RETURNING id,
                      patient_id,
                      clinic_id,
                      clinic_session_id,
                      appointment_type_id,
                      practitioner_user_id,
                      series_id,
                      starts_at,
                      ends_at,
                      status,
                      cancellation_reason,
                      overbook_reason,
                      created_at
        )
        SELECT inserted.id,
               inserted.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               inserted.clinic_id,
               inserted.clinic_session_id,
               inserted.appointment_type_id,
               appointment_types.name AS appointment_type_name,
               inserted.practitioner_user_id,
               inserted.starts_at,
               inserted.ends_at,
               inserted.status,
               inserted.cancellation_reason,
               inserted.overbook_reason,
               inserted.series_id,
               inserted.created_at
        FROM inserted
        JOIN patients ON patients.id = inserted.patient_id
        LEFT JOIN appointment_types ON appointment_types.id = inserted.appointment_type_id
             AND appointment_types.facility_id = $2
        "#,
    )
    .bind(appointment.id)
    .bind(appointment.facility_id)
    .bind(appointment.patient_id)
    .bind(clinic_id)
    .bind(appointment.clinic_session_id)
    .bind(appointment.appointment_type_id)
    .bind(appointment.practitioner_user_id)
    .bind(appointment.series_id)
    .bind(appointment.starts_at)
    .bind(appointment.ends_at)
    .bind(codec::encode(AppointmentStatus::Scheduled)?)
    .bind(appointment.overbook_reason.as_deref())
    .bind(appointment.created_by_user_id)
    .fetch_one(&mut *transaction)
    .await?;

    if appointment.overbook_reason.is_some() {
        insert_appointment_history(
            &mut transaction,
            appointment.facility_id,
            appointment.id,
            "overbooked",
            appointment.created_by_user_id,
            appointment.overbook_reason.as_deref(),
            None,
            None,
            Some(appointment.starts_at),
            Some(appointment.ends_at),
        )
        .await?;
    }

    transaction.commit().await?;
    appointment_from_row(row)
}

pub async fn get_appointment(
    pool: &PgPool,
    facility_id: Uuid,
    appointment_id: Uuid,
) -> anyhow::Result<Option<AppointmentListItem>> {
    let row = sqlx::query_as::<_, AppointmentRow>(
        r#"
        SELECT appointments.id,
               appointments.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               appointments.clinic_id,
               appointments.clinic_session_id,
               appointments.appointment_type_id,
               appointment_types.name AS appointment_type_name,
               appointments.practitioner_user_id,
               appointments.starts_at,
               appointments.ends_at,
               appointments.status,
               appointments.cancellation_reason,
               appointments.overbook_reason,
               appointments.series_id,
               appointments.created_at
        FROM appointments
        JOIN patients ON patients.id = appointments.patient_id
        LEFT JOIN appointment_types ON appointment_types.id = appointments.appointment_type_id
             AND appointment_types.facility_id = appointments.facility_id
        WHERE appointments.facility_id = $1
          AND appointments.id = $2
          AND patients.facility_id = $1
        "#,
    )
    .bind(facility_id)
    .bind(appointment_id)
    .fetch_optional(pool)
    .await?;

    row.map(appointment_from_row).transpose()
}

pub async fn update_appointment(
    pool: &PgPool,
    appointment: AppointmentUpdate,
) -> anyhow::Result<Option<AppointmentListItem>> {
    let mut transaction = pool.begin().await?;
    let existing = sqlx::query_as::<_, AppointmentRow>(
        r#"
        SELECT appointments.id,
               appointments.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               appointments.clinic_id,
               appointments.clinic_session_id,
               appointments.appointment_type_id,
               appointment_types.name AS appointment_type_name,
               appointments.practitioner_user_id,
               appointments.starts_at,
               appointments.ends_at,
               appointments.status,
               appointments.cancellation_reason,
               appointments.overbook_reason,
               appointments.series_id,
               appointments.created_at
        FROM appointments
        JOIN patients ON patients.id = appointments.patient_id
        LEFT JOIN appointment_types ON appointment_types.id = appointments.appointment_type_id
             AND appointment_types.facility_id = appointments.facility_id
        WHERE appointments.facility_id = $1
          AND appointments.id = $2
          AND appointments.status = 'scheduled'
          AND patients.facility_id = $1
        FOR UPDATE OF appointments
        "#,
    )
    .bind(appointment.facility_id)
    .bind(appointment.id)
    .fetch_optional(&mut *transaction)
    .await?;

    let Some(existing) = existing else {
        return Ok(None);
    };
    let starts_at = appointment.starts_at.unwrap_or(existing.starts_at);
    let ends_at = appointment.ends_at.unwrap_or(existing.ends_at);
    if ends_at <= starts_at {
        anyhow::bail!("appointment end time must be after start time");
    }

    if let Some(session_id) = existing.clinic_session_id {
        let session =
            load_clinic_session_for_update(&mut transaction, appointment.facility_id, session_id)
                .await?;
        let validation_appointment = NewBookedAppointment {
            id: appointment.id,
            facility_id: appointment.facility_id,
            patient_id: existing.patient_id,
            clinic_id: existing.clinic_id,
            clinic_session_id: existing.clinic_session_id,
            appointment_type_id: existing.appointment_type_id,
            practitioner_user_id: existing.practitioner_user_id,
            starts_at,
            ends_at,
            overbook_reason: existing.overbook_reason.clone(),
            series_id: existing.series_id,
            created_by_user_id: appointment.actor_user_id,
        };
        validate_session_booking_excluding(
            &mut transaction,
            &session,
            &validation_appointment,
            Some(appointment.id),
        )
        .await?;
    }

    let row = sqlx::query_as::<_, AppointmentRow>(
        r#"
        WITH updated AS (
            UPDATE appointments
            SET starts_at = $3,
                ends_at = $4,
                updated_at = now()
            WHERE facility_id = $1
              AND id = $2
              AND status = 'scheduled'
            RETURNING id,
                      patient_id,
                      clinic_id,
                      clinic_session_id,
                      appointment_type_id,
                      practitioner_user_id,
                      series_id,
                      starts_at,
                      ends_at,
                      status,
                      cancellation_reason,
                      overbook_reason,
                      created_at
        )
        SELECT updated.id,
               updated.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               updated.clinic_id,
               updated.clinic_session_id,
               updated.appointment_type_id,
               appointment_types.name AS appointment_type_name,
               updated.practitioner_user_id,
               updated.starts_at,
               updated.ends_at,
               updated.status,
               updated.cancellation_reason,
               updated.overbook_reason,
               updated.series_id,
               updated.created_at
        FROM updated
        JOIN patients ON patients.id = updated.patient_id
        LEFT JOIN appointment_types ON appointment_types.id = updated.appointment_type_id
             AND appointment_types.facility_id = $1
        WHERE patients.facility_id = $1
        "#,
    )
    .bind(appointment.facility_id)
    .bind(appointment.id)
    .bind(starts_at)
    .bind(ends_at)
    .fetch_optional(&mut *transaction)
    .await?;

    if starts_at != existing.starts_at || ends_at != existing.ends_at {
        insert_appointment_history(
            &mut transaction,
            appointment.facility_id,
            appointment.id,
            "rescheduled",
            appointment.actor_user_id,
            None,
            Some(existing.starts_at),
            Some(existing.ends_at),
            Some(starts_at),
            Some(ends_at),
        )
        .await?;
    }

    transaction.commit().await?;
    row.map(appointment_from_row).transpose()
}

pub async fn cancel_appointment(
    pool: &PgPool,
    facility_id: Uuid,
    appointment_id: Uuid,
    actor_user_id: Uuid,
    reason: String,
) -> anyhow::Result<Option<AppointmentListItem>> {
    let reason = reason.trim().to_owned();
    if reason.is_empty() {
        anyhow::bail!("appointment cancellation reason is required");
    }
    let mut transaction = pool.begin().await?;
    let row = sqlx::query_as::<_, AppointmentRow>(
        r#"
        WITH updated AS (
            UPDATE appointments
            SET status = $3,
                cancellation_reason = $4,
                cancelled_at = now(),
                cancelled_by_user_id = $5,
                updated_at = now()
            WHERE facility_id = $1
              AND id = $2
              AND status = 'scheduled'
            RETURNING id,
                      patient_id,
                      clinic_id,
                      clinic_session_id,
                      appointment_type_id,
                      practitioner_user_id,
                      series_id,
                      starts_at,
                      ends_at,
                      status,
                      cancellation_reason,
                      overbook_reason,
                      created_at
        )
        SELECT updated.id,
               updated.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               updated.clinic_id,
               updated.clinic_session_id,
               updated.appointment_type_id,
               appointment_types.name AS appointment_type_name,
               updated.practitioner_user_id,
               updated.starts_at,
               updated.ends_at,
               updated.status,
               updated.cancellation_reason,
               updated.overbook_reason,
               updated.series_id,
               updated.created_at
        FROM updated
        JOIN patients ON patients.id = updated.patient_id
        LEFT JOIN appointment_types ON appointment_types.id = updated.appointment_type_id
             AND appointment_types.facility_id = $1
        WHERE patients.facility_id = $1
        "#,
    )
    .bind(facility_id)
    .bind(appointment_id)
    .bind(codec::encode(AppointmentStatus::Cancelled)?)
    .bind(&reason)
    .bind(actor_user_id)
    .fetch_optional(&mut *transaction)
    .await?;

    if row.is_some() {
        insert_appointment_history(
            &mut transaction,
            facility_id,
            appointment_id,
            "cancelled",
            actor_user_id,
            Some(&reason),
            None,
            None,
            None,
            None,
        )
        .await?;
    }

    transaction.commit().await?;
    row.map(appointment_from_row).transpose()
}

pub async fn list_visits(
    pool: &PgPool,
    facility_id: Uuid,
    clinic_id: Option<Uuid>,
    cursor: Option<CareCursor>,
    limit: i64,
) -> anyhow::Result<Vec<VisitListItem>> {
    let mut query = QueryBuilder::<Postgres>::new(
        r#"
        SELECT visits.id,
               visits.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               visits.appointment_id,
               visits.clinic_id,
               visits.status,
               visits.checked_in_at
        FROM visits
        JOIN patients ON patients.id = visits.patient_id
        WHERE visits.facility_id =
        "#,
    );
    query.push_bind(facility_id);
    query.push(" AND patients.facility_id = ");
    query.push_bind(facility_id);

    if let Some(clinic_id) = clinic_id {
        query.push(" AND visits.clinic_id = ");
        query.push_bind(clinic_id);
    }

    if let Some(cursor) = cursor {
        query.push(" AND (visits.checked_in_at, visits.id) > (");
        query.push_bind(cursor.occurred_at);
        query.push(", ");
        query.push_bind(cursor.id);
        query.push(")");
    }

    query.push(" ORDER BY visits.checked_in_at ASC, visits.id ASC LIMIT ");
    query.push_bind(limit);

    let rows = query.build_query_as::<VisitRow>().fetch_all(pool).await?;
    rows.into_iter().map(visit_from_row).collect()
}

pub async fn appointment_history(
    pool: &PgPool,
    facility_id: Uuid,
    appointment_id: Uuid,
) -> anyhow::Result<Vec<AppointmentHistoryItem>> {
    let rows = sqlx::query_as::<_, AppointmentHistoryRow>(
        r#"
        SELECT id,
               appointment_id,
               event_type,
               reason,
               previous_starts_at,
               previous_ends_at,
               new_starts_at,
               new_ends_at,
               created_at
        FROM appointment_history
        WHERE facility_id = $1
          AND appointment_id = $2
        ORDER BY created_at ASC, id ASC
        "#,
    )
    .bind(facility_id)
    .bind(appointment_id)
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(appointment_history_from_row).collect())
}

pub async fn create_appointment_series(
    pool: &PgPool,
    series: NewAppointmentSeries,
) -> anyhow::Result<AppointmentSeriesCreated> {
    if series.starts_at.is_empty() {
        anyhow::bail!("appointment series requires at least one date");
    }
    if series.duration_minutes <= 0 {
        anyhow::bail!("appointment series duration must be positive");
    }

    let mut transaction = pool.begin().await?;
    sqlx::query(
        r#"
        INSERT INTO appointment_series (
            id,
            facility_id,
            patient_id,
            repeat_rule,
            selected_dates,
            created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        "#,
    )
    .bind(series.id)
    .bind(series.facility_id)
    .bind(series.patient_id)
    .bind(series.repeat_rule.clone())
    .bind(sqlx::types::Json(json!(series.starts_at)))
    .bind(series.created_by_user_id)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;

    let mut appointments = Vec::with_capacity(series.starts_at.len());
    for starts_at in &series.starts_at {
        let ends_at = *starts_at + chrono::Duration::minutes(series.duration_minutes);
        let appointment = create_booked_appointment(
            pool,
            NewBookedAppointment {
                id: Uuid::new_v4(),
                facility_id: series.facility_id,
                patient_id: series.patient_id,
                clinic_id: series.clinic_id,
                clinic_session_id: series.clinic_session_id,
                appointment_type_id: series.appointment_type_id,
                practitioner_user_id: series.practitioner_user_id,
                starts_at: *starts_at,
                ends_at,
                overbook_reason: None,
                series_id: Some(series.id),
                created_by_user_id: series.created_by_user_id,
            },
        )
        .await?;
        appointments.push(appointment);
    }

    Ok(AppointmentSeriesCreated {
        series_id: series.id,
        appointments,
    })
}

pub async fn get_visit(
    pool: &PgPool,
    facility_id: Uuid,
    visit_id: Uuid,
) -> anyhow::Result<Option<VisitListItem>> {
    let row = sqlx::query_as::<_, VisitRow>(
        r#"
        SELECT visits.id,
               visits.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               visits.appointment_id,
               visits.clinic_id,
               visits.status,
               visits.checked_in_at
        FROM visits
        JOIN patients ON patients.id = visits.patient_id
        WHERE visits.facility_id = $1
          AND patients.facility_id = $1
          AND visits.id = $2
        "#,
    )
    .bind(facility_id)
    .bind(visit_id)
    .fetch_optional(pool)
    .await?;

    row.map(visit_from_row).transpose()
}

pub async fn check_in_visit(pool: &PgPool, visit: NewVisit) -> anyhow::Result<VisitListItem> {
    let clinic_id = resolve_visit_clinic_id(pool, visit.facility_id, visit.clinic_id).await?;
    let mut transaction = pool.begin().await?;
    let row = sqlx::query_as::<_, VisitRow>(
        r#"
        WITH inserted AS (
            INSERT INTO visits (
                id,
                facility_id,
                patient_id,
                appointment_id,
                clinic_id,
                status,
                created_by_user_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id,
                      patient_id,
                      appointment_id,
                      clinic_id,
                      status,
                      checked_in_at
        )
        SELECT inserted.id,
               inserted.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               inserted.appointment_id,
               inserted.clinic_id,
               inserted.status,
               inserted.checked_in_at
        FROM inserted
        JOIN patients ON patients.id = inserted.patient_id
        "#,
    )
    .bind(visit.id)
    .bind(visit.facility_id)
    .bind(visit.patient_id)
    .bind(visit.appointment_id)
    .bind(clinic_id)
    .bind(codec::encode(VisitStatus::Waiting)?)
    .bind(visit.created_by_user_id)
    .fetch_one(&mut *transaction)
    .await?;

    if let Some(appointment_id) = visit.appointment_id {
        sqlx::query(
            r#"
            UPDATE appointments
            SET status = $1,
                updated_at = now()
            WHERE facility_id = $2
              AND id = $3
              AND patient_id = $4
            "#,
        )
        .bind(codec::encode(AppointmentStatus::CheckedIn)?)
        .bind(visit.facility_id)
        .bind(appointment_id)
        .bind(visit.patient_id)
        .execute(&mut *transaction)
        .await?;
    }

    transaction.commit().await?;
    visit_from_row(row)
}

pub async fn update_visit_status(
    pool: &PgPool,
    facility_id: Uuid,
    visit_id: Uuid,
    status: VisitStatus,
) -> anyhow::Result<Option<VisitListItem>> {
    let status_code = codec::encode(status)?;
    let timestamp_column = match status {
        VisitStatus::Called => "called_at",
        VisitStatus::InConsultation => "consultation_started_at",
        VisitStatus::CheckedOut => "checked_out_at",
        _ => "",
    };
    let mut sql = String::from(
        r#"
        WITH updated AS (
            UPDATE visits
            SET status = $1,
        "#,
    );
    if timestamp_column.is_empty() {
        sql.push_str("updated_at = now()");
    } else {
        sql.push_str(timestamp_column);
        sql.push_str(" = COALESCE(");
        sql.push_str(timestamp_column);
        sql.push_str(", now()), updated_at = now()");
    }
    sql.push_str(
        r#"
            WHERE facility_id = $2 AND id = $3
            RETURNING id,
                      patient_id,
                      appointment_id,
                      clinic_id,
                      status,
                      checked_in_at
        )
        SELECT updated.id,
               updated.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               updated.appointment_id,
               updated.clinic_id,
               updated.status,
               updated.checked_in_at
        FROM updated
        JOIN patients ON patients.id = updated.patient_id
        WHERE patients.facility_id = $2
        "#,
    );

    let row = sqlx::query_as::<_, VisitRow>(&sql)
        .bind(status_code)
        .bind(facility_id)
        .bind(visit_id)
        .fetch_optional(pool)
        .await?;

    row.map(visit_from_row).transpose()
}

pub async fn list_triage(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<CareCursor>,
    limit: i64,
    filters: TriageFilters,
) -> anyhow::Result<Vec<TriageListItem>> {
    let mut query = QueryBuilder::<Postgres>::new(
        r#"
        SELECT triage_queue.id,
               triage_queue.visit_id,
               triage_queue.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               triage_queue.acuity,
               triage_queue.status,
               triage_queue.triage_notes,
               triage_queue.created_at
        FROM triage_queue
        JOIN patients ON patients.id = triage_queue.patient_id
        WHERE triage_queue.facility_id =
        "#,
    );
    query.push_bind(facility_id);
    query.push(" AND patients.facility_id = ");
    query.push_bind(facility_id);

    if let Some(acuity) = filters.acuity {
        query.push(" AND triage_queue.acuity = ");
        query.push_bind(codec::encode(acuity)?);
    }
    if let Some(status) = filters.status {
        query.push(" AND triage_queue.status = ");
        query.push_bind(codec::encode(status)?);
    }

    if let Some(cursor) = cursor {
        query.push(" AND (triage_queue.created_at, triage_queue.id) > (");
        query.push_bind(cursor.occurred_at);
        query.push(", ");
        query.push_bind(cursor.id);
        query.push(")");
    }

    query.push(" ORDER BY triage_queue.created_at ASC, triage_queue.id ASC LIMIT ");
    query.push_bind(limit);

    let rows = query.build_query_as::<TriageRow>().fetch_all(pool).await?;
    rows.into_iter().map(triage_from_row).collect()
}

pub async fn create_triage(pool: &PgPool, triage: NewTriage) -> anyhow::Result<TriageListItem> {
    let mut transaction = pool.begin().await?;
    let row = sqlx::query_as::<_, TriageRow>(
        r#"
        WITH inserted AS (
            INSERT INTO triage_queue (
                id,
                facility_id,
                visit_id,
                patient_id,
                acuity,
                status,
                created_by_user_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id,
                      visit_id,
                      patient_id,
                      acuity,
                      status,
                      triage_notes,
                      created_at
        )
        SELECT inserted.id,
               inserted.visit_id,
               inserted.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               inserted.acuity,
               inserted.status,
               inserted.triage_notes,
               inserted.created_at
        FROM inserted
        JOIN patients ON patients.id = inserted.patient_id
        "#,
    )
    .bind(triage.id)
    .bind(triage.facility_id)
    .bind(triage.visit_id)
    .bind(triage.patient_id)
    .bind(codec::encode(triage.acuity)?)
    .bind(codec::encode(TriageStatus::Waiting)?)
    .bind(triage.created_by_user_id)
    .fetch_one(&mut *transaction)
    .await?;

    sqlx::query(
        r#"
        UPDATE visits
        SET status = $1,
            updated_at = now()
        WHERE facility_id = $2
          AND id = $3
          AND patient_id = $4
        "#,
    )
    .bind(codec::encode(VisitStatus::InTriage)?)
    .bind(triage.facility_id)
    .bind(triage.visit_id)
    .bind(triage.patient_id)
    .execute(&mut *transaction)
    .await?;

    transaction.commit().await?;
    triage_from_row(row)
}

pub async fn assess_triage(
    pool: &PgPool,
    facility_id: Uuid,
    triage_id: Uuid,
    assessment: TriageAssessmentRequest,
) -> anyhow::Result<Option<TriageListItem>> {
    let acuity = assessment.acuity.map(codec::encode).transpose()?;
    let row = sqlx::query_as::<_, TriageRow>(
        r#"
        WITH updated AS (
            UPDATE triage_queue
            SET acuity = COALESCE($1, acuity),
                triage_notes = COALESCE($2, triage_notes),
                status = $3,
                updated_at = now()
            WHERE facility_id = $4
              AND id = $5
              AND status IN ($6, $7)
            RETURNING id,
                      visit_id,
                      patient_id,
                      acuity,
                      status,
                      triage_notes,
                      created_at
        )
        SELECT updated.id,
               updated.visit_id,
               updated.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               updated.acuity,
               updated.status,
               updated.triage_notes,
               updated.created_at
        FROM updated
        JOIN patients ON patients.id = updated.patient_id
        WHERE patients.facility_id = $4
        "#,
    )
    .bind(acuity)
    .bind(assessment.notes)
    .bind(codec::encode(TriageStatus::Completed)?)
    .bind(facility_id)
    .bind(triage_id)
    .bind(codec::encode(TriageStatus::Waiting)?)
    .bind(codec::encode(TriageStatus::Completed)?)
    .fetch_optional(pool)
    .await?;

    row.map(triage_from_row).transpose()
}

pub async fn assign_triage(
    pool: &PgPool,
    facility_id: Uuid,
    triage_id: Uuid,
    assigned_to_user_id: Uuid,
) -> anyhow::Result<Option<TriageListItem>> {
    let row = sqlx::query_as::<_, TriageRow>(
        r#"
        WITH updated AS (
            UPDATE triage_queue
            SET status = $1,
                assigned_to_user_id = $2,
                assigned_at = COALESCE(assigned_at, now()),
                updated_at = now()
            WHERE facility_id = $3
              AND id = $4
            RETURNING id,
                      visit_id,
                      patient_id,
                      acuity,
                      status,
                      triage_notes,
                      created_at
        )
        SELECT updated.id,
               updated.visit_id,
               updated.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               updated.acuity,
               updated.status,
               updated.triage_notes,
               updated.created_at
        FROM updated
        JOIN patients ON patients.id = updated.patient_id
        WHERE patients.facility_id = $3
        "#,
    )
    .bind(codec::encode(TriageStatus::Assigned)?)
    .bind(assigned_to_user_id)
    .bind(facility_id)
    .bind(triage_id)
    .fetch_optional(pool)
    .await?;

    row.map(triage_from_row).transpose()
}

pub async fn cancel_triage(
    pool: &PgPool,
    facility_id: Uuid,
    triage_id: Uuid,
) -> anyhow::Result<Option<TriageListItem>> {
    let mut transaction = pool.begin().await?;
    let row = sqlx::query_as::<_, TriageRow>(
        r#"
        WITH updated AS (
            UPDATE triage_queue
            SET status = $1,
                updated_at = now()
            WHERE facility_id = $2
              AND id = $3
              AND status = $4
            RETURNING id,
                      visit_id,
                      patient_id,
                      acuity,
                      status,
                      triage_notes,
                      created_at
        )
        SELECT updated.id,
               updated.visit_id,
               updated.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               updated.acuity,
               updated.status,
               updated.triage_notes,
               updated.created_at
        FROM updated
        JOIN patients ON patients.id = updated.patient_id
        WHERE patients.facility_id = $2
        "#,
    )
    .bind(codec::encode(TriageStatus::Cancelled)?)
    .bind(facility_id)
    .bind(triage_id)
    .bind(codec::encode(TriageStatus::Waiting)?)
    .fetch_optional(&mut *transaction)
    .await?;

    if let Some(triage) = &row {
        sqlx::query(
            r#"
            UPDATE visits
            SET status = $1,
                updated_at = now()
            WHERE facility_id = $2
              AND id = $3
              AND patient_id = $4
            "#,
        )
        .bind(codec::encode(VisitStatus::Cancelled)?)
        .bind(facility_id)
        .bind(triage.visit_id)
        .bind(triage.patient_id)
        .execute(&mut *transaction)
        .await?;
    }

    transaction.commit().await?;
    row.map(triage_from_row).transpose()
}

pub async fn get_triage(
    pool: &PgPool,
    facility_id: Uuid,
    triage_id: Uuid,
) -> anyhow::Result<Option<TriageListItem>> {
    let row = sqlx::query_as::<_, TriageRow>(
        r#"
        SELECT triage_queue.id,
               triage_queue.visit_id,
               triage_queue.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               triage_queue.acuity,
               triage_queue.status,
               triage_queue.triage_notes,
               triage_queue.created_at
        FROM triage_queue
        JOIN patients ON patients.id = triage_queue.patient_id
        WHERE triage_queue.facility_id = $1
          AND patients.facility_id = $1
          AND triage_queue.id = $2
        "#,
    )
    .bind(facility_id)
    .bind(triage_id)
    .fetch_optional(pool)
    .await?;

    row.map(triage_from_row).transpose()
}

pub async fn list_encounters(
    pool: &PgPool,
    facility_id: Uuid,
    patient_id: Option<Uuid>,
    cursor: Option<CareCursor>,
    limit: i64,
) -> anyhow::Result<Vec<EncounterListItem>> {
    let mut query = QueryBuilder::<Postgres>::new(
        r#"
        SELECT encounters.id,
               encounters.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               encounters.visit_id,
               encounters.encounter_type,
               encounters.status,
               encounters.started_at,
               encounters.ended_at
        FROM encounters
        JOIN patients ON patients.id = encounters.patient_id
        WHERE encounters.facility_id =
        "#,
    );
    query.push_bind(facility_id);
    query.push(" AND patients.facility_id = ");
    query.push_bind(facility_id);

    if let Some(patient_id) = patient_id {
        query.push(" AND encounters.patient_id = ");
        query.push_bind(patient_id);
    }

    if let Some(cursor) = cursor {
        query.push(" AND (encounters.started_at, encounters.id) > (");
        query.push_bind(cursor.occurred_at);
        query.push(", ");
        query.push_bind(cursor.id);
        query.push(")");
    }

    query.push(" ORDER BY encounters.started_at ASC, encounters.id ASC LIMIT ");
    query.push_bind(limit);

    let rows = query
        .build_query_as::<EncounterRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(encounter_from_row).collect()
}

pub async fn get_encounter(
    pool: &PgPool,
    facility_id: Uuid,
    encounter_id: Uuid,
) -> anyhow::Result<Option<EncounterListItem>> {
    let row = sqlx::query_as::<_, EncounterRow>(
        r#"
        SELECT encounters.id,
               encounters.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               encounters.visit_id,
               encounters.encounter_type,
               encounters.status,
               encounters.started_at,
               encounters.ended_at
        FROM encounters
        JOIN patients ON patients.id = encounters.patient_id
        WHERE encounters.facility_id = $1
          AND patients.facility_id = $1
          AND encounters.id = $2
        "#,
    )
    .bind(facility_id)
    .bind(encounter_id)
    .fetch_optional(pool)
    .await?;

    row.map(encounter_from_row).transpose()
}

pub async fn create_encounter(
    pool: &PgPool,
    encounter: NewEncounter,
) -> anyhow::Result<EncounterListItem> {
    let mut transaction = pool.begin().await?;
    let row = sqlx::query_as::<_, EncounterRow>(
        r#"
        WITH inserted AS (
            INSERT INTO encounters (
                id,
                facility_id,
                patient_id,
                visit_id,
                encounter_type,
                status,
                created_by_user_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id,
                      patient_id,
                      visit_id,
                      encounter_type,
                      status,
                      started_at,
                      ended_at
        )
        SELECT inserted.id,
               inserted.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               inserted.visit_id,
               inserted.encounter_type,
               inserted.status,
               inserted.started_at,
               inserted.ended_at
        FROM inserted
        JOIN patients ON patients.id = inserted.patient_id
        "#,
    )
    .bind(encounter.id)
    .bind(encounter.facility_id)
    .bind(encounter.patient_id)
    .bind(encounter.visit_id)
    .bind(codec::encode(encounter.encounter_type)?)
    .bind(codec::encode(EncounterStatus::InProgress)?)
    .bind(encounter.created_by_user_id)
    .fetch_one(&mut *transaction)
    .await?;

    if let Some(visit_id) = encounter.visit_id {
        sqlx::query(
            r#"
            UPDATE visits
            SET status = $1,
                consultation_started_at = COALESCE(consultation_started_at, now()),
                updated_at = now()
            WHERE facility_id = $2
              AND id = $3
              AND patient_id = $4
            "#,
        )
        .bind(codec::encode(VisitStatus::InConsultation)?)
        .bind(encounter.facility_id)
        .bind(visit_id)
        .bind(encounter.patient_id)
        .execute(&mut *transaction)
        .await?;
    }

    transaction.commit().await?;
    encounter_from_row(row)
}

pub async fn update_encounter(
    pool: &PgPool,
    encounter: EncounterUpdate,
) -> anyhow::Result<Option<EncounterListItem>> {
    let row = sqlx::query_as::<_, EncounterRow>(
        r#"
        WITH updated AS (
            UPDATE encounters
            SET visit_id = COALESCE($3, visit_id),
                encounter_type = COALESCE($4, encounter_type),
                updated_at = now()
            WHERE facility_id = $1
              AND id = $2
              AND status = 'in_progress'
              AND (
                  $3::uuid IS NULL
                  OR EXISTS (
                      SELECT 1
                      FROM visits
                      WHERE visits.facility_id = $1
                        AND visits.id = $3
                        AND visits.patient_id = encounters.patient_id
                  )
              )
            RETURNING id,
                      patient_id,
                      visit_id,
                      encounter_type,
                      status,
                      started_at,
                      ended_at
        )
        SELECT updated.id,
               updated.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               updated.visit_id,
               updated.encounter_type,
               updated.status,
               updated.started_at,
               updated.ended_at
        FROM updated
        JOIN patients ON patients.id = updated.patient_id
        WHERE patients.facility_id = $1
        "#,
    )
    .bind(encounter.facility_id)
    .bind(encounter.id)
    .bind(encounter.visit_id)
    .bind(match encounter.encounter_type {
        Some(encounter_type) => Some(codec::encode(encounter_type)?),
        None => None,
    })
    .fetch_optional(pool)
    .await?;

    let _ = encounter.actor_user_id;
    row.map(encounter_from_row).transpose()
}

pub async fn update_encounter_status(
    pool: &PgPool,
    facility_id: Uuid,
    encounter_id: Uuid,
    status: EncounterStatus,
) -> anyhow::Result<Option<EncounterListItem>> {
    let row = sqlx::query_as::<_, EncounterRow>(
        r#"
        WITH updated AS (
            UPDATE encounters
            SET status = $1,
                ended_at = COALESCE(ended_at, now()),
                updated_at = now()
            WHERE facility_id = $2
              AND id = $3
            RETURNING id,
                      patient_id,
                      visit_id,
                      encounter_type,
                      status,
                      started_at,
                      ended_at
        )
        SELECT updated.id,
               updated.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               updated.visit_id,
               updated.encounter_type,
               updated.status,
               updated.started_at,
               updated.ended_at
        FROM updated
        JOIN patients ON patients.id = updated.patient_id
        WHERE patients.facility_id = $2
        "#,
    )
    .bind(codec::encode(status)?)
    .bind(facility_id)
    .bind(encounter_id)
    .fetch_optional(pool)
    .await?;

    row.map(encounter_from_row).transpose()
}

pub async fn list_care_team_assignments(
    pool: &PgPool,
    encounter_id: Uuid,
) -> anyhow::Result<Vec<CareTeamAssignment>> {
    let rows = sqlx::query_as::<_, CareTeamAssignmentRow>(
        r#"
        SELECT id,
               encounter_id,
               user_id,
               role,
               is_active,
               created_at
        FROM encounter_care_team_assignments
        WHERE encounter_id = $1
        ORDER BY created_at ASC, id ASC
        "#,
    )
    .bind(encounter_id)
    .fetch_all(pool)
    .await?;

    rows.into_iter()
        .map(care_team_assignment_from_row)
        .collect()
}

pub async fn create_care_team_assignment(
    pool: &PgPool,
    assignment: NewCareTeamAssignment,
) -> anyhow::Result<CareTeamAssignment> {
    let row = sqlx::query_as::<_, CareTeamAssignmentRow>(
        r#"
        INSERT INTO encounter_care_team_assignments (
            id,
            encounter_id,
            user_id,
            role,
            created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (encounter_id, user_id, role) DO UPDATE
        SET is_active = TRUE
        RETURNING id,
                  encounter_id,
                  user_id,
                  role,
                  is_active,
                  created_at
        "#,
    )
    .bind(assignment.id)
    .bind(assignment.encounter_id)
    .bind(assignment.user_id)
    .bind(codec::encode(assignment.role)?)
    .bind(assignment.created_by_user_id)
    .fetch_one(pool)
    .await?;

    care_team_assignment_from_row(row)
}

async fn load_clinic_session_for_update(
    transaction: &mut sqlx::Transaction<'_, Postgres>,
    facility_id: Uuid,
    clinic_session_id: Uuid,
) -> anyhow::Result<ClinicSessionListItem> {
    let row = sqlx::query_as::<_, ClinicSessionRow>(
        r#"
        SELECT id,
               clinic_id,
               service_code,
               practitioner_user_id,
               owner_type,
               owner_id,
               name,
               mode,
               starts_at,
               ends_at,
               slot_minutes,
               capacity,
               allow_overbooking,
               overbook_limit,
               is_active,
               created_at
        FROM clinic_sessions
        WHERE facility_id = $1
          AND id = $2
          AND is_active = true
        FOR UPDATE
        "#,
    )
    .bind(facility_id)
    .bind(clinic_session_id)
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or_else(|| anyhow::anyhow!("clinic session is not active in facility"))?;

    clinic_session_from_row(row)
}

async fn validate_session_booking(
    transaction: &mut sqlx::Transaction<'_, Postgres>,
    session: &ClinicSessionListItem,
    appointment: &NewBookedAppointment,
) -> anyhow::Result<()> {
    validate_session_booking_excluding(transaction, session, appointment, None).await
}

async fn validate_session_booking_excluding(
    transaction: &mut sqlx::Transaction<'_, Postgres>,
    session: &ClinicSessionListItem,
    appointment: &NewBookedAppointment,
    excluding_appointment_id: Option<Uuid>,
) -> anyhow::Result<()> {
    if appointment.starts_at < session.starts_at || appointment.ends_at > session.ends_at {
        anyhow::bail!("appointment must be inside clinic session time");
    }
    if let Some(session_practitioner_id) = session.practitioner_user_id {
        if let Some(appointment_practitioner_id) = appointment.practitioner_user_id {
            if appointment_practitioner_id != session_practitioner_id {
                anyhow::bail!("appointment practitioner does not match session practitioner");
            }
        }
    }
    let constrained_count: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)
        FROM clinic_session_appointment_types
        WHERE facility_id = $1
          AND clinic_session_id = $2
        "#,
    )
    .bind(appointment.facility_id)
    .bind(session.id)
    .fetch_one(&mut **transaction)
    .await?;
    if constrained_count > 0 {
        let Some(appointment_type_id) = appointment.appointment_type_id else {
            anyhow::bail!("appointment type is required for this session");
        };
        let allowed: Option<Uuid> = sqlx::query_scalar(
            r#"
            SELECT appointment_type_id
            FROM clinic_session_appointment_types
            WHERE facility_id = $1
              AND clinic_session_id = $2
              AND appointment_type_id = $3
            "#,
        )
        .bind(appointment.facility_id)
        .bind(session.id)
        .bind(appointment_type_id)
        .fetch_optional(&mut **transaction)
        .await?;
        if allowed.is_none() {
            anyhow::bail!("appointment type is not allowed in this session");
        }
    }

    let blocked_exists: Option<Uuid> = sqlx::query_scalar(
        r#"
        SELECT id
        FROM appointment_blocked_times
        WHERE facility_id = $1
          AND starts_at < $3
          AND ends_at > $2
          AND (
              clinic_session_id = $4
              OR (
                  $5::uuid IS NOT NULL
                  AND practitioner_user_id = $5
              )
          )
        LIMIT 1
        "#,
    )
    .bind(appointment.facility_id)
    .bind(appointment.starts_at)
    .bind(appointment.ends_at)
    .bind(session.id)
    .bind(appointment.practitioner_user_id)
    .fetch_optional(&mut **transaction)
    .await?;
    if blocked_exists.is_some() {
        anyhow::bail!("appointment overlaps blocked time");
    }

    let active_overlap_count: i64 = match session.mode {
        ClinicSessionMode::CapacityBlock => {
            sqlx::query_scalar(
                r#"
            SELECT COUNT(*)
            FROM appointments
            WHERE facility_id = $1
              AND clinic_session_id = $2
              AND status IN ('scheduled', 'checked_in')
              AND ($3::uuid IS NULL OR id <> $3)
            "#,
            )
            .bind(appointment.facility_id)
            .bind(session.id)
            .bind(excluding_appointment_id)
            .fetch_one(&mut **transaction)
            .await?
        }
        ClinicSessionMode::FixedSlot => {
            sqlx::query_scalar(
                r#"
            SELECT COUNT(*)
            FROM appointments
            WHERE facility_id = $1
              AND clinic_session_id = $2
              AND status IN ('scheduled', 'checked_in')
              AND starts_at < $4
              AND ends_at > $3
              AND ($5::uuid IS NULL OR id <> $5)
            "#,
            )
            .bind(appointment.facility_id)
            .bind(session.id)
            .bind(appointment.starts_at)
            .bind(appointment.ends_at)
            .bind(excluding_appointment_id)
            .fetch_one(&mut **transaction)
            .await?
        }
    };

    if active_overlap_count < i64::from(session.capacity) {
        return Ok(());
    }

    if !session.allow_overbooking {
        anyhow::bail!("clinic session capacity is full");
    }
    let reason = appointment
        .overbook_reason
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if reason.is_none() {
        anyhow::bail!("overbooking reason is required");
    }
    let allowed_total = i64::from(session.capacity) + i64::from(session.overbook_limit);
    if active_overlap_count >= allowed_total {
        anyhow::bail!("clinic session overbook limit is full");
    }

    Ok(())
}

async fn insert_appointment_history(
    transaction: &mut sqlx::Transaction<'_, Postgres>,
    facility_id: Uuid,
    appointment_id: Uuid,
    event_type: &str,
    actor_user_id: Uuid,
    reason: Option<&str>,
    previous_starts_at: Option<DateTime<Utc>>,
    previous_ends_at: Option<DateTime<Utc>>,
    new_starts_at: Option<DateTime<Utc>>,
    new_ends_at: Option<DateTime<Utc>>,
) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO appointment_history (
            id,
            facility_id,
            appointment_id,
            event_type,
            actor_user_id,
            reason,
            previous_starts_at,
            previous_ends_at,
            new_starts_at,
            new_ends_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(facility_id)
    .bind(appointment_id)
    .bind(event_type)
    .bind(actor_user_id)
    .bind(reason)
    .bind(previous_starts_at)
    .bind(previous_ends_at)
    .bind(new_starts_at)
    .bind(new_ends_at)
    .execute(&mut **transaction)
    .await?;

    Ok(())
}

async fn default_clinic_id(pool: &PgPool, facility_id: Uuid) -> anyhow::Result<Option<Uuid>> {
    Ok(sqlx::query_scalar(
        r#"
        SELECT id
        FROM clinics
        WHERE facility_id = $1
          AND is_active = TRUE
        ORDER BY created_at ASC, id ASC
        LIMIT 1
        "#,
    )
    .bind(facility_id)
    .fetch_optional(pool)
    .await?)
}

async fn resolve_visit_clinic_id(
    pool: &PgPool,
    facility_id: Uuid,
    clinic_id: Option<Uuid>,
) -> anyhow::Result<Option<Uuid>> {
    if let Some(clinic_id) = clinic_id {
        return sqlx::query_scalar(
            r#"
            SELECT id
            FROM clinics
            WHERE facility_id = $1
              AND id = $2
              AND is_active = TRUE
            "#,
        )
        .bind(facility_id)
        .bind(clinic_id)
        .fetch_optional(pool)
        .await?
        .map(Some)
        .ok_or_else(|| anyhow::anyhow!("clinic is not active in facility"));
    }

    default_clinic_id(pool, facility_id).await
}

fn appointment_from_row(row: AppointmentRow) -> anyhow::Result<AppointmentListItem> {
    Ok(AppointmentListItem {
        id: row.id,
        patient_id: row.patient_id,
        patient_code: row.patient_code,
        patient_display_name: row.patient_display_name,
        clinic_id: row.clinic_id,
        clinic_session_id: row.clinic_session_id,
        appointment_type_id: row.appointment_type_id,
        appointment_type_name: row.appointment_type_name,
        practitioner_user_id: row.practitioner_user_id,
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        status: codec::decode(&row.status)?,
        cancellation_reason: row.cancellation_reason,
        overbook_reason: row.overbook_reason,
        series_id: row.series_id,
        created_at: row.created_at,
    })
}

fn clinic_from_row(row: ClinicRow) -> ClinicListItem {
    ClinicListItem {
        id: row.id,
        code: row.code,
        name: row.name,
        is_active: row.is_active,
        created_at: row.created_at,
    }
}

fn clinic_session_from_row(row: ClinicSessionRow) -> anyhow::Result<ClinicSessionListItem> {
    Ok(ClinicSessionListItem {
        id: row.id,
        clinic_id: row.clinic_id,
        service_code: row.service_code,
        practitioner_user_id: row.practitioner_user_id,
        owner_type: codec::decode(&row.owner_type)?,
        owner_id: row.owner_id,
        name: row.name,
        mode: codec::decode(&row.mode)?,
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        slot_minutes: row.slot_minutes,
        capacity: row.capacity,
        allow_overbooking: row.allow_overbooking,
        overbook_limit: row.overbook_limit,
        is_active: row.is_active,
        created_at: row.created_at,
    })
}

fn appointment_type_from_row(row: AppointmentTypeRow) -> AppointmentTypeListItem {
    AppointmentTypeListItem {
        id: row.id,
        code: row.code,
        name: row.name,
        default_duration_minutes: row.default_duration_minutes,
        is_active: row.is_active,
        created_at: row.created_at,
    }
}

fn appointment_history_from_row(row: AppointmentHistoryRow) -> AppointmentHistoryItem {
    AppointmentHistoryItem {
        id: row.id,
        appointment_id: row.appointment_id,
        event_type: row.event_type,
        reason: row.reason,
        previous_starts_at: row.previous_starts_at,
        previous_ends_at: row.previous_ends_at,
        new_starts_at: row.new_starts_at,
        new_ends_at: row.new_ends_at,
        created_at: row.created_at,
    }
}

fn visit_from_row(row: VisitRow) -> anyhow::Result<VisitListItem> {
    Ok(VisitListItem {
        id: row.id,
        patient_id: row.patient_id,
        patient_code: row.patient_code,
        patient_display_name: row.patient_display_name,
        appointment_id: row.appointment_id,
        clinic_id: row.clinic_id,
        status: codec::decode(&row.status)?,
        checked_in_at: row.checked_in_at,
    })
}

fn triage_from_row(row: TriageRow) -> anyhow::Result<TriageListItem> {
    Ok(TriageListItem {
        id: row.id,
        visit_id: row.visit_id,
        patient_id: row.patient_id,
        patient_code: row.patient_code,
        patient_display_name: row.patient_display_name,
        acuity: codec::decode(&row.acuity)?,
        status: codec::decode(&row.status)?,
        triage_notes: row.triage_notes,
        created_at: row.created_at,
    })
}

fn encounter_from_row(row: EncounterRow) -> anyhow::Result<EncounterListItem> {
    Ok(EncounterListItem {
        id: row.id,
        patient_id: row.patient_id,
        patient_code: row.patient_code,
        patient_display_name: row.patient_display_name,
        visit_id: row.visit_id,
        encounter_type: codec::decode(&row.encounter_type)?,
        status: codec::decode(&row.status)?,
        started_at: row.started_at,
        ended_at: row.ended_at,
    })
}

fn care_team_assignment_from_row(row: CareTeamAssignmentRow) -> anyhow::Result<CareTeamAssignment> {
    Ok(CareTeamAssignment {
        id: row.id,
        encounter_id: row.encounter_id,
        user_id: row.user_id,
        role: codec::decode(&row.role)?,
        is_active: row.is_active,
        created_at: row.created_at,
    })
}
