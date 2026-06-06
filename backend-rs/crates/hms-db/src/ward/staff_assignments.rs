use chrono::{DateTime, Utc};
use hms_domain::ward::{
    MyWardBoardAssignment, WardStaffAssignmentListItem, WardStaffListItem, WardStaffRoleCategory,
    WardStaffRoleItem,
};
use hms_observability::observe_db_query;
use sqlx::{FromRow, Postgres, QueryBuilder};
use uuid::Uuid;

use crate::codec;
use crate::PgPool;

use super::WardCursor;

#[derive(Clone, Debug)]
pub struct NewWardStaffAssignment {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub ward_id: Uuid,
    pub practitioner_id: Uuid,
    pub role_code: String,
    pub role_name: String,
    pub role_category: WardStaffRoleCategory,
    pub is_active: bool,
    pub is_primary: bool,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct WardStaffAssignmentUpdate {
    pub ward_id: Option<Uuid>,
    pub practitioner_id: Option<Uuid>,
    pub role_code: Option<String>,
    pub role_name: Option<String>,
    pub role_category: Option<WardStaffRoleCategory>,
    pub is_active: Option<bool>,
    pub is_primary: Option<bool>,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug, FromRow)]
struct WardStaffAssignmentRow {
    id: Uuid,
    ward_id: Uuid,
    ward_name: String,
    practitioner_id: Uuid,
    practitioner_name: String,
    user_id: Uuid,
    role_code: String,
    role_name: String,
    role_category: String,
    is_active: bool,
    is_primary: bool,
    assigned_at: DateTime<Utc>,
    assigned_by_user_id: Option<Uuid>,
    assigned_by_name: Option<String>,
}

#[derive(Clone, Debug, FromRow)]
struct WardStaffRow {
    practitioner_id: Uuid,
    user_id: Uuid,
    full_name: String,
    role_name: String,
    role_category: String,
}

#[derive(Clone, Debug, FromRow)]
struct MyWardBoardAssignmentRow {
    assignment_id: Uuid,
    ward_id: Uuid,
    ward_name: String,
    role_name: String,
    role_category: String,
    is_primary: bool,
}

#[derive(Clone, Copy)]
struct RoleDefinition {
    code: &'static str,
    name: &'static str,
    category: WardStaffRoleCategory,
    description: &'static str,
}

const ROLE_DEFINITIONS: [RoleDefinition; 8] = [
    RoleDefinition {
        code: "staff_nurse",
        name: "Staff Nurse",
        category: WardStaffRoleCategory::Nursing,
        description: "Ward nurse assigned to direct inpatient care.",
    },
    RoleDefinition {
        code: "charge_nurse",
        name: "Charge Nurse",
        category: WardStaffRoleCategory::Nursing,
        description: "Shift lead for ward nursing operations.",
    },
    RoleDefinition {
        code: "nurse_manager",
        name: "Nurse Manager",
        category: WardStaffRoleCategory::Nursing,
        description: "Nursing manager responsible for ward staffing and standards.",
    },
    RoleDefinition {
        code: "attending_physician",
        name: "Attending Physician",
        category: WardStaffRoleCategory::Medical,
        description: "Medical lead accountable for admitted patient care.",
    },
    RoleDefinition {
        code: "resident",
        name: "Resident",
        category: WardStaffRoleCategory::Medical,
        description: "Resident physician assigned to ward coverage.",
    },
    RoleDefinition {
        code: "consultant",
        name: "Consultant",
        category: WardStaffRoleCategory::Medical,
        description: "Specialist consultant attached to the ward.",
    },
    RoleDefinition {
        code: "physiotherapist",
        name: "Physiotherapist",
        category: WardStaffRoleCategory::Allied,
        description: "Allied health practitioner assigned to inpatient rehabilitation.",
    },
    RoleDefinition {
        code: "ward_clerk",
        name: "Ward Clerk",
        category: WardStaffRoleCategory::Operational,
        description: "Operational ward clerk supporting inpatient coordination.",
    },
];

