use chrono::{DateTime, Utc};
use hms_db::ward::{NewAdmission, NewAdmissionCase, WardBoardCursor, WardCursor};
use hms_domain::care::CursorListQuery;
use hms_domain::deployment::PermissionCode;
use hms_domain::ward::{
    AdmissionCaseListItem, AdmitPatientRequest, CreateAdmissionCaseRequest,
    ReserveAdmissionBedRequest, WardBoardItem, WardBoardQuery, WardBoardSort,
};
use uuid::Uuid;

use super::{common, staff_assignments};
use crate::cursor_list::{self, CursorListError, CursorPage};
use crate::error::ApiError;
use crate::response::{object, ListResponse, ObjectResponse};
use crate::state::AppState;

#[derive(Clone)]
pub struct AdmissionCasesService {
    state: AppState,
}

impl AdmissionCasesService {
    pub(super) fn new(state: AppState) -> Self {
        Self { state }
    }

    pub async fn ward_board(
        &self,
        ctx: &hms_access::RequestContext,
        query: WardBoardQuery,
    ) -> Result<ListResponse<WardBoardItem>, ApiError> {
        common::require_patient_workflow_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::WardView,
        )?;
        self.require_ward_board_scope(ctx, query.ward_id).await?;
        let sort = query.sort.unwrap_or(WardBoardSort::Admitted);
        let page = ward_board_page_request(
            CursorListQuery {
                cursor: query.cursor,
                limit: query.limit,
            },
            sort,
        )?;
        let page_size = page.limit;
        let fetch_limit = page.fetch_limit();
        let has_search = query
            .search
            .as_deref()
            .map(str::trim)
            .is_some_and(|value| !value.is_empty());
        if let Some(patient_id) = query.patient_id {
            common::load_patient_for_access(&self.state, ctx, patient_id).await?;
        }
        let cacheable_hot_page = page.cursor.is_none()
            && query.patient_id.is_none()
            && query.monitoring_filter.is_none()
            && sort == WardBoardSort::Admitted
            && !has_search;
        if cacheable_hot_page {
            if let Some(response) = self.state.cached_ward_board(ctx, query.ward_id, page_size) {
                return Ok(response);
            }
        }
        let rows = hms_db::ward::list_ward_board(
            self.state.db_pool(),
            self.state.facility_id(),
            query.ward_id,
            query.patient_id,
            query.search,
            query.monitoring_filter,
            sort,
            page.cursor,
            fetch_limit,
        )
        .await
        .map_err(|_| ApiError::conflict("ward_board_failed", "Ward board could not be loaded."))?;

