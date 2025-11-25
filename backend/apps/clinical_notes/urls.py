from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    NoteTemplateViewSet, NoteEntryViewSet, PrescriptionViewSet,
    patient_timeline, timeline_stats, patient_clinical_summary
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
    # Combined clinical summary endpoint (optimized - single request for medications + vitals)
    path('patient-summary/<uuid:patient_id>/', patient_clinical_summary, name='patient-clinical-summary'),
]