from importlib import import_module

from django.apps import AppConfig


class AppointmentsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.appointments'
    verbose_name = 'Appointments'

    def ready(self):
        import_module(f'{self.name}.signals')
