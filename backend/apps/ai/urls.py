from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    AIArtifactViewSet,
    AIChronicleAskView,
    AIChronicleSummarizeView,
    AIFeedbackViewSet,
    AILabInterpretView,
    AINoteDraftView,
    AINoteLintView,
    AIObservabilitySummaryView,
    AIOmniExecutePreviewView,
    AIOmniParseView,
    AISessionViewSet,
)

router = DefaultRouter()
router.register(r'sessions', AISessionViewSet, basename='ai-session')
router.register(r'artifacts', AIArtifactViewSet, basename='ai-artifact')
router.register(r'feedback', AIFeedbackViewSet, basename='ai-feedback')

urlpatterns = [
    path('', include(router.urls)),
    path(
        'chronicle/<uuid:patient_id>/summarize/',
        AIChronicleSummarizeView.as_view(),
        name='ai-chronicle-summarize',
    ),
    path(
        'chronicle/<uuid:patient_id>/ask/',
        AIChronicleAskView.as_view(),
        name='ai-chronicle-ask',
    ),
    path('notes/draft/', AINoteDraftView.as_view(), name='ai-notes-draft'),
    path('notes/lint/', AINoteLintView.as_view(), name='ai-notes-lint'),
    path('omni/parse/', AIOmniParseView.as_view(), name='ai-omni-parse'),
    path('omni/execute-preview/', AIOmniExecutePreviewView.as_view(), name='ai-omni-execute-preview'),
    path('labs/interpret/', AILabInterpretView.as_view(), name='ai-labs-interpret'),
    path('observability/summary/', AIObservabilitySummaryView.as_view(), name='ai-observability-summary'),
]
