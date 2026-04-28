from django.apps import AppConfig
from importlib import import_module


class LaboratoryConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.laboratory'
    verbose_name = 'Laboratory'

    def ready(self):
        # Import signals to register them
        import_module(f'{self.name}.signals')
