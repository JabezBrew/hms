import pytest
from django.core.management import call_command
from apps.users.models import User


@pytest.mark.django_db
class TestEnsureAdminCommand:
    def test_rejects_staging_placeholder_password(self):
        with pytest.raises(ValueError, match='Refusing to use insecure default ADMIN_PASSWORD'):
            call_command(
                'ensure_admin',
                email='admin@staging.example.com',
                password='CHANGE_ME_generate_unique_staging_admin_password',
            )

        assert not User.objects.filter(email='admin@staging.example.com').exists()

    def test_creates_superuser_with_unique_password(self):
        call_command(
            'ensure_admin',
            email='admin@example.com',
            password='A-unique-passphrase-123!',
        )

        user = User.objects.get(email='admin@example.com')
        assert user.is_superuser is True
        assert user.is_staff is True
        assert user.check_password('A-unique-passphrase-123!')
