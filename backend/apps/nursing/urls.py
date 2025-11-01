from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    VitalSignsViewSet,
    NursingTaskViewSet,
    NursingAlertViewSet,
    MedicationAdministrationViewSet,
    ShiftHandoffViewSet,
    PatientMonitoringViewSet
)

router = DefaultRouter()
router.register(r'vital-signs', VitalSignsViewSet, basename='vital-signs')
router.register(r'tasks', NursingTaskViewSet, basename='nursing-tasks')
router.register(r'alerts', NursingAlertViewSet, basename='nursing-alerts')
router.register(r'medications', MedicationAdministrationViewSet, basename='medication-administration')
router.register(r'handoffs', ShiftHandoffViewSet, basename='shift-handoffs')
router.register(r'monitoring', PatientMonitoringViewSet, basename='patient-monitoring')

urlpatterns = [
    path('', include(router.urls)),
]