pub fn ward_staff_roles(
    category: Option<WardStaffRoleCategory>,
    show_inactive: bool,
) -> Vec<WardStaffRoleItem> {
    ROLE_DEFINITIONS
        .iter()
        .filter(|role| category.is_none_or(|selected| selected == role.category))
        .map(|role| WardStaffRoleItem {
            id: role.code.to_owned(),
            code: role.code.to_owned(),
            name: role.name.to_owned(),
            category: role.category,
            description: Some(role.description.to_owned()),
            is_active: true,
        })
        .filter(|role| show_inactive || role.is_active)
        .collect()
}

pub fn ward_staff_role_by_code(code: &str) -> Option<WardStaffRoleItem> {
    let normalized = code.trim().to_ascii_lowercase();
    ward_staff_roles(None, false)
        .into_iter()
        .find(|role| role.code == normalized || role.id == normalized)
}

pub async fn list_ward_staff(
    pool: &PgPool,
    facility_id: Uuid,
    ward_id: Uuid,
    category: Option<WardStaffRoleCategory>,
) -> anyhow::Result<Vec<WardStaffListItem>> {
    let mut query = QueryBuilder::<Postgres>::new(
        r#"
        SELECT ward_staff_assignments.practitioner_profile_id AS practitioner_id,
               staff_profiles.user_id,
               users.display_name AS full_name,
               ward_staff_assignments.role_name,
               ward_staff_assignments.role_category
        FROM ward_staff_assignments
        JOIN practitioner_profiles
          ON practitioner_profiles.id = ward_staff_assignments.practitioner_profile_id
         AND practitioner_profiles.facility_id = ward_staff_assignments.facility_id
        JOIN staff_profiles
          ON staff_profiles.id = practitioner_profiles.staff_id
         AND staff_profiles.facility_id = ward_staff_assignments.facility_id
        JOIN users
          ON users.id = staff_profiles.user_id
         AND users.facility_id = ward_staff_assignments.facility_id
        WHERE ward_staff_assignments.facility_id =
        "#,
    );
    query.push_bind(facility_id);
    query.push(" AND ward_staff_assignments.ward_id = ");
    query.push_bind(ward_id);
    query.push(" AND ward_staff_assignments.is_active = TRUE");
    query.push(" AND users.is_active = TRUE");
    if let Some(category) = category {
        query.push(" AND ward_staff_assignments.role_category = ");
        query.push_bind(codec::encode(category)?);
    }
    query.push(
        " ORDER BY ward_staff_assignments.is_primary DESC, users.display_name ASC, ward_staff_assignments.assigned_at ASC LIMIT 100",
    );

    let rows = observe_db_query(
        "ward.staff_assignments.ward_staff.list",
        query.build_query_as::<WardStaffRow>().fetch_all(pool),
    )
    .await?;
    rows.into_iter().map(ward_staff_from_row).collect()
}

