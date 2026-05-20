use hms_domain::deployment::PermissionCode;
use hms_domain::laboratory::{LabPanelListItem, LabTestCatalogItem};
use uuid::Uuid;

use super::common;
use crate::error::ApiError;
use crate::response::{object, ListResponse, ObjectResponse};
use crate::state::AppState;

#[derive(Clone)]
pub struct LabCatalogService {
    state: AppState,
}

impl LabCatalogService {
    pub(super) fn new(state: AppState) -> Self {
        Self { state }
    }

    fn facility_id(&self) -> Uuid {
        self.state.facility_id()
    }

    fn pool(&self) -> &hms_db::PgPool {
        self.state.db_pool()
    }

    pub async fn list_test_catalog(
        &self,
        ctx: &hms_access::RequestContext,
    ) -> Result<ListResponse<LabTestCatalogItem>, ApiError> {
        common::require_laboratory_access(
            ctx,
            self.facility_id(),
            PermissionCode::LaboratoryOrderManage,
        )?;
        let tests = hms_db::laboratory::list_test_catalog(self.pool(), self.facility_id())
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "lab_catalog_list_failed",
                    "Laboratory test catalog could not be loaded.",
                )
            })?;

        Ok(common::static_list(tests))
    }

    pub async fn get_test_catalog_item(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<LabTestCatalogItem>, ApiError> {
        common::require_laboratory_access(
            ctx,
            self.facility_id(),
            PermissionCode::LaboratoryOrderManage,
        )?;
        let test = hms_db::laboratory::get_test_catalog_item(self.pool(), self.facility_id(), id)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "lab_catalog_item_load_failed",
                    "Laboratory test could not be loaded.",
                )
            })?
            .ok_or_else(|| {
                ApiError::not_found(
                    "lab_catalog_item_not_found",
                    "Laboratory test was not found.",
                )
            })?;

        Ok(object(test))
    }

    pub async fn list_panels(
        &self,
        ctx: &hms_access::RequestContext,
    ) -> Result<ListResponse<LabPanelListItem>, ApiError> {
        common::require_laboratory_access(
            ctx,
            self.facility_id(),
            PermissionCode::LaboratoryOrderManage,
        )?;
        let panels = hms_db::laboratory::list_panels(self.pool(), self.facility_id())
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "lab_panel_list_failed",
                    "Laboratory panels could not be loaded.",
                )
            })?;

        Ok(common::static_list(panels))
    }

    pub async fn get_panel(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<LabPanelListItem>, ApiError> {
        common::require_laboratory_access(
            ctx,
            self.facility_id(),
            PermissionCode::LaboratoryOrderManage,
        )?;
        let panel = hms_db::laboratory::get_panel_by_id(self.pool(), self.facility_id(), id)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "lab_panel_load_failed",
                    "Laboratory panel could not be loaded.",
                )
            })?
            .ok_or_else(|| {
                ApiError::not_found("lab_panel_not_found", "Laboratory panel was not found.")
            })?;

        Ok(object(panel))
    }
}
