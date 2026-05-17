use axum::extract::{Path, Query, State};
use axum::Json;
use chrono::{DateTime, Utc};
use hms_db::admin::AdminCursor;
use hms_domain::admin::{
    AdminLimitQuery, AdminListQuery, AuditEventListItem, AuditEventListQuery,
    AuthorityAppointmentListItem, CommitteeListItem, CreateAuthorityAppointmentRequest,
    CreateCommitteeRequest, CreateDelegationRequest, CreateOrganizationUnitRequest,
    CreatePermissionAssignmentRequest, CreatePositionRequest, CreatePositionTemplateRequest,
    CreateStaffRequest, DelegationListItem, FeatureEntitlementListItem, OrganizationUnitListItem,
    OrganizationUnitListQuery, PermissionAssignmentListItem, PositionListItem,
    PositionTemplateListItem, PractitionerListItem, PractitionerListQuery, StaffDirectoryItem,
    StaffListItem, StaffListQuery, UpdateFeatureEntitlementRequest, UpdateStaffRequest,
    UpsertPractitionerProfileRequest,
};
use hms_domain::deployment::{FeatureKey, PermissionCode};
use uuid::Uuid;

use crate::cursor_list;
use crate::error::{ApiError, ApiErrorResponse};
use crate::extractors::RequestContext;
use crate::response::{list, object, ListResponse, ObjectResponse, PageInfo};
use crate::state::AppState;

const DEFAULT_LIMIT: u8 = 25;
const MAX_LIMIT: u8 = 100;
const MAX_CODE_LEN: usize = 48;
const MAX_NAME_LEN: usize = 160;
const MAX_TEXT_LEN: usize = 240;

#[utoipa::path(get, path = "/api/v2/admin/org-units", operation_id = "getAdminOrgUnits", tag = "admin", security(("bearerAuth" = [])), params(OrganizationUnitListQuery), responses((status = 200, body = ListResponse<OrganizationUnitListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_org_units(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
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
    RequestContext(user): RequestContext,
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
    RequestContext(user): RequestContext,
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
    RequestContext(user): RequestContext,
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
    RequestContext(user): RequestContext,
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
    RequestContext(user): RequestContext,
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
    RequestContext(user): RequestContext,
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
    RequestContext(user): RequestContext,
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
    RequestContext(user): RequestContext,
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
    RequestContext(user): RequestContext,
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
    RequestContext(user): RequestContext,
    Query(query): Query<AdminListQuery>,
) -> Result<Json<ListResponse<AuthorityAppointmentListItem>>, ApiError> {
    Ok(Json(
        state
            .admin_service()
            .list_authority_appointments(&user, query)
            .await?,
    ))
}