pub async fn list_ward_staff_assignments(
    pool: &PgPool,
    facility_id: Uuid,
    ward_id: Option<Uuid>,
    practitioner_id: Option<Uuid>,
    category: Option<WardStaffRoleCategory>,
    show_inactive: bool,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<WardStaffAssignmentListItem>> {
    let mut query = QueryBuilder::<Postgres>::new(assignment_select());
    query.push(" WHERE ward_staff_assignments.facility_id = ");
    query.push_bind(facility_id);
    if !show_inactive {
        query.push(" AND ward_staff_assignments.is_active = TRUE");
    }
    if let Some(ward_id) = ward_id {
        query.push(" AND ward_staff_assignments.ward_id = ");
        query.push_bind(ward_id);
    }
    if let Some(practitioner_id) = practitioner_id {
        query.push(" AND ward_staff_assignments.practitioner_profile_id = ");
        query.push_bind(practitioner_id);
    }
    if let Some(category) = category {
        query.push(" AND ward_staff_assignments.role_category = ");
        query.push_bind(codec::encode(category)?);
    }
    if let Some(cursor) = cursor {
        query.push(" AND (ward_staff_assignments.assigned_at, ward_staff_assignments.id) > (");
        query.push_bind(cursor.occurred_at);
        query.push(", ");
        query.push_bind(cursor.id);
        query.push(")");
    }
    query.push(
        " ORDER BY ward_staff_assignments.assigned_at ASC, ward_staff_assignments.id ASC LIMIT ",
    );
    query.push_bind(limit);

    let rows = observe_db_query(
        "ward.staff_assignments.list",
        query
            .build_query_as::<WardStaffAssignmentRow>()
            .fetch_all(pool),
    )
    .await?;
    rows.into_iter().map(assignment_from_row).collect()
}

pub async fn get_ward_staff_assignment(
    pool: &PgPool,
    facility_id: Uuid,
    assignment_id: Uuid,
) -> anyhow::Result<Option<WardStaffAssignmentListItem>> {
    let mut query = QueryBuilder::<Postgres>::new(assignment_select());
    query.push(" WHERE ward_staff_assignments.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND ward_staff_assignments.id = ");
    query.push_bind(assignment_id);
    let row = observe_db_query(
        "ward.staff_assignments.get",
        query
            .build_query_as::<WardStaffAssignmentRow>()
            .fetch_optional(pool),
    )
    .await?;
    row.map(assignment_from_row).transpose()
}

pub async fn list_user_ward_board_assignments(
    pool: &PgPool,
    facility_id: Uuid,
    user_id: Uuid,
) -> anyhow::Result<Vec<MyWardBoardAssignment>> {
    let rows = observe_db_query(
        "ward.staff_assignments.user_context.list",
        sqlx::query_as::<_, MyWardBoardAssignmentRow>(
            r#"
        SELECT ward_staff_assignments.id AS assignment_id,
               ward_staff_assignments.ward_id,
               wards.name AS ward_name,
               ward_staff_assignments.role_name,
               ward_staff_assignments.role_category,
               ward_staff_assignments.is_primary
        FROM ward_staff_assignments
        JOIN wards
          ON wards.id = ward_staff_assignments.ward_id
         AND wards.facility_id = ward_staff_assignments.facility_id
        JOIN practitioner_profiles
          ON practitioner_profiles.id = ward_staff_assignments.practitioner_profile_id
         AND practitioner_profiles.facility_id = ward_staff_assignments.facility_id
        JOIN staff_profiles
          ON staff_profiles.id = practitioner_profiles.staff_id
         AND staff_profiles.facility_id = ward_staff_assignments.facility_id
        JOIN users
          ON users.id = staff_profiles.user_id
         AND users.facility_id = ward_staff_assignments.facility_id
        WHERE ward_staff_assignments.facility_id = $1
          AND staff_profiles.user_id = $2
          AND ward_staff_assignments.is_active = TRUE
          AND wards.status = 'active'
          AND users.is_active = TRUE
        ORDER BY ward_staff_assignments.is_primary DESC, wards.name ASC, ward_staff_assignments.assigned_at ASC
        LIMIT 100
        "#,
        )
        .bind(facility_id)
        .bind(user_id)
        .fetch_all(pool),
    )
    .await?;
    rows.into_iter().map(my_assignment_from_row).collect()
}

pub async fn user_has_active_ward_assignment(
    pool: &PgPool,
    facility_id: Uuid,
    user_id: Uuid,
    ward_id: Uuid,
) -> anyhow::Result<bool> {
    let allowed = observe_db_query(
        "ward.staff_assignments.user_ward.exists",
        sqlx::query_scalar::<_, bool>(
            r#"
        SELECT EXISTS (
            SELECT 1
            FROM ward_staff_assignments
            JOIN practitioner_profiles
              ON practitioner_profiles.id = ward_staff_assignments.practitioner_profile_id
             AND practitioner_profiles.facility_id = ward_staff_assignments.facility_id
            JOIN staff_profiles
              ON staff_profiles.id = practitioner_profiles.staff_id
             AND staff_profiles.facility_id = ward_staff_assignments.facility_id
            JOIN users
              ON users.id = staff_profiles.user_id
             AND users.facility_id = ward_staff_assignments.facility_id
            WHERE ward_staff_assignments.facility_id = $1
              AND ward_staff_assignments.ward_id = $2
              AND staff_profiles.user_id = $3
              AND ward_staff_assignments.is_active = TRUE
              AND users.is_active = TRUE
        )
        "#,
        )
        .bind(facility_id)
        .bind(ward_id)
        .bind(user_id)
        .fetch_one(pool),
    )
    .await?;
    Ok(allowed)
}

pub async fn create_ward_staff_assignment(
    pool: &PgPool,
    assignment: NewWardStaffAssignment,
) -> anyhow::Result<Option<WardStaffAssignmentListItem>> {
    let mut tx = pool.begin().await?;
    let target_exists = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM wards
            WHERE wards.facility_id = $1
              AND wards.id = $2
              AND wards.status = 'active'
        )
        AND EXISTS (
            SELECT 1
            FROM practitioner_profiles
            JOIN staff_profiles ON staff_profiles.id = practitioner_profiles.staff_id
            JOIN users ON users.id = staff_profiles.user_id
            WHERE practitioner_profiles.facility_id = $1
              AND practitioner_profiles.id = $3
              AND users.is_active = TRUE
        )
        "#,
    )
    .bind(assignment.facility_id)
    .bind(assignment.ward_id)
    .bind(assignment.practitioner_id)
    .fetch_one(&mut *tx)
    .await?;

    if !target_exists {
        tx.rollback().await?;
        return Ok(None);
    }

    if assignment.is_active && assignment.is_primary {
        clear_primary_assignments_tx(
            &mut tx,
            assignment.facility_id,
            assignment.practitioner_id,
            assignment.actor_user_id,
            None,
        )
        .await?;
    }

    let inserted_id = sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO ward_staff_assignments (
            id,
            facility_id,
            ward_id,
            practitioner_profile_id,
            role_code,
            role_name,
            role_category,
            is_active,
            is_primary,
            assigned_by_user_id,
            updated_by_user_id
        )
        SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10
        WHERE EXISTS (
            SELECT 1
            FROM wards
            WHERE wards.facility_id = $2
              AND wards.id = $3
              AND wards.status = 'active'
        )
          AND EXISTS (
            SELECT 1
            FROM practitioner_profiles
            JOIN staff_profiles ON staff_profiles.id = practitioner_profiles.staff_id
            JOIN users ON users.id = staff_profiles.user_id
            WHERE practitioner_profiles.facility_id = $2
              AND practitioner_profiles.id = $4
              AND users.is_active = TRUE
        )
        RETURNING id
        "#,
    )
    .bind(assignment.id)
    .bind(assignment.facility_id)
    .bind(assignment.ward_id)
    .bind(assignment.practitioner_id)
    .bind(assignment.role_code)
    .bind(assignment.role_name)
    .bind(codec::encode(assignment.role_category)?)
    .bind(assignment.is_active)
    .bind(assignment.is_primary)
    .bind(assignment.actor_user_id)
    .fetch_optional(&mut *tx)
    .await?;

    let Some(inserted_id) = inserted_id else {
        tx.rollback().await?;
        return Ok(None);
    };

    tx.commit().await?;
    get_ward_staff_assignment(pool, assignment.facility_id, inserted_id).await
}

