"""
Chart Builder URL Configuration
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter

from apps.charts.views import (
    ChartTemplateViewSet,
    ChartAssignmentViewSet,
    ChartEntryViewSet,
)

router = DefaultRouter()
router.register(r'templates', ChartTemplateViewSet, basename='chart-template')
router.register(r'assignments', ChartAssignmentViewSet, basename='chart-assignment')
router.register(r'entries', ChartEntryViewSet, basename='chart-entry')

urlpatterns = [
    path('', include(router.urls)),
]
