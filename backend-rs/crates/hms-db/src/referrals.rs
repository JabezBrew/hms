use chrono::{DateTime, Utc};
use hms_domain::referrals::{
    ClinicWaitlistEntryListItem, ClinicWaitlistStatus, ReferralListItem, ReferralPriority,
    ReferralStatus,
};
use sqlx::{FromRow, Postgres, QueryBuilder};
use uuid::Uuid;

use crate::codec;
use crate::PgPool;

#[derive(Clone, Debug)]
pub struct ReferralCursor {
    pub occurred_at: DateTime<Utc>,
    pub id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewReferral {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub patient_id: Uuid,
    pub to_service: String,
    pub priority: ReferralPriority,
    pub reason: Option<String>,
    pub sla_due_at: DateTime<Utc>,
    pub created_by_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewClinicWaitlistEntry {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub patient_id: Uuid,
    pub service: String,
    pub priority: ReferralPriority,
    pub created_by_user_id: Uuid,
}

#[derive(Clone, Debug, FromRow)]
struct ReferralRow {
    id: Uuid,
    patient_id: Uuid,
    patient_code: String,
    patient_display_name: String,
    to_service: String,
    priority: String,
    status: String,
    sla_due_at: DateTime<Utc>,
    created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct ClinicWaitlistEntryRow {
    id: Uuid,
    patient_id: Uuid,
    patient_code: String,
    patient_display_name: String,
    service: String,
    priority: String,
    status: String,
    created_at: DateTime<Utc>,
    offered_at: Option<DateTime<Utc>>,
    promoted_at: Option<DateTime<Utc>>,
}

pub async fn list_referrals(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<ReferralCursor>,
    limit: i64,
) -> anyhow::Result<Vec<ReferralListItem>> {
    let mut query = referral_query();
    query.push(" WHERE referrals.facility_id = ");
    query.push_bind(facility_id);
    append_cursor(&mut query, "referrals.created_at", "referrals.id", cursor);
    query.push(" ORDER BY referrals.created_at ASC, referrals.id ASC LIMIT ");
    query.push_bind(limit);

    let rows = query
        .build_query_as::<ReferralRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(referral_from_row).collect()
}

pub async fn create_referral(
    pool: &PgPool,
    referral: NewReferral,
) -> anyhow::Result<ReferralListItem> {
    sqlx::query(
        r#"
        INSERT INTO referrals (
            id,
            facility_id,
            patient_id,
            to_service,
            priority,
            status,
            reason,
            sla_due_at,
            created_by_user_id
        )
        SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9
        WHERE EXISTS (
            SELECT 1
            FROM patients
            WHERE patients.facility_id = $2
              AND patients.id = $3
        )
        "#,
    )
    .bind(referral.id)
    .bind(referral.facility_id)
    .bind(referral.patient_id)
    .bind(referral.to_service)
    .bind(codec::encode(referral.priority)?)
    .bind(codec::encode(ReferralStatus::Sent)?)
    .bind(referral.reason)
    .bind(referral.sla_due_at)
    .bind(referral.created_by_user_id)
    .execute(pool)
    .await?;

    referral_by_id(pool, referral.facility_id, referral.id).await
}

pub async fn accept_referral(
    pool: &PgPool,
    facility_id: Uuid,
    referral_id: Uuid,
    actor_user_id: Uuid,
) -> anyhow::Result<Option<ReferralListItem>> {
    sqlx::query(
        r#"
        UPDATE referrals
        SET status = $1,
            accepted_by_user_id = $2,
            accepted_at = COALESCE(accepted_at, now()),
            updated_at = now()
        WHERE facility_id = $3
          AND id = $4
          AND status = $5
        "#,
    )
    .bind(codec::encode(ReferralStatus::Accepted)?)
    .bind(actor_user_id)
    .bind(facility_id)
    .bind(referral_id)
    .bind(codec::encode(ReferralStatus::Sent)?)
    .execute(pool)
    .await?;

    optional_referral_by_id(pool, facility_id, referral_id).await
}

pub async fn get_referral(
    pool: &PgPool,
    facility_id: Uuid,
    referral_id: Uuid,
) -> anyhow::Result<Option<ReferralListItem>> {
    optional_referral_by_id(pool, facility_id, referral_id).await
}

pub async fn list_clinic_waitlist_entries(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<ReferralCursor>,
    limit: i64,
) -> anyhow::Result<Vec<ClinicWaitlistEntryListItem>> {
    let mut query = clinic_waitlist_query();
    query.push(" WHERE clinic_waitlist_entries.facility_id = ");
    query.push_bind(facility_id);
    append_cursor(
        &mut query,
        "clinic_waitlist_entries.created_at",
        "clinic_waitlist_entries.id",
        cursor,
    );
    query.push(
        " ORDER BY clinic_waitlist_entries.created_at ASC, clinic_waitlist_entries.id ASC LIMIT ",
    );
    query.push_bind(limit);

    let rows = query
        .build_query_as::<ClinicWaitlistEntryRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(waitlist_from_row).collect()
}

pub async fn create_clinic_waitlist_entry(
    pool: &PgPool,
    entry: NewClinicWaitlistEntry,
) -> anyhow::Result<ClinicWaitlistEntryListItem> {
    sqlx::query(
        r#"
        INSERT INTO clinic_waitlist_entries (
            id,
            facility_id,
            patient_id,
            service,
            priority,
            status,
            created_by_user_id
        )
        SELECT $1, $2, $3, $4, $5, $6, $7
        WHERE EXISTS (
            SELECT 1
            FROM patients
            WHERE patients.facility_id = $2
              AND patients.id = $3
        )
        "#,
    )
    .bind(entry.id)
    .bind(entry.facility_id)
    .bind(entry.patient_id)
    .bind(entry.service)
    .bind(codec::encode(entry.priority)?)
    .bind(codec::encode(ClinicWaitlistStatus::Waiting)?)
    .bind(entry.created_by_user_id)
    .execute(pool)
    .await?;

    waitlist_by_id(pool, entry.facility_id, entry.id).await
}

pub async fn offer_next_clinic_waitlist_entry(
    pool: &PgPool,
    facility_id: Uuid,
    service: &str,
    actor_user_id: Uuid,
) -> anyhow::Result<Option<ClinicWaitlistEntryListItem>> {
    let id = sqlx::query_scalar::<_, Uuid>(
        r#"
        WITH next_entry AS (
            SELECT id
            FROM clinic_waitlist_entries
            WHERE facility_id = $1
              AND service = $2
              AND status = $3
            ORDER BY CASE priority
                        WHEN 'emergency' THEN 0
                        WHEN 'urgent' THEN 1
                        ELSE 2
                     END,
                     created_at ASC,
                     id ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        UPDATE clinic_waitlist_entries
        SET status = $4,
            offered_by_user_id = $5,
            offered_at = COALESCE(offered_at, now()),
            updated_at = now()
        FROM next_entry
        WHERE clinic_waitlist_entries.id = next_entry.id
        RETURNING clinic_waitlist_entries.id
        "#,
    )
    .bind(facility_id)
    .bind(service)
    .bind(codec::encode(ClinicWaitlistStatus::Waiting)?)
    .bind(codec::encode(ClinicWaitlistStatus::Offered)?)
    .bind(actor_user_id)
    .fetch_optional(pool)
    .await?;

    match id {
        Some(id) => optional_waitlist_by_id(pool, facility_id, id).await,
        None => Ok(None),
    }
}

fn referral_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::<Postgres>::new(
        r#"
        SELECT referrals.id,
               referrals.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               referrals.to_service,
               referrals.priority,
               referrals.status,
               referrals.sla_due_at,
               referrals.created_at
        FROM referrals
        JOIN patients
          ON patients.id = referrals.patient_id
         AND patients.facility_id = referrals.facility_id
        "#,
    )
}

fn clinic_waitlist_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::<Postgres>::new(
        r#"
        SELECT clinic_waitlist_entries.id,
               clinic_waitlist_entries.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               clinic_waitlist_entries.service,
               clinic_waitlist_entries.priority,
               clinic_waitlist_entries.status,
               clinic_waitlist_entries.created_at,
               clinic_waitlist_entries.offered_at,
               clinic_waitlist_entries.promoted_at
        FROM clinic_waitlist_entries
        JOIN patients
          ON patients.id = clinic_waitlist_entries.patient_id
         AND patients.facility_id = clinic_waitlist_entries.facility_id
        "#,
    )
}

fn append_cursor(
    query: &mut QueryBuilder<'_, Postgres>,
    time_column: &str,
    id_column: &str,
    cursor: Option<ReferralCursor>,
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

async fn referral_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    referral_id: Uuid,
) -> anyhow::Result<ReferralListItem> {
    optional_referral_by_id(pool, facility_id, referral_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("referral was not found after write"))
}

async fn optional_referral_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    referral_id: Uuid,
) -> anyhow::Result<Option<ReferralListItem>> {
    let mut query = referral_query();
    query.push(" WHERE referrals.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND referrals.id = ");
    query.push_bind(referral_id);
    let row = query
        .build_query_as::<ReferralRow>()
        .fetch_optional(pool)
        .await?;
    row.map(referral_from_row).transpose()
}

async fn waitlist_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    entry_id: Uuid,
) -> anyhow::Result<ClinicWaitlistEntryListItem> {
    optional_waitlist_by_id(pool, facility_id, entry_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("clinic waitlist entry was not found after write"))
}

