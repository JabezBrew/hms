from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    AppointmentTypeViewSet, ScheduleTemplateViewSet, ScheduleTimeSlotViewSet,
    AppointmentFHIRMappingViewSet, RecurringAppointmentRuleViewSet
)

router = DefaultRouter()
router.register(r'types', AppointmentTypeViewSet)
router.register(r'templates', ScheduleTemplateViewSet)
router.register(r'time-slots', ScheduleTimeSlotViewSet)
router.register(r'fhir-mappings', AppointmentFHIRMappingViewSet)
router.register(r'recurring-rules', RecurringAppointmentRuleViewSet)

urlpatterns = [
    path('', include(router.urls)),
]