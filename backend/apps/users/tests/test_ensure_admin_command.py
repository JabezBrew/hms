from django.core.management import call_command
from django.test import TestCase, override_settings

from apps.users.models import User


@override_settings(ADMIN_EMAIL=None, ADMIN_PASSWORD=None)
class EnsureAdminCommandTests(TestCase):
    def test_raises_when_creating_initial_admin_without_credentials(self):
        with self.assertRaisesMessage(
            ValueError,
            'ADMIN_EMAIL and ADMIN_PASSWORD must be set to create the initial superuser.',
        ):
            call_command('ensure_admin')

        self.assertFalse(User.objects.filter(is_superuser=True).exists())

    def test_succeeds_without_credentials_when_superuser_already_exists(self):
        User.objects.create_superuser(
            username='existing-admin',
            email='existing-admin@example.com',
            password='test-password-123',
            user_type='admin',
        )

        call_command('ensure_admin')
        self.assertEqual(User.objects.filter(is_superuser=True).count(), 1)
