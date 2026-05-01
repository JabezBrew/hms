from importlib import import_module

from django.apps import AppConfig


class WardsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.wards'
    verbose_name = 'Wards'

    def ready(self):
        import_module(f'{self.name}.signals')
