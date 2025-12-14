"""
Management command to ensure an admin user exists.

Creates an admin superuser if none exists, using environment variables
for credentials. This is safe to run on every deployment.
"""
import os
from django.core.management.base import BaseCommand
from apps.users.models import User


class Command(BaseCommand):
    help = 'Ensure an admin superuser exists (creates one if needed)'

    def add_arguments(self, parser):
        parser.add_argument(
            '--email',
            default=os.environ.get('ADMIN_EMAIL', 'admin@hms.com'),
            help='Admin email (default: ADMIN_EMAIL env var or admin@hms.com)',
        )
        parser.add_argument(
            '--password',
            default=os.environ.get('ADMIN_PASSWORD', 'Admin123!'),
            help='Admin password (default: ADMIN_PASSWORD env var or Admin123!)',
        )

    def handle(self, *args, **options):
        email = options['email']
        password = options['password']

        # Check if any superuser exists
        if User.objects.filter(is_superuser=True).exists():
            superuser = User.objects.filter(is_superuser=True).first()
            self.stdout.write(
                self.style.SUCCESS(f'Superuser already exists: {superuser.email}')
            )

            # Ensure user_type is admin
            if superuser.user_type != 'admin':
                superuser.user_type = 'admin'
                superuser.save()
                self.stdout.write(
                    self.style.SUCCESS(f'Updated user_type to admin')
                )
            return

        # Create admin user
        self.stdout.write(f'Creating admin user: {email}')

        user = User.objects.create_superuser(
            email=email,
            password=password,
            first_name='Admin',
            last_name='User',
            user_type='admin',
        )

        self.stdout.write(
            self.style.SUCCESS(f'Admin user created successfully: {user.email}')
        )
