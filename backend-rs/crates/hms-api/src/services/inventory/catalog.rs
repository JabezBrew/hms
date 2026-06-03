use hms_db::inventory::{
    CatalogEditCommand, InventoryItemFilters, InventoryItemOrdering, StorageLocationFilters,
    SupplierFilters,
};
use hms_domain::deployment::PermissionCode;
use hms_domain::inventory::{
    CreateInventoryCatalogEditRequest, InventoryCatalogVersionItem, InventoryCategoryListItem,
    InventoryDashboardSummary, InventoryDashboardSummaryQuery, InventoryItemListItem,
    InventoryItemsQuery, StorageLocationListItem, StorageLocationListQuery, SupplierListItem,
    SupplierListQuery,
};
use uuid::Uuid;

use super::common::{
    decode_page, encode_cursor, normalize_text, page_response, require_inventory_access,
    static_list,
};
use crate::error::ApiError;
use crate::response::{object, ListResponse, ObjectResponse};
use crate::state::AppState;

#[derive(Clone)]
pub struct InventoryCatalogService {
    state: AppState,
}

impl InventoryCatalogService {
    pub fn new(state: AppState) -> Self {
        Self { state }
    }

    fn facility_id(&self) -> Uuid {
        self.state.facility_id()
    }

    fn pool(&self) -> &hms_db::PgPool {
        self.state.db_pool()
    }

    pub async fn list_categories(
        &self,
        ctx: &hms_access::RequestContext,
    ) -> Result<ListResponse<InventoryCategoryListItem>, ApiError> {
        require_catalog_access(ctx, self.facility_id())?;
        let rows = hms_db::inventory::list_categories(self.pool(), self.facility_id())
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "inventory_category_list_failed",
                    "Categories could not be loaded.",
                )
            })?;
        Ok(static_list(rows))
    }

    pub async fn list_items(
        &self,
        ctx: &hms_access::RequestContext,
        query: InventoryItemsQuery,
    ) -> Result<ListResponse<InventoryItemListItem>, ApiError> {
        require_catalog_access(ctx, self.facility_id())?;
        let (cursor, page_size) = decode_page(query.cursor.as_deref(), query.limit)?;
        let requested_ordering = query
            .ordering
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let ordering = match requested_ordering {
            Some(value) => InventoryItemOrdering::parse(Some(value)).ok_or_else(|| {
                ApiError::bad_request(
                    "invalid_inventory_item_ordering",
                    "Inventory item ordering is invalid.",
                )
            })?,
            None => InventoryItemOrdering::default(),
        };
        let filters = InventoryItemFilters {
            search: query.search,
            category_id: query.category,
            location_id: query.location,
            stock_status: query.status,
            supplier_id: query.supplier,
            ordering,
        };
        let rows = hms_db::inventory::list_items(
            self.pool(),
            self.facility_id(),
            cursor,
            i64::from(page_size) + 1,
            filters,
        )
        .await
        .map_err(|_| {
            ApiError::conflict("inventory_item_list_failed", "Items could not be loaded.")
        })?;
        Ok(page_response(rows, page_size, |item| {
            encode_cursor(item.updated_at, item.id)
        }))
    }

    pub async fn dashboard_summary(
        &self,
        ctx: &hms_access::RequestContext,
        query: InventoryDashboardSummaryQuery,
    ) -> Result<ObjectResponse<InventoryDashboardSummary>, ApiError> {
        require_catalog_access(ctx, self.facility_id())?;
        let expiring_within_days = query.expiring_within_days.unwrap_or(30).clamp(1, 365) as i32;
        let summary = hms_db::inventory::inventory_dashboard_summary(
            self.pool(),
            self.facility_id(),
            expiring_within_days,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "inventory_dashboard_summary_failed",
                "Inventory dashboard summary could not be loaded.",
            )
        })?;
        Ok(object(summary))
    }

    pub async fn get_item(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<InventoryItemListItem>, ApiError> {
        require_catalog_access(ctx, self.facility_id())?;
        let item = hms_db::inventory::get_item(self.pool(), self.facility_id(), id)
            .await
            .map_err(|_| {
                ApiError::conflict("inventory_item_load_failed", "Item could not be loaded.")
            })?
            .ok_or_else(|| {
                ApiError::not_found("inventory_item_not_found", "Item could not be found.")
            })?;
        Ok(object(item))
    }

    pub async fn list_locations(
        &self,
        ctx: &hms_access::RequestContext,
        query: StorageLocationListQuery,
    ) -> Result<ListResponse<StorageLocationListItem>, ApiError> {
        require_catalog_access(ctx, self.facility_id())?;
        let (cursor, page_size) = decode_page(query.cursor.as_deref(), query.limit)?;
        let rows = hms_db::inventory::list_locations(
            self.pool(),
            self.facility_id(),
            cursor,
            i64::from(page_size) + 1,
            StorageLocationFilters {
                search: query.search,
                location_type: query.location_type,
                temperature_zone: query.temperature_zone,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "storage_location_list_failed",
                "Locations could not be loaded.",
            )
        })?;
        Ok(page_response(rows, page_size, |item| {
            encode_cursor(item.created_at, item.id)
        }))
    }

    pub async fn list_suppliers(
        &self,
        ctx: &hms_access::RequestContext,
        query: SupplierListQuery,
    ) -> Result<ListResponse<SupplierListItem>, ApiError> {
        require_catalog_access(ctx, self.facility_id())?;
        let (cursor, page_size) = decode_page(query.cursor.as_deref(), query.limit)?;
        let rows = hms_db::inventory::list_suppliers(
            self.pool(),
            self.facility_id(),
            cursor,
            i64::from(page_size) + 1,
            SupplierFilters {
                search: query.search,
                is_active: query.is_active,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict("supplier_list_failed", "Suppliers could not be loaded.")
        })?;
        Ok(page_response(rows, page_size, |item| {
            encode_cursor(item.created_at, item.id)
        }))
    }

    pub async fn get_location(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<StorageLocationListItem>, ApiError> {
        require_catalog_access(ctx, self.facility_id())?;
        let location = hms_db::inventory::get_location(self.pool(), self.facility_id(), id)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "storage_location_load_failed",
                    "Location could not be loaded.",
                )
            })?
            .ok_or_else(|| {
                ApiError::not_found("storage_location_not_found", "Location could not be found.")
            })?;
        Ok(object(location))
    }

    pub async fn apply_catalog_edit(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateInventoryCatalogEditRequest,
    ) -> Result<ObjectResponse<InventoryCatalogVersionItem>, ApiError> {
        require_inventory_access(ctx, self.facility_id(), PermissionCode::InventoryManage)?;
        let edit = hms_db::inventory::apply_catalog_edit(
            self.pool(),
            CatalogEditCommand {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                item_id: payload.item_id,
                effective_from: payload.effective_from,
                code: normalize_text(payload.code, "code")?,
                name: normalize_text(payload.name, "name")?,
                unit: normalize_text(payload.unit, "unit")?,
                reason: normalize_text(payload.reason, "reason")?,
                actor_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "inventory_catalog_edit_failed",
                "Inventory catalog edit could not be saved.",
            )
        })?;
        Ok(object(edit))
    }
}

fn require_catalog_access(
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
) -> Result<(), ApiError> {
    require_inventory_access(ctx, facility_id, PermissionCode::InventoryView)
}
