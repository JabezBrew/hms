from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import WorkflowViewSet, ConsultationWorkflowViewSet, ClinicalNoteWorkflowViewSet, WorkflowTemplateViewSet
from .onboarding_views import (
    OnboardingActiveFlowsView,
    OnboardingEventsIngestView,
    OnboardingProgressStartView,
    OnboardingProgressView,
    OnboardingSkipStepView,
)

router = DefaultRouter()
router.register(r'workflows', WorkflowViewSet, basename='workflow')
router.register(r'consultation-workflows', ConsultationWorkflowViewSet, basename='consultation-workflow')
router.register(r'clinical-note-workflows', ClinicalNoteWorkflowViewSet, basename='clinical-note-workflow')
router.register(r'workflow-templates', WorkflowTemplateViewSet, basename='workflow-template')

urlpatterns = [
    path('workflows/onboarding/flows/active/', OnboardingActiveFlowsView.as_view(), name='onboarding-flows-active'),
    path('workflows/onboarding/progress/start/', OnboardingProgressStartView.as_view(), name='onboarding-progress-start'),
    path('workflows/onboarding/progress/', OnboardingProgressView.as_view(), name='onboarding-progress'),
    path('workflows/onboarding/events/ingest/', OnboardingEventsIngestView.as_view(), name='onboarding-events-ingest'),
    path('workflows/onboarding/steps/skip/', OnboardingSkipStepView.as_view(), name='onboarding-steps-skip'),
    path('', include(router.urls)),
]
