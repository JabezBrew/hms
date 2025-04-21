from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    WardViewSet, BedViewSet, AdmissionViewSet,
    BedAllocationLogViewSet, WardTransferViewSet
)
from .encounters import EncounterViewSet

router = DefaultRouter()
router.register(r'wards', WardViewSet)
router.register(r'beds', BedViewSet)
router.register(r'admissions', AdmissionViewSet)
router.register(r'allocation-logs', BedAllocationLogViewSet)
router.register(r'transfers', WardTransferViewSet)
router.register(r'encounters', EncounterViewSet, basename='encounter')

urlpatterns = [
    path('', include(router.urls)),
]
