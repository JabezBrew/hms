from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.ward_board.views import (
    WardBoardAPIView,
    WardBoardPatientAPIView,
    WardBoardTaskViewSet,
)

router = DefaultRouter()
router.register(r'tasks', WardBoardTaskViewSet, basename='ward-board-task')

urlpatterns = [
    path('', WardBoardAPIView.as_view(), name='ward-board'),
    path('patients/<uuid:patient_id>/', WardBoardPatientAPIView.as_view(), name='ward-board-patient'),
    path('', include(router.urls)),
]
