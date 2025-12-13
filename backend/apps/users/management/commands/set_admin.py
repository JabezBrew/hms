from django.core.management.base import BaseCommand
from apps.users.models import User


class Command(BaseCommand):
    help = 'Set a superuser\'s user_type to admin'

    def handle(self, *args, **options):
        users = User.objects.filter(is_superuser=True)

        if not users.exists():
            self.stdout.write(self.style.ERROR('No superusers found'))
            return

        for user in users:
            self.stdout.write(f'Found superuser: {user.email}')
            self.stdout.write(f'Current user_type: {user.user_type}')

            if user.user_type != 'admin':
                user.user_type = 'admin'
                user.save()
                self.stdout.write(self.style.SUCCESS(f'Updated user_type to: admin'))
            else:
                self.stdout.write(self.style.SUCCESS('Already set to admin'))
