"""
ASGI config for hms_backend project.

Supports both HTTP and WebSocket protocols:
- HTTP requests are handled by Django
- WebSocket connections are routed to Channels consumers

For production, run with Daphne:
    daphne -b 0.0.0.0 -p 8001 hms_backend.asgi:application
"""

import os

from django.core.asgi import get_asgi_application

# Must set Django settings before importing anything else
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'hms_backend.settings')

# Initialize Django ASGI application early to ensure AppRegistry is populated
django_asgi_app = get_asgi_application()

# Import after Django setup
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.security.websocket import AllowedHostsOriginValidator
from hms_backend.websocket_auth import JWTAuthMiddleware
from hms_backend.routing import websocket_urlpatterns


application = ProtocolTypeRouter({
    # HTTP requests handled by Django
    "http": django_asgi_app,

    # WebSocket connections with JWT authentication
    "websocket": AllowedHostsOriginValidator(
        JWTAuthMiddleware(
            URLRouter(websocket_urlpatterns)
        )
    ),
})
