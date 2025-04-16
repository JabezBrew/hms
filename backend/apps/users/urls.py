from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import UserViewSet, StaffViewSet, PractitionerProfileViewSet, PatientProfileViewSet

router = DefaultRouter()
router.register(r'', UserViewSet)
router.register(r'staff', StaffViewSet)
router.register(r'practitioners', PractitionerProfileViewSet)
router.register(r'patients', PatientProfileViewSet)

urlpatterns = [
    path('', include(router.urls)),
]