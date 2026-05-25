use chrono::{DateTime, NaiveDate, Utc};
use hms_domain::care::AppointmentListItem;
use hms_domain::scheduling::{
    AvailabilitySlot, BookableServiceListItem, BookableSessionListItem, BookableSessionMode,
    BookableUnitType, SchedulingExceptionItem, SlotCapacity,
};
use sqlx::{FromRow, Postgres, QueryBuilder};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

use crate::codec;
use crate::PgPool;

#[derive(Clone, Debug)]
pub struct SchedulingCursor {
    pub occurred_at: DateTime<Utc>,
    pub id: Uuid,
}

#[derive(Clone, Debug, Default)]
pub struct SessionFilters {
    pub date: Option<NaiveDate>,
    pub clinic_id: Option<Uuid>,
    pub service_id: Option<Uuid>,
    pub practitioner_user_id: Option<Uuid>,
}

#[derive(Clone, Debug, Default)]
pub struct AvailabilityFilters {
    pub starts_at: DateTime<Utc>,
    pub ends_before: DateTime<Utc>,
    pub clinic_id: Option<Uuid>,
    pub service_id: Option<Uuid>,
    pub practitioner_user_id: Option<Uuid>,
    pub limit: i64,
}

#[derive(Clone, Debug, Default)]
pub struct ExceptionFilters {
    pub starts_at: Option<DateTime<Utc>>,
    pub ends_before: Option<DateTime<Utc>>,
    pub session_id: Option<Uuid>,
    pub practitioner_user_id: Option<Uuid>,
}

