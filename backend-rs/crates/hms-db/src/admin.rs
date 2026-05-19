use std::collections::HashMap;

use chrono::{DateTime, NaiveDate, Utc};
use hms_domain::admin::{
    AuditEventListItem, AuthorityAppointmentListItem, AuthorityAppointmentStatus,
    CommitteeListItem, CommitteeStatus, DelegationListItem, DelegationStatus,
    FeatureEntitlementListItem, OrgUnitType, OrganizationUnitListItem,
    PermissionAssignmentListItem, PermissionAssignmentStatus, PositionListItem, PositionStatus,
    PositionTemplateListItem, PractitionerListItem, PractitionerProfileSummary, StaffDirectoryItem,
    StaffListItem, UpdateStaffRequest,
};
use hms_domain::auth::{ActiveAuthority, AuthorityScope, AuthoritySource};
use hms_domain::capabilities::{feature_flags_for_profile, ALL_FEATURES};
use hms_domain::deployment::{DeploymentProfile, FeatureKey, PermissionCode};
use serde_json::{json, Value};
use sqlx::{FromRow, QueryBuilder};
use uuid::Uuid;

use crate::{codec, PgPool};

pub struct AdminCursor {
    pub occurred_at: DateTime<Utc>,
    pub id: Uuid,
}

pub struct NewOrganizationUnit {
    pub facility_id: Uuid,
    pub code: String,
    pub name: String,
    pub unit_type: OrgUnitType,
    pub parent_unit_id: Option<Uuid>,
}

pub struct NewPositionTemplate {
    pub facility_id: Uuid,
    pub code: String,
    pub title: String,
    pub description: String,
    pub permission_codes: Vec<PermissionCode>,
}

pub struct NewPosition {
    pub facility_id: Uuid,
    pub code: String,
    pub title: String,
    pub org_unit_id: Uuid,
    pub template_id: Option<Uuid>,
}

pub struct NewAuthorityAppointment {
    pub facility_id: Uuid,
    pub position_id: Uuid,
    pub user_id: Uuid,
    pub appointed_by_user_id: Uuid,
    pub appointment_type: String,
    pub starts_at: DateTime<Utc>,
    pub ends_at: Option<DateTime<Utc>>,
}

pub struct NewPermissionAssignment {
    pub facility_id: Uuid,
    pub grantee_user_id: Uuid,
    pub permission_code: PermissionCode,
    pub scope_type: String,
    pub scope_id: Option<Uuid>,
    pub granted_by_user_id: Uuid,
    pub starts_at: DateTime<Utc>,
    pub ends_at: Option<DateTime<Utc>>,
    pub reason_code: String,
}

pub struct NewCommittee {
    pub facility_id: Uuid,
    pub code: String,
    pub name: String,
    pub mandate: String,
}

pub struct NewDelegation {
    pub facility_id: Uuid,
    pub delegator_user_id: Uuid,
    pub delegate_user_id: Uuid,
    pub permission_code: PermissionCode,
    pub starts_at: DateTime<Utc>,
    pub ends_at: Option<DateTime<Utc>>,
    pub reason: String,
}

pub struct NewAuditEvent {
    pub facility_id: Uuid,
    pub actor_user_id: Option<Uuid>,
    pub request_id: Option<String>,
    pub event_type: String,
    pub resource_type: String,
    pub resource_id: Option<Uuid>,
    pub metadata: Value,
}

#[derive(Clone, Debug, Default)]
pub struct AuditEventFilters {
    pub search: Option<String>,
    pub category: Option<String>,
    pub action: Option<String>,
    pub start_date: Option<NaiveDate>,
    pub end_date: Option<NaiveDate>,
}

pub struct NewPractitionerProfile {
    pub license_number: String,
    pub specialization: String,
    pub qualification: String,
    pub fhir_practitioner_id: Option<String>,
}

pub struct NewStaffAccount {
    pub facility_id: Uuid,
    pub email: String,
    pub display_name: String,
    pub password_hash: String,
    pub employee_id: String,
    pub department: String,
    pub position: String,
    pub hire_date: NaiveDate,
    pub created_by_user_id: Uuid,
    pub practitioner_profile: Option<NewPractitionerProfile>,
}

#[derive(FromRow)]
struct OrganizationUnitRow {
    id: Uuid,
    code: String,
    name: String,
    unit_type: String,
    parent_unit_id: Option<Uuid>,
    parent_unit_name: Option<String>,
    is_active: bool,
    created_at: DateTime<Utc>,
}

#[derive(FromRow)]
struct PositionTemplateRow {
    id: Uuid,
    code: String,
    title: String,
    description: String,
    permission_codes: Vec<String>,
    created_at: DateTime<Utc>,
}

#[derive(FromRow)]
struct PositionRow {
    id: Uuid,
    code: String,
    title: String,
    org_unit_id: Uuid,
    org_unit_name: String,
    template_id: Option<Uuid>,
    status: String,
    created_at: DateTime<Utc>,
}

#[derive(FromRow)]
struct AuthorityAppointmentRow {
    id: Uuid,
    position_id: Uuid,
    position_title: String,
    user_id: Uuid,
    user_display_name: String,
    appointment_type: String,
    starts_at: DateTime<Utc>,
    ends_at: Option<DateTime<Utc>>,
    status: String,
    created_at: DateTime<Utc>,
}

#[derive(FromRow)]
struct ActiveAuthorityRow {
    source: String,
    source_id: Uuid,
    facility_id: Uuid,
    permission_code: Option<String>,
    scope_type: String,
    scope_id: Option<Uuid>,
    starts_at: DateTime<Utc>,
    ends_at: Option<DateTime<Utc>>,
}

#[derive(FromRow)]
struct PermissionAssignmentRow {
    id: Uuid,
    grantee_user_id: Uuid,
    grantee_display_name: String,
    permission_code: String,
    scope_type: String,
    scope_id: Option<Uuid>,
    starts_at: DateTime<Utc>,
    ends_at: Option<DateTime<Utc>>,
    status: String,
    created_at: DateTime<Utc>,
}

#[derive(FromRow)]
struct FacilityProfileRow {
    deployment_profile: String,
}

#[derive(FromRow)]
struct FeatureEntitlementRow {
    feature_key: String,
    enabled: bool,
    updated_at: DateTime<Utc>,
    updated_by_user_id: Option<Uuid>,
}

#[derive(FromRow)]
struct EffectiveFeatureFlagRow {
    deployment_profile: String,
    feature_key: Option<String>,
    enabled: Option<bool>,
}

#[derive(FromRow)]
struct StaffRow {
    id: Uuid,
    user_id: Uuid,
    email: String,
    display_name: String,
    employee_id: String,
    department: String,
    position: String,
    hire_date: NaiveDate,
    is_active: bool,
    password_change_required: bool,
    session_version: i64,
    permission_version: i64,
    practitioner_profile_id: Option<Uuid>,
    license_number: Option<String>,
    specialization: Option<String>,
    qualification: Option<String>,
    fhir_practitioner_id: Option<String>,
    created_at: DateTime<Utc>,
}

#[derive(FromRow)]
struct PractitionerRow {
    id: Uuid,
    staff_id: Uuid,
    user_id: Uuid,
    display_name: String,
    employee_id: String,
    license_number: String,
    specialization: String,
    qualification: String,
    fhir_practitioner_id: Option<String>,
    is_active: bool,
    created_at: DateTime<Utc>,
}

#[derive(FromRow)]
struct CommitteeRow {
    id: Uuid,
    code: String,
    name: String,
    mandate: String,
    status: String,
    created_at: DateTime<Utc>,
}

#[derive(FromRow)]
struct DelegationRow {
    id: Uuid,
    delegator_user_id: Uuid,
    delegator_display_name: String,
    delegate_user_id: Uuid,
    delegate_display_name: String,
    permission_code: String,
    starts_at: DateTime<Utc>,
    ends_at: Option<DateTime<Utc>>,
    status: String,
    reason: String,
    created_at: DateTime<Utc>,
}

#[derive(FromRow)]
struct AuditEventRow {
    id: Uuid,
    actor_user_id: Option<Uuid>,
    actor_display_name: Option<String>,
    request_id: Option<String>,
    event_type: String,
    resource_type: String,
    resource_id: Option<Uuid>,
    occurred_at: DateTime<Utc>,
}

