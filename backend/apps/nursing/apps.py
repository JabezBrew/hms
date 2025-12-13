from django.apps import AppConfig


class NursingConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.nursing'
    verbose_name = 'Nursing Management'

    def ready(self):
        """Register signal handlers for WebSocket broadcasts."""
        # Import signals to register handlers
        # This enables real-time alert and vitals broadcasting
        from . import signals  # noqa: F401
