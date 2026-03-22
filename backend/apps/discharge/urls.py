from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import DischargeCaseViewSet, DischargeTaskViewSet

router = DefaultRouter()
router.register(r'cases', DischargeCaseViewSet, basename='discharge-case')
router.register(r'tasks', DischargeTaskViewSet, basename='discharge-task')

urlpatterns = [
    path('', include(router.urls)),
]

