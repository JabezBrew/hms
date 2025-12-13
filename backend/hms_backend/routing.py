"""
WebSocket URL routing for HMS.

Routes:
- /ws/alerts/ - Global alert notifications
- /ws/alerts/ward/<ward_id>/ - Ward-specific alerts
- /ws/vitals/<patient_id>/ - Real-time vital signs for a patient
"""

from django.urls import re_path

from apps.nursing.consumers import AlertConsumer, VitalSignsConsumer

websocket_urlpatterns = [
    # Global alerts (for supervisors/admins)
    re_path(r'^ws/alerts/$', AlertConsumer.as_asgi()),

    # Ward-specific alerts (for nurses assigned to specific wards)
    re_path(r'^ws/alerts/ward/(?P<ward_id>[0-9a-f-]+)/$', AlertConsumer.as_asgi()),

    # Patient-specific vital signs updates
    re_path(r'^ws/vitals/(?P<patient_id>[0-9a-f-]+)/$', VitalSignsConsumer.as_asgi()),
]
