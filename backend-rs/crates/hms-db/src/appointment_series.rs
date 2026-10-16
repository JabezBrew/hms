//! Atomic explicit-slot booking, immutable membership, and scoped retry receipts.
use crate::{care, PgPool};
use chrono::{DateTime, Duration, Utc};
use hms_domain::{
    appointment_series::*,
    care::{AppointmentStatus, ClinicSessionMode},
};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::{types::Json, FromRow, Postgres, Transaction};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SeriesError {
    Invalid,
    References,
    SlotChanged,
    RequestConflict,
    SnapshotChanged,
    Incomplete,
}
impl SeriesError {
    pub fn message(self) -> &'static str {
        match self {
        Self::Invalid => "Choose 2 to 50 distinct, nonoverlapping real session slots in the next 180 days.",
        Self::References => "The patient, clinic, service or practitioner is no longer available in this facility.",
        Self::SlotChanged => "A selected session or slot is no longer available. Refresh every selected date before booking.",
        Self::RequestConflict => "This request reference was already used for different booking instructions.",
        Self::SnapshotChanged => "An appointment changed since this review. Refresh the series before cancelling future appointments.",
        Self::Incomplete => "The complete saved series could not be confirmed. Reload before making another change.",
    }
    }
}
impl std::fmt::Display for SeriesError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.message())
    }
}
impl std::error::Error for SeriesError {}
#[derive(Clone)]
pub struct SeriesActor {
    pub facility_id: Uuid,
    pub user_id: Uuid,
    pub request_id: Option<String>,
}
fn hash(value: &[u8]) -> String {
    format!("{:x}", Sha256::digest(value))
}
fn key(id: Uuid) -> String {
    hash(id.as_bytes())
}
async fn request_lock(
    tx: &mut Transaction<'_, Postgres>,
    actor: &SeriesActor,
    id: Uuid,
) -> anyhow::Result<()> {
    let digest = Sha256::digest(
        [
            actor.facility_id.as_bytes().as_slice(),
            actor.user_id.as_bytes().as_slice(),
            id.as_bytes().as_slice(),
        ]
        .concat(),
    );
    let lock = i64::from_be_bytes(digest[..8].try_into().expect("fixed digest"));
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(lock)
        .execute(&mut **tx)
        .await?;
    Ok(())
}
fn normalize(
    mut data: CreateAppointmentSeriesRequest,
) -> anyhow::Result<CreateAppointmentSeriesRequest> {
    if data.client_request_id.is_nil() || !(2..=50).contains(&data.occurrences.len()) {
        return Err(SeriesError::Invalid.into());
    }
    for o in &mut data.occurrences {
        o.overbook_reason = o
            .overbook_reason
            .take()
            .map(|v| v.trim().to_owned())
            .filter(|v| !v.is_empty());
        if o.ends_at <= o.starts_at
            || o.overbook_reason.as_ref().is_some_and(|v| v.len() > 1000)
            || o.starts_at.timestamp_subsec_nanos() % 1000 != 0
            || o.ends_at.timestamp_subsec_nanos() % 1000 != 0
        {
            return Err(SeriesError::Invalid.into());
        }
    }
    data.occurrences
        .sort_by_key(|o| (o.starts_at, o.ends_at, o.session_id));
    if data
        .occurrences
        .windows(2)
        .any(|w| w[1].starts_at < w[0].ends_at)
    {
        return Err(SeriesError::Invalid.into());
    }
    Ok(data)
}
#[derive(FromRow)]
struct DetailRow {
    id: Uuid,
    patient_id: Uuid,
    patient_code: String,
    patient_display_name: String,
    clinic_id: Uuid,
    clinic_name: String,
    service_id: Uuid,
    service_name: String,
    occurrence_count: i16,
    created_at: DateTime<Utc>,
    appointments: Json<Vec<AppointmentSeriesMember>>,
}
fn detail(row: DetailRow) -> anyhow::Result<AppointmentSeriesDetail> {
    if row.appointments.len() != usize::try_from(row.occurrence_count).unwrap_or(0)
        || !(2..=50).contains(&row.appointments.len())
    {
        return Err(SeriesError::Incomplete.into());
    }
    let evidence: Vec<_> = row
        .appointments
        .iter()
        .map(|m| {
            json!([
                m.id,
                m.clinic_session_id,
                m.practitioner_user_id,
                m.starts_at,
                m.ends_at,
                m.status
            ])
        })
        .collect();
    let snapshot_token = hash(&serde_json::to_vec(&evidence)?);
    Ok(AppointmentSeriesDetail {
        id: row.id,
        patient_id: row.patient_id,
        patient_code: row.patient_code,
        patient_display_name: row.patient_display_name,
        clinic_id: row.clinic_id,
        clinic_name: row.clinic_name,
        service_id: row.service_id,
        service_name: row.service_name,
        snapshot_token,
        occurrence_count: i32::from(row.occurrence_count),
        created_at: row.created_at,
        appointments: row.appointments.0,
    })
}
// One statement supplies a single MVCC snapshot even when ordinary appointment
// actions change members without updating the series header.
async fn detail_tx(
    tx: &mut Transaction<'_, Postgres>,
    facility: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<AppointmentSeriesDetail>> {
    let row=sqlx::query_as::<_,DetailRow>(r#"SELECT s.id,s.patient_id,p.patient_code,p.first_name||' '||p.last_name AS patient_display_name,
        s.clinic_id,c.name AS clinic_name,s.service_id,t.name AS service_name,s.occurrence_count,s.created_at,
        COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM (SELECT a.id,a.clinic_session_id,a.practitioner_user_id,a.starts_at,a.ends_at,a.status,a.cancellation_reason,a.created_at
            FROM appointments a WHERE a.facility_id=s.facility_id AND a.series_id=s.id ORDER BY a.id LIMIT 51) m),'[]'::jsonb) AS appointments
        FROM appointment_series s JOIN patients p ON p.id=s.patient_id AND p.facility_id=s.facility_id
        JOIN clinics c ON c.id=s.clinic_id AND c.facility_id=s.facility_id
        JOIN appointment_types t ON t.id=s.service_id AND t.facility_id=s.facility_id
        WHERE s.facility_id=$1 AND s.id=$2 AND s.request_key_hash IS NOT NULL"#)
        .bind(facility).bind(id).fetch_optional(&mut **tx).await?;
    row.map(detail).transpose()
}
pub async fn series_patient(
    pool: &PgPool,
    facility: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<Uuid>> {
    Ok(sqlx::query_scalar("SELECT patient_id FROM appointment_series WHERE facility_id=$1 AND id=$2 AND request_key_hash IS NOT NULL").bind(facility).bind(id).fetch_optional(pool).await?)
}
pub async fn series_by_request(
    pool: &PgPool,
    actor: &SeriesActor,
    request: Uuid,
) -> anyhow::Result<Option<Uuid>> {
    let mut tx = pool.begin().await?;
    request_lock(&mut tx, actor, request).await?;
    let id=sqlx::query_scalar("SELECT id FROM appointment_series WHERE facility_id=$1 AND created_by_user_id=$2 AND request_key_hash=$3")
        .bind(actor.facility_id).bind(actor.user_id).bind(key(request)).fetch_optional(&mut *tx).await?;
    tx.commit().await?;
    Ok(id)
}
pub async fn get_series(
    pool: &PgPool,
    facility: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<AppointmentSeriesDetail>> {
    let mut tx = pool.begin().await?;
    let saved = detail_tx(&mut tx, facility, id).await?;
    tx.commit().await?;
    Ok(saved)
}
pub async fn list_series(
    pool: &PgPool,
    facility: Uuid,
    patient: Uuid,
    cursor: Option<care::CareCursor>,
    limit: i64,
) -> anyhow::Result<Vec<AppointmentSeriesListItem>> {
    #[derive(FromRow)]
    struct Row {
        id: Uuid,
        clinic_id: Uuid,
        clinic_name: String,
        service_id: Uuid,
        service_name: String,
        occurrence_count: i16,
        scheduled_count: i64,
        created_at: DateTime<Utc>,
    }
    let rows=sqlx::query_as::<_,Row>(r#"SELECT s.id,s.clinic_id,c.name AS clinic_name,s.service_id,t.name AS service_name,s.occurrence_count,s.created_at,
        (SELECT count(*) FROM appointments a WHERE a.facility_id=s.facility_id AND a.series_id=s.id AND a.status='scheduled') AS scheduled_count
        FROM appointment_series s JOIN clinics c ON c.id=s.clinic_id AND c.facility_id=s.facility_id
        JOIN appointment_types t ON t.id=s.service_id AND t.facility_id=s.facility_id
        WHERE s.facility_id=$1 AND s.patient_id=$2 AND s.request_key_hash IS NOT NULL
            AND ($3::timestamptz IS NULL OR (s.created_at,s.id)<($3,$4)) ORDER BY s.created_at DESC,s.id DESC LIMIT $5"#)
        .bind(facility).bind(patient).bind(cursor.as_ref().map(|c|c.occurred_at)).bind(cursor.as_ref().map(|c|c.id)).bind(limit.clamp(1,101)).fetch_all(pool).await?;
    Ok(rows
        .into_iter()
        .map(|r| AppointmentSeriesListItem {
            id: r.id,
            clinic_id: r.clinic_id,
            clinic_name: r.clinic_name,
            service_id: r.service_id,
            service_name: r.service_name,
            occurrence_count: i32::from(r.occurrence_count),
            scheduled_count: r.scheduled_count,
            created_at: r.created_at,
        })
        .collect())
}
async fn audit(
    tx: &mut Transaction<'_, Postgres>,
    actor: &SeriesActor,
    event: &str,
    id: Uuid,
    count: i64,
) -> anyhow::Result<()> {
    sqlx::query("INSERT INTO audit_events(id,facility_id,actor_user_id,request_id,event_type,resource_type,resource_id,metadata) VALUES($1,$2,$3,$4,$5,'appointment_series',$6,$7)")
        .bind(Uuid::new_v4()).bind(actor.facility_id).bind(actor.user_id).bind(&actor.request_id).bind(event).bind(id).bind(json!({"appointment_count":count})).execute(&mut **tx).await?;
    Ok(())
}
pub async fn create_series(
    pool: &PgPool,
    actor: SeriesActor,
    data: CreateAppointmentSeriesRequest,
) -> anyhow::Result<AppointmentSeriesDetail> {
    let data = normalize(data)?;
    let fingerprint = hash(&serde_json::to_vec(&data)?);
    let mut tx = pool.begin().await?;
    request_lock(&mut tx, &actor, data.client_request_id).await?;
    let replay:Option<(Uuid,String)>=sqlx::query_as("SELECT id,request_fingerprint FROM appointment_series WHERE facility_id=$1 AND created_by_user_id=$2 AND request_key_hash=$3")
        .bind(actor.facility_id).bind(actor.user_id).bind(key(data.client_request_id)).fetch_optional(&mut *tx).await?;
    if let Some((id, original)) = replay {
        if original != fingerprint {
            return Err(SeriesError::RequestConflict.into());
        }
        let saved = detail_tx(&mut tx, actor.facility_id, id)
            .await?
            .ok_or(SeriesError::Incomplete)?;
        tx.commit().await?;
        return Ok(saved);
    }
    let now: DateTime<Utc> = sqlx::query_scalar("SELECT clock_timestamp()")
        .fetch_one(&mut *tx)
        .await?;
    if data
        .occurrences
        .iter()
        .any(|o| o.starts_at <= now || o.ends_at > now + Duration::days(180))
    {
        return Err(SeriesError::Invalid.into());
    }
    let patient:Option<Uuid>=sqlx::query_scalar("SELECT id FROM patients WHERE facility_id=$1 AND id=$2 AND record_status='registered' AND vital_status<>'deceased' FOR SHARE")
        .bind(actor.facility_id).bind(data.patient_id).fetch_optional(&mut *tx).await?;
    let clinic: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM clinics WHERE facility_id=$1 AND id=$2 AND is_active FOR SHARE",
    )
    .bind(actor.facility_id)
    .bind(data.clinic_id)
    .fetch_optional(&mut *tx)
    .await?;
    let service: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM appointment_types WHERE facility_id=$1 AND id=$2 AND is_active FOR SHARE",
    )
    .bind(actor.facility_id)
    .bind(data.service_id)
    .fetch_optional(&mut *tx)
    .await?;
    if patient.is_none() || clinic.is_none() || service.is_none() {
        return Err(SeriesError::References.into());
    }
    let mut ids: Vec<_> = data.occurrences.iter().map(|o| o.session_id).collect();
    ids.sort();
    ids.dedup();
    let mut sessions = std::collections::HashMap::new();
    for id in ids {
        let session = care::load_clinic_session_for_update(&mut tx, actor.facility_id, id)
            .await
            .map_err(|_| SeriesError::SlotChanged)?;
        sessions.insert(id, session);
    }
    let mut practitioners: Vec<_> = sessions
        .values()
        .filter_map(|s| s.practitioner_user_id)
        .collect();
    practitioners.sort();
    practitioners.dedup();
    let active:Vec<Uuid>=sqlx::query_scalar("SELECT id FROM users WHERE facility_id=$1 AND id=ANY($2) AND is_active ORDER BY id FOR SHARE")
        .bind(actor.facility_id).bind(&practitioners).fetch_all(&mut *tx).await?;
    if active.len() != practitioners.len() {
        return Err(SeriesError::References.into());
    }
    for o in &data.occurrences {
        let s = &sessions[&o.session_id];
        if s.clinic_id != Some(data.clinic_id) || o.starts_at < s.starts_at || o.ends_at > s.ends_at
        {
            return Err(SeriesError::SlotChanged.into());
        }
        match s.mode {
            ClinicSessionMode::CapacityBlock => {
                if o.starts_at != s.starts_at || o.ends_at != s.ends_at {
                    return Err(SeriesError::SlotChanged.into());
                }
            }
            ClinicSessionMode::FixedSlot => {
                let minutes = i64::from(s.slot_minutes.unwrap_or(30));
                let delta = o.starts_at - s.starts_at;
                if minutes <= 0
                    || delta != Duration::seconds(delta.num_seconds())
                    || delta.num_seconds() % (minutes * 60) != 0
                    || o.ends_at != (o.starts_at + Duration::minutes(minutes)).min(s.ends_at)
                {
                    return Err(SeriesError::SlotChanged.into());
                }
            }
        }
    }
    // Locks may have waited behind an exception, deactivation or another booker.
    // Validate the time horizon against the database clock after those waits.
    let now: DateTime<Utc> = sqlx::query_scalar("SELECT clock_timestamp()")
        .fetch_one(&mut *tx)
        .await?;
    if data
        .occurrences
        .iter()
        .any(|o| o.starts_at <= now || o.ends_at > now + Duration::days(180))
    {
        return Err(SeriesError::Invalid.into());
    }
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO appointment_series(id,facility_id,patient_id,clinic_id,service_id,occurrence_count,request_key_hash,request_fingerprint,selected_dates,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)")
        .bind(id).bind(actor.facility_id).bind(data.patient_id).bind(data.clinic_id).bind(data.service_id).bind(data.occurrences.len() as i16).bind(key(data.client_request_id)).bind(fingerprint)
        .bind(Json(data.occurrences.iter().map(|o|o.starts_at).collect::<Vec<_>>())).bind(actor.user_id).execute(&mut *tx).await?;
    for o in data.occurrences {
        let session = &sessions[&o.session_id];
        care::create_booked_appointment_in_transaction(
            pool,
            &mut tx,
            care::NewBookedAppointment {
                id: Uuid::new_v4(),
                facility_id: actor.facility_id,
                patient_id: data.patient_id,
                clinic_id: Some(data.clinic_id),
                clinic_session_id: Some(o.session_id),
                appointment_type_id: Some(data.service_id),
                practitioner_user_id: session.practitioner_user_id,
                starts_at: o.starts_at,
                ends_at: o.ends_at,
                overbook_reason: o.overbook_reason,
                series_id: Some(id),
                created_by_user_id: actor.user_id,
            },
        )
        .await?;
    }
    let saved = detail_tx(&mut tx, actor.facility_id, id)
        .await?
        .ok_or(SeriesError::Incomplete)?;
    audit(
        &mut tx,
        &actor,
        "appointment.series_created",
        id,
        i64::from(saved.occurrence_count),
    )
    .await?;
    tx.commit().await?;
    Ok(saved)
}
#[derive(FromRow)]
struct CancelRow {
    request_fingerprint: String,
    cutoff_at: DateTime<Utc>,
    cancelled_appointment_ids: Vec<Uuid>,
    retained_appointment_ids: Vec<Uuid>,
}
pub async fn cancel_future(
    pool: &PgPool,
    actor: SeriesActor,
    id: Uuid,
    mut data: CancelFutureAppointmentsRequest,
) -> anyhow::Result<Option<AppointmentSeriesCancellationReceipt>> {
    data.reason = data.reason.trim().to_owned();
    if data.client_request_id.is_nil()
        || data.reason.is_empty()
        || data.reason.len() > 1000
        || data.expected_snapshot_token.len() != 64
    {
        return Err(SeriesError::Invalid.into());
    }
    let fingerprint = hash(&serde_json::to_vec(&data)?);
    let mut tx = pool.begin().await?;
    let found:Option<Uuid>=sqlx::query_scalar("SELECT id FROM appointment_series WHERE facility_id=$1 AND id=$2 AND request_key_hash IS NOT NULL FOR UPDATE")
        .bind(actor.facility_id).bind(id).fetch_optional(&mut *tx).await?;
    if found.is_none() {
        return Ok(None);
    }
    let previous=sqlx::query_as::<_,CancelRow>("SELECT request_fingerprint,cutoff_at,cancelled_appointment_ids,retained_appointment_ids FROM appointment_series_cancellations WHERE facility_id=$1 AND series_id=$2 AND actor_user_id=$3 AND request_key_hash=$4")
        .bind(actor.facility_id).bind(id).bind(actor.user_id).bind(key(data.client_request_id)).fetch_optional(&mut *tx).await?;
    let receipt = if let Some(row) = previous {
        if row.request_fingerprint != fingerprint {
            return Err(SeriesError::RequestConflict.into());
        }
        row
    } else {
        sqlx::query("SELECT id FROM appointments WHERE facility_id=$1 AND series_id=$2 ORDER BY id FOR UPDATE").bind(actor.facility_id).bind(id).fetch_all(&mut *tx).await?;
        let current = detail_tx(&mut tx, actor.facility_id, id)
            .await?
            .ok_or(SeriesError::Incomplete)?;
        if current.snapshot_token != data.expected_snapshot_token {
            return Err(SeriesError::SnapshotChanged.into());
        }
        let cutoff: DateTime<Utc> = sqlx::query_scalar("SELECT clock_timestamp()")
            .fetch_one(&mut *tx)
            .await?;
        let (cancelled, retained): (Vec<_>, Vec<_>) = current
            .appointments
            .iter()
            .partition(|m| m.status == AppointmentStatus::Scheduled && m.starts_at > cutoff);
        let cancelled: Vec<_> = cancelled.into_iter().map(|m| m.id).collect();
        let retained: Vec<_> = retained.into_iter().map(|m| m.id).collect();
        sqlx::query("UPDATE appointments SET status='cancelled',cancellation_reason=$3,cancelled_at=$4,cancelled_by_user_id=$5,updated_at=now() WHERE facility_id=$1 AND id=ANY($2) AND status='scheduled'")
            .bind(actor.facility_id).bind(&cancelled).bind(&data.reason).bind(cutoff).bind(actor.user_id).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO appointment_history(id,facility_id,appointment_id,event_type,actor_user_id,reason) SELECT gen_random_uuid(),$1,id,'cancelled',$3,$4 FROM appointments WHERE facility_id=$1 AND id=ANY($2)")
            .bind(actor.facility_id).bind(&cancelled).bind(actor.user_id).bind(&data.reason).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO appointment_series_cancellations(id,facility_id,series_id,actor_user_id,request_key_hash,request_fingerprint,cutoff_at,cancelled_appointment_ids,retained_appointment_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)")
            .bind(Uuid::new_v4()).bind(actor.facility_id).bind(id).bind(actor.user_id).bind(key(data.client_request_id)).bind(&fingerprint).bind(cutoff).bind(&cancelled).bind(&retained).execute(&mut *tx).await?;
        audit(
            &mut tx,
            &actor,
            "appointment.series_future_cancelled",
            id,
            cancelled.len() as i64,
        )
        .await?;
        CancelRow {
            request_fingerprint: fingerprint,
            cutoff_at: cutoff,
            cancelled_appointment_ids: cancelled,
            retained_appointment_ids: retained,
        }
    };
    let series = detail_tx(&mut tx, actor.facility_id, id)
        .await?
        .ok_or(SeriesError::Incomplete)?;
    let result = AppointmentSeriesCancellationReceipt {
        series,
        cutoff_at: receipt.cutoff_at,
        cancelled_count: receipt.cancelled_appointment_ids.len() as i32,
        cancelled_appointment_ids: receipt.cancelled_appointment_ids,
        retained_appointment_ids: receipt.retained_appointment_ids,
    };
    tx.commit().await?;
    Ok(Some(result))
}
