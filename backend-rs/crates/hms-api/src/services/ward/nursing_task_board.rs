use super::{common, nursing_access as access};
use crate::{
    error::ApiError,
    response::{object, ListResponse, ObjectResponse},
    state::AppState,
};
use chrono::{DateTime, Utc};
use hms_db::ward::NewNursingTask;
use hms_domain::ward::{
    CreateNursingTaskRequest, NursingTaskListItem, NursingTaskListQuery, NursingTaskStatus,
};
use uuid::Uuid;

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
        q: NursingTaskListQuery,
        deadline: DateTime<Utc>,
    ) -> Result<ListResponse<NursingTaskListItem>, ApiError> {
        access::require(ctx, self.state.facility_id(), true)?;
        common::validate_nursing_list_range(q.due_from, q.due_before)?;
        access::scope(
            &self.state,
            ctx,
            q.patient_id,
            q.admission_case_id,
            q.ward_id,
            true,
        )
        .await?;
        let page = common::page_request(hms_domain::care::CursorListQuery {
            cursor: q.cursor.clone(),
            limit: q.limit,
        })?;
        let size = page.limit;
        let limit = page.fetch_limit();
        let rows = hms_db::ward::list_nursing_tasks_for_actor(
            self.state.db_pool(),
            access::actor(ctx, deadline),
            &q,
            page.cursor,
            limit,
        )
        .await
        .map_err(|e| access::error(e, false))?;
        Ok(common::page_response(rows, size, |r| {
            common::encode_cursor(r.due_at, r.id)
        }))
    }
    pub async fn create_nursing_task(
        &self,
        ctx: &hms_access::RequestContext,
        p: CreateNursingTaskRequest,
        deadline: DateTime<Utc>,
    ) -> Result<ObjectResponse<NursingTaskListItem>, ApiError> {
        access::require(ctx, self.state.facility_id(), true)?;
        let a = common::load_admission_for_access(&self.state, ctx, p.admission_case_id).await?;
        if p.patient_id.is_some_and(|id| id != a.patient_id) {
            return Err(ApiError::bad_request(
                "invalid_nursing_patient_context",
                "The selected admission does not belong to the reviewed patient.",
            ));
        }
        let task = hms_db::ward::create_nursing_task_for_actor(
            self.state.db_pool(),
            access::actor(ctx, deadline),
            NewNursingTask {
                id: Uuid::new_v4(),
                facility_id: self.state.facility_id(),
                admission_case_id: a.id,
                patient_id: a.patient_id,
                ward_id: a.ward_id,
                task_type: p.task_type,
                title: access::text(p.title, 160)?,
                instruction: access::text(p.instruction, 4000)?,
                due_at: p.due_at,
                assigned_to_user_id: p.assigned_to_user_id,
                actor_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|e| access::error(e, true))?;
        self.state.invalidate_ward_board_cache();
        Ok(object(task))
    }
    pub async fn complete_nursing_task(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        deadline: DateTime<Utc>,
    ) -> Result<ObjectResponse<NursingTaskListItem>, ApiError> {
        self.decide(ctx, id, NursingTaskStatus::Completed, deadline)
            .await
    }
    pub async fn cancel_nursing_task(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        deadline: DateTime<Utc>,
    ) -> Result<ObjectResponse<NursingTaskListItem>, ApiError> {
        self.decide(ctx, id, NursingTaskStatus::Cancelled, deadline)
            .await
    }
    async fn decide(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        target: NursingTaskStatus,
        deadline: DateTime<Utc>,
    ) -> Result<ObjectResponse<NursingTaskListItem>, ApiError> {
        access::require(ctx, self.state.facility_id(), true)?;
        let old =
            hms_db::ward::get_nursing_task(self.state.db_pool(), self.state.facility_id(), id)
                .await
                .map_err(|e| access::error(e, false))?
                .ok_or_else(|| {
                    ApiError::not_found(
                        "nursing_record_not_found",
                        "The nursing record was not found.",
                    )
                })?;
        common::load_patient_for_access(&self.state, ctx, old.patient_id).await?;
        let result = hms_db::ward::decide_nursing_task_for_actor(
            self.state.db_pool(),
            access::actor(ctx, deadline),
            id,
            target,
        )
        .await
        .map_err(|e| access::error(e, true))?;
        self.state.invalidate_ward_board_cache();
        Ok(object(result))
    }
}
