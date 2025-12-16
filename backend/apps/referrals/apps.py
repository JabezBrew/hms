from django.apps import AppConfig


class ReferralsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.referrals'
    verbose_name = 'Referrals'

    def ready(self):
        # Import signals to register them
        from . import signals  # noqa: F401
