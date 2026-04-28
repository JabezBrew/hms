from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    ReferralViewSet,
    ReferralNotificationViewSet,
    ReferralSLAPolicyViewSet,
    ReferralSLAEventViewSet,
    ClinicWaitlistEntryViewSet,
)

router = DefaultRouter()
router.register(r'notifications', ReferralNotificationViewSet, basename='referral-notification')
router.register(r'sla-policies', ReferralSLAPolicyViewSet, basename='referral-sla-policy')
router.register(r'sla-events', ReferralSLAEventViewSet, basename='referral-sla-event')
router.register(r'clinic-waitlist', ClinicWaitlistEntryViewSet, basename='clinic-waitlist')
router.register(r'', ReferralViewSet, basename='referral')

urlpatterns = [
    path('', include(router.urls)),
]
