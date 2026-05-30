use hms_db::ward::NewNursingTask;
use hms_domain::care::CursorListQuery;
use hms_domain::deployment::PermissionCode;
use hms_domain::ward::{CreateNursingTaskRequest, NursingTaskListItem, NursingTaskStatus};
use uuid::Uuid;

use super::common;
use crate::error::ApiError;
use crate::response::{object, ListResponse, ObjectResponse};
use crate::state::AppState;

#[derive(Clone)]
pub struct NursingTaskBoardService {
    state: AppState,
}

impl NursingTaskBoardService {
    pub(super) fn new(state: AppState) -> Self {
        Self { state }
    }

    pub async fn list_nursing_tasks(
        &self,
        ctx: &hms_access::RequestContext,
        query: CursorListQuery,
    ) -> Result<ListResponse<NursingTaskListItem>, ApiError> {
        common::require_patient_workflow_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::NursingTaskManage,
        )?;
        let page = common::page_request(query)?;
        let page_size = page.limit;
        let fetch_limit = page.fetch_limit();
        let rows = hms_db::ward::list_nursing_tasks(
            self.state.db_pool(),
            self.state.facility_id(),
            page.cursor,
            fetch_limit,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "nursing_task_list_failed",
                "Nursing tasks could not be loaded.",
            )
        })?;

        Ok(common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.due_at, item.id)
        }))
    }

    pub async fn create_nursing_task(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateNursingTaskRequest,
    ) -> Result<ObjectResponse<NursingTaskListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::NursingTaskManage,
        )?;
        let admission =
            common::load_admission_for_access(&self.state, ctx, payload.admission_case_id).await?;
        let task = hms_db::ward::create_nursing_task(
            self.state.db_pool(),
            NewNursingTask {
                id: Uuid::new_v4(),
                facility_id: self.state.facility_id(),
                admission_case_id: admission.id,
                patient_id: admission.patient_id,
                ward_id: admission.ward_id,
                task_type: payload.task_type,
                title: payload.title,
                instruction: payload.instruction,
                due_at: payload.due_at,
                assigned_to_user_id: payload.assigned_to_user_id,
                actor_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "nursing_task_create_failed",
                "Nursing task could not be created.",
            )
        })?;

        self.state.invalidate_ward_board_cache();
        Ok(object(task))
    }

    pub async fn complete_nursing_task(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<NursingTaskListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::NursingTaskManage,
        )?;
        let existing =
            hms_db::ward::get_nursing_task(self.state.db_pool(), self.state.facility_id(), id)
                .await
                .map_err(|_| {
                    ApiError::conflict(
                        "nursing_task_load_failed",
                        "Nursing task could not be loaded.",
                    )
                })?
                .ok_or_else(|| {
                    ApiError::not_found("nursing_task_not_found", "Nursing task was not found.")
                })?;
        let _patient =
            common::load_patient_for_access(&self.state, ctx, existing.patient_id).await?;
        let task =
            hms_db::ward::complete_nursing_task(self.state.db_pool(), self.state.facility_id(), id)
                .await
                .map_err(|_| {
                    ApiError::conflict(
                        "nursing_task_complete_failed",
                        "Nursing task could not be completed.",
                    )
                })?
                .ok_or_else(|| {
                    ApiError::not_found("nursing_task_not_found", "Nursing task was not found.")
                })?;

        self.state.invalidate_ward_board_cache();
        Ok(object(task))
    }

    pub async fn cancel_nursing_task(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<NursingTaskListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::NursingTaskManage,
        )?;
        let existing =
            hms_db::ward::get_nursing_task(self.state.db_pool(), self.state.facility_id(), id)
                .await
                .map_err(|_| {
                    ApiError::conflict(
                        "nursing_task_load_failed",
                        "Nursing task could not be loaded.",
                    )
                })?
                .ok_or_else(|| {
                    ApiError::not_found("nursing_task_not_found", "Nursing task was not found.")
                })?;
        let _patient =
            common::load_patient_for_access(&self.state, ctx, existing.patient_id).await?;
        if existing.status == NursingTaskStatus::Completed {
            return Err(ApiError::conflict(
                "nursing_task_cancel_invalid_status",
                "Completed nursing tasks cannot be cancelled.",
            ));
        }

        let task =
            hms_db::ward::cancel_nursing_task(self.state.db_pool(), self.state.facility_id(), id)
                .await
                .map_err(|_| {
                    ApiError::conflict(
                        "nursing_task_cancel_failed",
                        "Nursing task could not be cancelled.",
                    )
                })?
                .ok_or_else(|| {
                    ApiError::not_found("nursing_task_not_found", "Nursing task was not found.")
                })?;

        self.state.invalidate_ward_board_cache();
        Ok(object(task))
    }
}
