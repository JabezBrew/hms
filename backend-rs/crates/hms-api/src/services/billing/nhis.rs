use hms_db::billing::{NewClaim, NewNhisBatch, NewRemittanceImport};
use hms_domain::billing::{
    BillingListQuery, ClaimListItem, CreateClaimRequest, CreateNhisBatchRequest,
    CreateRemittanceImportRequest, NhisBatchExport, NhisBatchListItem, RemittanceImportListItem,
};
use uuid::Uuid;

use super::common;
use crate::error::ApiError;
use crate::response::{object, ListResponse, ObjectResponse};
use crate::state::AppState;

#[derive(Clone)]
pub struct NhisService {
    state: AppState,
}

impl NhisService {
    pub(super) fn new(state: AppState) -> Self {
        Self { state }
    }

    fn facility_id(&self) -> Uuid {
        self.state.facility_id()
    }

    fn pool(&self) -> &hms_db::PgPool {
        self.state.db_pool()
    }

    pub async fn list_claims(
        &self,
        ctx: &hms_access::RequestContext,
        query: BillingListQuery,
    ) -> Result<ListResponse<ClaimListItem>, ApiError> {
        common::require_nhis_access(ctx, self.facility_id())?;
        let (cursor, page_size) = common::page_request(query)?;
        let rows = hms_db::billing::list_claims(
            self.pool(),
            self.facility_id(),
            cursor,
            page_size as i64 + 1,
        )
        .await
        .map_err(|_| ApiError::conflict("claim_list_failed", "Claims could not be loaded."))?;
        Ok(common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.created_at, item.id)
        }))
    }

    pub async fn get_claim(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<ClaimListItem>, ApiError> {
        common::require_nhis_access(ctx, self.facility_id())?;
        let claim = hms_db::billing::get_claim(self.pool(), self.facility_id(), id)
            .await
            .map_err(|_| ApiError::conflict("claim_load_failed", "Claim could not be loaded."))?
            .ok_or_else(|| ApiError::not_found("claim_not_found", "Claim was not found."))?;
        let _patient = common::load_patient_for_access(&self.state, ctx, claim.patient_id).await?;

        Ok(object(claim))
    }

    pub async fn create_claim(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateClaimRequest,
    ) -> Result<ObjectResponse<ClaimListItem>, ApiError> {
        common::require_nhis_access(ctx, self.facility_id())?;
        common::require_invoice_patient_access(&self.state, ctx, payload.invoice_id).await?;
        let id = Uuid::new_v4();
        let claim = hms_db::billing::create_claim(
            self.pool(),
            NewClaim {
                id,
                facility_id: self.facility_id(),
                invoice_id: payload.invoice_id,
                claim_number: format!("CLM-{}", &id.simple().to_string()[..10].to_uppercase()),
                actor_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| ApiError::conflict("claim_create_failed", "Claim could not be saved."))?;
        Ok(object(claim))
    }

    pub async fn list_batches(
        &self,
        ctx: &hms_access::RequestContext,
        query: BillingListQuery,
    ) -> Result<ListResponse<NhisBatchListItem>, ApiError> {
        common::require_nhis_access(ctx, self.facility_id())?;
        let (cursor, page_size) = common::page_request(query)?;
        let rows = hms_db::billing::list_nhis_batches(
            self.pool(),
            self.facility_id(),
            cursor,
            page_size as i64 + 1,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "nhis_batch_list_failed",
                "NHIS batches could not be loaded.",
            )
        })?;
        Ok(common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.created_at, item.id)
        }))
    }

    pub async fn create_batch(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateNhisBatchRequest,
    ) -> Result<ObjectResponse<NhisBatchListItem>, ApiError> {
        common::require_nhis_access(ctx, self.facility_id())?;
        common::validate_claim_ids(&payload.claim_ids)?;
        let contexts =
            hms_db::billing::claim_contexts(self.pool(), self.facility_id(), &payload.claim_ids)
                .await
                .map_err(|_| {
                    ApiError::conflict("claim_load_failed", "Claims could not be loaded.")
                })?;
        if contexts.len() != payload.claim_ids.len() {
            return Err(ApiError::not_found(
                "claim_not_found",
                "One or more claims were not found.",
            ));
        }
        for context in contexts {
            let _patient =
                common::load_patient_for_access(&self.state, ctx, context.patient_id).await?;
        }
        let id = Uuid::new_v4();
        let batch = hms_db::billing::create_nhis_batch(
            self.pool(),
            NewNhisBatch {
                id,
                facility_id: self.facility_id(),
                batch_number: format!("NHB-{}", &id.simple().to_string()[..10].to_uppercase()),
                claim_ids: payload.claim_ids,
                actor_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict("nhis_batch_create_failed", "NHIS batch could not be saved.")
        })?;
        Ok(object(batch))
    }

    pub async fn export_batch(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<NhisBatchExport>, ApiError> {
        common::require_nhis_access(ctx, self.facility_id())?;
        let exported = hms_db::billing::export_nhis_batch(self.pool(), self.facility_id(), id)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "nhis_batch_export_failed",
                    "NHIS batch could not be exported.",
                )
            })?
            .ok_or_else(|| {
                ApiError::not_found("nhis_batch_not_found", "NHIS batch was not found.")
            })?;
        Ok(object(exported))
    }

    pub async fn list_remittance_imports(
        &self,
        ctx: &hms_access::RequestContext,
        query: BillingListQuery,
    ) -> Result<ListResponse<RemittanceImportListItem>, ApiError> {
        common::require_nhis_access(ctx, self.facility_id())?;
        let (cursor, page_size) = common::page_request(query)?;
        let rows = hms_db::billing::list_remittance_imports(
            self.pool(),
            self.facility_id(),
            cursor,
            page_size as i64 + 1,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "remittance_list_failed",
                "Remittance imports could not be loaded.",
            )
        })?;
        Ok(common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.imported_at, item.id)
        }))
    }

    pub async fn create_remittance_import(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateRemittanceImportRequest,
    ) -> Result<ObjectResponse<RemittanceImportListItem>, ApiError> {
        common::require_nhis_access(ctx, self.facility_id())?;
        common::require_positive(payload.total_paid_minor, "total_paid_minor")?;
        let reference = common::normalize_text(payload.reference, "reference")?;
        let remittance = hms_db::billing::create_remittance_import(
            self.pool(),
            NewRemittanceImport {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                batch_id: payload.batch_id,
                reference,
                total_paid_minor: payload.total_paid_minor,
                actor_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "remittance_create_failed",
                "Remittance import could not be saved.",
            )
        })?;
        Ok(object(remittance))
    }
}