        let response =
            common::page_response(rows, page_size, |item| ward_board_cursor_for(item, sort));
        if cacheable_hot_page {
            self.state
                .put_cached_ward_board(ctx, query.ward_id, page_size, response.clone());
        }
        Ok(response)
    }

    async fn require_ward_board_scope(
        &self,
        ctx: &hms_access::RequestContext,
        ward_id: Option<Uuid>,
    ) -> Result<(), ApiError> {
        if staff_assignments::can_view_all_ward_board(ctx, self.state.facility_id()) {
            if let Some(ward_id) = ward_id {
                let _ward = common::load_ward(&self.state, ward_id).await?;
            }
            return Ok(());
        }

        let Some(ward_id) = ward_id else {
            return Err(ApiError::forbidden(
                "ward_board_scope_denied",
                "Select an assigned ward to open the ward board.",
            ));
        };
        let _ward = common::load_ward(&self.state, ward_id).await?;
        let assigned = hms_db::ward::user_has_active_ward_assignment(
            self.state.db_pool(),
            self.state.facility_id(),
            ctx.user_id,
            ward_id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "ward_board_scope_check_failed",
                "Ward board access could not be checked.",
            )
        })?;
        if assigned {
            Ok(())
        } else {
            Err(ApiError::forbidden(
                "ward_board_scope_denied",
                "You are not assigned to this ward board.",
            ))
        }
    }

    pub async fn get_admission(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<WardBoardItem>, ApiError> {
        common::require_patient_workflow_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::AdmissionManage,
        )?;
        let admission = hms_db::ward::get_ward_board_admission(
            self.state.db_pool(),
            self.state.facility_id(),
            id,
        )
        .await
        .map_err(|_| ApiError::conflict("admission_load_failed", "Admission could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("admission_not_found", "Admission was not found."))?;
        let _patient =
            common::load_patient_for_access(&self.state, ctx, admission.patient_id).await?;
        Ok(object(admission))
    }

    pub async fn list_admission_cases(
        &self,
        ctx: &hms_access::RequestContext,
        query: CursorListQuery,
    ) -> Result<ListResponse<AdmissionCaseListItem>, ApiError> {
        common::require_patient_workflow_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::AdmissionManage,
        )?;
        let page = common::page_request(query)?;
        let page_size = page.limit;
        let fetch_limit = page.fetch_limit();
        let rows = hms_db::ward::list_admission_cases(
            self.state.db_pool(),
            self.state.facility_id(),
            page.cursor,
            fetch_limit,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "admission_case_list_failed",
                "Admission cases could not be loaded.",
            )
        })?;

        Ok(common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.created_at, item.id)
        }))
    }

    pub async fn get_admission_case(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<AdmissionCaseListItem>, ApiError> {
        common::require_patient_workflow_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::AdmissionManage,
        )?;
        let admission_case = common::load_admission_case_for_access(&self.state, ctx, id).await?;
        Ok(object(admission_case))
    }

    pub async fn create_admission_case(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateAdmissionCaseRequest,
    ) -> Result<ObjectResponse<AdmissionCaseListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::AdmissionManage,
        )?;
        let _patient =
            common::load_patient_for_access(&self.state, ctx, payload.patient_id).await?;
        let _ward = common::load_ward(&self.state, payload.ward_id).await?;
        let care_context = common::validate_care_context(
            &self.state,
            payload.patient_id,
            payload.encounter_id,
            payload.visit_id,
        )
        .await?;
        let admission_case = hms_db::ward::create_admission_case(
            self.state.db_pool(),
            NewAdmissionCase {
                id: Uuid::new_v4(),
                facility_id: self.state.facility_id(),
                patient_id: payload.patient_id,
                ward_id: payload.ward_id,
                encounter_id: care_context.encounter_id,
                visit_id: care_context.visit_id,
                actor_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "admission_case_create_failed",
                "Admission case could not be created.",
            )
        })?;

        self.state.invalidate_ward_board_cache();
        self.state.invalidate_patient_list_cache();
        self.state.invalidate_patient_chronicle_cache();
        Ok(object(admission_case))
    }

    pub async fn reserve_admission_bed(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        payload: ReserveAdmissionBedRequest,
    ) -> Result<ObjectResponse<AdmissionCaseListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::AdmissionManage,
        )?;
        let _existing = common::load_admission_case_for_access(&self.state, ctx, id).await?;
        let admission_case = hms_db::ward::reserve_admission_bed(
            self.state.db_pool(),
            self.state.facility_id(),
            id,
            payload.bed_id,
            ctx.user_id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "admission_case_reserve_failed",
                "Admission bed could not be reserved.",
            )
        })?
        .ok_or_else(|| {
            ApiError::conflict(
                "admission_case_reserve_failed",
                "Admission bed could not be reserved.",
            )
        })?;

        self.state.invalidate_ward_board_cache();
        self.state.invalidate_patient_list_cache();
        self.state.invalidate_patient_chronicle_cache();
        Ok(object(admission_case))
    }

    pub async fn activate_admission_case(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<AdmissionCaseListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::AdmissionManage,
        )?;
        let _existing = common::load_admission_case_for_access(&self.state, ctx, id).await?;
        let admission_case = hms_db::ward::activate_admission_case(
            self.state.db_pool(),
            self.state.facility_id(),
            id,
            ctx.user_id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "admission_case_activate_failed",
                "Admission case could not be activated.",
            )
        })?
        .ok_or_else(|| {
            ApiError::conflict(
                "admission_case_activate_failed",
                "Admission case could not be activated.",
            )
        })?;

        self.state.invalidate_ward_board_cache();
        self.state.invalidate_patient_list_cache();
        self.state.invalidate_patient_chronicle_cache();
        Ok(object(admission_case))
    }

    pub async fn cancel_admission_case(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<AdmissionCaseListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::AdmissionManage,
        )?;
        let _existing = common::load_admission_case_for_access(&self.state, ctx, id).await?;
        let admission_case = hms_db::ward::cancel_admission_case(
            self.state.db_pool(),
            self.state.facility_id(),
            id,
            ctx.user_id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "admission_case_cancel_failed",
                "Admission case could not be cancelled.",
            )
        })?
        .ok_or_else(|| {
            ApiError::conflict(
                "admission_case_cancel_failed",
                "Admission case could not be cancelled.",
            )
        })?;

        self.state.invalidate_ward_board_cache();
        self.state.invalidate_patient_list_cache();
        self.state.invalidate_patient_chronicle_cache();
        Ok(object(admission_case))
    }

    pub async fn admit_patient(
        &self,
        ctx: &hms_access::RequestContext,
        payload: AdmitPatientRequest,
    ) -> Result<ObjectResponse<WardBoardItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::AdmissionManage,
        )?;
        let _patient =
            common::load_patient_for_access(&self.state, ctx, payload.patient_id).await?;
        let admission = hms_db::ward::admit_patient(
            self.state.db_pool(),
            NewAdmission {
                id: Uuid::new_v4(),
                facility_id: self.state.facility_id(),
                patient_id: payload.patient_id,
                ward_id: payload.ward_id,
                bed_id: payload.bed_id,
                actor_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict("admission_create_failed", "Admission could not be created.")
        })?;

        self.state.invalidate_ward_board_cache();
        self.state.invalidate_patient_list_cache();
        self.state.invalidate_patient_chronicle_cache();
        Ok(object(admission))
    }
}