pub async fn update_ward_staff_assignment(
    pool: &PgPool,
    facility_id: Uuid,
    assignment_id: Uuid,
    update: WardStaffAssignmentUpdate,
) -> anyhow::Result<Option<WardStaffAssignmentListItem>> {
    let mut tx = pool.begin().await?;
    let encoded_role_category = update.role_category.map(codec::encode).transpose()?;
    let target = sqlx::query_as::<_, (Uuid, bool)>(
        r#"
        SELECT
            COALESCE($4, ward_staff_assignments.practitioner_profile_id) AS target_practitioner_id,
            (
                COALESCE($5, ward_staff_assignments.is_active) = TRUE
                AND COALESCE($6, ward_staff_assignments.is_primary) = TRUE
            ) AS should_clear_primary
        FROM ward_staff_assignments
        WHERE ward_staff_assignments.facility_id = $1
          AND ward_staff_assignments.id = $2
          AND ($3::uuid IS NULL OR EXISTS (
              SELECT 1
              FROM wards
              WHERE wards.facility_id = $1
                AND wards.id = $3
                AND wards.status = 'active'
          ))
          AND ($4::uuid IS NULL OR EXISTS (
              SELECT 1
              FROM practitioner_profiles
              JOIN staff_profiles ON staff_profiles.id = practitioner_profiles.staff_id
              JOIN users ON users.id = staff_profiles.user_id
              WHERE practitioner_profiles.facility_id = $1
                AND practitioner_profiles.id = $4
                AND users.is_active = TRUE
          ))
        "#,
    )
    .bind(facility_id)
    .bind(assignment_id)
    .bind(update.ward_id)
    .bind(update.practitioner_id)
    .bind(update.is_active)
    .bind(update.is_primary)
    .fetch_optional(&mut *tx)
    .await?;

    let Some((target_practitioner_id, should_clear_primary)) = target else {
        tx.rollback().await?;
        return Ok(None);
    };

    if should_clear_primary {
        clear_primary_assignments_tx(
            &mut tx,
            facility_id,
            target_practitioner_id,
            update.actor_user_id,
            Some(assignment_id),
        )
        .await?;
    }

    let updated_id = sqlx::query_scalar::<_, Uuid>(
        r#"
        UPDATE ward_staff_assignments
           SET ward_id = COALESCE($3, ward_id),
               practitioner_profile_id = COALESCE($4, practitioner_profile_id),
               role_code = COALESCE($5, role_code),
               role_name = COALESCE($6, role_name),
               role_category = COALESCE($7, role_category),
               is_active = COALESCE($8, is_active),
               is_primary = COALESCE($9, is_primary),
               updated_by_user_id = $10,
               updated_at = now()
         WHERE facility_id = $1
           AND id = $2
           AND ($3::uuid IS NULL OR EXISTS (
               SELECT 1
               FROM wards
               WHERE wards.facility_id = $1
                 AND wards.id = $3
                 AND wards.status = 'active'
           ))
           AND ($4::uuid IS NULL OR EXISTS (
               SELECT 1
               FROM practitioner_profiles
               JOIN staff_profiles ON staff_profiles.id = practitioner_profiles.staff_id
               JOIN users ON users.id = staff_profiles.user_id
               WHERE practitioner_profiles.facility_id = $1
                 AND practitioner_profiles.id = $4
                 AND users.is_active = TRUE
           ))
        RETURNING ward_staff_assignments.id
        "#,
    )
    .bind(facility_id)
    .bind(assignment_id)
    .bind(update.ward_id)
    .bind(update.practitioner_id)
    .bind(update.role_code)
    .bind(update.role_name)
    .bind(encoded_role_category)
    .bind(update.is_active)
    .bind(update.is_primary)
    .bind(update.actor_user_id)
    .fetch_optional(&mut *tx)
    .await?;

    let Some(updated_id) = updated_id else {
        tx.rollback().await?;
        return Ok(None);
    };

    tx.commit().await?;
    get_ward_staff_assignment(pool, facility_id, updated_id).await
}

