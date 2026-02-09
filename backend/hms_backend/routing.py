"""
WebSocket URL routing for HMS.

Routes:
- /ws/alerts/ - Global alert notifications
- /ws/alerts/ward/<ward_id>/ - Ward-specific alerts
- /ws/vitals/<patient_id>/ - Real-time vital signs for a patient
- /ws/notifications/ - Referral notifications for user
"""

from django.urls import re_path

from apps.nursing.consumers import AlertConsumer, VitalSignsConsumer
from apps.dashboards.consumers import AdminDashboardConsumer
from apps.referrals.consumers import ReferralNotificationConsumer

websocket_urlpatterns = [
    # Global alerts (for supervisors/admins)
    re_path(r'^ws/alerts/$', AlertConsumer.as_asgi()),

    # Ward-specific alerts (for nurses assigned to specific wards)
    re_path(r'^ws/alerts/ward/(?P<ward_id>[0-9a-f-]+)/$', AlertConsumer.as_asgi()),

    # Referral notifications for signed-in user
    re_path(r'^ws/notifications/$', ReferralNotificationConsumer.as_asgi()),

    # Admin dashboard live invalidation stream
    re_path(r'^ws/dashboards/admin/$', AdminDashboardConsumer.as_asgi()),

    # Patient-specific vital signs updates
    re_path(r'^ws/vitals/(?P<patient_id>[0-9a-f-]+)/$', VitalSignsConsumer.as_asgi()),
]