pub async fn list_organization_units(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<AdminCursor>,
    limit: i64,
    unit_type: Option<OrgUnitType>,
    is_active: Option<bool>,
) -> anyhow::Result<Vec<OrganizationUnitListItem>> {
    let mut query = QueryBuilder::new(
        "SELECT organization_units.id,
                organization_units.code,
                organization_units.name,
                organization_units.unit_type,
                organization_units.parent_unit_id,
                parent.name AS parent_unit_name,
                organization_units.is_active,
                organization_units.created_at
         FROM organization_units
         LEFT JOIN organization_units parent ON parent.id = organization_units.parent_unit_id
         WHERE organization_units.facility_id = ",
    );
    query.push_bind(facility_id);
    if let Some(unit_type) = unit_type {
        query.push(" AND organization_units.unit_type = ");
        query.push_bind(codec::encode(unit_type)?);
    }
    if let Some(is_active) = is_active {
        query.push(" AND organization_units.is_active = ");
        query.push_bind(is_active);
    }
    append_cursor(
        &mut query,
        "organization_units.created_at",
        "organization_units.id",
        cursor,
    );
    query.push(" ORDER BY organization_units.created_at ASC, organization_units.id ASC LIMIT ");
    query.push_bind(limit);
    let rows = query
        .build_query_as::<OrganizationUnitRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(organization_unit_from_row).collect()
}

pub async fn create_organization_unit(
    pool: &PgPool,
    unit: NewOrganizationUnit,
) -> anyhow::Result<OrganizationUnitListItem> {
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO organization_units (id, facility_id, parent_unit_id, code, name, unit_type)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(id)
    .bind(unit.facility_id)
    .bind(unit.parent_unit_id)
    .bind(unit.code)
    .bind(unit.name)
    .bind(codec::encode(unit.unit_type)?)
    .execute(pool)
    .await?;
    get_organization_unit(pool, unit.facility_id, id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("organization unit was not found after write"))
}

pub async fn get_organization_unit_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<OrganizationUnitListItem>> {
    get_organization_unit(pool, facility_id, id).await
}

pub async fn list_organization_unit_children(
    pool: &PgPool,
    facility_id: Uuid,
    parent_unit_id: Uuid,
    cursor: Option<AdminCursor>,
    limit: i64,
) -> anyhow::Result<Vec<OrganizationUnitListItem>> {
    let mut query = QueryBuilder::new(
        "SELECT organization_units.id,
                organization_units.code,
                organization_units.name,
                organization_units.unit_type,
                organization_units.parent_unit_id,
                parent.name AS parent_unit_name,
                organization_units.is_active,
                organization_units.created_at
         FROM organization_units
         LEFT JOIN organization_units parent ON parent.id = organization_units.parent_unit_id
         WHERE organization_units.facility_id = ",
    );
    query.push_bind(facility_id);
    query.push(" AND organization_units.parent_unit_id = ");
    query.push_bind(parent_unit_id);
    append_cursor(
        &mut query,
        "organization_units.created_at",
        "organization_units.id",
        cursor,
    );
    query.push(" ORDER BY organization_units.created_at ASC, organization_units.id ASC LIMIT ");
    query.push_bind(limit);
    let rows = query
        .build_query_as::<OrganizationUnitRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(organization_unit_from_row).collect()
}

pub async fn list_organization_unit_ancestors(
    pool: &PgPool,
    facility_id: Uuid,
    unit_id: Uuid,
    limit: i64,
) -> anyhow::Result<Vec<OrganizationUnitListItem>> {
    let rows = sqlx::query_as::<_, OrganizationUnitRow>(
        "WITH RECURSIVE ancestors AS (
             SELECT parent.id,
                    parent.code,
                    parent.name,
                    parent.unit_type,
                    parent.parent_unit_id,
                    parent.is_active,
                    parent.created_at,
                    1 AS depth,
                    ARRAY[target.id, parent.id]::uuid[] AS path
             FROM organization_units target
             JOIN organization_units parent ON parent.id = target.parent_unit_id
             WHERE target.facility_id = $1
               AND target.id = $2
               AND parent.facility_id = $1
             UNION ALL
             SELECT parent.id,
                    parent.code,
                    parent.name,
                    parent.unit_type,
                    parent.parent_unit_id,
                    parent.is_active,
                    parent.created_at,
                    ancestors.depth + 1 AS depth,
                    ancestors.path || parent.id
             FROM organization_units parent
             JOIN ancestors ON ancestors.parent_unit_id = parent.id
             WHERE parent.facility_id = $1
               AND NOT parent.id = ANY(ancestors.path)
         )
         SELECT ancestors.id,
                ancestors.code,
                ancestors.name,
                ancestors.unit_type,
                ancestors.parent_unit_id,
                parent.name AS parent_unit_name,
                ancestors.is_active,
                ancestors.created_at
         FROM ancestors
         LEFT JOIN organization_units parent ON parent.id = ancestors.parent_unit_id
         ORDER BY ancestors.depth DESC
         LIMIT $3",
    )
    .bind(facility_id)
    .bind(unit_id)
    .bind(limit)
    .fetch_all(pool)
    .await?;
    rows.into_iter().map(organization_unit_from_row).collect()
}

pub async fn list_organization_unit_descendants(
    pool: &PgPool,
    facility_id: Uuid,
    unit_id: Uuid,
    cursor: Option<AdminCursor>,
    limit: i64,
) -> anyhow::Result<Vec<OrganizationUnitListItem>> {
    let mut query = QueryBuilder::new(
        "WITH RECURSIVE descendants AS (
             SELECT child.id,
                    child.code,
                    child.name,
                    child.unit_type,
                    child.parent_unit_id,
                    child.is_active,
                    child.created_at,
                    ARRAY[child.id]::uuid[] AS path
             FROM organization_units child
             WHERE child.facility_id = ",
    );
    query.push_bind(facility_id);
    query.push(" AND child.parent_unit_id = ");
    query.push_bind(unit_id);
    query.push(
        " UNION ALL
             SELECT child.id,
                    child.code,
                    child.name,
                    child.unit_type,
                    child.parent_unit_id,
                    child.is_active,
                    child.created_at,
                    descendants.path || child.id
             FROM organization_units child
             JOIN descendants ON child.parent_unit_id = descendants.id
             WHERE child.facility_id = ",
    );
    query.push_bind(facility_id);
    query.push(
        " AND NOT child.id = ANY(descendants.path)
         )
         SELECT descendants.id,
                descendants.code,
                descendants.name,
                descendants.unit_type,
                descendants.parent_unit_id,
                parent.name AS parent_unit_name,
                descendants.is_active,
                descendants.created_at
         FROM descendants
         LEFT JOIN organization_units parent ON parent.id = descendants.parent_unit_id
         WHERE TRUE",
    );
    append_cursor(
        &mut query,
        "descendants.created_at",
        "descendants.id",
        cursor,
    );
    query.push(" ORDER BY descendants.created_at ASC, descendants.id ASC LIMIT ");
    query.push_bind(limit);
    let rows = query
        .build_query_as::<OrganizationUnitRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(organization_unit_from_row).collect()
}

pub async fn list_position_templates(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<AdminCursor>,
    limit: i64,
) -> anyhow::Result<Vec<PositionTemplateListItem>> {
    let mut query = QueryBuilder::new(
        "SELECT id, code, title, description, permission_codes, created_at
         FROM position_templates
         WHERE facility_id = ",
    );
    query.push_bind(facility_id);
    append_cursor(&mut query, "created_at", "id", cursor);
    query.push(" ORDER BY created_at ASC, id ASC LIMIT ");
    query.push_bind(limit);
    let rows = query
        .build_query_as::<PositionTemplateRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(position_template_from_row).collect()
}

