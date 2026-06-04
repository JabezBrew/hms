use hms_db::billing::{BillingRuleFilters, ServiceCatalogFilters};
use hms_domain::billing::{
    BillingRuleListItem, BillingRuleListQuery, ServiceCatalogItem, ServiceCatalogQuery,
    ServicePriceListItem,
};
use hms_domain::deployment::PermissionCode;
use uuid::Uuid;

use super::common;
use crate::error::ApiError;
use crate::response::{list, object, ListResponse, ObjectResponse, PageInfo};
use crate::state::AppState;

#[derive(Clone)]
pub struct BillingCatalogService {
    state: AppState,
}

impl BillingCatalogService {
    pub(super) fn new(state: AppState) -> Self {
        Self { state }
    }

    fn facility_id(&self) -> Uuid {
        self.state.facility_id()
    }

    fn pool(&self) -> &hms_db::PgPool {
        self.state.db_pool()
    }

    pub async fn list_service_catalog(
        &self,
        ctx: &hms_access::RequestContext,
        query: ServiceCatalogQuery,
    ) -> Result<ListResponse<ServiceCatalogItem>, ApiError> {
        common::require_billing_access(ctx, self.facility_id(), PermissionCode::BillingView)?;
        let (cursor, page_size) = common::decode_page(query.cursor.as_deref(), query.limit)?;
        let rows = hms_db::billing::list_service_catalog(
            self.pool(),
            self.facility_id(),
            cursor,
            page_size as i64 + 1,
            ServiceCatalogFilters {
                search: query.search,
                is_active: query.is_active,
                service_id: query.service_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "service_catalog_failed",
                "Service catalog could not be loaded.",
            )
        })?;

        Ok(common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.created_at, item.id)
        }))
    }

    pub async fn list_service_prices(
        &self,
        ctx: &hms_access::RequestContext,
    ) -> Result<ListResponse<ServicePriceListItem>, ApiError> {
        common::require_billing_access(ctx, self.facility_id(), PermissionCode::BillingView)?;
        let prices = hms_db::billing::list_service_prices(self.pool(), self.facility_id())
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "service_price_failed",
                    "Service prices could not be loaded.",
                )
            })?;

        Ok(common::static_list(prices))
    }

    pub async fn list_billing_rules(
        &self,
        ctx: &hms_access::RequestContext,
        query: BillingRuleListQuery,
    ) -> Result<ListResponse<BillingRuleListItem>, ApiError> {
        common::require_billing_access(ctx, self.facility_id(), PermissionCode::BillingView)?;
        let page_size = query
            .limit
            .unwrap_or(common::DEFAULT_LIMIT)
            .clamp(1, common::MAX_LIMIT);
        let rules = hms_db::billing::list_billing_rules(
            self.pool(),
            self.facility_id(),
            BillingRuleFilters {
                rule_type: query.rule_type,
                is_active: query.is_active,
            },
            page_size as i64,
        )
        .await
        .map_err(|_| {
            ApiError::conflict("billing_rule_failed", "Billing rules could not be loaded.")
        })?;

        Ok(list(
            rules,
            PageInfo {
                next_cursor: None,
                has_next: false,
                limit: page_size,
            },
        ))
    }

    pub async fn get_billing_rule(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<BillingRuleListItem>, ApiError> {
        common::require_billing_access(ctx, self.facility_id(), PermissionCode::BillingView)?;
        let rule = hms_db::billing::get_billing_rule(self.pool(), self.facility_id(), id)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "billing_rule_load_failed",
                    "Billing rule could not be loaded.",
                )
            })?
            .ok_or_else(|| {
                ApiError::not_found("billing_rule_not_found", "Billing rule was not found.")
            })?;

        Ok(object(rule))
    }
}