#[derive(Clone, Debug)]
pub struct NewBookableService {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub code: String,
    pub name: String,
    pub default_duration_minutes: i32,
    pub created_by_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewBookableSession {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub clinic_id: Option<Uuid>,
    pub service_code: Option<String>,
    pub practitioner_user_id: Option<Uuid>,
    pub owner_type: BookableUnitType,
    pub owner_id: Option<Uuid>,
    pub name: String,
    pub mode: BookableSessionMode,
    pub starts_at: DateTime<Utc>,
    pub ends_at: DateTime<Utc>,
    pub slot_minutes: Option<i32>,
    pub capacity: i32,
    pub allow_overbooking: bool,
    pub overbook_limit: i32,
    pub created_by_user_id: Uuid,
    pub allowed_service_ids: Vec<Uuid>,
}

#[derive(Clone, Debug)]
pub struct NewSchedulingException {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub session_id: Option<Uuid>,
    pub practitioner_user_id: Option<Uuid>,
    pub starts_at: DateTime<Utc>,
    pub ends_at: DateTime<Utc>,
    pub reason: String,
    pub created_by_user_id: Uuid,
}

#[derive(Clone, Debug, FromRow)]
struct BookableServiceRow {
    id: Uuid,
    code: String,
    name: String,
    default_duration_minutes: i32,
    is_active: bool,
    created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct BookableSessionRow {
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
    booked_count: i64,
    allow_overbooking: bool,
    overbook_limit: i32,
    is_active: bool,
    created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct AppointmentWindowRow {
    clinic_session_id: Uuid,
    starts_at: DateTime<Utc>,
    ends_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct ExceptionWindowRow {
    id: Uuid,
    clinic_session_id: Option<Uuid>,
    practitioner_user_id: Option<Uuid>,
    starts_at: DateTime<Utc>,
    ends_at: DateTime<Utc>,
    reason: String,
    created_at: DateTime<Utc>,
}

pub async fn list_bookable_services(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<SchedulingCursor>,
    limit: i64,
) -> anyhow::Result<Vec<BookableServiceListItem>> {
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
        .build_query_as::<BookableServiceRow>()
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().map(bookable_service_from_row).collect())
}

pub async fn create_bookable_service(
    pool: &PgPool,
    service: NewBookableService,
) -> anyhow::Result<BookableServiceListItem> {
    if service.default_duration_minutes < 1 {
        anyhow::bail!("service default duration must be positive");
    }

    let row = sqlx::query_as::<_, BookableServiceRow>(
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
    .bind(service.id)
    .bind(service.facility_id)
    .bind(service.code)
    .bind(service.name)
    .bind(service.default_duration_minutes)
    .bind(service.created_by_user_id)
    .fetch_one(pool)
    .await?;

    Ok(bookable_service_from_row(row))
}

pub async fn list_bookable_sessions(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<SchedulingCursor>,
    filters: SessionFilters,
    limit: i64,
) -> anyhow::Result<Vec<BookableSessionListItem>> {
    let mut query = bookable_session_query();
    query.push(" WHERE clinic_sessions.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND clinic_sessions.is_active = TRUE");
    apply_session_filters(&mut query, facility_id, filters);

    if let Some(cursor) = cursor {
        query.push(" AND (clinic_sessions.starts_at, clinic_sessions.id) > (");
        query.push_bind(cursor.occurred_at);
        query.push(", ");
        query.push_bind(cursor.id);
        query.push(")");
    }

    query.push(
        " GROUP BY clinic_sessions.id
          ORDER BY clinic_sessions.starts_at ASC, clinic_sessions.id ASC LIMIT ",
    );
    query.push_bind(limit);

    let rows = query
        .build_query_as::<BookableSessionRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(bookable_session_from_row).collect()
}

pub async fn create_bookable_session(
    pool: &PgPool,
    session: NewBookableSession,
) -> anyhow::Result<BookableSessionListItem> {
    if session.ends_at <= session.starts_at {
        anyhow::bail!("session end time must be after start time");
    }
    if session.capacity < 1 {
        anyhow::bail!("session capacity must be positive");
    }
    if let Some(slot_minutes) = session.slot_minutes {
        if slot_minutes < 1 {
            anyhow::bail!("slot duration must be positive");
        }
    }
    if session.overbook_limit < 0 {
        anyhow::bail!("overbook limit cannot be negative");
    }
    if matches!(session.mode, BookableSessionMode::FixedSlot) && session.slot_minutes.is_none() {
        anyhow::bail!("fixed-slot sessions require slot_minutes");
    }

    let mut transaction = pool.begin().await?;
    let row = sqlx::query_as::<_, BookableSessionRow>(
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
                  0::bigint AS booked_count,
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
    .fetch_one(&mut *transaction)
    .await?;

    let mut seen_service_ids = HashSet::new();
    for service_id in session.allowed_service_ids {
        if !seen_service_ids.insert(service_id) {
            continue;
        }
        let result = sqlx::query(
            r#"
            INSERT INTO clinic_session_appointment_types (
                facility_id,
                clinic_session_id,
                appointment_type_id
            )
            SELECT $1, $2, appointment_types.id
            FROM appointment_types
            WHERE appointment_types.facility_id = $1
              AND appointment_types.id = $3
              AND appointment_types.is_active = TRUE
            ON CONFLICT (clinic_session_id, appointment_type_id) DO NOTHING
            "#,
        )
        .bind(session.facility_id)
        .bind(session.id)
        .bind(service_id)
        .execute(&mut *transaction)
        .await?;
        if result.rows_affected() == 0 {
            anyhow::bail!("allowed service is not active in facility");
        }
    }

    transaction.commit().await?;
    bookable_session_from_row(row)
}

pub async fn cancel_bookable_session(
    pool: &PgPool,
    facility_id: Uuid,
    session_id: Uuid,
) -> anyhow::Result<Option<BookableSessionListItem>> {
    let row = sqlx::query_as::<_, BookableSessionRow>(
        r#"
        WITH updated AS (
            UPDATE clinic_sessions
            SET is_active = false,
                updated_at = now()
            WHERE facility_id = $1
              AND id = $2
              AND is_active = true
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
        )
        SELECT updated.id,
               updated.clinic_id,
               updated.service_code,
               updated.practitioner_user_id,
               updated.owner_type,
               updated.owner_id,
               updated.name,
               updated.mode,
               updated.starts_at,
               updated.ends_at,
               updated.slot_minutes,
               updated.capacity,
               0::bigint AS booked_count,
               updated.allow_overbooking,
               updated.overbook_limit,
               updated.is_active,
               updated.created_at
        FROM updated
        "#,
    )
    .bind(facility_id)
    .bind(session_id)
    .fetch_optional(pool)
    .await?;

    row.map(bookable_session_from_row).transpose()
}

pub async fn list_availability(
    pool: &PgPool,
    facility_id: Uuid,
    filters: AvailabilityFilters,
) -> anyhow::Result<Vec<AvailabilitySlot>> {
    let sessions = availability_sessions(pool, facility_id, &filters).await?;
    if sessions.is_empty() {
        return Ok(Vec::new());
    }

    let session_ids: Vec<Uuid> = sessions.iter().map(|session| session.id).collect();
    let practitioner_ids: Vec<Uuid> = sessions
        .iter()
        .filter_map(|session| session.practitioner_user_id)
        .collect();
    let appointments = appointment_windows(
        pool,
        facility_id,
        &session_ids,
        filters.starts_at,
        filters.ends_before,
    )
    .await?;
    let exceptions = exception_windows(
        pool,
        facility_id,
        &session_ids,
        &practitioner_ids,
        filters.starts_at,
        filters.ends_before,
    )
    .await?;

    Ok(build_availability_slots(
        sessions,
        appointments,
        exceptions,
        filters.limit,
    ))
}

pub async fn create_exception(
    pool: &PgPool,
    exception: NewSchedulingException,
) -> anyhow::Result<SchedulingExceptionItem> {
    if exception.ends_at <= exception.starts_at {
        anyhow::bail!("exception end time must be after start time");
    }
    let reason = exception.reason.trim();
    if reason.is_empty() {
        anyhow::bail!("exception reason is required");
    }
    let scope = match (exception.session_id, exception.practitioner_user_id) {
        (Some(_), None) => "session",
        (None, Some(_)) => "practitioner",
        _ => anyhow::bail!("exception must target exactly one session or practitioner"),
    };

    let row = sqlx::query_as::<_, ExceptionWindowRow>(
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
        RETURNING id,
                  clinic_session_id,
                  practitioner_user_id,
                  starts_at,
                  ends_at,
                  reason,
                  created_at
        "#,
    )
    .bind(exception.id)
    .bind(exception.facility_id)
    .bind(scope)
    .bind(exception.session_id)
    .bind(exception.practitioner_user_id)
    .bind(exception.starts_at)
    .bind(exception.ends_at)
    .bind(reason)
    .bind(exception.created_by_user_id)
    .fetch_one(pool)
    .await?;

    Ok(exception_from_row(row))
}

pub async fn list_exceptions(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<SchedulingCursor>,
    filters: ExceptionFilters,
    limit: i64,
) -> anyhow::Result<Vec<SchedulingExceptionItem>> {
    let mut query = QueryBuilder::<Postgres>::new(
        r#"
        SELECT id,
               clinic_session_id,
               practitioner_user_id,
               starts_at,
               ends_at,
               reason,
               created_at
        FROM appointment_blocked_times
        WHERE facility_id =
        "#,
    );
    query.push_bind(facility_id);

    if let Some(starts_at) = filters.starts_at {
        query.push(" AND ends_at > ");
        query.push_bind(starts_at);
    }
    if let Some(ends_before) = filters.ends_before {
        query.push(" AND starts_at < ");
        query.push_bind(ends_before);
    }
    if let Some(session_id) = filters.session_id {
        query.push(" AND clinic_session_id = ");
        query.push_bind(session_id);
    }
    if let Some(practitioner_user_id) = filters.practitioner_user_id {
        query.push(" AND practitioner_user_id = ");
        query.push_bind(practitioner_user_id);
    }
    if let Some(cursor) = cursor {
        query.push(" AND (starts_at, id) > (");
        query.push_bind(cursor.occurred_at);
        query.push(", ");
        query.push_bind(cursor.id);
        query.push(")");
    }

    query.push(" ORDER BY starts_at ASC, id ASC LIMIT ");
    query.push_bind(limit);

    let rows = query
        .build_query_as::<ExceptionWindowRow>()
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().map(exception_from_row).collect())
}

pub async fn bookable_service_exists(
    pool: &PgPool,
    facility_id: Uuid,
    service_id: Uuid,
) -> anyhow::Result<bool> {
    let exists: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM appointment_types
            WHERE facility_id = $1
              AND id = $2
              AND is_active = TRUE
        )
        "#,
    )
    .bind(facility_id)
    .bind(service_id)
    .fetch_one(pool)
    .await?;
    Ok(exists)
}

pub async fn bookable_session_exists(
    pool: &PgPool,
    facility_id: Uuid,
    session_id: Uuid,
) -> anyhow::Result<bool> {
    let exists: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM clinic_sessions
            WHERE facility_id = $1
              AND id = $2
              AND is_active = TRUE
        )
        "#,
    )
    .bind(facility_id)
    .bind(session_id)
    .fetch_one(pool)
    .await?;
    Ok(exists)
}

