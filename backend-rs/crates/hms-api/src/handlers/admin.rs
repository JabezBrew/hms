use axum::extract::{Path, Query, State};
use axum::Json;
use chrono::{DateTime, Utc};
use hms_access::require_permission;
use hms_db::admin::AdminCursor;
use hms_domain::admin::{
    AdminLimitQuery, AdminListQuery, AuditEventListItem, AuthorityAppointmentListItem,
    CommitteeListItem, CreateAuthorityAppointmentRequest, CreateCommitteeRequest,
    CreateDelegationRequest, CreateOrganizationUnitRequest, CreatePermissionAssignmentRequest,
    CreatePositionRequest, CreatePositionTemplateRequest, CreateStaffRequest, DelegationListItem,
    FeatureEntitlementListItem, OrganizationUnitListItem, OrganizationUnitListQuery,
    PermissionAssignmentListItem, PositionListItem, PositionTemplateListItem, PractitionerListItem,
    PractitionerListQuery, StaffDirectoryItem, StaffListItem, StaffListQuery,
    UpdateFeatureEntitlementRequest, UpdateStaffRequest, UpsertPractitionerProfileRequest,
};
use hms_domain::auth::AuthUser;
use hms_domain::deployment::{FeatureKey, PermissionCode};
use uuid::Uuid;

use crate::error::{ApiError, ApiErrorResponse};
use crate::extractors::AuthenticatedUser;
use crate::middleware::request_id::current_request_id;
use crate::response::{list, object, ListResponse, ObjectResponse, PageInfo};
use crate::state::AppState;

const DEFAULT_LIMIT: u8 = 25;
const MAX_LIMIT: u8 = 100;
const MAX_CODE_LEN: usize = 48;
const MAX_NAME_LEN: usize = 160;
const MAX_TEXT_LEN: usize = 240;
const MAX_EMAIL_LEN: usize = 254;

#[utoipa::path(get, path = "/api/v2/admin/org-units", operation_id = "getAdminOrgUnits", tag = "admin", security(("bearerAuth" = [])), params(OrganizationUnitListQuery), responses((status = 200, body = ListResponse<OrganizationUnitListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_org_units(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<OrganizationUnitListQuery>,
) -> Result<Json<ListResponse<OrganizationUnitListItem>>, ApiError> {
    require_admin_access(&user, state.facility_id())?;
    let unit_type = query.unit_type;
    let is_active = query.is_active;
    let (cursor, page_size) = page_request(AdminListQuery {
        cursor: query.cursor,
        limit: query.limit,
    })?;
    let rows = state
        .list_organization_units(cursor, page_size as i64 + 1, unit_type, is_active)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "org_unit_list_failed",
                "Organization units could not be loaded.",
            )
        })?;
    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.created_at, item.id)
    })))
}

#[utoipa::path(post, path = "/api/v2/admin/org-units", operation_id = "postAdminOrgUnits", tag = "admin", security(("bearerAuth" = [])), request_body = CreateOrganizationUnitRequest, responses((status = 200, body = ObjectResponse<OrganizationUnitListItem>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn create_org_unit(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(payload): Json<CreateOrganizationUnitRequest>,
) -> Result<Json<ObjectResponse<OrganizationUnitListItem>>, ApiError> {
    require_admin_access(&user, state.facility_id())?;
    validate_code(&payload.code)?;
    validate_text(&payload.name, MAX_NAME_LEN, "name")?;
    let unit = state.create_organization_unit(payload).await.map_err(|_| {
        ApiError::conflict(
            "org_unit_create_failed",
            "Organization unit could not be saved.",
        )
    })?;
    Ok(Json(object(unit)))
}

#[utoipa::path(get, path = "/api/v2/admin/org-units/{id}", operation_id = "getAdminOrgUnitById", tag = "admin", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Organization unit ID")), responses((status = 200, body = ObjectResponse<OrganizationUnitListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn get_org_unit(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<OrganizationUnitListItem>>, ApiError> {
    require_admin_access(&user, state.facility_id())?;
    let unit = state
        .get_organization_unit(id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "org_unit_load_failed",
                "Organization unit could not be loaded.",
            )
        })?
        .ok_or_else(|| {
            ApiError::not_found("org_unit_not_found", "Organization unit was not found.")
        })?;
    Ok(Json(object(unit)))
}

