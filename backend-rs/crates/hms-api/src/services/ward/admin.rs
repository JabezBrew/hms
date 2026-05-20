use hms_db::ward::{NewWard, NewWardSection, WardSectionUpdate, WardUpdate};
use hms_domain::care::CursorListQuery;
use hms_domain::deployment::PermissionCode;
use hms_domain::ward::{
    CreateWardRequest, CreateWardSectionRequest, UpdateWardRequest, UpdateWardSectionRequest,
    WardListItem, WardListQuery, WardSectionListItem,
};
use uuid::Uuid;

use super::common;
use crate::error::ApiError;
use crate::response::{object, ListResponse, ObjectResponse};
use crate::state::AppState;

#[derive(Clone)]
pub struct WardAdminService {
    state: AppState,
}

impl WardAdminService {
    pub(super) fn new(state: AppState) -> Self {
        Self { state }
    }

    pub async fn list_wards(
        &self,
        ctx: &hms_access::RequestContext,
        query: WardListQuery,
    ) -> Result<ListResponse<WardListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::WardView,
        )?;
        let page = common::page_request(CursorListQuery {
            cursor: query.cursor,
            limit: query.limit,
        })?;
        let page_size = page.limit;
        let fetch_limit = page.fetch_limit();
        let rows = hms_db::ward::list_wards(
            self.state.db_pool(),
            self.state.facility_id(),
            page.cursor,
            fetch_limit,
            query.search.as_deref(),
        )
        .await
        .map_err(|_| ApiError::conflict("ward_list_failed", "Wards could not be loaded."))?;

        Ok(common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.created_at, item.id)
        }))
    }

    pub async fn create_ward(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateWardRequest,
    ) -> Result<ObjectResponse<WardListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::WardManageBeds,
        )?;

        let code = payload.code.trim();
        let name = payload.name.trim();
        if code.is_empty() || name.is_empty() {
            return Err(ApiError::bad_request(
                "invalid_ward",
                "Ward code and name are required.",
            ));
        }
        if code.len() > common::MAX_WARD_CODE_LEN || name.len() > common::MAX_WARD_NAME_LEN {
            return Err(ApiError::bad_request(
                "invalid_ward",
                "Ward code or name is too long.",
            ));
        }

        let ward = hms_db::ward::create_ward(
            self.state.db_pool(),
            NewWard {
                id: Uuid::new_v4(),
                facility_id: self.state.facility_id(),
                code: code.to_owned(),
                name: name.to_owned(),
            },
        )
        .await
        .map_err(|_| ApiError::conflict("ward_create_failed", "Ward could not be created."))?;

        Ok(object(ward))
    }

    pub async fn get_ward(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<WardListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::WardView,
        )?;
        let ward = common::load_ward(&self.state, id).await?;
        Ok(object(ward))
    }

    pub async fn update_ward(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        payload: UpdateWardRequest,
    ) -> Result<ObjectResponse<WardListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::WardManageBeds,
        )?;

        let code = common::normalize_ward_text(payload.code, common::MAX_WARD_CODE_LEN)?;
        let name = common::normalize_ward_text(payload.name, common::MAX_WARD_NAME_LEN)?;
        if code.is_none() && name.is_none() && payload.status.is_none() {
            return Err(ApiError::bad_request(
                "invalid_ward",
                "At least one ward field is required.",
            ));
        }

        let ward = hms_db::ward::update_ward(
            self.state.db_pool(),
            self.state.facility_id(),
            id,
            WardUpdate {
                code,
                name,
                status: payload.status,
            },
        )
        .await
        .map_err(|_| ApiError::conflict("ward_update_failed", "Ward could not be updated."))?
        .ok_or_else(|| ApiError::not_found("ward_not_found", "Ward was not found."))?;

        Ok(object(ward))
    }

    pub async fn list_ward_sections(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        query: CursorListQuery,
    ) -> Result<ListResponse<WardSectionListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::WardView,
        )?;
        let _ward = common::load_ward(&self.state, id).await?;
        let page = common::page_request(query)?;
        let page_size = page.limit;
        let fetch_limit = page.fetch_limit();
        let rows = hms_db::ward::list_ward_sections(
            self.state.db_pool(),
            self.state.facility_id(),
            id,
            page.cursor,
            fetch_limit,
        )
        .await
        .map_err(|_| {
            ApiError::conflict("ward_sections_failed", "Ward sections could not be loaded.")
        })?;

        Ok(common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.created_at, item.id)
        }))
    }

    pub async fn get_ward_section(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<WardSectionListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::WardView,
        )?;
        let section = common::load_ward_section(&self.state, id).await?;
        Ok(object(section))
    }

    pub async fn update_ward_section(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        payload: UpdateWardSectionRequest,
    ) -> Result<ObjectResponse<WardSectionListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::WardManageBeds,
        )?;

        let code = common::normalize_ward_text(payload.code, common::MAX_WARD_CODE_LEN)?;
        let name = common::normalize_ward_text(payload.name, common::MAX_WARD_NAME_LEN)?;
        if code.is_none() && name.is_none() && payload.status.is_none() {
            return Err(ApiError::bad_request(
                "invalid_ward_section",
                "At least one ward section field is required.",
            ));
        }

        let section = hms_db::ward::update_ward_section(
            self.state.db_pool(),
            self.state.facility_id(),
            id,
            WardSectionUpdate {
                code,
                name,
                status: payload.status,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "ward_section_update_failed",
                "Ward section could not be updated.",
            )
        })?
        .ok_or_else(|| {
            ApiError::not_found("ward_section_not_found", "Ward section was not found.")
        })?;

        Ok(object(section))
    }

    pub async fn create_ward_section(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        payload: CreateWardSectionRequest,
    ) -> Result<ObjectResponse<WardSectionListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::WardManageBeds,
        )?;
        let _ward = common::load_ward(&self.state, id).await?;
        let code = payload.code.trim();
        let name = payload.name.trim();
        if code.is_empty() || name.is_empty() {
            return Err(ApiError::bad_request(
                "invalid_ward_section",
                "Section code and name are required.",
            ));
        }

        let section = hms_db::ward::create_ward_section(
            self.state.db_pool(),
            NewWardSection {
                id: Uuid::new_v4(),
                facility_id: self.state.facility_id(),
                ward_id: id,
                code: code.to_owned(),
                name: name.to_owned(),
                actor_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "ward_section_create_failed",
                "Ward section could not be created.",
            )
        })?;

        Ok(object(section))
    }
}
