use hms_domain::billing::BillingDashboardSummary;
use hms_domain::deployment::PermissionCode;

use super::common;
use crate::error::ApiError;
use crate::response::{object, ObjectResponse};
use crate::state::AppState;

#[derive(Clone)]
pub struct BillingOverviewService {
    state: AppState,
}

impl BillingOverviewService {
    pub(super) fn new(state: AppState) -> Self {
        Self { state }
    }

    pub async fn dashboard_summary(
        &self,
        ctx: &hms_access::RequestContext,
    ) -> Result<ObjectResponse<BillingDashboardSummary>, ApiError> {
        common::require_billing_access(ctx, self.state.facility_id(), PermissionCode::BillingView)?;
        let summary = self.state.billing_dashboard_summary().await.map_err(|_| {
            ApiError::conflict(
                "billing_dashboard_summary_failed",
                "Billing dashboard summary could not be loaded.",
            )
        })?;

        Ok(object(summary))
    }
}