#[utoipa::path(get, path = "/api/v2/admin/org-units/{id}/children", operation_id = "getAdminOrgUnitChildren", tag = "admin", security(("bearerAuth" = [])), params(AdminListQuery, ("id" = Uuid, Path, description = "Organization unit ID")), responses((status = 200, body = ListResponse<OrganizationUnitListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn list_org_unit_children(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
    Query(query): Query<AdminListQuery>,
) -> Result<Json<ListResponse<OrganizationUnitListItem>>, ApiError> {
    require_admin_access(&user, state.facility_id())?;
    let _parent = state
        .get_organization_unit(id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "org_unit_load_failed",
                "Organization unit could not be loaded.",
            )
        })?
        .ok_or_else(|| {
            ApiError::not_found("org_unit_not_found", "Organization unit was not found.")
        })?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_organization_unit_children(id, cursor, page_size as i64 + 1)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "org_unit_children_failed",
                "Organization unit children could not be loaded.",
            )
        })?;
    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.created_at, item.id)
    })))
}

#[utoipa::path(get, path = "/api/v2/admin/org-units/{id}/ancestors", operation_id = "getAdminOrgUnitAncestors", tag = "admin", security(("bearerAuth" = [])), params(AdminLimitQuery, ("id" = Uuid, Path, description = "Organization unit ID")), responses((status = 200, body = ListResponse<OrganizationUnitListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn list_org_unit_ancestors(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
    Query(query): Query<AdminLimitQuery>,
) -> Result<Json<ListResponse<OrganizationUnitListItem>>, ApiError> {
    require_admin_access(&user, state.facility_id())?;
    let page_size = query.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let _unit = state
        .get_organization_unit(id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "org_unit_load_failed",
                "Organization unit could not be loaded.",
            )
        })?
        .ok_or_else(|| {
            ApiError::not_found("org_unit_not_found", "Organization unit was not found.")
        })?;
    let rows = state
        .list_organization_unit_ancestors(id, page_size as i64)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "org_unit_ancestors_failed",
                "Organization unit ancestors could not be loaded.",
            )
        })?;
    Ok(Json(list(
        rows,
        PageInfo {
            next_cursor: None,
            has_next: false,
            limit: page_size,
        },
    )))
}

#[utoipa::path(get, path = "/api/v2/admin/org-units/{id}/descendants", operation_id = "getAdminOrgUnitDescendants", tag = "admin", security(("bearerAuth" = [])), params(AdminListQuery, ("id" = Uuid, Path, description = "Organization unit ID")), responses((status = 200, body = ListResponse<OrganizationUnitListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn list_org_unit_descendants(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
    Query(query): Query<AdminListQuery>,
) -> Result<Json<ListResponse<OrganizationUnitListItem>>, ApiError> {
    require_admin_access(&user, state.facility_id())?;
    let _unit = state
        .get_organization_unit(id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "org_unit_load_failed",
                "Organization unit could not be loaded.",
            )
        })?
        .ok_or_else(|| {
            ApiError::not_found("org_unit_not_found", "Organization unit was not found.")
        })?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_organization_unit_descendants(id, cursor, page_size as i64 + 1)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "org_unit_descendants_failed",
                "Organization unit descendants could not be loaded.",
            )
        })?;
    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.created_at, item.id)
    })))
}

#[utoipa::path(get, path = "/api/v2/admin/position-templates", operation_id = "getAdminPositionTemplates", tag = "admin", security(("bearerAuth" = [])), params(AdminListQuery), responses((status = 200, body = ListResponse<PositionTemplateListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_position_templates(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<AdminListQuery>,
) -> Result<Json<ListResponse<PositionTemplateListItem>>, ApiError> {
    require_admin_access(&user, state.facility_id())?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_position_templates(cursor, page_size as i64 + 1)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "position_template_list_failed",
                "Position templates could not be loaded.",
            )
        })?;
    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.created_at, item.id)
    })))
}

#[utoipa::path(post, path = "/api/v2/admin/position-templates", operation_id = "postAdminPositionTemplates", tag = "admin", security(("bearerAuth" = [])), request_body = CreatePositionTemplateRequest, responses((status = 200, body = ObjectResponse<PositionTemplateListItem>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn create_position_template(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(payload): Json<CreatePositionTemplateRequest>,
) -> Result<Json<ObjectResponse<PositionTemplateListItem>>, ApiError> {
    require_admin_access(&user, state.facility_id())?;
    validate_code(&payload.code)?;
    validate_text(&payload.title, MAX_NAME_LEN, "title")?;
    validate_text(&payload.description, MAX_TEXT_LEN, "description")?;
    ensure_supported_permissions(&state, &payload.permission_codes).await?;
    let template = state.create_position_template(payload).await.map_err(|_| {
        ApiError::conflict(
            "position_template_create_failed",
            "Position template could not be saved.",
        )
    })?;
    Ok(Json(object(template)))
}

