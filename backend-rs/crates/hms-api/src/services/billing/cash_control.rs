use hms_db::billing::CashSessionFilters;
use hms_domain::billing::{
    CashDrawerListItem, CashSessionListItem, CashSessionListQuery, CloseCashSessionRequest,
    OpenCashSessionRequest,
};
use hms_domain::deployment::PermissionCode;
use uuid::Uuid;

use super::common;
use crate::error::ApiError;
use crate::response::{object, ListResponse, ObjectResponse};
use crate::state::AppState;

#[derive(Clone)]
pub struct CashControlService {
    state: AppState,
}

impl CashControlService {
    pub(super) fn new(state: AppState) -> Self {
        Self { state }
    }

    pub async fn list_cash_drawers(
        &self,
        ctx: &hms_access::RequestContext,
    ) -> Result<ListResponse<CashDrawerListItem>, ApiError> {
        common::require_billing_access(ctx, self.state.facility_id(), PermissionCode::BillingView)?;
        let drawers = self.state.list_cash_drawers().await.map_err(|_| {
            ApiError::conflict(
                "cash_drawer_list_failed",
                "Cash drawers could not be loaded.",
            )
        })?;

        Ok(common::static_list(drawers))
    }

    pub async fn list_cash_sessions(
        &self,
        ctx: &hms_access::RequestContext,
        query: CashSessionListQuery,
    ) -> Result<ListResponse<CashSessionListItem>, ApiError> {
        common::require_billing_access(ctx, self.state.facility_id(), PermissionCode::BillingView)?;
        let (cursor, page_size) = common::decode_page(query.cursor.as_deref(), query.limit)?;
        let rows = self
            .state
            .list_cash_sessions(
                cursor,
                page_size as i64 + 1,
                CashSessionFilters {
                    status: query.status,
                },
            )
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "cash_session_list_failed",
                    "Cash sessions could not be loaded.",
                )
            })?;

        Ok(common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.opened_at, item.id)
        }))
    }

    pub async fn get_cash_session(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<CashSessionListItem>, ApiError> {
        common::require_billing_access(ctx, self.state.facility_id(), PermissionCode::BillingView)?;
        let session = self
            .state
            .get_cash_session(id)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "cash_session_detail_failed",
                    "Cash session could not be loaded.",
                )
            })?
            .ok_or_else(|| {
                ApiError::not_found("cash_session_not_found", "Cash session was not found.")
            })?;

        Ok(object(session))
    }

    pub async fn open_cash_session(
        &self,
        ctx: &hms_access::RequestContext,
        payload: OpenCashSessionRequest,
    ) -> Result<ObjectResponse<CashSessionListItem>, ApiError> {
        common::require_billing_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::BillingManage,
        )?;
        common::require_non_negative(payload.opening_float_minor, "opening_float_minor")?;
        let session = self
            .state
            .open_cash_session(payload.drawer_id, payload.opening_float_minor, ctx.user_id)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "cash_session_open_failed",
                    "Cash session could not be opened.",
                )
            })?;

        Ok(object(session))
    }

    pub async fn close_cash_session(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        payload: CloseCashSessionRequest,
    ) -> Result<ObjectResponse<CashSessionListItem>, ApiError> {
        common::require_billing_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::BillingManage,
        )?;
        common::require_non_negative(payload.counted_cash_minor, "counted_cash_minor")?;
        let session = self
            .state
            .close_cash_session(id, payload, ctx.user_id)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "cash_session_close_failed",
                    "Cash session could not be closed.",
                )
            })?
            .ok_or_else(|| {
                ApiError::not_found("cash_session_not_found", "Open cash session was not found.")
            })?;

        Ok(object(session))
    }
}