pub async fn create_position_template(
    pool: &PgPool,
    template: NewPositionTemplate,
) -> anyhow::Result<PositionTemplateListItem> {
    let id = Uuid::new_v4();
    let permission_codes = codec::encode_slice(&template.permission_codes)?;
    sqlx::query(
        "INSERT INTO position_templates (id, facility_id, code, title, description, permission_codes)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(id)
    .bind(template.facility_id)
    .bind(template.code)
    .bind(template.title)
    .bind(template.description)
    .bind(permission_codes)
    .execute(pool)
    .await?;
    get_position_template(pool, template.facility_id, id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("position template was not found after write"))
}

pub async fn list_positions(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<AdminCursor>,
    limit: i64,
) -> anyhow::Result<Vec<PositionListItem>> {
    let mut query = QueryBuilder::new(position_query());
    query.push(" WHERE positions.facility_id = ");
    query.push_bind(facility_id);
    append_cursor(&mut query, "positions.created_at", "positions.id", cursor);
    query.push(" ORDER BY positions.created_at ASC, positions.id ASC LIMIT ");
    query.push_bind(limit);
    let rows = query
        .build_query_as::<PositionRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(position_from_row).collect()
}

pub async fn create_position(
    pool: &PgPool,
    position: NewPosition,
) -> anyhow::Result<PositionListItem> {
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO positions (id, facility_id, org_unit_id, template_id, code, title, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(id)
    .bind(position.facility_id)
    .bind(position.org_unit_id)
    .bind(position.template_id)
    .bind(position.code)
    .bind(position.title)
    .bind(codec::encode(PositionStatus::Active)?)
    .execute(pool)
    .await?;
    get_position(pool, position.facility_id, id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("position was not found after write"))
}

pub async fn list_authority_appointments(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<AdminCursor>,
    limit: i64,
) -> anyhow::Result<Vec<AuthorityAppointmentListItem>> {
    let mut query = QueryBuilder::new(authority_appointment_query());
    query.push(" WHERE authority_appointments.facility_id = ");
    query.push_bind(facility_id);
    append_cursor(
        &mut query,
        "authority_appointments.created_at",
        "authority_appointments.id",
        cursor,
    );
    query.push(
        " ORDER BY authority_appointments.created_at ASC, authority_appointments.id ASC LIMIT ",
    );
    query.push_bind(limit);
    let rows = query
        .build_query_as::<AuthorityAppointmentRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter()
        .map(authority_appointment_from_row)
        .collect()
}

pub async fn create_authority_appointment(
    pool: &PgPool,
    appointment: NewAuthorityAppointment,
    request_id: Option<String>,
) -> anyhow::Result<AuthorityAppointmentListItem> {
    let id = Uuid::new_v4();
    let mut tx = pool.begin().await?;
    sqlx::query(
        "INSERT INTO authority_appointments (
            id, facility_id, position_id, user_id, appointed_by_user_id, appointment_type,
            starts_at, ends_at, status
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(id)
    .bind(appointment.facility_id)
    .bind(appointment.position_id)
    .bind(appointment.user_id)
    .bind(appointment.appointed_by_user_id)
    .bind(appointment.appointment_type)
    .bind(appointment.starts_at)
    .bind(appointment.ends_at)
    .bind(codec::encode(AuthorityAppointmentStatus::Active)?)
    .execute(&mut *tx)
    .await?;
    insert_audit_event_tx(
        &mut tx,
        NewAuditEvent {
            facility_id: appointment.facility_id,
            actor_user_id: Some(appointment.appointed_by_user_id),
            request_id,
            event_type: "admin.authority_appointment.created".to_owned(),
            resource_type: "authority_appointment".to_owned(),
            resource_id: Some(id),
            metadata: json!({}),
        },
    )
    .await?;
    tx.commit().await?;
    get_authority_appointment(pool, appointment.facility_id, id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("authority appointment was not found after write"))
}

pub async fn list_permission_assignments(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<AdminCursor>,
    limit: i64,
) -> anyhow::Result<Vec<PermissionAssignmentListItem>> {
    let mut query = QueryBuilder::new(permission_assignment_query());
    query.push(" WHERE permission_assignments.facility_id = ");
    query.push_bind(facility_id);
    append_cursor(
        &mut query,
        "permission_assignments.created_at",
        "permission_assignments.id",
        cursor,
    );
    query.push(
        " ORDER BY permission_assignments.created_at ASC, permission_assignments.id ASC LIMIT ",
    );
    query.push_bind(limit);
    let rows = query
        .build_query_as::<PermissionAssignmentRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter()
        .map(permission_assignment_from_row)
        .collect()
}

pub async fn active_authorities_for_user(
    pool: &PgPool,
    facility_id: Uuid,
    user_id: Uuid,
) -> anyhow::Result<Vec<ActiveAuthority>> {
    let rows = hms_observability::observe_db_query(
        "admin.active_authorities_for_user",
        sqlx::query_as::<_, ActiveAuthorityRow>(
            r#"
        SELECT 'position_appointment' AS source,
               authority_appointments.id AS source_id,
               authority_appointments.facility_id,
               authority_permissions.permission_code,
               'organization_unit' AS scope_type,
               positions.org_unit_id AS scope_id,
               authority_appointments.starts_at,
               authority_appointments.ends_at
        FROM authority_appointments
        JOIN positions ON positions.id = authority_appointments.position_id
        LEFT JOIN position_templates ON position_templates.id = positions.template_id
        LEFT JOIN LATERAL unnest(COALESCE(position_templates.permission_codes, '{}'::text[]))
            AS authority_permissions(permission_code) ON TRUE
        WHERE authority_appointments.facility_id = $1
          AND authority_appointments.user_id = $2
          AND authority_appointments.status = 'active'
          AND positions.status = 'active'
          AND authority_appointments.starts_at <= now()
          AND (authority_appointments.ends_at IS NULL OR authority_appointments.ends_at > now())

        UNION ALL

        SELECT 'permission_assignment' AS source,
               permission_assignments.id AS source_id,
               permission_assignments.facility_id,
               permission_assignments.permission_code,
               permission_assignments.scope_type,
               permission_assignments.scope_id,
               permission_assignments.starts_at,
               permission_assignments.ends_at
        FROM permission_assignments
        WHERE permission_assignments.facility_id = $1
          AND permission_assignments.grantee_user_id = $2
          AND permission_assignments.status = 'active'
          AND permission_assignments.starts_at <= now()
          AND (permission_assignments.ends_at IS NULL OR permission_assignments.ends_at > now())

        UNION ALL

        SELECT 'delegation' AS source,
               delegations.id AS source_id,
               delegations.facility_id,
               delegations.permission_code,
               'facility' AS scope_type,
               NULL::uuid AS scope_id,
               delegations.starts_at,
               delegations.ends_at
        FROM delegations
        WHERE delegations.facility_id = $1
          AND delegations.delegate_user_id = $2
          AND delegations.status = 'active'
          AND delegations.starts_at <= now()
          AND (delegations.ends_at IS NULL OR delegations.ends_at > now())
        ORDER BY starts_at ASC, source_id ASC, permission_code ASC NULLS LAST
        "#,
        )
        .bind(facility_id)
        .bind(user_id)
        .fetch_all(pool),
    )
    .await?;

    rows.into_iter().map(active_authority_from_row).collect()
}

pub async fn create_permission_assignment(
    pool: &PgPool,
    assignment: NewPermissionAssignment,
    request_id: Option<String>,
) -> anyhow::Result<PermissionAssignmentListItem> {
    let id = Uuid::new_v4();
    let permission_code = codec::encode(assignment.permission_code)?;
    let mut tx = pool.begin().await?;
    sqlx::query(
        "INSERT INTO permission_assignments (
            id, facility_id, grantee_user_id, permission_code, scope_type, scope_id,
            granted_by_user_id, starts_at, ends_at, status, reason_code
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
    )
    .bind(id)
    .bind(assignment.facility_id)
    .bind(assignment.grantee_user_id)
    .bind(&permission_code)
    .bind(assignment.scope_type)
    .bind(assignment.scope_id)
    .bind(assignment.granted_by_user_id)
    .bind(assignment.starts_at)
    .bind(assignment.ends_at)
    .bind(codec::encode(PermissionAssignmentStatus::Active)?)
    .bind(assignment.reason_code)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO user_permissions (user_id, permission_code)
         VALUES ($1, $2)
         ON CONFLICT (user_id, permission_code) DO NOTHING",
    )
    .bind(assignment.grantee_user_id)
    .bind(&permission_code)
    .execute(&mut *tx)
    .await?;
    sqlx::query("UPDATE users SET permission_version = permission_version + 1, updated_at = now() WHERE id = $1 AND facility_id = $2")
        .bind(assignment.grantee_user_id)
        .bind(assignment.facility_id)
        .execute(&mut *tx)
        .await?;
    insert_audit_event_tx(
        &mut tx,
        NewAuditEvent {
            facility_id: assignment.facility_id,
            actor_user_id: Some(assignment.granted_by_user_id),
            request_id,
            event_type: "admin.permission_assignment.created".to_owned(),
            resource_type: "permission_assignment".to_owned(),
            resource_id: Some(id),
            metadata: json!({ "permission_code": permission_code }),
        },
    )
    .await?;
    tx.commit().await?;
    get_permission_assignment(pool, assignment.facility_id, id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("permission assignment was not found after write"))
}

pub async fn list_feature_entitlements(
    pool: &PgPool,
    facility_id: Uuid,
) -> anyhow::Result<Vec<FeatureEntitlementListItem>> {
    let Some(profile) = facility_profile(pool, facility_id).await? else {
        return Ok(Vec::new());
    };
    let defaults = feature_flags_for_profile(profile);
    let overrides = feature_entitlement_overrides(pool, facility_id).await?;
    Ok(ALL_FEATURES
        .into_iter()
        .map(|feature| feature_entitlement_item(feature, &defaults, &overrides))
        .collect())
}

pub async fn effective_feature_flags(
    pool: &PgPool,
    facility_id: Uuid,
    fallback_profile: DeploymentProfile,
) -> anyhow::Result<HashMap<FeatureKey, bool>> {
    let rows = hms_observability::observe_db_query(
        "admin.effective_feature_flags",
        sqlx::query_as::<_, EffectiveFeatureFlagRow>(
            r#"
            SELECT facilities.deployment_profile,
                   facility_feature_entitlements.feature_key,
                   facility_feature_entitlements.enabled
            FROM facilities
            LEFT JOIN facility_feature_entitlements
              ON facility_feature_entitlements.facility_id = facilities.id
            WHERE facilities.id = $1
              AND facilities.is_active = TRUE
            "#,
        )
        .bind(facility_id)
        .fetch_all(pool),
    )
    .await?;
    let profile = rows
        .first()
        .map(|row| codec::decode(&row.deployment_profile))
        .transpose()?
        .unwrap_or(fallback_profile);
    let mut flags = feature_flags_for_profile(profile);
    for row in rows {
        if let (Some(feature), Some(enabled)) = (row.feature_key, row.enabled) {
            flags.insert(codec::decode(&feature)?, enabled);
        }
    }
    Ok(flags)
}

pub async fn update_feature_entitlement(
    pool: &PgPool,
    facility_id: Uuid,
    feature: FeatureKey,
    enabled: bool,
    actor_user_id: Uuid,
    request_id: Option<String>,
) -> anyhow::Result<Option<FeatureEntitlementListItem>> {
    let Some(profile) = facility_profile(pool, facility_id).await? else {
        return Ok(None);
    };
    let feature_key = codec::encode(feature)?;
    let mut tx = pool.begin().await?;
    sqlx::query(
        r#"
        INSERT INTO facility_feature_entitlements (
            facility_id,
            feature_key,
            enabled,
            updated_by_user_id
        )
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (facility_id, feature_key) DO UPDATE
        SET enabled = EXCLUDED.enabled,
            updated_by_user_id = EXCLUDED.updated_by_user_id,
            updated_at = now()
        "#,
    )
    .bind(facility_id)
    .bind(&feature_key)
    .bind(enabled)
    .bind(actor_user_id)
    .execute(&mut *tx)
    .await?;

    insert_audit_event_tx(
        &mut tx,
        NewAuditEvent {
            facility_id,
            actor_user_id: Some(actor_user_id),
            request_id,
            event_type: "admin.feature_entitlement.updated".to_owned(),
            resource_type: "feature_entitlement".to_owned(),
            resource_id: None,
            metadata: json!({
                "feature": feature_key,
                "enabled": enabled,
            }),
        },
    )
    .await?;

    tx.commit().await?;
    let defaults = feature_flags_for_profile(profile);
    let overrides = feature_entitlement_overrides(pool, facility_id).await?;
    Ok(Some(feature_entitlement_item(
        feature, &defaults, &overrides,
    )))
}

pub async fn delete_feature_entitlement(
    pool: &PgPool,
    facility_id: Uuid,
    feature: FeatureKey,
    actor_user_id: Uuid,
    request_id: Option<String>,
) -> anyhow::Result<Option<FeatureEntitlementListItem>> {
    let Some(profile) = facility_profile(pool, facility_id).await? else {
        return Ok(None);
    };
    let feature_key = codec::encode(feature)?;
    let mut tx = pool.begin().await?;
    sqlx::query(
        r#"
        DELETE FROM facility_feature_entitlements
        WHERE facility_id = $1
          AND feature_key = $2
        "#,
    )
    .bind(facility_id)
    .bind(&feature_key)
    .execute(&mut *tx)
    .await?;

    insert_audit_event_tx(
        &mut tx,
        NewAuditEvent {
            facility_id,
            actor_user_id: Some(actor_user_id),
            request_id,
            event_type: "admin.feature_entitlement.deleted".to_owned(),
            resource_type: "feature_entitlement".to_owned(),
            resource_id: None,
            metadata: json!({
                "feature": feature_key,
            }),
        },
    )
    .await?;

    tx.commit().await?;
    let defaults = feature_flags_for_profile(profile);
    let overrides = feature_entitlement_overrides(pool, facility_id).await?;
    Ok(Some(feature_entitlement_item(
        feature, &defaults, &overrides,
    )))
}

pub async fn list_staff_accounts(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<AdminCursor>,
    limit: i64,
    search: Option<String>,
    is_active: Option<bool>,
    practitioners_only: Option<bool>,
) -> anyhow::Result<Vec<StaffListItem>> {
    let mut query = QueryBuilder::new(staff_query());
    query.push(" WHERE staff_profiles.facility_id = ");
    query.push_bind(facility_id);
    if let Some(pattern) = like_contains_pattern(search.as_deref()) {
        query.push(" AND (users.display_name ILIKE ");
        query.push_bind(pattern.clone());
        query.push(" ESCAPE '\\' OR users.email ILIKE ");
        query.push_bind(pattern.clone());
        query.push(" ESCAPE '\\' OR staff_profiles.employee_id ILIKE ");
        query.push_bind(pattern.clone());
        query.push(" ESCAPE '\\' OR staff_profiles.department ILIKE ");
        query.push_bind(pattern.clone());
        query.push(" ESCAPE '\\' OR staff_profiles.position ILIKE ");
        query.push_bind(pattern);
        query.push(" ESCAPE '\\')");
    }
    if let Some(is_active) = is_active {
        query.push(" AND users.is_active = ");
        query.push_bind(is_active);
    }
    if practitioners_only == Some(true) {
        query.push(" AND practitioner_profiles.id IS NOT NULL");
    }
    append_cursor(
        &mut query,
        "staff_profiles.created_at",
        "staff_profiles.id",
        cursor,
    );
    query.push(" ORDER BY staff_profiles.created_at ASC, staff_profiles.id ASC LIMIT ");
    query.push_bind(limit);
    let rows = query.build_query_as::<StaffRow>().fetch_all(pool).await?;
    rows.into_iter().map(staff_from_row).collect()
}

pub async fn list_staff_directory(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<AdminCursor>,
    limit: i64,
) -> anyhow::Result<Vec<StaffDirectoryItem>> {
    let mut query = QueryBuilder::new(staff_query());
    query.push(" WHERE staff_profiles.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND users.is_active = true");
    append_cursor(
        &mut query,
        "staff_profiles.created_at",
        "staff_profiles.id",
        cursor,
    );
    query.push(" ORDER BY staff_profiles.created_at ASC, staff_profiles.id ASC LIMIT ");
    query.push_bind(limit);
    let rows = query.build_query_as::<StaffRow>().fetch_all(pool).await?;
    Ok(rows.into_iter().map(staff_directory_from_row).collect())
}

pub async fn get_staff_account(
    pool: &PgPool,
    facility_id: Uuid,
    staff_id: Uuid,
) -> anyhow::Result<Option<StaffListItem>> {
    let mut query = QueryBuilder::new(staff_query());
    query.push(" WHERE staff_profiles.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND staff_profiles.id = ");
    query.push_bind(staff_id);
    let row = query
        .build_query_as::<StaffRow>()
        .fetch_optional(pool)
        .await?;
    row.map(staff_from_row).transpose()
}

pub async fn create_staff_account(
    pool: &PgPool,
    staff: NewStaffAccount,
    request_id: Option<String>,
) -> anyhow::Result<StaffListItem> {
    let staff_id = Uuid::new_v4();
    let user_id = Uuid::new_v4();
    let mut tx = pool.begin().await?;
    sqlx::query(
        r#"
        INSERT INTO users (
            id,
            facility_id,
            email,
            display_name,
            password_hash,
            password_change_required
        )
        VALUES ($1, $2, $3, $4, $5, TRUE)
        "#,
    )
    .bind(user_id)
    .bind(staff.facility_id)
    .bind(staff.email.trim().to_lowercase())
    .bind(staff.display_name.trim())
    .bind(staff.password_hash)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO user_permissions (user_id, permission_code) VALUES ($1, $2)
         ON CONFLICT (user_id, permission_code) DO NOTHING",
    )
    .bind(user_id)
    .bind(codec::encode(PermissionCode::AuthMeView)?)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO staff_profiles (
            id,
            facility_id,
            user_id,
            employee_id,
            department,
            position,
            hire_date,
            created_by_user_id,
            updated_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
        "#,
    )
    .bind(staff_id)
    .bind(staff.facility_id)
    .bind(user_id)
    .bind(staff.employee_id.trim())
    .bind(staff.department.trim())
    .bind(staff.position.trim())
    .bind(staff.hire_date)
    .bind(staff.created_by_user_id)
    .execute(&mut *tx)
    .await?;

    if let Some(profile) = staff.practitioner_profile {
        insert_practitioner_profile_tx(
            &mut tx,
            staff.facility_id,
            staff_id,
            staff.created_by_user_id,
            profile,
        )
        .await?;
    }

    insert_audit_event_tx(
        &mut tx,
        NewAuditEvent {
            facility_id: staff.facility_id,
            actor_user_id: Some(staff.created_by_user_id),
            request_id,
            event_type: "admin.staff.created".to_owned(),
            resource_type: "staff".to_owned(),
            resource_id: Some(staff_id),
            metadata: json!({}),
        },
    )
    .await?;
    tx.commit().await?;
    get_staff_account(pool, staff.facility_id, staff_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("staff account was not found after write"))
}

pub async fn update_staff_account(
    pool: &PgPool,
    facility_id: Uuid,
    staff_id: Uuid,
    update: UpdateStaffRequest,
    actor_user_id: Uuid,
    request_id: Option<String>,
) -> anyhow::Result<Option<StaffListItem>> {
    let Some(staff) = get_staff_account(pool, facility_id, staff_id).await? else {
        return Ok(None);
    };

    let display_name = update.display_name.map(|value| value.trim().to_owned());
    let department = update.department.map(|value| value.trim().to_owned());
    let position = update.position.map(|value| value.trim().to_owned());

    let mut tx = pool.begin().await?;
    sqlx::query(
        "UPDATE users
         SET display_name = COALESCE($1, display_name),
             updated_at = now()
         WHERE id = $2 AND facility_id = $3",
    )
    .bind(display_name)
    .bind(staff.user_id)
    .bind(facility_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE staff_profiles
         SET department = COALESCE($1, department),
             position = COALESCE($2, position),
             updated_by_user_id = $3,
             updated_at = now()
         WHERE id = $4 AND facility_id = $5",
    )
    .bind(department)
    .bind(position)
    .bind(actor_user_id)
    .bind(staff_id)
    .bind(facility_id)
    .execute(&mut *tx)
    .await?;
    insert_audit_event_tx(
        &mut tx,
        NewAuditEvent {
            facility_id,
            actor_user_id: Some(actor_user_id),
            request_id,
            event_type: "admin.staff.updated".to_owned(),
            resource_type: "staff".to_owned(),
            resource_id: Some(staff_id),
            metadata: json!({}),
        },
    )
    .await?;
    tx.commit().await?;
    get_staff_account(pool, facility_id, staff_id).await
}

pub async fn upsert_practitioner_profile(
    pool: &PgPool,
    facility_id: Uuid,
    staff_id: Uuid,
    actor_user_id: Uuid,
    profile: NewPractitionerProfile,
    request_id: Option<String>,
) -> anyhow::Result<Option<StaffListItem>> {
    if get_staff_account(pool, facility_id, staff_id)
        .await?
        .is_none()
    {
        return Ok(None);
    }

    let mut tx = pool.begin().await?;
    insert_practitioner_profile_tx(&mut tx, facility_id, staff_id, actor_user_id, profile).await?;
    insert_audit_event_tx(
        &mut tx,
        NewAuditEvent {
            facility_id,
            actor_user_id: Some(actor_user_id),
            request_id,
            event_type: "admin.practitioner_profile.upserted".to_owned(),
            resource_type: "staff".to_owned(),
            resource_id: Some(staff_id),
            metadata: json!({}),
        },
    )
    .await?;
    tx.commit().await?;
    get_staff_account(pool, facility_id, staff_id).await
}

pub async fn force_staff_password_reset(
    pool: &PgPool,
    facility_id: Uuid,
    staff_id: Uuid,
    actor_user_id: Uuid,
    request_id: Option<String>,
) -> anyhow::Result<Option<StaffListItem>> {
    let Some(staff) = get_staff_account(pool, facility_id, staff_id).await? else {
        return Ok(None);
    };

    let mut tx = pool.begin().await?;
    sqlx::query(
        "UPDATE users
         SET password_change_required = TRUE,
             session_version = session_version + 1,
             updated_at = now()
         WHERE id = $1 AND facility_id = $2",
    )
    .bind(staff.user_id)
    .bind(facility_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE refresh_sessions
         SET revoked_at = COALESCE(revoked_at, now()),
             revoked_reason = COALESCE(revoked_reason, 'admin_forced_password_reset')
         WHERE user_id = $1 AND facility_id = $2",
    )
    .bind(staff.user_id)
    .bind(facility_id)
    .execute(&mut *tx)
    .await?;
    insert_audit_event_tx(
        &mut tx,
        NewAuditEvent {
            facility_id,
            actor_user_id: Some(actor_user_id),
            request_id,
            event_type: "admin.staff.password_reset_forced".to_owned(),
            resource_type: "staff".to_owned(),
            resource_id: Some(staff_id),
            metadata: json!({}),
        },
    )
    .await?;
    tx.commit().await?;
    get_staff_account(pool, facility_id, staff_id).await
}

pub async fn deactivate_staff_account(
    pool: &PgPool,
    facility_id: Uuid,
    staff_id: Uuid,
    actor_user_id: Uuid,
    request_id: Option<String>,
) -> anyhow::Result<Option<StaffListItem>> {
    set_staff_active(
        pool,
        facility_id,
        staff_id,
        actor_user_id,
        false,
        "admin.staff.deactivated",
        request_id,
    )
    .await
}

pub async fn reactivate_staff_account(
    pool: &PgPool,
    facility_id: Uuid,
    staff_id: Uuid,
    actor_user_id: Uuid,
    request_id: Option<String>,
) -> anyhow::Result<Option<StaffListItem>> {
    set_staff_active(
        pool,
        facility_id,
        staff_id,
        actor_user_id,
        true,
        "admin.staff.reactivated",
        request_id,
    )
    .await
}

pub async fn list_practitioners(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<AdminCursor>,
    limit: i64,
    search: Option<String>,
    is_active: Option<bool>,
) -> anyhow::Result<Vec<PractitionerListItem>> {
    let mut query = QueryBuilder::new(practitioner_query());
    query.push(" WHERE practitioner_profiles.facility_id = ");
    query.push_bind(facility_id);
    if let Some(pattern) = like_contains_pattern(search.as_deref()) {
        query.push(" AND (users.display_name ILIKE ");
        query.push_bind(pattern.clone());
        query.push(" ESCAPE '\\' OR staff_profiles.employee_id ILIKE ");
        query.push_bind(pattern.clone());
        query.push(" ESCAPE '\\' OR practitioner_profiles.license_number ILIKE ");
        query.push_bind(pattern.clone());
        query.push(" ESCAPE '\\' OR practitioner_profiles.specialization ILIKE ");
        query.push_bind(pattern.clone());
        query.push(" ESCAPE '\\' OR practitioner_profiles.qualification ILIKE ");
        query.push_bind(pattern);
        query.push(" ESCAPE '\\')");
    }
    if let Some(is_active) = is_active {
        query.push(" AND users.is_active = ");
        query.push_bind(is_active);
    }
    append_cursor(
        &mut query,
        "practitioner_profiles.created_at",
        "practitioner_profiles.id",
        cursor,
    );
    query.push(
        " ORDER BY practitioner_profiles.created_at ASC, practitioner_profiles.id ASC LIMIT ",
    );
    query.push_bind(limit);
    let rows = query
        .build_query_as::<PractitionerRow>()
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().map(practitioner_from_row).collect())
}

