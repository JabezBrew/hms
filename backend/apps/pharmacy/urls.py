from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import DispensingViewSet, SupplyRequestDispensingViewSet

router = DefaultRouter()
router.register(r'dispensing', DispensingViewSet, basename='dispensing')
router.register(r'supply-requests', SupplyRequestDispensingViewSet, basename='pharmacy-supply-requests')

urlpatterns = [
    path('', include(router.urls)),
]