#[utoipa::path(get, path = "/api/v2/admin/positions", operation_id = "getAdminPositions", tag = "admin", security(("bearerAuth" = [])), params(AdminListQuery), responses((status = 200, body = ListResponse<PositionListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_positions(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<AdminListQuery>,
) -> Result<Json<ListResponse<PositionListItem>>, ApiError> {
    require_admin_access(&user, state.facility_id())?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_positions(cursor, page_size as i64 + 1)
        .await
        .map_err(|_| {
            ApiError::conflict("position_list_failed", "Positions could not be loaded.")
        })?;
    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.created_at, item.id)
    })))
}

#[utoipa::path(post, path = "/api/v2/admin/positions", operation_id = "postAdminPositions", tag = "admin", security(("bearerAuth" = [])), request_body = CreatePositionRequest, responses((status = 200, body = ObjectResponse<PositionListItem>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn create_position(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(payload): Json<CreatePositionRequest>,
) -> Result<Json<ObjectResponse<PositionListItem>>, ApiError> {
    require_admin_access(&user, state.facility_id())?;
    validate_code(&payload.code)?;
    validate_text(&payload.title, MAX_NAME_LEN, "title")?;
    let position = state.create_position(payload).await.map_err(|_| {
        ApiError::conflict("position_create_failed", "Position could not be saved.")
    })?;
    Ok(Json(object(position)))
}

#[utoipa::path(get, path = "/api/v2/admin/authority-appointments", operation_id = "getAdminAuthorityAppointments", tag = "admin", security(("bearerAuth" = [])), params(AdminListQuery), responses((status = 200, body = ListResponse<AuthorityAppointmentListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_authority_appointments(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<AdminListQuery>,
) -> Result<Json<ListResponse<AuthorityAppointmentListItem>>, ApiError> {
    require_admin_access(&user, state.facility_id())?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_authority_appointments(cursor, page_size as i64 + 1)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "authority_appointment_list_failed",
                "Authority appointments could not be loaded.",
            )
        })?;
    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.created_at, item.id)
    })))
}

#[utoipa::path(post, path = "/api/v2/admin/authority-appointments", operation_id = "postAdminAuthorityAppointments", tag = "admin", security(("bearerAuth" = [])), request_body = CreateAuthorityAppointmentRequest, responses((status = 200, body = ObjectResponse<AuthorityAppointmentListItem>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn create_authority_appointment(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(payload): Json<CreateAuthorityAppointmentRequest>,
) -> Result<Json<ObjectResponse<AuthorityAppointmentListItem>>, ApiError> {
    require_admin_access(&user, state.facility_id())?;
    validate_text(&payload.appointment_type, MAX_CODE_LEN, "appointment_type")?;
    validate_time_window(payload.starts_at, payload.ends_at)?;
    let appointment = state
        .create_authority_appointment(payload, user.id, Some(current_request_id()))
        .await
        .map_err(|_| {
            ApiError::conflict(
                "authority_appointment_create_failed",
                "Authority appointment could not be saved.",
            )
        })?;
    Ok(Json(object(appointment)))
}

#[utoipa::path(get, path = "/api/v2/admin/permission-assignments", operation_id = "getAdminPermissionAssignments", tag = "admin", security(("bearerAuth" = [])), params(AdminListQuery), responses((status = 200, body = ListResponse<PermissionAssignmentListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_permission_assignments(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<AdminListQuery>,
) -> Result<Json<ListResponse<PermissionAssignmentListItem>>, ApiError> {
    require_admin_access(&user, state.facility_id())?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_permission_assignments(cursor, page_size as i64 + 1)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "permission_assignment_list_failed",
                "Permission assignments could not be loaded.",
            )
        })?;
    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.created_at, item.id)
    })))
}

#[utoipa::path(post, path = "/api/v2/admin/permission-assignments", operation_id = "postAdminPermissionAssignments", tag = "admin", security(("bearerAuth" = [])), request_body = CreatePermissionAssignmentRequest, responses((status = 200, body = ObjectResponse<PermissionAssignmentListItem>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn create_permission_assignment(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(payload): Json<CreatePermissionAssignmentRequest>,
) -> Result<Json<ObjectResponse<PermissionAssignmentListItem>>, ApiError> {
    require_admin_access(&user, state.facility_id())?;
    validate_text(&payload.scope_type, MAX_CODE_LEN, "scope_type")?;
    validate_text(&payload.reason_code, MAX_CODE_LEN, "reason_code")?;
    validate_time_window(payload.starts_at, payload.ends_at)?;
    ensure_supported_permissions(&state, &[payload.permission_code]).await?;
    let assignment = state
        .create_permission_assignment(payload, user.id, Some(current_request_id()))
        .await
        .map_err(|_| {
            ApiError::conflict(
                "permission_assignment_create_failed",
                "Permission assignment could not be saved.",
            )
        })?;
    Ok(Json(object(assignment)))
}

