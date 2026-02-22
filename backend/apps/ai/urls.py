from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import AIArtifactViewSet, AIFeedbackViewSet, AIObservabilitySummaryView, AISessionViewSet

router = DefaultRouter()
router.register(r'sessions', AISessionViewSet, basename='ai-session')
router.register(r'artifacts', AIArtifactViewSet, basename='ai-artifact')
router.register(r'feedback', AIFeedbackViewSet, basename='ai-feedback')

urlpatterns = [
    path('', include(router.urls)),
    path('observability/summary/', AIObservabilitySummaryView.as_view(), name='ai-observability-summary'),
]
