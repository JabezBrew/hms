from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    InventoryCategoryViewSet, SupplierViewSet, InventoryItemViewSet,
    StockMovementViewSet, ExpiryTrackerViewSet, InventoryAuditViewSet,
    InventoryAuditItemViewSet
)

router = DefaultRouter()
router.register(r'categories', InventoryCategoryViewSet)
router.register(r'suppliers', SupplierViewSet)
router.register(r'items', InventoryItemViewSet)
router.register(r'movements', StockMovementViewSet)
router.register(r'expiry-trackers', ExpiryTrackerViewSet)
router.register(r'audits', InventoryAuditViewSet)
router.register(r'audit-items', InventoryAuditItemViewSet)

urlpatterns = [
    path('', include(router.urls)),
]