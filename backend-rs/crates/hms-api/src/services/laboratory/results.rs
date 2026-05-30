use hms_db::laboratory::{LabResultListFilters, NewLabResult};
use hms_domain::deployment::PermissionCode;
use hms_domain::laboratory::{
    BulkCreateLabResultsRequest, BulkCreateLabResultsResponse, BulkVerifyLabResultsRequest,
    BulkVerifyLabResultsResponse, CreateLabResultRequest, LabResultListItem,
    LaboratoryResultListQuery,
};
use uuid::Uuid;

use super::common;
use crate::error::ApiError;
use crate::response::{object, ListResponse, ObjectResponse};
use crate::state::AppState;

#[derive(Clone)]
pub struct LabResultsService {
    state: AppState,
}

impl LabResultsService {
    pub(super) fn new(state: AppState) -> Self {
        Self { state }
    }

    fn facility_id(&self) -> Uuid {
        self.state.facility_id()
    }

    fn pool(&self) -> &hms_db::PgPool {
        self.state.db_pool()
    }

    pub async fn list_results(
        &self,
        ctx: &hms_access::RequestContext,
        query: LaboratoryResultListQuery,
    ) -> Result<ListResponse<LabResultListItem>, ApiError> {
        common::require_laboratory_list_access(ctx, self.facility_id())?;
        let (cursor, page_size) = common::page_request(query.cursor, query.limit)?;
        let rows = hms_db::laboratory::list_results(
            self.pool(),
            self.facility_id(),
            cursor,
            page_size as i64 + 1,
            LabResultListFilters {
                status: query.status,
                is_verified: query.is_verified,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict("lab_result_list_failed", "Lab results could not be loaded.")
        })?;

        Ok(common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.entered_at, item.id)
        }))
    }

    pub async fn get_result(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<LabResultListItem>, ApiError> {
        common::require_laboratory_list_access(ctx, self.facility_id())?;
        let _context = common::load_result_for_access(&self.state, ctx, id).await?;
        let result = hms_db::laboratory::get_result_by_id(self.pool(), self.facility_id(), id)
            .await
            .map_err(|_| {
                ApiError::conflict("lab_result_load_failed", "Lab result could not be loaded.")
            })?
            .ok_or_else(|| {
                ApiError::not_found("lab_result_not_found", "Lab result was not found.")
            })?;

        Ok(object(result))
    }

    pub async fn create_result(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateLabResultRequest,
    ) -> Result<ObjectResponse<LabResultListItem>, ApiError> {
        common::require_laboratory_access(
            ctx,
            self.facility_id(),
            PermissionCode::LaboratoryOrderManage,
        )?;
        let specimen =
            common::load_specimen_for_access(&self.state, ctx, payload.specimen_id).await?;
        let value = common::normalize_text(payload.value, "value")?;
        let unit = common::normalize_optional_text(payload.unit, "unit")?;
        let result = hms_db::laboratory::create_result(
            self.pool(),
            NewLabResult {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                specimen_id: specimen.id,
                order_id: specimen.order_id,
                patient_id: specimen.patient_id,
                test_id: payload.test_id,
                value,
                unit,
                actor_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict("lab_result_create_failed", "Lab result could not be saved.")
        })?;

        self.state.invalidate_patient_chronicle_cache();
        Ok(object(result))
    }

    pub async fn bulk_create_results(
        &self,
        ctx: &hms_access::RequestContext,
        payload: BulkCreateLabResultsRequest,
    ) -> Result<ObjectResponse<BulkCreateLabResultsResponse>, ApiError> {
        common::require_laboratory_access(
            ctx,
            self.facility_id(),
            PermissionCode::LaboratoryOrderManage,
        )?;
        if payload.results.is_empty() {
            return Err(common::validation_error(
                "results",
                "At least one result is required.",
            ));
        }
        if payload.results.len() > common::MAX_BULK_CREATE_RESULTS {
            return Err(common::validation_error(
                "results",
                "Too many results were provided.",
            ));
        }

        let specimen =
            common::load_specimen_for_access(&self.state, ctx, payload.specimen_id).await?;
        if specimen.order_id != payload.order_id {
            return Err(common::validation_error(
                "specimen_id",
                "Specimen does not belong to the selected order.",
            ));
        }

        let mut results = Vec::with_capacity(payload.results.len());
        for item in payload.results {
            let test_id = common::result_item_test_id(item.order_test_id, item.test_id)?;
            let value = common::normalize_text(item.value, "value")?;
            let unit = common::normalize_optional_text(item.unit, "unit")?;
            results.push((test_id, value, unit));
        }

        let records = results
            .into_iter()
            .map(|(test_id, value, unit)| NewLabResult {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                specimen_id: specimen.id,
                order_id: specimen.order_id,
                patient_id: specimen.patient_id,
                test_id,
                value,
                unit,
                actor_user_id: ctx.user_id,
            })
            .collect();
        let created = hms_db::laboratory::create_results(
            self.pool(),
            self.facility_id(),
            specimen.order_id,
            records,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "lab_results_bulk_create_failed",
                "Lab results could not be saved.",
            )
        })?;
        let created_count = created.len() as i64;

        self.state.invalidate_patient_chronicle_cache();
        Ok(object(BulkCreateLabResultsResponse {
            created_count,
            message: format!("{created_count} lab results saved"),
            results: created,
        }))
    }

    pub async fn verify_result(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<LabResultListItem>, ApiError> {
        common::require_laboratory_access(
            ctx,
            self.facility_id(),
            PermissionCode::LaboratoryResultVerify,
        )?;
        let _result_context = common::load_result_for_access(&self.state, ctx, id).await?;
        let result =
            hms_db::laboratory::verify_result(self.pool(), self.facility_id(), id, ctx.user_id)
                .await
                .map_err(|_| {
                    ApiError::conflict(
                        "lab_result_verify_failed",
                        "Lab result could not be verified.",
                    )
                })?
                .ok_or_else(|| {
                    ApiError::not_found("lab_result_not_found", "Lab result was not found.")
                })?;

        self.state.invalidate_patient_chronicle_cache();
        Ok(object(result))
    }

    pub async fn bulk_verify_results(
        &self,
        ctx: &hms_access::RequestContext,
        payload: BulkVerifyLabResultsRequest,
    ) -> Result<ObjectResponse<BulkVerifyLabResultsResponse>, ApiError> {
        common::require_laboratory_access(
            ctx,
            self.facility_id(),
            PermissionCode::LaboratoryResultVerify,
        )?;
        let result_ids = common::unique_result_ids(payload.result_ids)?;
        if payload.order_id.is_none() && result_ids.is_empty() {
            return Err(common::validation_error(
                "results",
                "Provide an order id or at least one result id.",
            ));
        }
        if payload.order_id.is_some() && !result_ids.is_empty() {
            return Err(common::validation_error(
                "results",
                "Provide either an order id or result ids, not both.",
            ));
        }
        let _verification_notes =
            common::normalize_optional_text(payload.verification_notes, "verification_notes")?;

        if let Some(order_id) = payload.order_id {
            let _order = common::load_order_for_access(&self.state, ctx, order_id).await?;
        } else {
            for result_id in &result_ids {
                let _result = common::load_result_for_access(&self.state, ctx, *result_id).await?;
            }
        }

        let verified_count = hms_db::laboratory::verify_results(
            self.pool(),
            self.facility_id(),
            payload.order_id,
            &result_ids,
            ctx.user_id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "lab_results_bulk_verify_failed",
                "Lab results could not be verified.",
            )
        })?;

        self.state.invalidate_patient_chronicle_cache();
        Ok(object(BulkVerifyLabResultsResponse {
            verified_count,
            message: format!("{verified_count} lab results verified"),
        }))
    }
}