fn ward_board_page_request(
    query: CursorListQuery,
    sort: WardBoardSort,
) -> Result<CursorPage<WardBoardCursor>, ApiError> {
    match sort {
        WardBoardSort::Admitted => Ok(cursor_list::page_request(
            query.cursor.as_deref(),
            query.limit,
            common::DEFAULT_LIMIT,
            common::MAX_LIMIT,
            |occurred_at, id| WardBoardCursor::Admitted(WardCursor { occurred_at, id }),
        )?),
        WardBoardSort::Attention => {
            let limit = query
                .limit
                .unwrap_or(common::DEFAULT_LIMIT)
                .clamp(1, common::MAX_LIMIT);
            let cursor = query
                .cursor
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(decode_attention_cursor)
                .transpose()?;
            Ok(CursorPage { cursor, limit })
        }
    }
}

fn ward_board_cursor_for(item: &WardBoardItem, sort: WardBoardSort) -> String {
    match sort {
        WardBoardSort::Attention => encode_attention_cursor(
            ward_board_attention_rank(item),
            item.admitted_at,
            item.admission_id,
        ),
        WardBoardSort::Admitted => common::encode_cursor(item.admitted_at, item.admission_id),
    }
}

fn ward_board_attention_rank(item: &WardBoardItem) -> i32 {
    if item.critical_alert_count > 0 || item.critical_unverified_result_count > 0 {
        return 0;
    }
    if item.active_alert_count > 0
        || item.overdue_nursing_task_count > 0
        || item.due_medication_count > 0
    {
        return 1;
    }
    if item.open_nursing_task_count > 0
        || item.unverified_result_count > 0
        || item.pending_lab_order_count > 0
        || item.discharge_case_id.is_some()
    {
        return 2;
    }
    3
}

fn encode_attention_cursor(rank: i32, occurred_at: DateTime<Utc>, id: Uuid) -> String {
    format!("a:{}:{}:{}", rank, occurred_at.timestamp_micros(), id)
}

fn decode_attention_cursor(value: &str) -> Result<WardBoardCursor, CursorListError> {
    let mut parts = value.split(':');
    if parts.next() != Some("a") {
        return Err(CursorListError::InvalidCursor);
    }
    let rank = parts
        .next()
        .ok_or(CursorListError::InvalidCursor)?
        .parse::<i32>()
        .map_err(|_| CursorListError::InvalidCursor)?;
    let micros = parts
        .next()
        .ok_or(CursorListError::InvalidCursor)?
        .parse::<i64>()
        .map_err(|_| CursorListError::InvalidCursor)?;
    let id = parts
        .next()
        .ok_or(CursorListError::InvalidCursor)?
        .parse::<Uuid>()
        .map_err(|_| CursorListError::InvalidCursor)?;
    if parts.next().is_some() {
        return Err(CursorListError::InvalidCursor);
    }
    let occurred_at =
        DateTime::<Utc>::from_timestamp_micros(micros).ok_or(CursorListError::InvalidCursor)?;
    Ok(WardBoardCursor::Attention {
        rank,
        occurred_at,
        id,
    })
}