pub async fn get_practitioner(
    pool: &PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<PractitionerListItem>> {
    let mut query = QueryBuilder::new(practitioner_query());
    query.push(" WHERE practitioner_profiles.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND (practitioner_profiles.id = ");
    query.push_bind(id);
    query.push(" OR practitioner_profiles.staff_id = ");
    query.push_bind(id);
    query.push(")");
    let row = query
        .build_query_as::<PractitionerRow>()
        .fetch_optional(pool)
        .await?;
    Ok(row.map(practitioner_from_row))
}

pub async fn list_committees(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<AdminCursor>,
    limit: i64,
) -> anyhow::Result<Vec<CommitteeListItem>> {
    let mut query = QueryBuilder::new(
        "SELECT id, code, name, mandate, status, created_at
         FROM committees
         WHERE facility_id = ",
    );
    query.push_bind(facility_id);
    append_cursor(&mut query, "created_at", "id", cursor);
    query.push(" ORDER BY created_at ASC, id ASC LIMIT ");
    query.push_bind(limit);
    let rows = query
        .build_query_as::<CommitteeRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(committee_from_row).collect()
}

pub async fn create_committee(
    pool: &PgPool,
    committee: NewCommittee,
) -> anyhow::Result<CommitteeListItem> {
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO committees (id, facility_id, code, name, mandate, status)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(id)
    .bind(committee.facility_id)
    .bind(committee.code)
    .bind(committee.name)
    .bind(committee.mandate)
    .bind(codec::encode(CommitteeStatus::Active)?)
    .execute(pool)
    .await?;
    get_committee(pool, committee.facility_id, id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("committee was not found after write"))
}

pub async fn list_delegations(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<AdminCursor>,
    limit: i64,
) -> anyhow::Result<Vec<DelegationListItem>> {
    let mut query = QueryBuilder::new(delegation_query());
    query.push(" WHERE delegations.facility_id = ");
    query.push_bind(facility_id);
    append_cursor(
        &mut query,
        "delegations.created_at",
        "delegations.id",
        cursor,
    );
    query.push(" ORDER BY delegations.created_at ASC, delegations.id ASC LIMIT ");
    query.push_bind(limit);
    let rows = query
        .build_query_as::<DelegationRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(delegation_from_row).collect()
}

pub async fn create_delegation(
    pool: &PgPool,
    delegation: NewDelegation,
    request_id: Option<String>,
) -> anyhow::Result<DelegationListItem> {
    let id = Uuid::new_v4();
    let permission_code = codec::encode(delegation.permission_code)?;
    let mut tx = pool.begin().await?;
    sqlx::query(
        "INSERT INTO delegations (
            id, facility_id, delegator_user_id, delegate_user_id, permission_code,
            starts_at, ends_at, status, reason
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(id)
    .bind(delegation.facility_id)
    .bind(delegation.delegator_user_id)
    .bind(delegation.delegate_user_id)
    .bind(&permission_code)
    .bind(delegation.starts_at)
    .bind(delegation.ends_at)
    .bind(codec::encode(DelegationStatus::Active)?)
    .bind(delegation.reason)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO user_permissions (user_id, permission_code)
         VALUES ($1, $2)
         ON CONFLICT (user_id, permission_code) DO NOTHING",
    )
    .bind(delegation.delegate_user_id)
    .bind(&permission_code)
    .execute(&mut *tx)
    .await?;
    sqlx::query("UPDATE users SET permission_version = permission_version + 1, updated_at = now() WHERE id = $1 AND facility_id = $2")
        .bind(delegation.delegate_user_id)
        .bind(delegation.facility_id)
        .execute(&mut *tx)
        .await?;
    insert_audit_event_tx(
        &mut tx,
        NewAuditEvent {
            facility_id: delegation.facility_id,
            actor_user_id: Some(delegation.delegator_user_id),
            request_id,
            event_type: "admin.delegation.created".to_owned(),
            resource_type: "delegation".to_owned(),
            resource_id: Some(id),
            metadata: json!({ "permission_code": permission_code }),
        },
    )
    .await?;
    tx.commit().await?;
    get_delegation(pool, delegation.facility_id, id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("delegation was not found after write"))
}

pub async fn list_audit_events(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<AdminCursor>,
    limit: i64,
    filters: AuditEventFilters,
) -> anyhow::Result<Vec<AuditEventListItem>> {
    let mut query = QueryBuilder::new(
        "SELECT audit_events.id,
                audit_events.actor_user_id,
                users.display_name AS actor_display_name,
                audit_events.request_id,
                audit_events.event_type,
                audit_events.resource_type,
                audit_events.resource_id,
                audit_events.occurred_at
         FROM audit_events
         LEFT JOIN users ON users.id = audit_events.actor_user_id
         WHERE audit_events.facility_id = ",
    );
    query.push_bind(facility_id);
    if let Some(pattern) = like_contains_pattern(filters.search.as_deref()) {
        query.push(" AND (audit_events.event_type ILIKE ");
        query.push_bind(pattern.clone());
        query.push(" ESCAPE '\\' OR audit_events.resource_type ILIKE ");
        query.push_bind(pattern.clone());
        query.push(" ESCAPE '\\' OR audit_events.resource_id::text ILIKE ");
        query.push_bind(pattern.clone());
        query.push(" ESCAPE '\\' OR audit_events.request_id ILIKE ");
        query.push_bind(pattern.clone());
        query.push(" ESCAPE '\\' OR users.display_name ILIKE ");
        query.push_bind(pattern);
        query.push(" ESCAPE '\\')");
    }
    if let Some(start_date) = filters.start_date {
        let starts_at = start_date
            .and_hms_opt(0, 0, 0)
            .expect("valid audit start date")
            .and_utc();
        query.push(" AND audit_events.occurred_at >= ");
        query.push_bind(starts_at);
    }
    if let Some(end_date) = filters.end_date {
        let ends_before = end_date
            .succ_opt()
            .and_then(|next| next.and_hms_opt(0, 0, 0))
            .expect("valid audit end date")
            .and_utc();
        query.push(" AND audit_events.occurred_at < ");
        query.push_bind(ends_before);
    }
    push_audit_category_filter(&mut query, filters.category.as_deref());
    push_audit_action_filter(&mut query, filters.action.as_deref());
    if let Some(cursor) = cursor {
        query.push(" AND (audit_events.occurred_at, audit_events.id) < (");
        query.push_bind(cursor.occurred_at);
        query.push(", ");
        query.push_bind(cursor.id);
        query.push(")");
    }
    query.push(" ORDER BY audit_events.occurred_at DESC, audit_events.id DESC LIMIT ");
    query.push_bind(limit);
    let rows = query
        .build_query_as::<AuditEventRow>()
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().map(audit_event_from_row).collect())
}

