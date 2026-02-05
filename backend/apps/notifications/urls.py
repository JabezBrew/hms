from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import InboxItemViewSet

router = DefaultRouter()
router.register(r'inbox', InboxItemViewSet, basename='inbox')

urlpatterns = [
    path('', include(router.urls)),
]