#[utoipa::path(get, path = "/api/v2/admin/features", operation_id = "getAdminFeatures", tag = "admin", security(("bearerAuth" = [])), responses((status = 200, body = ListResponse<FeatureEntitlementListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_feature_entitlements(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<Json<ListResponse<FeatureEntitlementListItem>>, ApiError> {
    require_feature_entitlement_access(&user, state.facility_id())?;
    let rows = state.list_feature_entitlements().await.map_err(|_| {
        ApiError::conflict(
            "feature_entitlement_list_failed",
            "Feature entitlements could not be loaded.",
        )
    })?;
    Ok(Json(list(
        rows,
        PageInfo {
            next_cursor: None,
            has_next: false,
            limit: 25,
        },
    )))
}

#[utoipa::path(patch, path = "/api/v2/admin/features/{key}", operation_id = "patchAdminFeature", tag = "admin", security(("bearerAuth" = [])), params(("key" = FeatureKey, Path, description = "Feature key")), request_body = UpdateFeatureEntitlementRequest, responses((status = 200, body = ObjectResponse<FeatureEntitlementListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn update_feature_entitlement(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(key): Path<FeatureKey>,
    Json(payload): Json<UpdateFeatureEntitlementRequest>,
) -> Result<Json<ObjectResponse<FeatureEntitlementListItem>>, ApiError> {
    require_feature_entitlement_access(&user, state.facility_id())?;
    let entitlement = state
        .update_feature_entitlement(key, payload.enabled, user.id, Some(current_request_id()))
        .await
        .map_err(|_| {
            ApiError::conflict(
                "feature_entitlement_update_failed",
                "Feature entitlement could not be updated.",
            )
        })?
        .ok_or_else(|| ApiError::not_found("feature_not_found", "Feature was not found."))?;
    Ok(Json(object(entitlement)))
}

#[utoipa::path(get, path = "/api/v2/admin/staff", operation_id = "getAdminStaff", tag = "admin", security(("bearerAuth" = [])), params(StaffListQuery), responses((status = 200, body = ListResponse<StaffListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_staff(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<StaffListQuery>,
) -> Result<Json<ListResponse<StaffListItem>>, ApiError> {
    require_staff_access(&user, state.facility_id())?;
    let search = query.search;
    let is_active = query.is_active;
    let practitioners_only = query.practitioners_only;
    let (cursor, page_size) = page_request(AdminListQuery {
        cursor: query.cursor,
        limit: query.limit,
    })?;
    let rows = state
        .list_staff_accounts(
            cursor,
            page_size as i64 + 1,
            search,
            is_active,
            practitioners_only,
        )
        .await
        .map_err(|_| ApiError::conflict("staff_list_failed", "Staff could not be loaded."))?;
    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.created_at, item.id)
    })))
}

#[utoipa::path(get, path = "/api/v2/staff/directory", operation_id = "getStaffDirectory", tag = "staff", security(("bearerAuth" = [])), params(AdminListQuery), responses((status = 200, body = ListResponse<StaffDirectoryItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_staff_directory(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<AdminListQuery>,
) -> Result<Json<ListResponse<StaffDirectoryItem>>, ApiError> {
    require_staff_directory_access(&user, state.facility_id())?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_staff_directory(cursor, page_size as i64 + 1)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "staff_directory_failed",
                "Staff directory could not be loaded.",
            )
        })?;
    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.created_at, item.user_id)
    })))
}

#[utoipa::path(post, path = "/api/v2/admin/staff", operation_id = "postAdminStaff", tag = "admin", security(("bearerAuth" = [])), request_body = CreateStaffRequest, responses((status = 200, body = ObjectResponse<StaffListItem>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 409, body = ApiErrorResponse)))]
pub async fn create_staff(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(payload): Json<CreateStaffRequest>,
) -> Result<Json<ObjectResponse<StaffListItem>>, ApiError> {
    require_staff_access(&user, state.facility_id())?;
    validate_staff_payload(&payload)?;
    let staff = state
        .create_staff_account(payload, user.id, Some(current_request_id()))
        .await
        .map_err(|_| {
            ApiError::conflict("staff_create_failed", "Staff account could not be saved.")
        })?;
    Ok(Json(object(staff)))
}

