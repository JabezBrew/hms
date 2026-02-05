"""
Management command to ensure an admin user exists.

Creates an admin superuser if none exists, using environment variables
for credentials. This is safe to run on every deployment.
"""
import os
from django.core.management.base import BaseCommand
from apps.users.models import User
from apps.core.models import Facility


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

        default_facility = None
        try:
            from django.conf import settings
            default_code = getattr(settings, 'DEFAULT_FACILITY_CODE', None)
            if default_code:
                default_facility = Facility.objects.filter(code=default_code.strip().upper()).first()
        except Exception:
            default_facility = None

        if default_facility is None:
            if Facility.objects.count() == 1:
                default_facility = Facility.objects.first()

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
            if default_facility and superuser.primary_facility_id is None:
                superuser.primary_facility = default_facility
                superuser.save(update_fields=['primary_facility'])
                superuser.facilities.add(default_facility)
            return

        # Create admin user
        self.stdout.write(f'Creating admin user: {email}')

        # Username is required by AbstractUser - use email prefix
        username = email.split('@')[0]

        user = User.objects.create_superuser(
            username=username,
            email=email,
            password=password,
            first_name='Admin',
            last_name='User',
            user_type='admin',
        )

        if default_facility:
            user.primary_facility = default_facility
            user.save(update_fields=['primary_facility'])
            user.facilities.add(default_facility)

        self.stdout.write(
            self.style.SUCCESS(f'Admin user created successfully: {user.email}')
        )
