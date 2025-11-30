from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    WardViewSet, BedViewSet, AdmissionViewSet,
    BedAllocationLogViewSet, WardTransferViewSet,
    WardSectionViewSet, BedAmenityViewSet
)
from .encounters import EncounterViewSet

router = DefaultRouter()
router.register(r'wards', WardViewSet)
router.register(r'beds', BedViewSet)
router.register(r'admissions', AdmissionViewSet)
router.register(r'allocation-logs', BedAllocationLogViewSet)
router.register(r'transfers', WardTransferViewSet)
router.register(r'encounters', EncounterViewSet, basename='encounter')
router.register(r'sections', WardSectionViewSet)
router.register(r'amenities', BedAmenityViewSet)

urlpatterns = [
    path('', include(router.urls)),
]