#[utoipa::path(get, path = "/api/v2/admin/staff/{id}", operation_id = "getAdminStaffById", tag = "admin", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Staff profile ID")), responses((status = 200, body = ObjectResponse<StaffListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn get_staff(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<StaffListItem>>, ApiError> {
    require_staff_access(&user, state.facility_id())?;
    let staff = state
        .get_staff_account(id)
        .await
        .map_err(|_| ApiError::conflict("staff_load_failed", "Staff account could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("staff_not_found", "Staff account was not found."))?;
    Ok(Json(object(staff)))
}

#[utoipa::path(patch, path = "/api/v2/admin/staff/{id}", operation_id = "patchAdminStaff", tag = "admin", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Staff profile ID")), request_body = UpdateStaffRequest, responses((status = 200, body = ObjectResponse<StaffListItem>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse), (status = 409, body = ApiErrorResponse)))]
pub async fn update_staff(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateStaffRequest>,
) -> Result<Json<ObjectResponse<StaffListItem>>, ApiError> {
    require_staff_access(&user, state.facility_id())?;
    validate_staff_update_payload(&payload)?;
    let staff = state
        .update_staff_account(id, payload, user.id, Some(current_request_id()))
        .await
        .map_err(|_| {
            ApiError::conflict("staff_update_failed", "Staff account could not be updated.")
        })?
        .ok_or_else(|| ApiError::not_found("staff_not_found", "Staff account was not found."))?;
    Ok(Json(object(staff)))
}

#[utoipa::path(post, path = "/api/v2/admin/staff/{id}/force-password-reset", operation_id = "postAdminStaffForcePasswordReset", tag = "admin", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Staff profile ID")), responses((status = 200, body = ObjectResponse<StaffListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn force_staff_password_reset(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<StaffListItem>>, ApiError> {
    require_staff_access(&user, state.facility_id())?;
    let staff = state
        .force_staff_password_reset(id, user.id, Some(current_request_id()))
        .await
        .map_err(|_| {
            ApiError::conflict(
                "staff_reset_failed",
                "Staff password reset could not be forced.",
            )
        })?
        .ok_or_else(|| ApiError::not_found("staff_not_found", "Staff account was not found."))?;
    Ok(Json(object(staff)))
}

#[utoipa::path(post, path = "/api/v2/admin/staff/{id}/deactivate", operation_id = "postAdminStaffDeactivate", tag = "admin", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Staff profile ID")), responses((status = 200, body = ObjectResponse<StaffListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn deactivate_staff(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<StaffListItem>>, ApiError> {
    require_staff_access(&user, state.facility_id())?;
    let staff = state
        .deactivate_staff_account(id, user.id, Some(current_request_id()))
        .await
        .map_err(|_| {
            ApiError::conflict(
                "staff_deactivate_failed",
                "Staff account could not be deactivated.",
            )
        })?
        .ok_or_else(|| ApiError::not_found("staff_not_found", "Staff account was not found."))?;
    Ok(Json(object(staff)))
}

#[utoipa::path(post, path = "/api/v2/admin/staff/{id}/reactivate", operation_id = "postAdminStaffReactivate", tag = "admin", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Staff profile ID")), responses((status = 200, body = ObjectResponse<StaffListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn reactivate_staff(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<StaffListItem>>, ApiError> {
    require_staff_access(&user, state.facility_id())?;
    let staff = state
        .reactivate_staff_account(id, user.id, Some(current_request_id()))
        .await
        .map_err(|_| {
            ApiError::conflict(
                "staff_reactivate_failed",
                "Staff account could not be reactivated.",
            )
        })?
        .ok_or_else(|| ApiError::not_found("staff_not_found", "Staff account was not found."))?;
    Ok(Json(object(staff)))
}

#[utoipa::path(put, path = "/api/v2/admin/staff/{id}/practitioner-profile", operation_id = "putAdminStaffPractitionerProfile", tag = "admin", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Staff profile ID")), request_body = UpsertPractitionerProfileRequest, responses((status = 200, body = ObjectResponse<StaffListItem>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse), (status = 409, body = ApiErrorResponse)))]
pub async fn upsert_staff_practitioner_profile(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpsertPractitionerProfileRequest>,
) -> Result<Json<ObjectResponse<StaffListItem>>, ApiError> {
    require_staff_access(&user, state.facility_id())?;
    validate_practitioner_profile(&payload)?;
    let staff = state
        .upsert_practitioner_profile(id, user.id, payload, Some(current_request_id()))
        .await
        .map_err(|_| {
            ApiError::conflict(
                "practitioner_profile_save_failed",
                "Practitioner profile could not be saved.",
            )
        })?
        .ok_or_else(|| ApiError::not_found("staff_not_found", "Staff account was not found."))?;
    Ok(Json(object(staff)))
}