#[utoipa::path(post, path = "/api/v2/admin/authority-appointments", operation_id = "postAdminAuthorityAppointments", tag = "admin", security(("bearerAuth" = [])), request_body = CreateAuthorityAppointmentRequest, responses((status = 200, body = ObjectResponse<AuthorityAppointmentListItem>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn create_authority_appointment(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<CreateAuthorityAppointmentRequest>,
) -> Result<Json<ObjectResponse<AuthorityAppointmentListItem>>, ApiError> {
    Ok(Json(
        state
            .admin_service()
            .create_authority_appointment(&user, payload)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/admin/permission-assignments", operation_id = "getAdminPermissionAssignments", tag = "admin", security(("bearerAuth" = [])), params(AdminListQuery), responses((status = 200, body = ListResponse<PermissionAssignmentListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_permission_assignments(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<AdminListQuery>,
) -> Result<Json<ListResponse<PermissionAssignmentListItem>>, ApiError> {
    Ok(Json(
        state
            .admin_service()
            .list_permission_assignments(&user, query)
            .await?,
    ))
}

#[utoipa::path(post, path = "/api/v2/admin/permission-assignments", operation_id = "postAdminPermissionAssignments", tag = "admin", security(("bearerAuth" = [])), request_body = CreatePermissionAssignmentRequest, responses((status = 200, body = ObjectResponse<PermissionAssignmentListItem>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn create_permission_assignment(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<CreatePermissionAssignmentRequest>,
) -> Result<Json<ObjectResponse<PermissionAssignmentListItem>>, ApiError> {
    Ok(Json(
        state
            .admin_service()
            .create_permission_assignment(&user, payload)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/admin/features", operation_id = "getAdminFeatures", tag = "admin", security(("bearerAuth" = [])), responses((status = 200, body = ListResponse<FeatureEntitlementListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_feature_entitlements(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
) -> Result<Json<ListResponse<FeatureEntitlementListItem>>, ApiError> {
    Ok(Json(
        state
            .admin_service()
            .list_feature_entitlements(&user)
            .await?,
    ))
}

#[utoipa::path(patch, path = "/api/v2/admin/features/{key}", operation_id = "patchAdminFeature", tag = "admin", security(("bearerAuth" = [])), params(("key" = FeatureKey, Path, description = "Feature key")), request_body = UpdateFeatureEntitlementRequest, responses((status = 200, body = ObjectResponse<FeatureEntitlementListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn update_feature_entitlement(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(key): Path<FeatureKey>,
    Json(payload): Json<UpdateFeatureEntitlementRequest>,
) -> Result<Json<ObjectResponse<FeatureEntitlementListItem>>, ApiError> {
    Ok(Json(
        state
            .admin_service()
            .update_feature_entitlement(&user, key, payload)
            .await?,
    ))
}

#[utoipa::path(delete, path = "/api/v2/admin/features/{key}", operation_id = "deleteAdminFeature", tag = "admin", security(("bearerAuth" = [])), params(("key" = FeatureKey, Path, description = "Feature key")), responses((status = 200, body = ObjectResponse<FeatureEntitlementListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn delete_feature_entitlement(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(key): Path<FeatureKey>,
) -> Result<Json<ObjectResponse<FeatureEntitlementListItem>>, ApiError> {
    Ok(Json(
        state
            .admin_service()
            .delete_feature_entitlement(&user, key)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/admin/staff", operation_id = "getAdminStaff", tag = "admin", security(("bearerAuth" = [])), params(StaffListQuery), responses((status = 200, body = ListResponse<StaffListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_staff(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<StaffListQuery>,
) -> Result<Json<ListResponse<StaffListItem>>, ApiError> {
    Ok(Json(state.admin_service().list_staff(&user, query).await?))
}

#[utoipa::path(get, path = "/api/v2/staff/directory", operation_id = "getStaffDirectory", tag = "staff", security(("bearerAuth" = [])), params(AdminListQuery), responses((status = 200, body = ListResponse<StaffDirectoryItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_staff_directory(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<AdminListQuery>,
) -> Result<Json<ListResponse<StaffDirectoryItem>>, ApiError> {
    Ok(Json(
        state
            .admin_service()
            .list_staff_directory(&user, query)
            .await?,
    ))
}

#[utoipa::path(post, path = "/api/v2/admin/staff", operation_id = "postAdminStaff", tag = "admin", security(("bearerAuth" = [])), request_body = CreateStaffRequest, responses((status = 200, body = ObjectResponse<StaffListItem>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 409, body = ApiErrorResponse)))]
pub async fn create_staff(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<CreateStaffRequest>,
) -> Result<Json<ObjectResponse<StaffListItem>>, ApiError> {
    Ok(Json(
        state.admin_service().create_staff(&user, payload).await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/admin/staff/{id}", operation_id = "getAdminStaffById", tag = "admin", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Staff profile ID")), responses((status = 200, body = ObjectResponse<StaffListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn get_staff(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<StaffListItem>>, ApiError> {
    Ok(Json(state.admin_service().get_staff(&user, id).await?))
}

#[utoipa::path(patch, path = "/api/v2/admin/staff/{id}", operation_id = "patchAdminStaff", tag = "admin", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Staff profile ID")), request_body = UpdateStaffRequest, responses((status = 200, body = ObjectResponse<StaffListItem>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse), (status = 409, body = ApiErrorResponse)))]
pub async fn update_staff(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateStaffRequest>,
) -> Result<Json<ObjectResponse<StaffListItem>>, ApiError> {
    Ok(Json(
        state
            .admin_service()
            .update_staff(&user, id, payload)
            .await?,
    ))
}

#[utoipa::path(post, path = "/api/v2/admin/staff/{id}/force-password-reset", operation_id = "postAdminStaffForcePasswordReset", tag = "admin", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Staff profile ID")), responses((status = 200, body = ObjectResponse<StaffListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn force_staff_password_reset(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<StaffListItem>>, ApiError> {
    Ok(Json(
        state
            .admin_service()
            .force_staff_password_reset(&user, id)
            .await?,
    ))
}

#[utoipa::path(post, path = "/api/v2/admin/staff/{id}/deactivate", operation_id = "postAdminStaffDeactivate", tag = "admin", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Staff profile ID")), responses((status = 200, body = ObjectResponse<StaffListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn deactivate_staff(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<StaffListItem>>, ApiError> {
    Ok(Json(
        state.admin_service().deactivate_staff(&user, id).await?,
    ))
}

#[utoipa::path(post, path = "/api/v2/admin/staff/{id}/reactivate", operation_id = "postAdminStaffReactivate", tag = "admin", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Staff profile ID")), responses((status = 200, body = ObjectResponse<StaffListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn reactivate_staff(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<StaffListItem>>, ApiError> {
    Ok(Json(
        state.admin_service().reactivate_staff(&user, id).await?,
    ))
}

#[utoipa::path(put, path = "/api/v2/admin/staff/{id}/practitioner-profile", operation_id = "putAdminStaffPractitionerProfile", tag = "admin", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Staff profile ID")), request_body = UpsertPractitionerProfileRequest, responses((status = 200, body = ObjectResponse<StaffListItem>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse), (status = 409, body = ApiErrorResponse)))]
pub async fn upsert_staff_practitioner_profile(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpsertPractitionerProfileRequest>,
) -> Result<Json<ObjectResponse<StaffListItem>>, ApiError> {
    Ok(Json(
        state
            .admin_service()
            .upsert_staff_practitioner_profile(&user, id, payload)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/admin/practitioners", operation_id = "getAdminPractitioners", tag = "admin", security(("bearerAuth" = [])), params(PractitionerListQuery), responses((status = 200, body = ListResponse<PractitionerListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_practitioners(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<PractitionerListQuery>,
) -> Result<Json<ListResponse<PractitionerListItem>>, ApiError> {
    Ok(Json(
        state
            .admin_service()
            .list_practitioners(&user, query)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/admin/practitioners/{id}", operation_id = "getAdminPractitionerById", tag = "admin", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Practitioner profile or staff id")), responses((status = 200, body = ObjectResponse<PractitionerListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn get_practitioner(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<PractitionerListItem>>, ApiError> {
    Ok(Json(
        state.admin_service().get_practitioner(&user, id).await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/admin/committees", operation_id = "getAdminCommittees", tag = "admin", security(("bearerAuth" = [])), params(AdminListQuery), responses((status = 200, body = ListResponse<CommitteeListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_committees(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
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
    RequestContext(user): RequestContext,
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
    RequestContext(user): RequestContext,
    Query(query): Query<AdminListQuery>,
) -> Result<Json<ListResponse<DelegationListItem>>, ApiError> {
    Ok(Json(
        state.admin_service().list_delegations(&user, query).await?,
    ))
}

#[utoipa::path(post, path = "/api/v2/admin/delegations", operation_id = "postAdminDelegations", tag = "admin", security(("bearerAuth" = [])), request_body = CreateDelegationRequest, responses((status = 200, body = ObjectResponse<DelegationListItem>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn create_delegation(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<CreateDelegationRequest>,
) -> Result<Json<ObjectResponse<DelegationListItem>>, ApiError> {
    Ok(Json(
        state
            .admin_service()
            .create_delegation(&user, payload)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/admin/audit-events", operation_id = "getAdminAuditEvents", tag = "admin", security(("bearerAuth" = [])), params(AuditEventListQuery), responses((status = 200, body = ListResponse<AuditEventListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_audit_events(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<AuditEventListQuery>,
) -> Result<Json<ListResponse<AuditEventListItem>>, ApiError> {
    Ok(Json(
        state
            .admin_service()
            .list_audit_events(&user, query)
            .await?,
    ))
}

fn require_admin_access(
    user: &hms_access::RequestContext,
    facility_id: Uuid,
) -> Result<(), ApiError> {
    hms_access::require_admin_authority_access(user, facility_id).map_err(ApiError::from)
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

fn validate_text(value: &str, max_len: usize, field: &'static str) -> Result<(), ApiError> {
    if value.trim().is_empty() || value.len() > max_len {
        return Err(ApiError::bad_request("invalid_text", field));
    }
    Ok(())
}

fn page_request(query: AdminListQuery) -> Result<(Option<AdminCursor>, u8), ApiError> {
    let page = cursor_list::page_request(
        query.cursor.as_deref(),
        query.limit,
        DEFAULT_LIMIT,
        MAX_LIMIT,
        |occurred_at, id| AdminCursor { occurred_at, id },
    )?;
    Ok((page.cursor, page.limit))
}

fn page_response<T>(
    rows: Vec<T>,
    page_size: u8,
    cursor_for: impl Fn(&T) -> String,
) -> ListResponse<T> {
    cursor_list::page_response(rows, page_size, cursor_for)
}

fn encode_cursor(occurred_at: DateTime<Utc>, id: Uuid) -> String {
    cursor_list::encode_cursor(occurred_at, id)
}
