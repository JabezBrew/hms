from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    LabTestCatalogViewSet,
    LabPanelViewSet,
    LabOrderViewSet,
    LabSpecimenViewSet,
    LabResultViewSet
)

router = DefaultRouter()
router.register(r'tests', LabTestCatalogViewSet, basename='lab-test')
router.register(r'panels', LabPanelViewSet, basename='lab-panel')
router.register(r'orders', LabOrderViewSet, basename='lab-order')
router.register(r'specimens', LabSpecimenViewSet, basename='lab-specimen')
router.register(r'results', LabResultViewSet, basename='lab-result')

urlpatterns = [
    path('', include(router.urls)),
]
