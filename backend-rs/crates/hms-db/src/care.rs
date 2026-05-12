use chrono::{DateTime, Utc};
use hms_domain::care::{
    AppointmentListItem, AppointmentStatus, CareTeamAssignment, CareTeamRole, ClinicListItem,
    EncounterListItem, EncounterStatus, EncounterType, TriageAcuity, TriageListItem, TriageStatus,
    VisitListItem, VisitStatus,
};
use sqlx::{FromRow, Postgres, QueryBuilder};
use uuid::Uuid;

use crate::codec;
use crate::PgPool;

#[derive(Clone, Debug)]
pub struct CareCursor {
    pub occurred_at: DateTime<Utc>,
    pub id: Uuid,
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
pub struct AppointmentUpdate {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub starts_at: Option<DateTime<Utc>>,
    pub ends_at: Option<DateTime<Utc>>,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewVisit {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub patient_id: Uuid,
    pub appointment_id: Option<Uuid>,
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
    starts_at: DateTime<Utc>,
    ends_at: DateTime<Utc>,
    status: String,
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
struct VisitRow {
    id: Uuid,
    patient_id: Uuid,
    patient_code: String,
    patient_display_name: String,
    appointment_id: Option<Uuid>,
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
    limit: i64,
) -> anyhow::Result<Vec<AppointmentListItem>> {
    let mut query = QueryBuilder::<Postgres>::new(
        r#"
        SELECT appointments.id,
               appointments.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               appointments.starts_at,
               appointments.ends_at,
               appointments.status,
               appointments.created_at
        FROM appointments
        JOIN patients ON patients.id = appointments.patient_id
        WHERE appointments.facility_id =
        "#,
    );
    query.push_bind(facility_id);
    query.push(" AND patients.facility_id = ");
    query.push_bind(facility_id);

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
    Ok(rows
        .into_iter()
        .map(|row| ClinicListItem {
            id: row.id,
            code: row.code,
            name: row.name,
            is_active: row.is_active,
            created_at: row.created_at,
        })
        .collect())
}

pub async fn create_appointment(
    pool: &PgPool,
    appointment: NewAppointment,
) -> anyhow::Result<AppointmentListItem> {
    let clinic_id = default_clinic_id(pool, appointment.facility_id).await?;
    let row = sqlx::query_as::<_, AppointmentRow>(
        r#"
        WITH inserted AS (
            INSERT INTO appointments (
                id,
                facility_id,
                patient_id,
                clinic_id,
                starts_at,
                ends_at,
                status,
                created_by_user_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id,
                      patient_id,
                      starts_at,
                      ends_at,
                      status,
                      created_at
        )
        SELECT inserted.id,
               inserted.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               inserted.starts_at,
               inserted.ends_at,
               inserted.status,
               inserted.created_at
        FROM inserted
        JOIN patients ON patients.id = inserted.patient_id
        "#,
    )
    .bind(appointment.id)
    .bind(appointment.facility_id)
    .bind(appointment.patient_id)
    .bind(clinic_id)
    .bind(appointment.starts_at)
    .bind(appointment.ends_at)
    .bind(codec::encode(AppointmentStatus::Scheduled)?)
    .bind(appointment.created_by_user_id)
    .fetch_one(pool)
    .await?;

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
               appointments.starts_at,
               appointments.ends_at,
               appointments.status,
               appointments.created_at
        FROM appointments
        JOIN patients ON patients.id = appointments.patient_id
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
    let row = sqlx::query_as::<_, AppointmentRow>(
        r#"
        WITH updated AS (
            UPDATE appointments
            SET starts_at = COALESCE($3, starts_at),
                ends_at = COALESCE($4, ends_at),
                updated_at = now()
            WHERE facility_id = $1
              AND id = $2
              AND status = 'scheduled'
            RETURNING id,
                      patient_id,
                      starts_at,
                      ends_at,
                      status,
                      created_at
        )
        SELECT updated.id,
               updated.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               updated.starts_at,
               updated.ends_at,
               updated.status,
               updated.created_at
        FROM updated
        JOIN patients ON patients.id = updated.patient_id
        WHERE patients.facility_id = $1
        "#,
    )
    .bind(appointment.facility_id)
    .bind(appointment.id)
    .bind(appointment.starts_at)
    .bind(appointment.ends_at)
    .fetch_optional(pool)
    .await?;

    let _ = appointment.actor_user_id;
    row.map(appointment_from_row).transpose()
}

pub async fn cancel_appointment(
    pool: &PgPool,
    facility_id: Uuid,
    appointment_id: Uuid,
    actor_user_id: Uuid,
) -> anyhow::Result<Option<AppointmentListItem>> {
    let row = sqlx::query_as::<_, AppointmentRow>(
        r#"
        WITH updated AS (
            UPDATE appointments
            SET status = $3,
                updated_at = now()
            WHERE facility_id = $1
              AND id = $2
              AND status = 'scheduled'
            RETURNING id,
                      patient_id,
                      starts_at,
                      ends_at,
                      status,
                      created_at
        )
        SELECT updated.id,
               updated.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               updated.starts_at,
               updated.ends_at,
               updated.status,
               updated.created_at
        FROM updated
        JOIN patients ON patients.id = updated.patient_id
        WHERE patients.facility_id = $1
        "#,
    )
    .bind(facility_id)
    .bind(appointment_id)
    .bind(codec::encode(AppointmentStatus::Cancelled)?)
    .fetch_optional(pool)
    .await?;

    let _ = actor_user_id;
    row.map(appointment_from_row).transpose()
}

pub async fn list_visits(
    pool: &PgPool,
    facility_id: Uuid,
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
    let clinic_id = default_clinic_id(pool, visit.facility_id).await?;
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
                      status,
                      checked_in_at
        )
        SELECT inserted.id,
               inserted.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               inserted.appointment_id,
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
                      status,
                      checked_in_at
        )
        SELECT updated.id,
               updated.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               updated.appointment_id,
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
               triage_queue.created_at
        FROM triage_queue
        JOIN patients ON patients.id = triage_queue.patient_id
        WHERE triage_queue.facility_id =
        "#,
    );
    query.push_bind(facility_id);
    query.push(" AND patients.facility_id = ");
    query.push_bind(facility_id);

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
                      created_at
        )
        SELECT inserted.id,
               inserted.visit_id,
               inserted.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               inserted.acuity,
               inserted.status,
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
                      created_at
        )
        SELECT updated.id,
               updated.visit_id,
               updated.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               updated.acuity,
               updated.status,
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

fn appointment_from_row(row: AppointmentRow) -> anyhow::Result<AppointmentListItem> {
    Ok(AppointmentListItem {
        id: row.id,
        patient_id: row.patient_id,
        patient_code: row.patient_code,
        patient_display_name: row.patient_display_name,
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        status: codec::decode(&row.status)?,
        created_at: row.created_at,
    })
}

fn visit_from_row(row: VisitRow) -> anyhow::Result<VisitListItem> {
    Ok(VisitListItem {
        id: row.id,
        patient_id: row.patient_id,
        patient_code: row.patient_code,
        patient_display_name: row.patient_display_name,
        appointment_id: row.appointment_id,
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
