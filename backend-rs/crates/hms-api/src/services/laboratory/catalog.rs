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

    pub async fn list_test_catalog(
        &self,
        ctx: &hms_access::RequestContext,
    ) -> Result<ListResponse<LabTestCatalogItem>, ApiError> {
        common::require_laboratory_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::LaboratoryOrderManage,
        )?;
        let tests = self.state.list_lab_test_catalog().await.map_err(|_| {
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
            self.state.facility_id(),
            PermissionCode::LaboratoryOrderManage,
        )?;
        let test = self
            .state
            .get_lab_test_catalog_item(id)
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
            self.state.facility_id(),
            PermissionCode::LaboratoryOrderManage,
        )?;
        let panels = self.state.list_lab_panels().await.map_err(|_| {
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
            self.state.facility_id(),
            PermissionCode::LaboratoryOrderManage,
        )?;
        let panel = self
            .state
            .get_lab_panel(id)
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