pub async fn record_manual_booking_history(
    pool: &PgPool,
    facility_id: Uuid,
    appointment_id: Uuid,
    actor_user_id: Uuid,
    reason: &str,
    starts_at: DateTime<Utc>,
    ends_at: DateTime<Utc>,
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
            new_starts_at,
            new_ends_at
        )
        VALUES ($1, $2, $3, 'manual_booked', $4, $5, $6, $7)
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(facility_id)
    .bind(appointment_id)
    .bind(actor_user_id)
    .bind(reason)
    .bind(starts_at)
    .bind(ends_at)
    .execute(pool)
    .await?;

    Ok(())
}

fn bookable_session_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::new(
        r#"
        SELECT clinic_sessions.id,
               clinic_sessions.clinic_id,
               clinic_sessions.service_code,
               clinic_sessions.practitioner_user_id,
               clinic_sessions.owner_type,
               clinic_sessions.owner_id,
               clinic_sessions.name,
               clinic_sessions.mode,
               clinic_sessions.starts_at,
               clinic_sessions.ends_at,
               clinic_sessions.slot_minutes,
               clinic_sessions.capacity,
               COUNT(appointments.id)::bigint AS booked_count,
               clinic_sessions.allow_overbooking,
               clinic_sessions.overbook_limit,
               clinic_sessions.is_active,
               clinic_sessions.created_at
        FROM clinic_sessions
        LEFT JOIN appointments
          ON appointments.facility_id = clinic_sessions.facility_id
         AND appointments.clinic_session_id = clinic_sessions.id
         AND appointments.status IN ('scheduled', 'checked_in')
        "#,
    )
}

