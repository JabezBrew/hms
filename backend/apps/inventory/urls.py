"""
URL configuration for inventory app.

Registers all inventory-related API endpoints including:
- Storage locations (multi-location support)
- Location stock
- Stock transfers and availability checks
- Batch recommendations (FEFO)
- Inventory items, categories, suppliers
- Stock movements, expiry tracking
- Inventory audits
- Purchase requisitions (Phase 3)
- Purchase orders (Phase 3)
- Goods received notes (Phase 3)
- Internal requisitions (Phase 4)
- Standing orders (Phase 4)
- Stock transfer requests (Phase 4)
- Controlled substance registers (Phase 5)
- Controlled substance entries (Phase 5)
- Controlled substance operations (Phase 5)
- Controlled substance discrepancies (Phase 5)
- Analytics and reporting (Phase 6)
"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    InventoryCategoryViewSet, SupplierViewSet, InventoryItemViewSet,
    StockMovementViewSet, ExpiryTrackerViewSet, InventoryAuditViewSet,
    InventoryAuditItemViewSet,
    # Phase 1: Multi-Location
    StorageLocationViewSet, LocationStockViewSet,
    StockTransferViewSet, StockAvailabilityViewSet, BatchRecommendationViewSet,
    # Phase 3: Procurement
    PurchaseRequisitionViewSet, PurchaseOrderViewSet, GoodsReceivedNoteViewSet,
    # Phase 4: Internal Logistics
    InternalRequisitionViewSet, StandingOrderViewSet, StockTransferRequestViewSet,
    # Phase 5: Controlled Substances
    ControlledSubstanceRegisterViewSet, ControlledSubstanceEntryViewSet,
    ControlledSubstanceOperationsViewSet, ControlledSubstanceDiscrepancyViewSet,
    # Phase 6: Analytics
    InventoryAnalyticsViewSet,
)

router = DefaultRouter()

# Original endpoints
router.register(r'categories', InventoryCategoryViewSet)
router.register(r'suppliers', SupplierViewSet)
router.register(r'items', InventoryItemViewSet)
router.register(r'movements', StockMovementViewSet)
router.register(r'expiry-trackers', ExpiryTrackerViewSet)
router.register(r'audits', InventoryAuditViewSet)
router.register(r'audit-items', InventoryAuditItemViewSet)

# Phase 1: Multi-Location endpoints
router.register(r'locations', StorageLocationViewSet)
router.register(r'location-stock', LocationStockViewSet)
router.register(r'transfers', StockTransferViewSet, basename='stock-transfer')
router.register(r'stock', StockAvailabilityViewSet, basename='stock-availability')
router.register(r'batch-recommendations', BatchRecommendationViewSet, basename='batch-recommendations')

# Phase 3: Procurement endpoints
router.register(r'requisitions', PurchaseRequisitionViewSet)
router.register(r'purchase-orders', PurchaseOrderViewSet)
router.register(r'grns', GoodsReceivedNoteViewSet)

# Phase 4: Internal Logistics endpoints
router.register(r'internal-requisitions', InternalRequisitionViewSet)
router.register(r'standing-orders', StandingOrderViewSet)
router.register(r'transfer-requests', StockTransferRequestViewSet)

# Phase 5: Controlled Substances endpoints
router.register(r'controlled-registers', ControlledSubstanceRegisterViewSet)
router.register(r'controlled-entries', ControlledSubstanceEntryViewSet)
router.register(r'controlled', ControlledSubstanceOperationsViewSet, basename='controlled-operations')
router.register(r'controlled-discrepancies', ControlledSubstanceDiscrepancyViewSet)

# Phase 6: Analytics endpoints
router.register(r'analytics', InventoryAnalyticsViewSet, basename='inventory-analytics')

urlpatterns = [
    path('', include(router.urls)),
]
