from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    AIArtifactViewSet,
    AIFeedbackViewSet,
    AILabInterpretView,
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
    path('omni/parse/', AIOmniParseView.as_view(), name='ai-omni-parse'),
    path('omni/execute-preview/', AIOmniExecutePreviewView.as_view(), name='ai-omni-execute-preview'),
    path('labs/interpret/', AILabInterpretView.as_view(), name='ai-labs-interpret'),
    path('observability/summary/', AIObservabilitySummaryView.as_view(), name='ai-observability-summary'),
]
