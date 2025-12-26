"""
Billing app configuration.
"""
from django.apps import AppConfig


class BillingConfig(AppConfig):
    """Configuration for the billing application."""

    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.billing'
    verbose_name = 'Billing'

    def ready(self):
        """Connect billing signals when app is ready."""
        from apps.billing.signals import connect_billing_signals
        connect_billing_signals()
