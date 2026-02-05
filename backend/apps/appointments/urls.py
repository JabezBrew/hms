from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    AppointmentTypeViewSet, AppointmentFHIRMappingViewSet, RecurringAppointmentRuleViewSet,
    LocalAppointmentViewSet, AppointmentViewSet, SlotViewSet, ScheduleViewSet, ScheduleFHIRMappingViewSet,
    RecurringScheduleViewSet, BatchGenerationViewSet, BlockedTimeViewSet
)

router = DefaultRouter()
router.register(r'types', AppointmentTypeViewSet)
router.register(r'fhir-mappings', AppointmentFHIRMappingViewSet)
router.register(r'recurring-rules', RecurringAppointmentRuleViewSet)
router.register(r'appointments', LocalAppointmentViewSet, basename='appointment')
router.register(r'slots', SlotViewSet, basename='slot')
router.register(r'schedules', ScheduleViewSet, basename='schedule')
router.register(r'schedule-mappings', ScheduleFHIRMappingViewSet)
router.register(r'recurring-schedules', RecurringScheduleViewSet)
router.register(r'blocked-times', BlockedTimeViewSet)
router.register(r'batch-generate-slots', BatchGenerationViewSet, basename='batch-generate-slots')

urlpatterns = [
    path('', include(router.urls)),
]