#[utoipa::path(get, path = "/api/v2/admin/practitioners", operation_id = "getAdminPractitioners", tag = "admin", security(("bearerAuth" = [])), params(PractitionerListQuery), responses((status = 200, body = ListResponse<PractitionerListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_practitioners(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<PractitionerListQuery>,
) -> Result<Json<ListResponse<PractitionerListItem>>, ApiError> {
    require_staff_access(&user, state.facility_id())?;
    let search = query.search;
    let is_active = query.is_active;
    let (cursor, page_size) = page_request(AdminListQuery {
        cursor: query.cursor,
        limit: query.limit,
    })?;
    let rows = state
        .list_practitioners(cursor, page_size as i64 + 1, search, is_active)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "practitioner_list_failed",
                "Practitioners could not be loaded.",
            )
        })?;
    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.created_at, item.id)
    })))
}

#[utoipa::path(get, path = "/api/v2/admin/practitioners/{id}", operation_id = "getAdminPractitionerById", tag = "admin", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Practitioner profile or staff id")), responses((status = 200, body = ObjectResponse<PractitionerListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn get_practitioner(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<PractitionerListItem>>, ApiError> {
    require_staff_access(&user, state.facility_id())?;
    let practitioner = state
        .get_practitioner(id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "practitioner_load_failed",
                "Practitioner could not be loaded.",
            )
        })?
        .ok_or_else(|| {
            ApiError::not_found("practitioner_not_found", "Practitioner was not found.")
        })?;
    Ok(Json(object(practitioner)))
}

#[utoipa::path(get, path = "/api/v2/admin/committees", operation_id = "getAdminCommittees", tag = "admin", security(("bearerAuth" = [])), params(AdminListQuery), responses((status = 200, body = ListResponse<CommitteeListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_committees(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<AdminListQuery>,
) -> Result<Json<ListResponse<CommitteeListItem>>, ApiError> {
    require_admin_access(&user, state.facility_id())?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_committees(cursor, page_size as i64 + 1)
        .await
        .map_err(|_| {
            ApiError::conflict("committee_list_failed", "Committees could not be loaded.")
        })?;
    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.created_at, item.id)
    })))
}

#[utoipa::path(post, path = "/api/v2/admin/committees", operation_id = "postAdminCommittees", tag = "admin", security(("bearerAuth" = [])), request_body = CreateCommitteeRequest, responses((status = 200, body = ObjectResponse<CommitteeListItem>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn create_committee(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(payload): Json<CreateCommitteeRequest>,
) -> Result<Json<ObjectResponse<CommitteeListItem>>, ApiError> {
    require_admin_access(&user, state.facility_id())?;
    validate_code(&payload.code)?;
    validate_text(&payload.name, MAX_NAME_LEN, "name")?;
    validate_text(&payload.mandate, MAX_TEXT_LEN, "mandate")?;
    let committee = state.create_committee(payload).await.map_err(|_| {
        ApiError::conflict("committee_create_failed", "Committee could not be saved.")
    })?;
    Ok(Json(object(committee)))
}

#[utoipa::path(get, path = "/api/v2/admin/delegations", operation_id = "getAdminDelegations", tag = "admin", security(("bearerAuth" = [])), params(AdminListQuery), responses((status = 200, body = ListResponse<DelegationListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_delegations(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<AdminListQuery>,
) -> Result<Json<ListResponse<DelegationListItem>>, ApiError> {
    require_admin_access(&user, state.facility_id())?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_delegations(cursor, page_size as i64 + 1)
        .await
        .map_err(|_| {
            ApiError::conflict("delegation_list_failed", "Delegations could not be loaded.")
        })?;
    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.created_at, item.id)
    })))
}

#[utoipa::path(post, path = "/api/v2/admin/delegations", operation_id = "postAdminDelegations", tag = "admin", security(("bearerAuth" = [])), request_body = CreateDelegationRequest, responses((status = 200, body = ObjectResponse<DelegationListItem>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn create_delegation(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(payload): Json<CreateDelegationRequest>,
) -> Result<Json<ObjectResponse<DelegationListItem>>, ApiError> {
    require_admin_access(&user, state.facility_id())?;
    validate_text(&payload.reason, MAX_TEXT_LEN, "reason")?;
    validate_time_window(payload.starts_at, payload.ends_at)?;
    ensure_supported_permissions(&state, &[payload.permission_code]).await?;
    let delegation = state
        .create_delegation(payload, Some(current_request_id()))
        .await
        .map_err(|_| {
            ApiError::conflict("delegation_create_failed", "Delegation could not be saved.")
        })?;
    Ok(Json(object(delegation)))
}

