import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.users.models import User


@pytest.mark.django_db
class TestEnsureAdminCommand:
    def test_requires_admin_password_for_initial_superuser(self, monkeypatch):
        monkeypatch.delenv('ADMIN_EMAIL', raising=False)
        monkeypatch.delenv('ADMIN_PASSWORD', raising=False)

        with pytest.raises(CommandError, match='ADMIN_PASSWORD is required'):
            call_command('ensure_admin', email='admin@hms.com')

        assert not User.objects.filter(is_superuser=True).exists()

    def test_uses_explicit_credentials_to_create_initial_superuser(self, monkeypatch):
        monkeypatch.delenv('ADMIN_EMAIL', raising=False)
        monkeypatch.delenv('ADMIN_PASSWORD', raising=False)

        call_command(
            'ensure_admin',
            email='secadmin@example.com',
            password='StrongPass123!@#',
        )

        user = User.objects.get(email='secadmin@example.com')
        assert user.is_superuser is True
        assert user.user_type == 'admin'
        assert user.check_password('StrongPass123!@#') is True
