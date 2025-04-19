from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    AppointmentTypeViewSet, ScheduleTemplateViewSet, ScheduleTimeSlotViewSet,
    AppointmentFHIRMappingViewSet, RecurringAppointmentRuleViewSet,
    AppointmentViewSet, SlotViewSet, ScheduleViewSet, ScheduleFHIRMappingViewSet
)

router = DefaultRouter()
router.register(r'types', AppointmentTypeViewSet)
router.register(r'templates', ScheduleTemplateViewSet)
router.register(r'time-slots', ScheduleTimeSlotViewSet)
router.register(r'fhir-mappings', AppointmentFHIRMappingViewSet)
router.register(r'recurring-rules', RecurringAppointmentRuleViewSet)
router.register(r'appointments', AppointmentViewSet, basename='appointment')
router.register(r'slots', SlotViewSet, basename='slot')
router.register(r'schedules', ScheduleViewSet, basename='schedule')
router.register(r'schedule-mappings', ScheduleFHIRMappingViewSet)

urlpatterns = [
    path('', include(router.urls)),
]
