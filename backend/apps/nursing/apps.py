from django.apps import AppConfig
from importlib import import_module


class NursingConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.nursing'
    verbose_name = 'Nursing Management'

    def ready(self):
        """Register signal handlers for WebSocket broadcasts."""
        import_module(f'{self.name}.signals')
