from django.apps import AppConfig


class ClinicalNotesConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.clinical_notes'
    verbose_name = 'Clinical Notes'

    def ready(self):
        # Import signals to register them
        from . import signals  # noqa: F401