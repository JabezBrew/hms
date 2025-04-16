from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    PatientFHIRMappingViewSet, PatientSearchViewSet, RecentPatientViewSet,
    PatientRegistrationValidationViewSet, PatientNoteViewSet, PatientViewSet
)

router = DefaultRouter()
router.register(r'fhir-mappings', PatientFHIRMappingViewSet)
router.register(r'searches', PatientSearchViewSet)
router.register(r'recent', RecentPatientViewSet)
router.register(r'validation-rules', PatientRegistrationValidationViewSet)
router.register(r'notes', PatientNoteViewSet)
router.register(r'', PatientViewSet, basename='patient')

urlpatterns = [
    path('', include(router.urls)),
]