async fn optional_waitlist_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    entry_id: Uuid,
) -> anyhow::Result<Option<ClinicWaitlistEntryListItem>> {
    let mut query = clinic_waitlist_query();
    query.push(" WHERE clinic_waitlist_entries.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND clinic_waitlist_entries.id = ");
    query.push_bind(entry_id);
    let row = query
        .build_query_as::<ClinicWaitlistEntryRow>()
        .fetch_optional(pool)
        .await?;
    row.map(waitlist_from_row).transpose()
}

fn referral_from_row(row: ReferralRow) -> anyhow::Result<ReferralListItem> {
    Ok(ReferralListItem {
        id: row.id,
        patient_id: row.patient_id,
        patient_code: row.patient_code,
        patient_display_name: row.patient_display_name,
        to_service: row.to_service,
        priority: codec::decode(&row.priority)?,
        status: codec::decode(&row.status)?,
        sla_due_at: row.sla_due_at,
        created_at: row.created_at,
    })
}

fn waitlist_from_row(row: ClinicWaitlistEntryRow) -> anyhow::Result<ClinicWaitlistEntryListItem> {
    Ok(ClinicWaitlistEntryListItem {
        id: row.id,
        patient_id: row.patient_id,
        patient_code: row.patient_code,
        patient_display_name: row.patient_display_name,
        service: row.service,
        priority: codec::decode(&row.priority)?,
        status: codec::decode(&row.status)?,
        created_at: row.created_at,
        offered_at: row.offered_at,
        promoted_at: row.promoted_at,
    })
}
