"""
URL configuration for the encounters app.
"""
from django.urls import path, include
from rest_framework.routers import SimpleRouter

from .views import EncounterViewSet, OutpatientVisitViewSet, TriageQueueViewSet

visit_router = SimpleRouter()
visit_router.register(r'visits', OutpatientVisitViewSet, basename='outpatient-visit')
visit_router.register(r'triage', TriageQueueViewSet, basename='triage-queue')

router = SimpleRouter()
router.register(r'', EncounterViewSet, basename='encounter')

urlpatterns = [
    path('', include(visit_router.urls)),
    path('', include(router.urls)),
]
