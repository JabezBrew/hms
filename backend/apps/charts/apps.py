from django.apps import AppConfig


class ChartsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.charts'
    verbose_name = 'Clinical Charts'

    def ready(self):
        # Import signals when app is ready
        from . import signals  # noqa: F401
