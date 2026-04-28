from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import AdmissionCaseViewSet, AdmissionTaskViewSet

router = DefaultRouter()
router.register(r'cases', AdmissionCaseViewSet, basename='admission-case')
router.register(r'tasks', AdmissionTaskViewSet, basename='admission-task')

urlpatterns = [
    path('', include(router.urls)),
]
