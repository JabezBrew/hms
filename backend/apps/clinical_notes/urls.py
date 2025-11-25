from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    NoteTemplateViewSet, NoteEntryViewSet, PrescriptionViewSet,
    patient_timeline, timeline_stats
)

router = DefaultRouter()
router.register(r'templates', NoteTemplateViewSet)
router.register(r'entries', NoteEntryViewSet)
router.register(r'prescriptions', PrescriptionViewSet)

urlpatterns = [
    path('', include(router.urls)),
    # Timeline endpoints
    path('timeline/<uuid:patient_id>/', patient_timeline, name='patient-timeline'),
    path('timeline/<uuid:patient_id>/stats/', timeline_stats, name='timeline-stats'),
]