from importlib import import_module

from django.apps import AppConfig


class PatientsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.patients'
    verbose_name = 'Patients'

    def ready(self):
        import_module(f'{self.name}.signals')