fn apply_session_filters(
    query: &mut QueryBuilder<'static, Postgres>,
    facility_id: Uuid,
    filters: SessionFilters,
) {
    if let Some(date) = filters.date {
        let starts_at = date
            .and_hms_opt(0, 0, 0)
            .expect("valid midnight for schedule date")
            .and_utc();
        let ends_before = date
            .succ_opt()
            .and_then(|next_date| next_date.and_hms_opt(0, 0, 0))
            .expect("valid next-day midnight for schedule date")
            .and_utc();
        query.push(" AND clinic_sessions.starts_at < ");
        query.push_bind(ends_before);
        query.push(" AND clinic_sessions.ends_at > ");
        query.push_bind(starts_at);
    }
    if let Some(clinic_id) = filters.clinic_id {
        query.push(" AND clinic_sessions.clinic_id = ");
        query.push_bind(clinic_id);
    }
    if let Some(practitioner_user_id) = filters.practitioner_user_id {
        query.push(" AND clinic_sessions.practitioner_user_id = ");
        query.push_bind(practitioner_user_id);
    }
    if let Some(service_id) = filters.service_id {
        apply_service_filter(query, facility_id, service_id);
    }
}

fn apply_service_filter(
    query: &mut QueryBuilder<'static, Postgres>,
    facility_id: Uuid,
    service_id: Uuid,
) {
    query.push(
        r#" AND (
            NOT EXISTS (
                SELECT 1
                FROM clinic_session_appointment_types constraints
                WHERE constraints.facility_id = "#,
    );
    query.push_bind(facility_id);
    query.push(
        r#"
                  AND constraints.clinic_session_id = clinic_sessions.id
            )
            OR EXISTS (
                SELECT 1
                FROM clinic_session_appointment_types constraints
                WHERE constraints.facility_id = "#,
    );
    query.push_bind(facility_id);
    query.push(
        r#"
                  AND constraints.clinic_session_id = clinic_sessions.id
                  AND constraints.appointment_type_id = "#,
    );
    query.push_bind(service_id);
    query.push("))");
}

async fn availability_sessions(
    pool: &PgPool,
    facility_id: Uuid,
    filters: &AvailabilityFilters,
) -> anyhow::Result<Vec<BookableSessionListItem>> {
    let mut query = bookable_session_query();
    query.push(" WHERE clinic_sessions.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND clinic_sessions.is_active = TRUE");
    query.push(" AND clinic_sessions.starts_at < ");
    query.push_bind(filters.ends_before);
    query.push(" AND clinic_sessions.ends_at > ");
    query.push_bind(filters.starts_at);

    if let Some(clinic_id) = filters.clinic_id {
        query.push(" AND clinic_sessions.clinic_id = ");
        query.push_bind(clinic_id);
    }
    if let Some(practitioner_user_id) = filters.practitioner_user_id {
        query.push(" AND clinic_sessions.practitioner_user_id = ");
        query.push_bind(practitioner_user_id);
    }
    if let Some(service_id) = filters.service_id {
        apply_service_filter(&mut query, facility_id, service_id);
    }

    query.push(
        " GROUP BY clinic_sessions.id
          ORDER BY clinic_sessions.starts_at ASC, clinic_sessions.id ASC LIMIT ",
    );
    query.push_bind(filters.limit);

    let rows = query
        .build_query_as::<BookableSessionRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(bookable_session_from_row).collect()
}

async fn appointment_windows(
    pool: &PgPool,
    facility_id: Uuid,
    session_ids: &[Uuid],
    starts_at: DateTime<Utc>,
    ends_before: DateTime<Utc>,
) -> anyhow::Result<Vec<AppointmentWindowRow>> {
    sqlx::query_as::<_, AppointmentWindowRow>(
        r#"
        SELECT clinic_session_id,
               starts_at,
               ends_at
        FROM appointments
        WHERE facility_id = $1
          AND clinic_session_id = ANY($2)
          AND status IN ('scheduled', 'checked_in')
          AND starts_at < $4
          AND ends_at > $3
        "#,
    )
    .bind(facility_id)
    .bind(session_ids)
    .bind(starts_at)
    .bind(ends_before)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

async fn exception_windows(
    pool: &PgPool,
    facility_id: Uuid,
    session_ids: &[Uuid],
    practitioner_ids: &[Uuid],
    starts_at: DateTime<Utc>,
    ends_before: DateTime<Utc>,
) -> anyhow::Result<Vec<ExceptionWindowRow>> {
    sqlx::query_as::<_, ExceptionWindowRow>(
        r#"
        SELECT id,
               clinic_session_id,
               practitioner_user_id,
               starts_at,
               ends_at,
               reason,
               created_at
        FROM appointment_blocked_times
        WHERE facility_id = $1
          AND starts_at < $5
          AND ends_at > $4
          AND (
              clinic_session_id = ANY($2)
              OR (
                  array_length($3::uuid[], 1) IS NOT NULL
                  AND practitioner_user_id = ANY($3)
              )
          )
        "#,
    )
    .bind(facility_id)
    .bind(session_ids)
    .bind(practitioner_ids)
    .bind(starts_at)
    .bind(ends_before)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

fn build_availability_slots(
    sessions: Vec<BookableSessionListItem>,
    appointments: Vec<AppointmentWindowRow>,
    exceptions: Vec<ExceptionWindowRow>,
    limit: i64,
) -> Vec<AvailabilitySlot> {
    let mut appointments_by_session: HashMap<Uuid, Vec<AppointmentWindowRow>> = HashMap::new();
    for appointment in appointments {
        appointments_by_session
            .entry(appointment.clinic_session_id)
            .or_default()
            .push(appointment);
    }

    let mut slots = Vec::new();
    for session in sessions {
        let session_appointments = appointments_by_session
            .get(&session.id)
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        if matches!(session.mode, BookableSessionMode::CapacityBlock) {
            let blocked = exceptions
                .iter()
                .any(|exception| exception_blocks_session(exception, &session));
            let booked = session_appointments.len() as i64;
            let capacity = capacity_for(
                session.capacity,
                session.overbook_limit,
                session.allow_overbooking,
                booked,
            );
            slots.push(AvailabilitySlot {
                id: format!("{}:{}", session.id, session.starts_at.timestamp_micros()),
                session_id: session.id,
                session_name: session.name.clone(),
                clinic_id: session.clinic_id,
                service_code: session.service_code.clone(),
                practitioner_user_id: session.practitioner_user_id,
                owner_type: session.owner_type,
                owner_id: session.owner_id,
                mode: session.mode,
                start: session.starts_at,
                end: session.ends_at,
                status: slot_status(blocked, &capacity),
                capacity,
            });
        } else {
            let slot_minutes = i64::from(session.slot_minutes.unwrap_or(30));
            let mut slot_start = session.starts_at;
            while slot_start < session.ends_at {
                let slot_end =
                    (slot_start + chrono::Duration::minutes(slot_minutes)).min(session.ends_at);
                let booked = session_appointments
                    .iter()
                    .filter(|appointment| {
                        appointment.starts_at < slot_end && appointment.ends_at > slot_start
                    })
                    .count() as i64;
                let blocked = exceptions.iter().any(|exception| {
                    exception_blocks_slot(exception, &session, slot_start, slot_end)
                });
                let capacity = capacity_for(
                    session.capacity,
                    session.overbook_limit,
                    session.allow_overbooking,
                    booked,
                );
                slots.push(AvailabilitySlot {
                    id: format!("{}:{}", session.id, slot_start.timestamp_micros()),
                    session_id: session.id,
                    session_name: session.name.clone(),
                    clinic_id: session.clinic_id,
                    service_code: session.service_code.clone(),
                    practitioner_user_id: session.practitioner_user_id,
                    owner_type: session.owner_type,
                    owner_id: session.owner_id,
                    mode: session.mode,
                    start: slot_start,
                    end: slot_end,
                    status: slot_status(blocked, &capacity),
                    capacity,
                });
                slot_start = slot_end;
            }
        }
        if slots.len() as i64 >= limit {
            slots.truncate(limit as usize);
            break;
        }
    }
    slots
}

fn exception_blocks_session(
    exception: &ExceptionWindowRow,
    session: &BookableSessionListItem,
) -> bool {
    if exception.clinic_session_id == Some(session.id) {
        return true;
    }
    session.practitioner_user_id.is_some()
        && exception.practitioner_user_id == session.practitioner_user_id
}

fn exception_blocks_slot(
    exception: &ExceptionWindowRow,
    session: &BookableSessionListItem,
    starts_at: DateTime<Utc>,
    ends_at: DateTime<Utc>,
) -> bool {
    exception_blocks_session(exception, session)
        && exception.starts_at < ends_at
        && exception.ends_at > starts_at
}

fn capacity_for(
    max: i32,
    overbook_limit: i32,
    allow_overbooking: bool,
    booked: i64,
) -> SlotCapacity {
    let max_i64 = i64::from(max);
    let remaining = (max_i64 - booked).max(0);
    let overbook_remaining = if allow_overbooking {
        (i64::from(max) + i64::from(overbook_limit) - booked).max(0)
    } else {
        0
    };
    SlotCapacity {
        max,
        booked,
        remaining,
        overbook_remaining,
    }
}

fn slot_status(blocked: bool, capacity: &SlotCapacity) -> String {
    if blocked {
        "busy-unavailable".to_owned()
    } else if capacity.remaining > 0 {
        "free".to_owned()
    } else if capacity.overbook_remaining > 0 {
        "overbook_available".to_owned()
    } else {
        "busy".to_owned()
    }
}

fn bookable_service_from_row(row: BookableServiceRow) -> BookableServiceListItem {
    BookableServiceListItem {
        id: row.id,
        code: row.code,
        name: row.name,
        default_duration_minutes: row.default_duration_minutes,
        is_active: row.is_active,
        created_at: row.created_at,
    }
}

fn bookable_session_from_row(row: BookableSessionRow) -> anyhow::Result<BookableSessionListItem> {
    let capacity = i64::from(row.capacity);
    let overbook_capacity = i64::from(row.capacity) + i64::from(row.overbook_limit);
    Ok(BookableSessionListItem {
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
        booked_count: row.booked_count,
        remaining_capacity: (capacity - row.booked_count).max(0),
        allow_overbooking: row.allow_overbooking,
        overbook_limit: row.overbook_limit,
        overbook_remaining: if row.allow_overbooking {
            (overbook_capacity - row.booked_count).max(0)
        } else {
            0
        },
        is_active: row.is_active,
        created_at: row.created_at,
    })
}

fn exception_from_row(row: ExceptionWindowRow) -> SchedulingExceptionItem {
    SchedulingExceptionItem {
        id: row.id,
        session_id: row.clinic_session_id,
        practitioner_user_id: row.practitioner_user_id,
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        reason: row.reason,
        created_at: row.created_at,
    }
}

pub async fn book_appointment(
    pool: &PgPool,
    appointment: crate::care::NewBookedAppointment,
) -> anyhow::Result<AppointmentListItem> {
    crate::care::create_booked_appointment(pool, appointment).await
}
