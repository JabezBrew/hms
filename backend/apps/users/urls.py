from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    UserViewSet, StaffViewSet, PractitionerProfileViewSet, PatientProfileViewSet,
    PractitionerFHIRMappingViewSet, UserPatientListViewSet
)

# Create a router for all endpoints
router = DefaultRouter()
router.register(r'users', UserViewSet, basename='user')
router.register(r'staff', StaffViewSet, basename='staff')
router.register(r'practitioners', PractitionerProfileViewSet)
router.register(r'patients', PatientProfileViewSet)
router.register(r'practitioner-fhir-mappings', PractitionerFHIRMappingViewSet)
router.register(r'my-patients', UserPatientListViewSet, basename='my-patients')

urlpatterns = [
    path('', include(router.urls)),
]