fn push_audit_category_filter(
    query: &mut QueryBuilder<'_, sqlx::Postgres>,
    category: Option<&str>,
) {
    let Some(terms) = audit_category_terms(category) else {
        return;
    };
    query.push(" AND (");
    for (index, term) in terms.iter().enumerate() {
        if index > 0 {
            query.push(" OR ");
        }
        let pattern = format!("%{term}%");
        query.push("audit_events.resource_type ILIKE ");
        query.push_bind(pattern.clone());
        query.push(" OR audit_events.event_type ILIKE ");
        query.push_bind(pattern);
    }
    query.push(")");
}

fn push_audit_action_filter(query: &mut QueryBuilder<'_, sqlx::Postgres>, action: Option<&str>) {
    let Some(terms) = audit_action_terms(action) else {
        return;
    };
    query.push(" AND (");
    for (index, term) in terms.iter().enumerate() {
        if index > 0 {
            query.push(" OR ");
        }
        query.push("audit_events.event_type ILIKE ");
        query.push_bind(format!("%{term}%"));
    }
    query.push(")");
}

fn audit_category_terms(category: Option<&str>) -> Option<&'static [&'static str]> {
    match category?.trim().to_ascii_uppercase().as_str() {
        "" | "ALL" => None,
        "ADMIN" => Some(&[
            "admin",
            "authority",
            "committee",
            "delegation",
            "feature",
            "org",
            "permission",
            "position",
            "staff",
        ]),
        "AUTHENTICATION" => Some(&["auth", "login", "logout", "password", "session"]),
        "PATIENT" => Some(&["patient"]),
        "CLINICAL" => Some(&["allergy", "clinical", "note", "prescription", "problem"]),
        "ENCOUNTER" => Some(&["encounter", "triage", "visit"]),
        "WARD" => Some(&["admission", "bed", "discharge", "transfer", "ward"]),
        "APPOINTMENT" => Some(&["appointment", "schedule"]),
        "LABORATORY" => Some(&["lab", "result", "specimen"]),
        "BILLING" => Some(&["billing", "claim", "invoice", "nhis", "payment"]),
        "PHARMACY" => Some(&["controlled", "dispense", "medication", "pharmacy"]),
        "NURSING" => Some(&["handoff", "nursing", "vitals"]),
        "REFERRAL" => Some(&["referral", "waitlist"]),
        _ => None,
    }
}

