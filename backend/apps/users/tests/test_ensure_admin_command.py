import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.users.tests.factories import AdminUserFactory


@pytest.mark.django_db
def test_ensure_admin_requires_explicit_credentials_for_initial_superuser(settings):
    settings.DEFAULT_FACILITY_CODE = None

    with pytest.raises(CommandError, match='ADMIN_EMAIL and ADMIN_PASSWORD'):
        call_command('ensure_admin', email=None, password=None)


@pytest.mark.django_db
def test_ensure_admin_allows_existing_superuser_without_credentials(settings):
    settings.DEFAULT_FACILITY_CODE = None
    admin = AdminUserFactory()

    call_command('ensure_admin', email=None, password=None)

    admin.refresh_from_db()
    assert admin.is_superuser is True
