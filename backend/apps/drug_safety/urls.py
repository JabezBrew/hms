from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    PatientAllergyViewSet,
    DrugSafetyAlertViewSet,
    DrugSafetyCheckView,
    DrugInteractionCacheViewSet
)

router = DefaultRouter()
router.register(r'allergies', PatientAllergyViewSet, basename='allergy')
router.register(r'alerts', DrugSafetyAlertViewSet, basename='safety-alert')
router.register(r'cache', DrugInteractionCacheViewSet, basename='interaction-cache')

# Custom ViewSet for drug safety checks
router.register(r'safety', DrugSafetyCheckView, basename='safety-check')

urlpatterns = [
    path('', include(router.urls)),
]
