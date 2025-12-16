from django.apps import AppConfig


class LaboratoryConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.laboratory'
    verbose_name = 'Laboratory'

    def ready(self):
        # Import signals to register them
        from . import signals  # noqa: F401