fn audit_action_terms(action: Option<&str>) -> Option<&'static [&'static str]> {
    match action?.trim().to_ascii_uppercase().as_str() {
        "" | "ALL" => None,
        "CREATE" => Some(&["assigned", "created", "granted"]),
        "READ" => Some(&["read", "viewed"]),
        "UPDATE" => Some(&["approved", "completed", "fulfilled", "revoked", "updated"]),
        "DELETE" => Some(&["deleted", "removed"]),
        "ADMISSION" => Some(&["admission", "admitted"]),
        "DISCHARGE" => Some(&["discharge", "discharged"]),
        "TRANSFER" => Some(&["transfer", "transferred"]),
        "CANCEL" => Some(&["cancel", "cancelled", "canceled"]),
        _ => None,
    }
}

pub async fn insert_audit_event(pool: &PgPool, event: NewAuditEvent) -> anyhow::Result<()> {
    sqlx::query(
        "INSERT INTO audit_events (
            id, facility_id, actor_user_id, request_id, event_type, resource_type, resource_id, metadata
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(Uuid::new_v4())
    .bind(event.facility_id)
    .bind(event.actor_user_id)
    .bind(event.request_id)
    .bind(event.event_type)
    .bind(event.resource_type)
    .bind(event.resource_id)
    .bind(event.metadata)
    .execute(pool)
    .await?;
    Ok(())
}

async fn insert_audit_event_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    event: NewAuditEvent,
) -> anyhow::Result<()> {
    sqlx::query(
        "INSERT INTO audit_events (
            id, facility_id, actor_user_id, request_id, event_type, resource_type, resource_id, metadata
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(Uuid::new_v4())
    .bind(event.facility_id)
    .bind(event.actor_user_id)
    .bind(event.request_id)
    .bind(event.event_type)
    .bind(event.resource_type)
    .bind(event.resource_id)
    .bind(event.metadata)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn facility_profile(
    pool: &PgPool,
    facility_id: Uuid,
) -> anyhow::Result<Option<DeploymentProfile>> {
    let row = sqlx::query_as::<_, FacilityProfileRow>(
        "SELECT deployment_profile FROM facilities WHERE id = $1 AND is_active = TRUE",
    )
    .bind(facility_id)
    .fetch_optional(pool)
    .await?;
    row.map(|row| codec::decode(&row.deployment_profile))
        .transpose()
}

async fn feature_entitlement_overrides(
    pool: &PgPool,
    facility_id: Uuid,
) -> anyhow::Result<HashMap<FeatureKey, FeatureEntitlementRow>> {
    let rows = sqlx::query_as::<_, FeatureEntitlementRow>(
        r#"
        SELECT feature_key,
               enabled,
               updated_at,
               updated_by_user_id
        FROM facility_feature_entitlements
        WHERE facility_id = $1
        "#,
    )
    .bind(facility_id)
    .fetch_all(pool)
    .await?;

    let mut overrides = HashMap::new();
    for row in rows {
        let feature = codec::decode(&row.feature_key)?;
        overrides.insert(feature, row);
    }
    Ok(overrides)
}

fn feature_entitlement_item(
    feature: FeatureKey,
    defaults: &HashMap<FeatureKey, bool>,
    overrides: &HashMap<FeatureKey, FeatureEntitlementRow>,
) -> FeatureEntitlementListItem {
    let profile_default = defaults.get(&feature).copied().unwrap_or(false);
    let override_row = overrides.get(&feature);
    FeatureEntitlementListItem {
        feature,
        enabled: override_row
            .map(|row| row.enabled)
            .unwrap_or(profile_default),
        profile_default,
        override_enabled: override_row.map(|row| row.enabled),
        updated_at: override_row.map(|row| row.updated_at),
        updated_by_user_id: override_row.and_then(|row| row.updated_by_user_id),
    }
}

async fn insert_practitioner_profile_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    facility_id: Uuid,
    staff_id: Uuid,
    actor_user_id: Uuid,
    profile: NewPractitionerProfile,
) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO practitioner_profiles (
            id,
            facility_id,
            staff_id,
            license_number,
            specialization,
            qualification,
            fhir_practitioner_id,
            created_by_user_id,
            updated_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
        ON CONFLICT (staff_id) DO UPDATE
        SET license_number = EXCLUDED.license_number,
            specialization = EXCLUDED.specialization,
            qualification = EXCLUDED.qualification,
            fhir_practitioner_id = EXCLUDED.fhir_practitioner_id,
            updated_by_user_id = EXCLUDED.updated_by_user_id,
            updated_at = now()
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(facility_id)
    .bind(staff_id)
    .bind(profile.license_number.trim())
    .bind(profile.specialization.trim())
    .bind(profile.qualification.trim())
    .bind(
        profile
            .fhir_practitioner_id
            .map(|value| value.trim().to_owned()),
    )
    .bind(actor_user_id)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

async fn set_staff_active(
    pool: &PgPool,
    facility_id: Uuid,
    staff_id: Uuid,
    actor_user_id: Uuid,
    is_active: bool,
    event_type: &'static str,
    request_id: Option<String>,
) -> anyhow::Result<Option<StaffListItem>> {
    let Some(staff) = get_staff_account(pool, facility_id, staff_id).await? else {
        return Ok(None);
    };

    let mut tx = pool.begin().await?;
    sqlx::query(
        "UPDATE users
         SET is_active = $3,
             session_version = session_version + 1,
             updated_at = now()
         WHERE id = $1 AND facility_id = $2",
    )
    .bind(staff.user_id)
    .bind(facility_id)
    .bind(is_active)
    .execute(&mut *tx)
    .await?;
    if !is_active {
        sqlx::query(
            "UPDATE refresh_sessions
             SET revoked_at = COALESCE(revoked_at, now()),
                 revoked_reason = COALESCE(revoked_reason, 'admin_staff_deactivated')
             WHERE user_id = $1 AND facility_id = $2",
        )
        .bind(staff.user_id)
        .bind(facility_id)
        .execute(&mut *tx)
        .await?;
    }
    insert_audit_event_tx(
        &mut tx,
        NewAuditEvent {
            facility_id,
            actor_user_id: Some(actor_user_id),
            request_id,
            event_type: event_type.to_owned(),
            resource_type: "staff".to_owned(),
            resource_id: Some(staff_id),
            metadata: json!({ "active": is_active }),
        },
    )
    .await?;
    tx.commit().await?;
    get_staff_account(pool, facility_id, staff_id).await
}

async fn get_organization_unit(
    pool: &PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<OrganizationUnitListItem>> {
    let row = sqlx::query_as::<_, OrganizationUnitRow>(
        "SELECT organization_units.id,
                organization_units.code,
                organization_units.name,
                organization_units.unit_type,
                organization_units.parent_unit_id,
                parent.name AS parent_unit_name,
                organization_units.is_active,
                organization_units.created_at
         FROM organization_units
         LEFT JOIN organization_units parent ON parent.id = organization_units.parent_unit_id
         WHERE organization_units.facility_id = $1 AND organization_units.id = $2",
    )
    .bind(facility_id)
    .bind(id)
    .fetch_optional(pool)
    .await?;
    row.map(organization_unit_from_row).transpose()
}

async fn get_position_template(
    pool: &PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<PositionTemplateListItem>> {
    let row = sqlx::query_as::<_, PositionTemplateRow>(
        "SELECT id, code, title, description, permission_codes, created_at
         FROM position_templates
         WHERE facility_id = $1 AND id = $2",
    )
    .bind(facility_id)
    .bind(id)
    .fetch_optional(pool)
    .await?;
    row.map(position_template_from_row).transpose()
}

async fn get_position(
    pool: &PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<PositionListItem>> {
    let mut query = QueryBuilder::new(position_query());
    query.push(" WHERE positions.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND positions.id = ");
    query.push_bind(id);
    let row = query
        .build_query_as::<PositionRow>()
        .fetch_optional(pool)
        .await?;
    row.map(position_from_row).transpose()
}

async fn get_authority_appointment(
    pool: &PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<AuthorityAppointmentListItem>> {
    let mut query = QueryBuilder::new(authority_appointment_query());
    query.push(" WHERE authority_appointments.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND authority_appointments.id = ");
    query.push_bind(id);
    let row = query
        .build_query_as::<AuthorityAppointmentRow>()
        .fetch_optional(pool)
        .await?;
    row.map(authority_appointment_from_row).transpose()
}

async fn get_permission_assignment(
    pool: &PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<PermissionAssignmentListItem>> {
    let mut query = QueryBuilder::new(permission_assignment_query());
    query.push(" WHERE permission_assignments.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND permission_assignments.id = ");
    query.push_bind(id);
    let row = query
        .build_query_as::<PermissionAssignmentRow>()
        .fetch_optional(pool)
        .await?;
    row.map(permission_assignment_from_row).transpose()
}

async fn get_committee(
    pool: &PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<CommitteeListItem>> {
    let row = sqlx::query_as::<_, CommitteeRow>(
        "SELECT id, code, name, mandate, status, created_at
         FROM committees
         WHERE facility_id = $1 AND id = $2",
    )
    .bind(facility_id)
    .bind(id)
    .fetch_optional(pool)
    .await?;
    row.map(committee_from_row).transpose()
}

async fn get_delegation(
    pool: &PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<DelegationListItem>> {
    let mut query = QueryBuilder::new(delegation_query());
    query.push(" WHERE delegations.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND delegations.id = ");
    query.push_bind(id);
    let row = query
        .build_query_as::<DelegationRow>()
        .fetch_optional(pool)
        .await?;
    row.map(delegation_from_row).transpose()
}

fn append_cursor(
    query: &mut QueryBuilder<'_, sqlx::Postgres>,
    time_column: &str,
    id_column: &str,
    cursor: Option<AdminCursor>,
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

fn staff_query() -> &'static str {
    "SELECT staff_profiles.id,
            staff_profiles.user_id,
            users.email,
            users.display_name,
            staff_profiles.employee_id,
            staff_profiles.department,
            staff_profiles.position,
            staff_profiles.hire_date,
            users.is_active,
            users.password_change_required,
            users.session_version,
            users.permission_version,
            practitioner_profiles.id AS practitioner_profile_id,
            practitioner_profiles.license_number,
            practitioner_profiles.specialization,
            practitioner_profiles.qualification,
            practitioner_profiles.fhir_practitioner_id,
            staff_profiles.created_at
     FROM staff_profiles
     JOIN users ON users.id = staff_profiles.user_id
     LEFT JOIN practitioner_profiles ON practitioner_profiles.staff_id = staff_profiles.id"
}

fn practitioner_query() -> &'static str {
    "SELECT practitioner_profiles.id,
            practitioner_profiles.staff_id,
            staff_profiles.user_id,
            users.display_name,
            staff_profiles.employee_id,
            practitioner_profiles.license_number,
            practitioner_profiles.specialization,
            practitioner_profiles.qualification,
            practitioner_profiles.fhir_practitioner_id,
            users.is_active,
            practitioner_profiles.created_at
     FROM practitioner_profiles
     JOIN staff_profiles ON staff_profiles.id = practitioner_profiles.staff_id
     JOIN users ON users.id = staff_profiles.user_id"
}

fn position_query() -> &'static str {
    "SELECT positions.id,
            positions.code,
            positions.title,
            positions.org_unit_id,
            organization_units.name AS org_unit_name,
            positions.template_id,
            positions.status,
            positions.created_at
     FROM positions
     JOIN organization_units ON organization_units.id = positions.org_unit_id"
}

fn authority_appointment_query() -> &'static str {
    "SELECT authority_appointments.id,
            authority_appointments.position_id,
            positions.title AS position_title,
            authority_appointments.user_id,
            users.display_name AS user_display_name,
            authority_appointments.appointment_type,
            authority_appointments.starts_at,
            authority_appointments.ends_at,
            authority_appointments.status,
            authority_appointments.created_at
     FROM authority_appointments
     JOIN positions ON positions.id = authority_appointments.position_id
     JOIN users ON users.id = authority_appointments.user_id"
}

fn permission_assignment_query() -> &'static str {
    "SELECT permission_assignments.id,
            permission_assignments.grantee_user_id,
            users.display_name AS grantee_display_name,
            permission_assignments.permission_code,
            permission_assignments.scope_type,
            permission_assignments.scope_id,
            permission_assignments.starts_at,
            permission_assignments.ends_at,
            permission_assignments.status,
            permission_assignments.created_at
     FROM permission_assignments
     JOIN users ON users.id = permission_assignments.grantee_user_id"
}

fn delegation_query() -> &'static str {
    "SELECT delegations.id,
            delegations.delegator_user_id,
            delegator.display_name AS delegator_display_name,
            delegations.delegate_user_id,
            delegate.display_name AS delegate_display_name,
            delegations.permission_code,
            delegations.starts_at,
            delegations.ends_at,
            delegations.status,
            delegations.reason,
            delegations.created_at
     FROM delegations
     JOIN users delegator ON delegator.id = delegations.delegator_user_id
     JOIN users delegate ON delegate.id = delegations.delegate_user_id"
}

fn organization_unit_from_row(
    row: OrganizationUnitRow,
) -> anyhow::Result<OrganizationUnitListItem> {
    Ok(OrganizationUnitListItem {
        id: row.id,
        code: row.code,
        name: row.name,
        unit_type: codec::decode(&row.unit_type)?,
        parent_unit_id: row.parent_unit_id,
        parent_unit_name: row.parent_unit_name,
        is_active: row.is_active,
        created_at: row.created_at,
    })
}

fn position_template_from_row(
    row: PositionTemplateRow,
) -> anyhow::Result<PositionTemplateListItem> {
    let permission_codes = row
        .permission_codes
        .iter()
        .map(|value| codec::decode(value))
        .collect::<anyhow::Result<Vec<PermissionCode>>>()?;
    Ok(PositionTemplateListItem {
        id: row.id,
        code: row.code,
        title: row.title,
        description: row.description,
        permission_codes,
        created_at: row.created_at,
    })
}

fn position_from_row(row: PositionRow) -> anyhow::Result<PositionListItem> {
    Ok(PositionListItem {
        id: row.id,
        code: row.code,
        title: row.title,
        org_unit_id: row.org_unit_id,
        org_unit_name: row.org_unit_name,
        template_id: row.template_id,
        status: codec::decode(&row.status)?,
        created_at: row.created_at,
    })
}

fn authority_appointment_from_row(
    row: AuthorityAppointmentRow,
) -> anyhow::Result<AuthorityAppointmentListItem> {
    Ok(AuthorityAppointmentListItem {
        id: row.id,
        position_id: row.position_id,
        position_title: row.position_title,
        user_id: row.user_id,
        user_display_name: row.user_display_name,
        appointment_type: row.appointment_type,
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        status: codec::decode(&row.status)?,
        created_at: row.created_at,
    })
}

fn active_authority_from_row(row: ActiveAuthorityRow) -> anyhow::Result<ActiveAuthority> {
    let source = match row.source.as_str() {
        "position_appointment" => AuthoritySource::PositionAppointment,
        "permission_assignment" => AuthoritySource::PermissionAssignment,
        "delegation" => AuthoritySource::Delegation,
        other => anyhow::bail!("unsupported authority source: {other}"),
    };
    let permission_code = row
        .permission_code
        .as_deref()
        .map(codec::decode)
        .transpose()?;
    Ok(ActiveAuthority {
        source,
        source_id: row.source_id,
        facility_id: row.facility_id,
        permission_code,
        scope: AuthorityScope {
            scope_type: row.scope_type,
            scope_id: row.scope_id,
        },
        starts_at: row.starts_at,
        ends_at: row.ends_at,
    })
}

fn permission_assignment_from_row(
    row: PermissionAssignmentRow,
) -> anyhow::Result<PermissionAssignmentListItem> {
    Ok(PermissionAssignmentListItem {
        id: row.id,
        grantee_user_id: row.grantee_user_id,
        grantee_display_name: row.grantee_display_name,
        permission_code: codec::decode(&row.permission_code)?,
        scope_type: row.scope_type,
        scope_id: row.scope_id,
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        status: codec::decode(&row.status)?,
        created_at: row.created_at,
    })
}

fn staff_from_row(row: StaffRow) -> anyhow::Result<StaffListItem> {
    let practitioner_profile =
        if let (Some(id), Some(license_number), Some(specialization), Some(qualification)) = (
            row.practitioner_profile_id,
            row.license_number,
            row.specialization,
            row.qualification,
        ) {
            Some(PractitionerProfileSummary {
                id,
                license_number,
                specialization,
                qualification,
                fhir_practitioner_id: row.fhir_practitioner_id,
            })
        } else {
            None
        };

    Ok(StaffListItem {
        id: row.id,
        user_id: row.user_id,
        email: row.email,
        display_name: row.display_name,
        employee_id: row.employee_id,
        department: row.department,
        position: row.position,
        hire_date: row.hire_date,
        is_active: row.is_active,
        password_change_required: row.password_change_required,
        session_version: row.session_version,
        permission_version: row.permission_version,
        practitioner_profile,
        created_at: row.created_at,
    })
}

fn staff_directory_from_row(row: StaffRow) -> StaffDirectoryItem {
    StaffDirectoryItem {
        user_id: row.user_id,
        email: row.email,
        display_name: row.display_name,
        employee_id: row.employee_id,
        department: row.department,
        position: row.position,
        created_at: row.created_at,
    }
}

fn practitioner_from_row(row: PractitionerRow) -> PractitionerListItem {
    PractitionerListItem {
        id: row.id,
        staff_id: row.staff_id,
        user_id: row.user_id,
        display_name: row.display_name,
        employee_id: row.employee_id,
        license_number: row.license_number,
        specialization: row.specialization,
        qualification: row.qualification,
        fhir_practitioner_id: row.fhir_practitioner_id,
        is_active: row.is_active,
        created_at: row.created_at,
    }
}

fn committee_from_row(row: CommitteeRow) -> anyhow::Result<CommitteeListItem> {
    Ok(CommitteeListItem {
        id: row.id,
        code: row.code,
        name: row.name,
        mandate: row.mandate,
        status: codec::decode(&row.status)?,
        created_at: row.created_at,
    })
}

fn delegation_from_row(row: DelegationRow) -> anyhow::Result<DelegationListItem> {
    Ok(DelegationListItem {
        id: row.id,
        delegator_user_id: row.delegator_user_id,
        delegator_display_name: row.delegator_display_name,
        delegate_user_id: row.delegate_user_id,
        delegate_display_name: row.delegate_display_name,
        permission_code: codec::decode(&row.permission_code)?,
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        status: codec::decode(&row.status)?,
        reason: row.reason,
        created_at: row.created_at,
    })
}

fn audit_event_from_row(row: AuditEventRow) -> AuditEventListItem {
    AuditEventListItem {
        id: row.id,
        actor_user_id: row.actor_user_id,
        actor_display_name: row.actor_display_name,
        request_id: row.request_id,
        event_type: row.event_type,
        resource_type: row.resource_type,
        resource_id: row.resource_id,
        occurred_at: row.occurred_at,
    }
}
