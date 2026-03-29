from django.apps import AppConfig
from importlib import import_module


class DashboardsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.dashboards'
    verbose_name = 'Dashboards'

    def ready(self):
        # Register signal handlers for cache invalidation and realtime updates.
        import_module(f'{self.name}.signals')
