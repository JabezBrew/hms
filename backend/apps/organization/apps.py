from django.apps import AppConfig


class OrganizationConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.organization'
    verbose_name = 'Organization Management'

    def ready(self):
        # Import signals to register them
        import apps.organization.signals  # noqa: F401