pub async fn deactivate_ward_staff_assignment(
    pool: &PgPool,
    facility_id: Uuid,
    assignment_id: Uuid,
    actor_user_id: Uuid,
) -> anyhow::Result<Option<WardStaffAssignmentListItem>> {
    let id = observe_db_query(
        "ward.staff_assignments.deactivate",
        sqlx::query_scalar::<_, Uuid>(
            r#"
        UPDATE ward_staff_assignments
           SET is_active = FALSE,
               is_primary = FALSE,
               updated_by_user_id = $3,
               updated_at = now()
         WHERE facility_id = $1
           AND id = $2
        RETURNING id
        "#,
        )
        .bind(facility_id)
        .bind(assignment_id)
        .bind(actor_user_id)
        .fetch_optional(pool),
    )
    .await?;
    match id {
        Some(id) => get_ward_staff_assignment(pool, facility_id, id).await,
        None => Ok(None),
    }
}

async fn clear_primary_assignments_tx(
    tx: &mut sqlx::Transaction<'_, Postgres>,
    facility_id: Uuid,
    practitioner_id: Uuid,
    actor_user_id: Uuid,
    except_assignment_id: Option<Uuid>,
) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        UPDATE ward_staff_assignments
           SET is_primary = FALSE,
               updated_by_user_id = $4,
               updated_at = now()
         WHERE facility_id = $1
           AND practitioner_profile_id = $2
           AND is_active = TRUE
           AND is_primary = TRUE
           AND ($3::uuid IS NULL OR id <> $3)
        "#,
    )
    .bind(facility_id)
    .bind(practitioner_id)
    .bind(except_assignment_id)
    .bind(actor_user_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

fn assignment_select() -> &'static str {
    r#"
        SELECT ward_staff_assignments.id,
               ward_staff_assignments.ward_id,
               wards.name AS ward_name,
               ward_staff_assignments.practitioner_profile_id AS practitioner_id,
               users.display_name AS practitioner_name,
               staff_profiles.user_id,
               ward_staff_assignments.role_code,
               ward_staff_assignments.role_name,
               ward_staff_assignments.role_category,
               ward_staff_assignments.is_active,
               ward_staff_assignments.is_primary,
               ward_staff_assignments.assigned_at,
               ward_staff_assignments.assigned_by_user_id,
               assigned_by.display_name AS assigned_by_name
        FROM ward_staff_assignments
        JOIN wards
          ON wards.id = ward_staff_assignments.ward_id
         AND wards.facility_id = ward_staff_assignments.facility_id
        JOIN practitioner_profiles
          ON practitioner_profiles.id = ward_staff_assignments.practitioner_profile_id
         AND practitioner_profiles.facility_id = ward_staff_assignments.facility_id
        JOIN staff_profiles
          ON staff_profiles.id = practitioner_profiles.staff_id
         AND staff_profiles.facility_id = ward_staff_assignments.facility_id
        JOIN users
          ON users.id = staff_profiles.user_id
         AND users.facility_id = ward_staff_assignments.facility_id
        LEFT JOIN users AS assigned_by
          ON assigned_by.id = ward_staff_assignments.assigned_by_user_id
         AND assigned_by.facility_id = ward_staff_assignments.facility_id
    "#
}

