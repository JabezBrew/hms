use chrono::{DateTime, Utc};
use hms_db::ward::{BedUpdate, NewBed};
use hms_domain::care::CursorListQuery;
use hms_domain::deployment::PermissionCode;
use hms_domain::ward::{BedListItem, CreateBedRequest, UpdateBedRequest};
use uuid::Uuid;

use super::common;
use crate::error::ApiError;
use crate::response::{object, ListResponse, ObjectResponse};
use crate::state::AppState;

#[derive(Clone)]
pub struct BedManagementService {
    state: AppState,
}

impl BedManagementService {
    pub(super) fn new(state: AppState) -> Self {
        Self { state }
    }

    pub async fn list_section_beds(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        query: CursorListQuery,
    ) -> Result<ListResponse<BedListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::WardView,
        )?;
        let _section = common::load_ward_section(&self.state, id).await?;
        let page = common::page_request(query)?;
        let page_size = page.limit;
        let fetch_limit = page.fetch_limit();
        let rows = hms_db::ward::list_section_beds(
            self.state.db_pool(),
            self.state.facility_id(),
            id,
            page.cursor,
            fetch_limit,
        )
        .await
        .map_err(|_| {
            ApiError::conflict("section_beds_failed", "Section beds could not be loaded.")
        })?;

        Ok(common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.created_at, item.id)
        }))
    }

    pub async fn list_ward_beds(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        query: CursorListQuery,
    ) -> Result<ListResponse<BedListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::WardView,
        )?;
        let _ward = common::load_ward(&self.state, id).await?;
        let page = common::page_request(query)?;
        let page_size = page.limit;
        let fetch_limit = page.fetch_limit();
        let rows = hms_db::ward::list_ward_beds(
            self.state.db_pool(),
            self.state.facility_id(),
            id,
            page.cursor,
            fetch_limit,
        )
        .await
        .map_err(|_| ApiError::conflict("ward_beds_failed", "Ward beds could not be loaded."))?;

        Ok(common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.created_at, item.id)
        }))
    }

    pub async fn get_bed(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<BedListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::WardView,
        )?;
        let bed = common::load_bed(&self.state, id).await?;
        Ok(object(bed))
    }

    pub async fn update_bed(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        payload: UpdateBedRequest,
    ) -> Result<ObjectResponse<BedListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::WardManageBeds,
        )?;

        let bed_code = common::normalize_bed_code(payload.bed_code)?;
        if payload.section_id.is_none() && bed_code.is_none() && payload.status.is_none() {
            return Err(ApiError::bad_request(
                "invalid_bed",
                "At least one bed field is required.",
            ));
        }
        if let Some(section_id) = payload.section_id {
            let bed = common::load_bed(&self.state, id).await?;
            let section = common::load_ward_section(&self.state, section_id).await?;
            if section.ward_id != bed.ward_id {
                return Err(ApiError::bad_request(
                    "invalid_bed_section",
                    "Bed section must belong to the same ward.",
                ));
            }
        }

        let bed = hms_db::ward::update_bed(
            self.state.db_pool(),
            self.state.facility_id(),
            id,
            BedUpdate {
                section_id: payload.section_id,
                bed_code,
                status: payload.status,
            },
        )
        .await
        .map_err(|_| ApiError::conflict("bed_update_failed", "Bed could not be updated."))?
        .ok_or_else(|| ApiError::not_found("bed_not_found", "Bed was not found."))?;

        Ok(object(bed))
    }

    pub async fn create_bed(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        payload: CreateBedRequest,
    ) -> Result<ObjectResponse<BedListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::WardManageBeds,
        )?;
        let _ward = common::load_ward(&self.state, id).await?;
        let bed_code = payload.bed_code.trim();
        if bed_code.is_empty() {
            return Err(ApiError::bad_request(
                "invalid_bed",
                "Bed code is required.",
            ));
        }

        let bed = hms_db::ward::create_bed(
            self.state.db_pool(),
            NewBed {
                id: Uuid::new_v4(),
                facility_id: self.state.facility_id(),
                ward_id: id,
                section_id: payload.section_id,
                bed_code: bed_code.to_owned(),
                actor_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| ApiError::conflict("bed_create_failed", "Bed could not be created."))?;

        Ok(object(bed))
    }

    pub async fn release_due_cleaning_beds(
        &self,
        now: DateTime<Utc>,
        limit: i64,
    ) -> Result<u64, ApiError> {
        hms_db::ward::release_cleaned_beds(
            self.state.db_pool(),
            self.state.facility_id(),
            now,
            limit,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "bed_cleaning_release_failed",
                "Cleaned beds could not be released.",
            )
        })
    }
}
