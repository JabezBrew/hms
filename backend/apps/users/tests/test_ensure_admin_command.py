import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.users.tests.factories import AdminUserFactory, UserFactory


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


@pytest.mark.django_db
def test_ensure_admin_rejects_known_default_admin_password(settings):
    settings.DEFAULT_FACILITY_CODE = None

    with pytest.raises(CommandError, match='insecure default ADMIN_PASSWORD'):
        call_command(
            'ensure_admin',
            email='admin@example.com',
            password='Admin123!ChangeMe',
        )


@pytest.mark.django_db
def test_reset_test_passwords_requires_explicit_password(settings):
    settings.DEBUG = True

    with pytest.raises(CommandError, match='no default test password'):
        call_command('reset_test_passwords', password=None)


@pytest.mark.django_db
def test_reset_test_passwords_rejects_known_default_password(settings):
    settings.DEBUG = True

    with pytest.raises(CommandError, match='insecure default test user reset password'):
        call_command('reset_test_passwords', password='Admin123!')


@pytest.mark.django_db
def test_reset_test_passwords_requires_confirmation_when_debug_false(settings):
    settings.DEBUG = False

    with pytest.raises(CommandError, match='DEBUG=False'):
        call_command('reset_test_passwords', password='UniqueTestPassword123!')


@pytest.mark.django_db
def test_reset_test_passwords_sets_explicit_password_and_forces_change(settings):
    settings.DEBUG = True
    user = UserFactory(email='doctor@hms.com')

    call_command('reset_test_passwords', password='UniqueTestPassword123!')

    user.refresh_from_db()
    assert user.check_password('UniqueTestPassword123!')
    assert user.must_change_password is True
    assert user.password_changed_at is None