#[utoipa::path(get, path = "/api/v2/admin/audit-events", operation_id = "getAdminAuditEvents", tag = "admin", security(("bearerAuth" = [])), params(AdminListQuery), responses((status = 200, body = ListResponse<AuditEventListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_audit_events(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<AdminListQuery>,
) -> Result<Json<ListResponse<AuditEventListItem>>, ApiError> {
    require_admin_access(&user, state.facility_id())?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_audit_events(cursor, page_size as i64 + 1)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "audit_event_list_failed",
                "Audit events could not be loaded.",
            )
        })?;
    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.occurred_at, item.id)
    })))
}

fn require_admin_access(user: &AuthUser, facility_id: Uuid) -> Result<(), ApiError> {
    require_permission(user, PermissionCode::AdminAuthorityManage).map_err(|_| {
        ApiError::forbidden(
            "permission_denied",
            "You do not have permission to manage HMS authority.",
        )
    })?;
    if user.facility_id != facility_id {
        return Err(ApiError::forbidden(
            "permission_denied",
            "You do not have access to this facility.",
        ));
    }
    Ok(())
}

fn require_feature_entitlement_access(user: &AuthUser, facility_id: Uuid) -> Result<(), ApiError> {
    require_permission(user, PermissionCode::AdminFeatureEntitlementsManage).map_err(|_| {
        ApiError::forbidden(
            "permission_denied",
            "You do not have permission to manage feature entitlements.",
        )
    })?;
    if user.facility_id != facility_id {
        return Err(ApiError::forbidden(
            "permission_denied",
            "You do not have access to this facility.",
        ));
    }
    Ok(())
}

fn require_staff_access(user: &AuthUser, facility_id: Uuid) -> Result<(), ApiError> {
    require_permission(user, PermissionCode::AdminStaffManage).map_err(|_| {
        ApiError::forbidden(
            "permission_denied",
            "You do not have permission to manage staff.",
        )
    })?;
    if user.facility_id != facility_id {
        return Err(ApiError::forbidden(
            "permission_denied",
            "You do not have access to this facility.",
        ));
    }
    Ok(())
}

fn require_staff_directory_access(user: &AuthUser, facility_id: Uuid) -> Result<(), ApiError> {
    let allowed = [
        PermissionCode::AdminStaffManage,
        PermissionCode::EncounterManage,
        PermissionCode::NursingTaskManage,
        PermissionCode::ControlledSubstanceManage,
        PermissionCode::PharmacyDispense,
    ]
    .iter()
    .any(|permission| user.permissions.contains(permission));

    if !allowed {
        return Err(ApiError::forbidden(
            "permission_denied",
            "You do not have permission to view the staff directory.",
        ));
    }
    if user.facility_id != facility_id {
        return Err(ApiError::forbidden(
            "permission_denied",
            "You do not have access to this facility.",
        ));
    }
    Ok(())
}

async fn ensure_supported_permissions(
    state: &AppState,
    permissions: &[PermissionCode],
) -> Result<(), ApiError> {
    let supported = state
        .deployment_capabilities()
        .await
        .map_err(|_| ApiError::conflict("capabilities_load_failed", "Capabilities failed."))?
        .permissions;
    if permissions
        .iter()
        .any(|permission| !supported.contains(permission))
    {
        return Err(ApiError::bad_request(
            "unsupported_permission",
            "Permission is not supported by this deployment profile.",
        ));
    }
    Ok(())
}

fn validate_code(value: &str) -> Result<(), ApiError> {
    validate_text(value, MAX_CODE_LEN, "code")?;
    if !value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(ApiError::bad_request(
            "invalid_code",
            "Code may only contain letters, numbers, dashes, and underscores.",
        ));
    }
    Ok(())
}

fn validate_staff_payload(payload: &CreateStaffRequest) -> Result<(), ApiError> {
    validate_email(&payload.email)?;
    validate_text(&payload.display_name, MAX_NAME_LEN, "display_name")?;
    validate_code(&payload.employee_id)?;
    validate_text(&payload.department, MAX_NAME_LEN, "department")?;
    validate_text(&payload.position, MAX_NAME_LEN, "position")?;
    validate_password_policy(&payload.temporary_password)?;
    if let Some(profile) = payload.practitioner_profile.as_ref() {
        validate_practitioner_profile(profile)?;
    }
    Ok(())
}

