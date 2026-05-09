"""
WSGI config for hms_backend project.
"""

import os

from django.core.wsgi import get_wsgi_application
from hms_backend.tracing import configure_tracing

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'hms_backend.settings')
configure_tracing()

application = get_wsgi_application()
