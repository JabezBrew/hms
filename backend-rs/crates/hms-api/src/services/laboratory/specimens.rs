use hms_db::laboratory::NewSpecimen;
use hms_domain::deployment::PermissionCode;
use hms_domain::laboratory::{CreateSpecimenRequest, LaboratoryListQuery, SpecimenListItem};
use uuid::Uuid;

use super::common;
use crate::error::ApiError;
use crate::response::{object, ListResponse, ObjectResponse};
use crate::state::AppState;

#[derive(Clone)]
pub struct LabSpecimensService {
    state: AppState,
}

impl LabSpecimensService {
    pub(super) fn new(state: AppState) -> Self {
        Self { state }
    }

    fn facility_id(&self) -> Uuid {
        self.state.facility_id()
    }

    fn pool(&self) -> &hms_db::PgPool {
        self.state.db_pool()
    }

    pub async fn list_specimens(
        &self,
        ctx: &hms_access::RequestContext,
        query: LaboratoryListQuery,
    ) -> Result<ListResponse<SpecimenListItem>, ApiError> {
        common::require_laboratory_list_access(ctx, self.facility_id())?;
        let (cursor, page_size) = common::page_request(query.cursor, query.limit)?;
        let rows = hms_db::laboratory::list_specimens(
            self.pool(),
            self.facility_id(),
            cursor,
            page_size as i64 + 1,
        )
        .await
        .map_err(|_| {
            ApiError::conflict("specimen_list_failed", "Specimens could not be loaded.")
        })?;

        Ok(common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.collected_at, item.id)
        }))
    }

    pub async fn get_specimen(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<SpecimenListItem>, ApiError> {
        common::require_laboratory_list_access(ctx, self.facility_id())?;
        let _context = common::load_specimen_for_access(&self.state, ctx, id).await?;
        let specimen = hms_db::laboratory::get_specimen_by_id(self.pool(), self.facility_id(), id)
            .await
            .map_err(|_| {
                ApiError::conflict("specimen_load_failed", "Specimen could not be loaded.")
            })?
            .ok_or_else(|| ApiError::not_found("specimen_not_found", "Specimen was not found."))?;

        Ok(object(specimen))
    }

    pub async fn create_specimen(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateSpecimenRequest,
    ) -> Result<ObjectResponse<SpecimenListItem>, ApiError> {
        common::require_laboratory_access(
            ctx,
            self.facility_id(),
            PermissionCode::LaboratoryOrderManage,
        )?;
        let specimen_type = common::normalize_text(payload.specimen_type, "specimen_type")?;
        let order = common::load_order_for_access(&self.state, ctx, payload.order_id).await?;
        let specimen = hms_db::laboratory::create_specimen(
            self.pool(),
            NewSpecimen {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                order_id: order.id,
                patient_id: order.patient_id,
                specimen_type,
                actor_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict("specimen_create_failed", "Specimen could not be saved.")
        })?;

        Ok(object(specimen))
    }

    pub async fn receive_specimen(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<SpecimenListItem>, ApiError> {
        common::require_laboratory_access(
            ctx,
            self.facility_id(),
            PermissionCode::LaboratoryOrderManage,
        )?;
        let _context = common::load_specimen_for_access(&self.state, ctx, id).await?;
        let specimen = hms_db::laboratory::receive_specimen(self.pool(), self.facility_id(), id)
            .await
            .map_err(|_| {
                ApiError::conflict("specimen_receive_failed", "Specimen could not be received.")
            })?
            .ok_or_else(|| ApiError::not_found("specimen_not_found", "Specimen was not found."))?;

        Ok(object(specimen))
    }
}
