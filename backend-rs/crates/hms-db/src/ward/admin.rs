use chrono::{DateTime, Utc};
use hms_domain::ward::{WardListItem, WardSectionListItem, WardStatus};
use hms_observability::observe_db_query;
use sqlx::{FromRow, Postgres, QueryBuilder};
use uuid::Uuid;

use crate::codec;
use crate::PgPool;

use super::WardCursor;

#[derive(Clone, Debug)]
pub struct NewWard {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub code: String,
    pub name: String,
}

#[derive(Clone, Debug)]
pub struct WardUpdate {
    pub code: Option<String>,
    pub name: Option<String>,
    pub status: Option<WardStatus>,
}

#[derive(Clone, Debug)]
pub struct NewWardSection {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub ward_id: Uuid,
    pub code: String,
    pub name: String,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct WardSectionUpdate {
    pub code: Option<String>,
    pub name: Option<String>,
    pub status: Option<WardStatus>,
}

#[derive(Clone, Debug, FromRow)]
struct WardRow {
    id: Uuid,
    code: String,
    name: String,
    status: String,
    active_bed_count: i64,
    available_bed_count: i64,
    occupied_bed_count: i64,
    reserved_bed_count: i64,
    cleaning_bed_count: i64,
    created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct WardSectionRow {
    id: Uuid,
    ward_id: Uuid,
    code: String,
    name: String,
    status: String,
    active_bed_count: i64,
    available_bed_count: i64,
    occupied_bed_count: i64,
    reserved_bed_count: i64,
    cleaning_bed_count: i64,
    created_at: DateTime<Utc>,
}

pub async fn list_wards(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<WardCursor>,
    limit: i64,
    search: Option<&str>,
) -> anyhow::Result<Vec<WardListItem>> {
    let mut query = QueryBuilder::<Postgres>::new(
        r#"
        WITH paged_wards AS (
            SELECT wards.id,
                   wards.code,
                   wards.name,
                   wards.status,
                   wards.created_at
            FROM wards
            WHERE wards.facility_id =
        "#,
    );
    query.push_bind(facility_id);

    if let Some(pattern) = like_contains_pattern(search) {
        query.push(" AND (wards.name ILIKE ");
        query.push_bind(pattern.clone());
        query.push(" ESCAPE '\\' OR wards.code ILIKE ");
        query.push_bind(pattern);
        query.push(" ESCAPE '\\')");
    }

    if let Some(cursor) = cursor {
        query.push(" AND (wards.created_at, wards.id) > (");
        query.push_bind(cursor.occurred_at);
        query.push(", ");
        query.push_bind(cursor.id);
        query.push(")");
    }

    query.push(" ORDER BY wards.created_at ASC, wards.id ASC LIMIT ");
    query.push_bind(limit);
    query.push(
        r#"
        )
        SELECT paged_wards.id,
               paged_wards.code,
               paged_wards.name,
               paged_wards.status,
               COALESCE(bed_counts.active_bed_count, 0) AS active_bed_count,
               COALESCE(bed_counts.available_bed_count, 0) AS available_bed_count,
               COALESCE(bed_counts.occupied_bed_count, 0) AS occupied_bed_count,
               COALESCE(bed_counts.reserved_bed_count, 0) AS reserved_bed_count,
               COALESCE(bed_counts.cleaning_bed_count, 0) AS cleaning_bed_count,
               paged_wards.created_at
        FROM paged_wards
        LEFT JOIN (
            SELECT beds.ward_id,
                   count(*) FILTER (WHERE beds.status != 'closed') AS active_bed_count,
                   count(*) FILTER (WHERE beds.status = 'available') AS available_bed_count,
                   count(*) FILTER (WHERE beds.status = 'occupied') AS occupied_bed_count,
                   count(*) FILTER (WHERE beds.status = 'reserved') AS reserved_bed_count,
                   count(*) FILTER (WHERE beds.status = 'cleaning') AS cleaning_bed_count
            FROM beds
            JOIN paged_wards ON paged_wards.id = beds.ward_id
            WHERE beds.facility_id =
        "#,
    );
    query.push_bind(facility_id);
    query.push(
        r#"
            GROUP BY beds.ward_id
        ) bed_counts ON bed_counts.ward_id = paged_wards.id
        ORDER BY paged_wards.created_at ASC, paged_wards.id ASC
        "#,
    );

    let rows = observe_db_query(
        "ward.admin.wards.list",
        query.build_query_as::<WardRow>().fetch_all(pool),
    )
    .await?;
    rows.into_iter().map(ward_from_row).collect()
}

pub async fn get_ward(
    pool: &PgPool,
    facility_id: Uuid,
    ward_id: Uuid,
) -> anyhow::Result<Option<WardListItem>> {
    let row = observe_db_query(
        "ward.admin.wards.get",
        sqlx::query_as::<_, WardRow>(
            r#"
        SELECT wards.id,
               wards.code,
               wards.name,
               wards.status,
               COALESCE(bed_counts.active_bed_count, 0) AS active_bed_count,
               COALESCE(bed_counts.available_bed_count, 0) AS available_bed_count,
               COALESCE(bed_counts.occupied_bed_count, 0) AS occupied_bed_count,
               COALESCE(bed_counts.reserved_bed_count, 0) AS reserved_bed_count,
               COALESCE(bed_counts.cleaning_bed_count, 0) AS cleaning_bed_count,
               wards.created_at
        FROM wards
        LEFT JOIN (
            SELECT ward_id,
                   count(*) FILTER (WHERE beds.status != 'closed') AS active_bed_count,
                   count(*) FILTER (WHERE beds.status = 'available') AS available_bed_count,
                   count(*) FILTER (WHERE beds.status = 'occupied') AS occupied_bed_count,
                   count(*) FILTER (WHERE beds.status = 'reserved') AS reserved_bed_count,
                   count(*) FILTER (WHERE beds.status = 'cleaning') AS cleaning_bed_count
            FROM beds
            WHERE facility_id = $1
              AND ward_id = $2
            GROUP BY ward_id
        ) bed_counts ON bed_counts.ward_id = wards.id
        WHERE wards.facility_id = $1
          AND wards.id = $2
        "#,
        )
        .bind(facility_id)
        .bind(ward_id)
        .fetch_optional(pool),
    )
    .await?;

    row.map(ward_from_row).transpose()
}

pub async fn ward_exists(pool: &PgPool, facility_id: Uuid, ward_id: Uuid) -> anyhow::Result<bool> {
    let exists = observe_db_query(
        "ward.admin.wards.exists",
        sqlx::query_scalar::<_, bool>(
            r#"
        SELECT EXISTS (
            SELECT 1
            FROM wards
            WHERE facility_id = $1
              AND id = $2
        )
        "#,
        )
        .bind(facility_id)
        .bind(ward_id)
        .fetch_one(pool),
    )
    .await?;

    Ok(exists)
}

pub async fn create_ward(pool: &PgPool, ward: NewWard) -> anyhow::Result<WardListItem> {
    let row = observe_db_query(
        "ward.admin.wards.create",
        sqlx::query_as::<_, WardRow>(
            r#"
        INSERT INTO wards (
            id,
            facility_id,
            code,
            name,
            status
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id,
                  code,
                  name,
                  status,
                  0::bigint AS active_bed_count,
                  0::bigint AS available_bed_count,
                  0::bigint AS occupied_bed_count,
                  0::bigint AS reserved_bed_count,
                  0::bigint AS cleaning_bed_count,
                  created_at
        "#,
        )
        .bind(ward.id)
        .bind(ward.facility_id)
        .bind(ward.code)
        .bind(ward.name)
        .bind(codec::encode(WardStatus::Active)?)
        .fetch_one(pool),
    )
    .await?;

    ward_from_row(row)
}

pub async fn update_ward(
    pool: &PgPool,
    facility_id: Uuid,
    ward_id: Uuid,
    update: WardUpdate,
) -> anyhow::Result<Option<WardListItem>> {
    let status = update.status.map(codec::encode).transpose()?;
    let row = observe_db_query(
        "ward.admin.wards.update",
        sqlx::query_as::<_, WardRow>(
            r#"
        WITH updated AS (
            UPDATE wards
               SET code = COALESCE($3, code),
                   name = COALESCE($4, name),
                   status = COALESCE($5, status),
                   updated_at = now()
             WHERE facility_id = $1
               AND id = $2
            RETURNING id,
                      code,
                      name,
                      status,
                      created_at
        )
        SELECT updated.id,
               updated.code,
               updated.name,
               updated.status,
               COALESCE(bed_counts.active_bed_count, 0) AS active_bed_count,
               COALESCE(bed_counts.available_bed_count, 0) AS available_bed_count,
               COALESCE(bed_counts.occupied_bed_count, 0) AS occupied_bed_count,
               COALESCE(bed_counts.reserved_bed_count, 0) AS reserved_bed_count,
               COALESCE(bed_counts.cleaning_bed_count, 0) AS cleaning_bed_count,
               updated.created_at
        FROM updated
        LEFT JOIN (
            SELECT ward_id,
                   count(*) FILTER (WHERE beds.status != 'closed') AS active_bed_count,
                   count(*) FILTER (WHERE beds.status = 'available') AS available_bed_count,
                   count(*) FILTER (WHERE beds.status = 'occupied') AS occupied_bed_count,
                   count(*) FILTER (WHERE beds.status = 'reserved') AS reserved_bed_count,
                   count(*) FILTER (WHERE beds.status = 'cleaning') AS cleaning_bed_count
            FROM beds
            WHERE facility_id = $1
              AND ward_id = $2
            GROUP BY ward_id
        ) bed_counts ON bed_counts.ward_id = updated.id
        "#,
        )
        .bind(facility_id)
        .bind(ward_id)
        .bind(update.code)
        .bind(update.name)
        .bind(status)
        .fetch_optional(pool),
    )
    .await?;

    row.map(ward_from_row).transpose()
}

pub async fn list_ward_sections(
    pool: &PgPool,
    facility_id: Uuid,
    ward_id: Uuid,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<WardSectionListItem>> {
    let mut query = QueryBuilder::<Postgres>::new(
        r#"
        SELECT ward_sections.id,
               ward_sections.ward_id,
               ward_sections.code,
               ward_sections.name,
               ward_sections.status,
               COALESCE(bed_counts.active_bed_count, 0) AS active_bed_count,
               COALESCE(bed_counts.available_bed_count, 0) AS available_bed_count,
               COALESCE(bed_counts.occupied_bed_count, 0) AS occupied_bed_count,
               COALESCE(bed_counts.reserved_bed_count, 0) AS reserved_bed_count,
               COALESCE(bed_counts.cleaning_bed_count, 0) AS cleaning_bed_count,
               ward_sections.created_at
        FROM ward_sections
        LEFT JOIN (
            SELECT section_id,
                   count(*) FILTER (WHERE beds.status != 'closed') AS active_bed_count,
                   count(*) FILTER (WHERE beds.status = 'available') AS available_bed_count,
                   count(*) FILTER (WHERE beds.status = 'occupied') AS occupied_bed_count,
                   count(*) FILTER (WHERE beds.status = 'reserved') AS reserved_bed_count,
                   count(*) FILTER (WHERE beds.status = 'cleaning') AS cleaning_bed_count
            FROM beds
            WHERE facility_id =
        "#,
    );
    query.push_bind(facility_id);
    query.push(" AND ward_id = ");
    query.push_bind(ward_id);
    query.push(
        r#"
              AND section_id IS NOT NULL
            GROUP BY section_id
        ) bed_counts ON bed_counts.section_id = ward_sections.id
        WHERE ward_sections.facility_id =
        "#,
    );
    query.push_bind(facility_id);
    query.push(" AND ward_sections.ward_id = ");
    query.push_bind(ward_id);

    if let Some(cursor) = cursor {
        query.push(" AND (ward_sections.created_at, ward_sections.id) > (");
        query.push_bind(cursor.occurred_at);
        query.push(", ");
        query.push_bind(cursor.id);
        query.push(")");
    }

    query.push(" ORDER BY ward_sections.created_at ASC, ward_sections.id ASC LIMIT ");
    query.push_bind(limit);

    let rows = observe_db_query(
        "ward.admin.sections.list",
        query.build_query_as::<WardSectionRow>().fetch_all(pool),
    )
    .await?;
    rows.into_iter().map(ward_section_from_row).collect()
}

pub async fn get_ward_section_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    section_id: Uuid,
) -> anyhow::Result<Option<WardSectionListItem>> {
    let row = observe_db_query(
        "ward.admin.sections.get",
        sqlx::query_as::<_, WardSectionRow>(
            r#"
        SELECT ward_sections.id,
               ward_sections.ward_id,
               ward_sections.code,
               ward_sections.name,
               ward_sections.status,
               COALESCE(bed_counts.active_bed_count, 0) AS active_bed_count,
               COALESCE(bed_counts.available_bed_count, 0) AS available_bed_count,
               COALESCE(bed_counts.occupied_bed_count, 0) AS occupied_bed_count,
               COALESCE(bed_counts.reserved_bed_count, 0) AS reserved_bed_count,
               COALESCE(bed_counts.cleaning_bed_count, 0) AS cleaning_bed_count,
               ward_sections.created_at
        FROM ward_sections
        LEFT JOIN (
            SELECT section_id,
                   count(*) FILTER (WHERE beds.status != 'closed') AS active_bed_count,
                   count(*) FILTER (WHERE beds.status = 'available') AS available_bed_count,
                   count(*) FILTER (WHERE beds.status = 'occupied') AS occupied_bed_count,
                   count(*) FILTER (WHERE beds.status = 'reserved') AS reserved_bed_count,
                   count(*) FILTER (WHERE beds.status = 'cleaning') AS cleaning_bed_count
            FROM beds
            WHERE facility_id = $1
              AND section_id = $2
            GROUP BY section_id
        ) bed_counts ON bed_counts.section_id = ward_sections.id
        WHERE ward_sections.facility_id = $1
          AND ward_sections.id = $2
        "#,
        )
        .bind(facility_id)
        .bind(section_id)
        .fetch_optional(pool),
    )
    .await?;

    row.map(ward_section_from_row).transpose()
}

pub async fn create_ward_section(
    pool: &PgPool,
    section: NewWardSection,
) -> anyhow::Result<WardSectionListItem> {
    let row = observe_db_query(
        "ward.admin.sections.create",
        sqlx::query_as::<_, WardSectionRow>(
            r#"
        WITH inserted AS (
            INSERT INTO ward_sections (
                id,
                facility_id,
                ward_id,
                code,
                name,
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
            RETURNING id,
                      ward_id,
                      code,
                      name,
                      status,
                      created_at
        )
        SELECT inserted.id,
               inserted.ward_id,
               inserted.code,
               inserted.name,
               inserted.status,
               0::bigint AS active_bed_count,
               0::bigint AS available_bed_count,
               0::bigint AS occupied_bed_count,
               0::bigint AS reserved_bed_count,
               0::bigint AS cleaning_bed_count,
               inserted.created_at
        FROM inserted
        "#,
        )
        .bind(section.id)
        .bind(section.facility_id)
        .bind(section.ward_id)
        .bind(section.code)
        .bind(section.name)
        .bind(codec::encode(WardStatus::Active)?)
        .bind(section.actor_user_id)
        .fetch_optional(pool),
    )
    .await?
    .ok_or_else(|| anyhow::anyhow!("ward not found for section"))?;

    ward_section_from_row(row)
}

pub async fn update_ward_section(
    pool: &PgPool,
    facility_id: Uuid,
    section_id: Uuid,
    update: WardSectionUpdate,
) -> anyhow::Result<Option<WardSectionListItem>> {
    let status = update.status.map(codec::encode).transpose()?;
    let row = observe_db_query(
        "ward.admin.sections.update",
        sqlx::query_as::<_, WardSectionRow>(
            r#"
        WITH updated AS (
            UPDATE ward_sections
               SET code = COALESCE($3, code),
                   name = COALESCE($4, name),
                   status = COALESCE($5, status),
                   updated_at = now()
             WHERE facility_id = $1
               AND id = $2
            RETURNING id,
                      ward_id,
                      code,
                      name,
                      status,
                      created_at
        )
        SELECT updated.id,
               updated.ward_id,
               updated.code,
               updated.name,
               updated.status,
               COALESCE(bed_counts.active_bed_count, 0) AS active_bed_count,
               COALESCE(bed_counts.available_bed_count, 0) AS available_bed_count,
               COALESCE(bed_counts.occupied_bed_count, 0) AS occupied_bed_count,
               COALESCE(bed_counts.reserved_bed_count, 0) AS reserved_bed_count,
               COALESCE(bed_counts.cleaning_bed_count, 0) AS cleaning_bed_count,
               updated.created_at
        FROM updated
        LEFT JOIN (
            SELECT section_id,
                   count(*) FILTER (WHERE beds.status != 'closed') AS active_bed_count,
                   count(*) FILTER (WHERE beds.status = 'available') AS available_bed_count,
                   count(*) FILTER (WHERE beds.status = 'occupied') AS occupied_bed_count,
                   count(*) FILTER (WHERE beds.status = 'reserved') AS reserved_bed_count,
                   count(*) FILTER (WHERE beds.status = 'cleaning') AS cleaning_bed_count
            FROM beds
            WHERE facility_id = $1
              AND section_id = $2
            GROUP BY section_id
        ) bed_counts ON bed_counts.section_id = updated.id
        "#,
        )
        .bind(facility_id)
        .bind(section_id)
        .bind(update.code)
        .bind(update.name)
        .bind(status)
        .fetch_optional(pool),
    )
    .await?;

    row.map(ward_section_from_row).transpose()
}

fn ward_from_row(row: WardRow) -> anyhow::Result<WardListItem> {
    Ok(WardListItem {
        id: row.id,
        code: row.code,
        name: row.name,
        status: codec::decode(&row.status)?,
        active_bed_count: row.active_bed_count,
        available_bed_count: row.available_bed_count,
        occupied_bed_count: row.occupied_bed_count,
        reserved_bed_count: row.reserved_bed_count,
        cleaning_bed_count: row.cleaning_bed_count,
        created_at: row.created_at,
    })
}

fn ward_section_from_row(row: WardSectionRow) -> anyhow::Result<WardSectionListItem> {
    Ok(WardSectionListItem {
        id: row.id,
        ward_id: row.ward_id,
        code: row.code,
        name: row.name,
        status: codec::decode(&row.status)?,
        active_bed_count: row.active_bed_count,
        available_bed_count: row.available_bed_count,
        occupied_bed_count: row.occupied_bed_count,
        reserved_bed_count: row.reserved_bed_count,
        cleaning_bed_count: row.cleaning_bed_count,
        created_at: row.created_at,
    })
}

fn like_contains_pattern(search: Option<&str>) -> Option<String> {
    let search = search?.trim();
    if search.is_empty() {
        return None;
    }
    let mut escaped = String::with_capacity(search.len());
    for ch in search.chars() {
        match ch {
            '\\' => escaped.push_str("\\\\"),
            '%' => escaped.push_str("\\%"),
            '_' => escaped.push_str("\\_"),
            _ => escaped.push(ch),
        }
    }
    Some(format!("%{escaped}%"))
}
