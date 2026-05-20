use chrono::{DateTime, Utc};
use hms_domain::ward::{BedListItem, BedStatus};
use hms_observability::observe_db_query;
use sqlx::{FromRow, Postgres, QueryBuilder};
use uuid::Uuid;

use crate::codec;
use crate::PgPool;

use super::WardCursor;

#[derive(Clone, Debug)]
pub struct NewBed {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub ward_id: Uuid,
    pub section_id: Option<Uuid>,
    pub bed_code: String,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct BedUpdate {
    pub section_id: Option<Uuid>,
    pub bed_code: Option<String>,
    pub status: Option<BedStatus>,
}

#[derive(Clone, Debug, FromRow)]
struct BedRow {
    id: Uuid,
    ward_id: Uuid,
    section_id: Option<Uuid>,
    bed_code: String,
    status: String,
    created_at: DateTime<Utc>,
}

pub async fn list_ward_beds(
    pool: &PgPool,
    facility_id: Uuid,
    ward_id: Uuid,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<BedListItem>> {
    let mut query = QueryBuilder::<Postgres>::new(
        r#"
        SELECT beds.id,
               beds.ward_id,
               beds.section_id,
               beds.bed_code,
               beds.status,
               beds.created_at
        FROM beds
        WHERE beds.facility_id =
        "#,
    );
    query.push_bind(facility_id);
    query.push(" AND beds.ward_id = ");
    query.push_bind(ward_id);

    if let Some(cursor) = cursor {
        query.push(" AND (beds.created_at, beds.id) > (");
        query.push_bind(cursor.occurred_at);
        query.push(", ");
        query.push_bind(cursor.id);
        query.push(")");
    }

    query.push(" ORDER BY beds.created_at ASC, beds.id ASC LIMIT ");
    query.push_bind(limit);

    let rows = observe_db_query(
        "ward.bed_management.ward_beds.list",
        query.build_query_as::<BedRow>().fetch_all(pool),
    )
    .await?;
    rows.into_iter().map(bed_from_row).collect()
}

pub async fn list_section_beds(
    pool: &PgPool,
    facility_id: Uuid,
    section_id: Uuid,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<BedListItem>> {
    let mut query = QueryBuilder::<Postgres>::new(
        r#"
        SELECT beds.id,
               beds.ward_id,
               beds.section_id,
               beds.bed_code,
               beds.status,
               beds.created_at
        FROM beds
        WHERE beds.facility_id =
        "#,
    );
    query.push_bind(facility_id);
    query.push(" AND beds.section_id = ");
    query.push_bind(section_id);

    if let Some(cursor) = cursor {
        query.push(" AND (beds.created_at, beds.id) > (");
        query.push_bind(cursor.occurred_at);
        query.push(", ");
        query.push_bind(cursor.id);
        query.push(")");
    }

    query.push(" ORDER BY beds.created_at ASC, beds.id ASC LIMIT ");
    query.push_bind(limit);

    let rows = observe_db_query(
        "ward.bed_management.section_beds.list",
        query.build_query_as::<BedRow>().fetch_all(pool),
    )
    .await?;
    rows.into_iter().map(bed_from_row).collect()
}

pub async fn get_bed_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    bed_id: Uuid,
) -> anyhow::Result<Option<BedListItem>> {
    let row = observe_db_query(
        "ward.bed_management.beds.get",
        sqlx::query_as::<_, BedRow>(
            r#"
        SELECT beds.id,
               beds.ward_id,
               beds.section_id,
               beds.bed_code,
               beds.status,
               beds.created_at
        FROM beds
        WHERE beds.facility_id = $1
          AND beds.id = $2
        "#,
        )
        .bind(facility_id)
        .bind(bed_id)
        .fetch_optional(pool),
    )
    .await?;

    row.map(bed_from_row).transpose()
}

pub async fn create_bed(pool: &PgPool, bed: NewBed) -> anyhow::Result<BedListItem> {
    let row = observe_db_query(
        "ward.bed_management.beds.create",
        sqlx::query_as::<_, BedRow>(
            r#"
        INSERT INTO beds (
            id,
            facility_id,
            ward_id,
            section_id,
            bed_code,
            status,
            created_by_user_id
        )
        SELECT $1, $2, $3, $4, $5, $6, $7
        WHERE EXISTS (
            SELECT 1
            FROM wards
            WHERE wards.facility_id = $2
              AND wards.id = $3
        )
          AND (
              $4::uuid IS NULL
              OR EXISTS (
                  SELECT 1
                  FROM ward_sections
                  WHERE ward_sections.facility_id = $2
                    AND ward_sections.ward_id = $3
                    AND ward_sections.id = $4
                    AND ward_sections.status = 'active'
              )
          )
        RETURNING id,
                  ward_id,
                  section_id,
                  bed_code,
                  status,
                  created_at
        "#,
        )
        .bind(bed.id)
        .bind(bed.facility_id)
        .bind(bed.ward_id)
        .bind(bed.section_id)
        .bind(bed.bed_code)
        .bind(codec::encode(BedStatus::Available)?)
        .bind(bed.actor_user_id)
        .fetch_optional(pool),
    )
    .await?
    .ok_or_else(|| anyhow::anyhow!("ward or section not found for bed"))?;

    bed_from_row(row)
}

pub async fn update_bed(
    pool: &PgPool,
    facility_id: Uuid,
    bed_id: Uuid,
    update: BedUpdate,
) -> anyhow::Result<Option<BedListItem>> {
    let status = update.status.map(codec::encode).transpose()?;
    let row = observe_db_query(
        "ward.bed_management.beds.update",
        sqlx::query_as::<_, BedRow>(
            r#"
        WITH target AS (
            SELECT id, ward_id
            FROM beds
            WHERE facility_id = $1
              AND id = $2
        ),
        updated AS (
            UPDATE beds
               SET section_id = COALESCE($3, section_id),
                   bed_code = COALESCE($4, bed_code),
                   status = COALESCE($5, status),
                   updated_at = now()
              FROM target
             WHERE beds.id = target.id
               AND (
                   $3::uuid IS NULL
                   OR EXISTS (
                       SELECT 1
                       FROM ward_sections
                       WHERE ward_sections.facility_id = $1
                         AND ward_sections.ward_id = target.ward_id
                         AND ward_sections.id = $3
                         AND ward_sections.status = 'active'
                   )
               )
            RETURNING beds.id,
                      beds.ward_id,
                      beds.section_id,
                      beds.bed_code,
                      beds.status,
                      beds.created_at
        )
        SELECT id,
               ward_id,
               section_id,
               bed_code,
               status,
               created_at
        FROM updated
        "#,
        )
        .bind(facility_id)
        .bind(bed_id)
        .bind(update.section_id)
        .bind(update.bed_code)
        .bind(status)
        .fetch_optional(pool),
    )
    .await?;

    row.map(bed_from_row).transpose()
}

pub async fn release_cleaned_beds(
    pool: &PgPool,
    facility_id: Uuid,
    now: DateTime<Utc>,
    limit: i64,
) -> anyhow::Result<u64> {
    let result = observe_db_query(
        "ward.bed_management.beds.release_cleaned",
        sqlx::query(
            r#"
        WITH due_beds AS (
            SELECT id
            FROM beds
            WHERE facility_id = $1
              AND status = $2
              AND cleaning_due_at IS NOT NULL
              AND cleaning_due_at <= $3
            ORDER BY cleaning_due_at ASC, id ASC
            LIMIT $4
            FOR UPDATE SKIP LOCKED
        )
        UPDATE beds
        SET status = $5,
            cleaning_due_at = NULL,
            updated_at = now()
        FROM due_beds
        WHERE beds.id = due_beds.id
        "#,
        )
        .bind(facility_id)
        .bind(codec::encode(BedStatus::Cleaning)?)
        .bind(now)
        .bind(limit)
        .bind(codec::encode(BedStatus::Available)?)
        .execute(pool),
    )
    .await?;
    Ok(result.rows_affected())
}

fn bed_from_row(row: BedRow) -> anyhow::Result<BedListItem> {
    Ok(BedListItem {
        id: row.id,
        ward_id: row.ward_id,
        section_id: row.section_id,
        bed_code: row.bed_code,
        status: codec::decode(&row.status)?,
        created_at: row.created_at,
    })
}
