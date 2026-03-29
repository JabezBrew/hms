"""
Billing app configuration.
"""
from django.apps import AppConfig
from importlib import import_module


class BillingConfig(AppConfig):
    """Configuration for the billing application."""

    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.billing'
    verbose_name = 'Billing'

    def ready(self):
        import_module(f'{self.name}.signals')