fn validate_staff_update_payload(payload: &UpdateStaffRequest) -> Result<(), ApiError> {
    if let Some(value) = payload.display_name.as_ref() {
        validate_text(value, MAX_NAME_LEN, "display_name")?;
    }
    if let Some(value) = payload.department.as_ref() {
        validate_text(value, MAX_NAME_LEN, "department")?;
    }
    if let Some(value) = payload.position.as_ref() {
        validate_text(value, MAX_NAME_LEN, "position")?;
    }
    Ok(())
}

fn validate_practitioner_profile(
    payload: &UpsertPractitionerProfileRequest,
) -> Result<(), ApiError> {
    validate_text(&payload.license_number, MAX_CODE_LEN, "license_number")?;
    validate_text(&payload.specialization, MAX_NAME_LEN, "specialization")?;
    validate_text(&payload.qualification, MAX_NAME_LEN, "qualification")?;
    if let Some(value) = payload.fhir_practitioner_id.as_ref() {
        validate_text(value, MAX_TEXT_LEN, "fhir_practitioner_id")?;
    }
    Ok(())
}

fn validate_email(value: &str) -> Result<(), ApiError> {
    let value = value.trim();
    if value.len() > MAX_EMAIL_LEN
        || !value.contains('@')
        || value.starts_with('@')
        || value.ends_with('@')
    {
        return Err(ApiError::bad_request(
            "invalid_email",
            "Email address is invalid.",
        ));
    }
    Ok(())
}

fn validate_password_policy(value: &str) -> Result<(), ApiError> {
    let meets_policy = value.len() >= 12
        && value.chars().any(char::is_uppercase)
        && value.chars().any(char::is_lowercase)
        && value.chars().any(|character| character.is_ascii_digit())
        && value
            .chars()
            .any(|character| !character.is_ascii_alphanumeric());
    if !meets_policy {
        return Err(ApiError::bad_request(
            "weak_password",
            "Temporary password does not meet policy.",
        ));
    }
    Ok(())
}

fn validate_text(value: &str, max_len: usize, field: &'static str) -> Result<(), ApiError> {
    if value.trim().is_empty() || value.len() > max_len {
        return Err(ApiError::bad_request("invalid_text", field));
    }
    Ok(())
}

fn validate_time_window(
    starts_at: Option<DateTime<Utc>>,
    ends_at: Option<DateTime<Utc>>,
) -> Result<(), ApiError> {
    if let (Some(starts_at), Some(ends_at)) = (starts_at, ends_at) {
        if ends_at <= starts_at {
            return Err(ApiError::bad_request(
                "invalid_time_window",
                "End time must be after start time.",
            ));
        }
    }
    Ok(())
}

fn page_request(query: AdminListQuery) -> Result<(Option<AdminCursor>, u8), ApiError> {
    let page_size = query.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let cursor = query.cursor.map(decode_cursor).transpose()?;
    Ok((cursor, page_size))
}

fn page_response<T>(
    mut rows: Vec<T>,
    page_size: u8,
    cursor_for: impl Fn(&T) -> String,
) -> ListResponse<T> {
    let has_next = rows.len() > page_size as usize;
    if has_next {
        rows.truncate(page_size as usize);
    }
    let next_cursor = if has_next {
        rows.last().map(cursor_for)
    } else {
        None
    };
    list(
        rows,
        PageInfo {
            next_cursor,
            has_next,
            limit: page_size,
        },
    )
}

fn encode_cursor(occurred_at: DateTime<Utc>, id: Uuid) -> String {
    format!("{}:{}", occurred_at.timestamp_micros(), id)
}

fn decode_cursor(value: String) -> Result<AdminCursor, ApiError> {
    let (micros, id) = value
        .split_once(':')
        .ok_or_else(|| ApiError::bad_request("invalid_cursor", "Cursor is invalid."))?;
    let micros = micros
        .parse::<i64>()
        .map_err(|_| ApiError::bad_request("invalid_cursor", "Cursor is invalid."))?;
    let occurred_at = DateTime::<Utc>::from_timestamp_micros(micros)
        .ok_or_else(|| ApiError::bad_request("invalid_cursor", "Cursor is invalid."))?;
    let id = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid_cursor", "Cursor is invalid."))?;
    Ok(AdminCursor { occurred_at, id })
}
