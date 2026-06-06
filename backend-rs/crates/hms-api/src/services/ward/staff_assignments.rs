use hms_access::AccessSubject;
use hms_db::ward::{NewWardStaffAssignment, WardStaffAssignmentUpdate};
use hms_domain::care::CursorListQuery;
use hms_domain::deployment::PermissionCode;
use hms_domain::ward::{
    CreateWardStaffAssignmentRequest, MyWardBoardContextResponse, UpdateWardStaffAssignmentRequest,
    WardStaffAssignmentByPractitionerQuery, WardStaffAssignmentListItem,
    WardStaffAssignmentListQuery, WardStaffListItem, WardStaffListQuery, WardStaffRoleItem,
    WardStaffRoleListQuery,
};
use uuid::Uuid;

use super::common;
use crate::error::ApiError;
use crate::response::{list, object, ListResponse, ObjectResponse, PageInfo};
use crate::state::AppState;

#[derive(Clone)]
pub struct WardStaffAssignmentService {
    state: AppState,
}

impl WardStaffAssignmentService {
    pub(super) fn new(state: AppState) -> Self {
        Self { state }
    }

    pub async fn my_board_context(
        &self,
        ctx: &hms_access::RequestContext,
    ) -> Result<ObjectResponse<MyWardBoardContextResponse>, ApiError> {
        common::require_patient_workflow_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::WardView,
        )?;
        let assigned_wards = hms_db::ward::list_user_ward_board_assignments(
            self.state.db_pool(),
            self.state.facility_id(),
            ctx.user_id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "ward_board_context_failed",
                "Ward board context could not be loaded.",
            )
        })?;
        let primary_ward_id = assigned_wards
            .iter()
            .find(|assignment| assignment.is_primary)
            .map(|assignment| assignment.ward_id);
        let default_ward_id = primary_ward_id
            .or_else(|| (assigned_wards.len() == 1).then(|| assigned_wards[0].ward_id));
        let can_view_all_wards = can_view_all_ward_board(ctx, self.state.facility_id());
        let default_route = default_ward_id
            .map(|ward_id| format!("/wards/{ward_id}/board"))
            .unwrap_or_else(|| "/ward-board".to_owned());

        Ok(object(MyWardBoardContextResponse {
            assigned_wards,
            primary_ward_id,
            default_ward_id,
            can_view_all_wards,
            default_route,
        }))
    }

    pub fn list_staff_roles(
        &self,
        ctx: &hms_access::RequestContext,
        query: WardStaffRoleListQuery,
    ) -> Result<ListResponse<WardStaffRoleItem>, ApiError> {
        require_ward_or_staff_access(ctx, self.state.facility_id())?;
        let roles =
            hms_db::ward::ward_staff_roles(query.category, query.show_inactive.unwrap_or(false));
        Ok(list(
            roles,
            PageInfo {
                next_cursor: None,
                has_next: false,
                limit: 100,
            },
        ))
    }

    pub async fn list_ward_staff(
        &self,
        ctx: &hms_access::RequestContext,
        ward_id: Uuid,
        query: WardStaffListQuery,
    ) -> Result<ListResponse<WardStaffListItem>, ApiError> {
        common::require_patient_workflow_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::WardView,
        )?;
        let _ward = common::load_ward(&self.state, ward_id).await?;
        let staff = hms_db::ward::list_ward_staff(
            self.state.db_pool(),
            self.state.facility_id(),
            ward_id,
            query.category,
        )
        .await
        .map_err(|_| ApiError::conflict("ward_staff_failed", "Ward staff could not be loaded."))?;
        Ok(list(
            staff,
            PageInfo {
                next_cursor: None,
                has_next: false,
                limit: 100,
            },
        ))
    }

    pub async fn list_assignments(
        &self,
        ctx: &hms_access::RequestContext,
        query: WardStaffAssignmentListQuery,
    ) -> Result<ListResponse<WardStaffAssignmentListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::AdminStaffManage,
        )?;
        self.list_assignments_inner(query).await
    }

    pub async fn list_assignments_by_practitioner(
        &self,
        ctx: &hms_access::RequestContext,
        query: WardStaffAssignmentByPractitionerQuery,
    ) -> Result<ListResponse<WardStaffAssignmentListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::AdminStaffManage,
        )?;
        self.list_assignments_inner(WardStaffAssignmentListQuery {
            cursor: None,
            limit: Some(100),
            ward_id: None,
            practitioner_id: Some(query.practitioner_id),
            category: None,
            show_inactive: Some(true),
        })
        .await
    }

    pub async fn get_assignment(
        &self,
        ctx: &hms_access::RequestContext,
        assignment_id: Uuid,
    ) -> Result<ObjectResponse<WardStaffAssignmentListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::AdminStaffManage,
        )?;
        let assignment = hms_db::ward::get_ward_staff_assignment(
            self.state.db_pool(),
            self.state.facility_id(),
            assignment_id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "ward_staff_assignment_load_failed",
                "Ward staff assignment could not be loaded.",
            )
        })?
        .ok_or_else(|| {
            ApiError::not_found(
                "ward_staff_assignment_not_found",
                "Ward staff assignment was not found.",
            )
        })?;
        Ok(object(assignment))
    }

    pub async fn create_assignment(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateWardStaffAssignmentRequest,
    ) -> Result<ObjectResponse<WardStaffAssignmentListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::AdminStaffManage,
        )?;
        let role = resolve_role(&payload.role_code)?;
        let assignment = hms_db::ward::create_ward_staff_assignment(
            self.state.db_pool(),
            NewWardStaffAssignment {
                id: Uuid::new_v4(),
                facility_id: self.state.facility_id(),
                ward_id: payload.ward_id,
                practitioner_id: payload.practitioner_id,
                role_code: role.code.clone(),
                role_name: role.name.clone(),
                role_category: role.category,
                is_active: payload.is_active.unwrap_or(true),
                is_primary: payload.is_primary.unwrap_or(false),
                actor_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "ward_staff_assignment_create_failed",
                "Ward staff assignment could not be created.",
            )
        })?
        .ok_or_else(|| {
            ApiError::not_found(
                "ward_staff_assignment_target_not_found",
                "Ward or practitioner was not found.",
            )
        })?;
        self.state.invalidate_ward_board_cache();
        Ok(object(assignment))
    }

    pub async fn update_assignment(
        &self,
        ctx: &hms_access::RequestContext,
        assignment_id: Uuid,
        payload: UpdateWardStaffAssignmentRequest,
    ) -> Result<ObjectResponse<WardStaffAssignmentListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::AdminStaffManage,
        )?;
        let role = payload.role_code.as_deref().map(resolve_role).transpose()?;
        let assignment = hms_db::ward::update_ward_staff_assignment(
            self.state.db_pool(),
            self.state.facility_id(),
            assignment_id,
            WardStaffAssignmentUpdate {
                ward_id: payload.ward_id,
                practitioner_id: payload.practitioner_id,
                role_code: role.as_ref().map(|role| role.code.clone()),
                role_name: role.as_ref().map(|role| role.name.clone()),
                role_category: role.as_ref().map(|role| role.category),
                is_active: payload.is_active,
                is_primary: payload.is_primary,
                actor_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "ward_staff_assignment_update_failed",
                "Ward staff assignment could not be updated.",
            )
        })?
        .ok_or_else(|| {
            ApiError::not_found(
                "ward_staff_assignment_not_found",
                "Ward staff assignment was not found.",
            )
        })?;
        self.state.invalidate_ward_board_cache();
        Ok(object(assignment))
    }

    pub async fn delete_assignment(
        &self,
        ctx: &hms_access::RequestContext,
        assignment_id: Uuid,
    ) -> Result<ObjectResponse<WardStaffAssignmentListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::AdminStaffManage,
        )?;
        let assignment = hms_db::ward::deactivate_ward_staff_assignment(
            self.state.db_pool(),
            self.state.facility_id(),
            assignment_id,
            ctx.user_id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "ward_staff_assignment_delete_failed",
                "Ward staff assignment could not be removed.",
            )
        })?
        .ok_or_else(|| {
            ApiError::not_found(
                "ward_staff_assignment_not_found",
                "Ward staff assignment was not found.",
            )
        })?;
        self.state.invalidate_ward_board_cache();
        Ok(object(assignment))
    }

    async fn list_assignments_inner(
        &self,
        query: WardStaffAssignmentListQuery,
    ) -> Result<ListResponse<WardStaffAssignmentListItem>, ApiError> {
        let page = common::page_request(CursorListQuery {
            cursor: query.cursor,
            limit: query.limit,
        })?;
        let page_size = page.limit;
        let fetch_limit = page.fetch_limit();
        let rows = hms_db::ward::list_ward_staff_assignments(
            self.state.db_pool(),
            self.state.facility_id(),
            query.ward_id,
            query.practitioner_id,
            query.category,
            query.show_inactive.unwrap_or(false),
            page.cursor,
            fetch_limit,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "ward_staff_assignments_failed",
                "Ward staff assignments could not be loaded.",
            )
        })?;
        Ok(common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.assigned_at, item.id)
        }))
    }
}

pub(super) fn can_view_all_ward_board(ctx: &hms_access::RequestContext, facility_id: Uuid) -> bool {
    ctx.has_facility_permission(facility_id, PermissionCode::WardBoardViewAll)
        || ctx.has_facility_permission(facility_id, PermissionCode::AdminStaffManage)
        || ctx.has_facility_permission(facility_id, PermissionCode::AdminAuthorityManage)
}

fn require_ward_or_staff_access(
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
) -> Result<(), ApiError> {
    if ctx.has_facility_permission(facility_id, PermissionCode::AdminStaffManage) {
        return Ok(());
    }
    common::require_patient_workflow_access(ctx, facility_id, PermissionCode::WardView)
}

fn resolve_role(code: &str) -> Result<WardStaffRoleItem, ApiError> {
    hms_db::ward::ward_staff_role_by_code(code).ok_or_else(|| {
        ApiError::bad_request(
            "invalid_ward_staff_role",
            "Ward staff role is not supported.",
        )
    })
}
