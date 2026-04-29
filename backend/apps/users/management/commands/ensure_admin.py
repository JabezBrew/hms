"""
Management command to ensure an admin user exists.

Creates an admin superuser if none exists, using environment variables
for credentials. This is safe to run on every deployment.
"""
import os
from django.core.management.base import BaseCommand
from django.core.management.base import CommandError
from apps.users.models import User
from apps.core.models import Facility


class Command(BaseCommand):
    help = 'Ensure an admin superuser exists (creates one if needed)'

    def add_arguments(self, parser):
        parser.add_argument(
            '--email',
            default=os.environ.get('ADMIN_EMAIL'),
            help='Admin email (default: ADMIN_EMAIL env var)',
        )
        parser.add_argument(
            '--password',
            default=os.environ.get('ADMIN_PASSWORD'),
            help='Admin password (default: ADMIN_PASSWORD env var)',
        )
        parser.add_argument(
            '--first-name',
            default=os.environ.get('ADMIN_FIRST_NAME', 'Platform'),
            help='Admin first name (default: ADMIN_FIRST_NAME env var or Platform)',
        )
        parser.add_argument(
            '--last-name',
            default=os.environ.get('ADMIN_LAST_NAME', 'Administrator'),
            help='Admin last name (default: ADMIN_LAST_NAME env var or Administrator)',
        )

    def handle(self, *args, **options):
        email = options['email']
        password = options['password']
        first_name = options['first_name']
        last_name = options['last_name']

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
                self.style.SUCCESS('Superuser already exists.')
            )

            # Ensure user_type is admin
            if superuser.user_type != 'admin':
                superuser.user_type = 'admin'
                superuser.save()
                self.stdout.write(
                    self.style.SUCCESS(f'Updated user_type to admin')
                )
            first_name_value = (superuser.first_name or "").strip().lower()
            last_name_value = (superuser.last_name or "").strip().lower()
            legacy_first_names = {"", "admin", "system"}
            legacy_last_names = {"", "user", "administrator"}
            if first_name_value in legacy_first_names and last_name_value in legacy_last_names:
                superuser.first_name = first_name
                superuser.last_name = last_name
                superuser.save(update_fields=['first_name', 'last_name'])
                self.stdout.write(
                    self.style.SUCCESS('Updated admin display name from legacy defaults.')
                )
            if default_facility and superuser.primary_facility_id is None:
                superuser.primary_facility = default_facility
                superuser.save(update_fields=['primary_facility'])
                superuser.facilities.add(default_facility)
            return

        # Create admin user
        if not email or not password:
            raise CommandError(
                'ADMIN_EMAIL and ADMIN_PASSWORD (or --email/--password) are required when creating the initial superuser.'
            )

        self.stdout.write('Creating initial admin user.')

        # Username is required by AbstractUser - use email prefix
        username = email.split('@')[0]

        user = User.objects.create_superuser(
            username=username,
            email=email,
            password=password,
            first_name=first_name,
            last_name=last_name,
            user_type='admin',
        )

        if default_facility:
            user.primary_facility = default_facility
            user.save(update_fields=['primary_facility'])
            user.facilities.add(default_facility)

        self.stdout.write(
            self.style.SUCCESS('Admin user created successfully.')
        )
