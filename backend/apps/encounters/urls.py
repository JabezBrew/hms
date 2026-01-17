"""
URL configuration for the encounters app.
"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import EncounterViewSet, OutpatientVisitViewSet, TriageQueueViewSet

visit_router = DefaultRouter()
visit_router.register(r'visits', OutpatientVisitViewSet, basename='outpatient-visit')
visit_router.register(r'triage', TriageQueueViewSet, basename='triage-queue')

router = DefaultRouter()
router.register(r'', EncounterViewSet, basename='encounter')

urlpatterns = [
    path('', include(visit_router.urls)),
    path('', include(router.urls)),
]