fn ward_staff_from_row(row: WardStaffRow) -> anyhow::Result<WardStaffListItem> {
    Ok(WardStaffListItem {
        id: row.practitioner_id,
        practitioner_id: row.practitioner_id,
        user_id: row.user_id,
        full_name: row.full_name,
        role_name: row.role_name,
        role_category: codec::decode(&row.role_category)?,
    })
}

fn assignment_from_row(row: WardStaffAssignmentRow) -> anyhow::Result<WardStaffAssignmentListItem> {
    Ok(WardStaffAssignmentListItem {
        id: row.id,
        ward_id: row.ward_id,
        ward: row.ward_id,
        ward_name: row.ward_name,
        practitioner_id: row.practitioner_id,
        practitioner: row.practitioner_id,
        practitioner_name: row.practitioner_name,
        user_id: row.user_id,
        role_code: row.role_code.clone(),
        role: row.role_code,
        role_name: row.role_name,
        role_category: codec::decode(&row.role_category)?,
        is_active: row.is_active,
        is_primary: row.is_primary,
        assigned_at: row.assigned_at,
        assigned_by_user_id: row.assigned_by_user_id,
        assigned_by_name: row.assigned_by_name,
    })
}

fn my_assignment_from_row(row: MyWardBoardAssignmentRow) -> anyhow::Result<MyWardBoardAssignment> {
    Ok(MyWardBoardAssignment {
        assignment_id: row.assignment_id,
        ward_id: row.ward_id,
        ward_name: row.ward_name,
        role_name: row.role_name,
        role_category: codec::decode(&row.role_category)?,
        is_primary: row.is_primary,
    })
}
