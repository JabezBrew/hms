"""
Management command to seed staff users for testing/demos.

Creates staff users via the admin staff invite endpoint, without setting
known passwords. Each invited user receives a password reset link email.

NOTE: This command does NOT create patients.

Usage:
    python manage.py seed_test_users
    python manage.py seed_test_users --reinvite  # Re-send invite emails to existing users
"""
from django.core.management.base import BaseCommand
from datetime import date

from rest_framework.test import APIRequestFactory, force_authenticate

from apps.users.models import User
from apps.users.views import StaffViewSet


# Staff users configuration (no patients)
TEST_STAFF = [
    {
        'tag': 'admin',
        'first_name': 'Test',
        'last_name': 'Admin',
        'user_type': 'admin',
        'department': 'Administration',
        'position': 'System Administrator',
        'hire_date': date(2019, 1, 1),
    },
    {
        'tag': 'doctor',
        'first_name': 'Test',
        'last_name': 'Doctor',
        'user_type': 'doctor',
        'department': 'Internal Medicine',
        'position': 'Attending Physician',
        'hire_date': date(2020, 1, 15),
        'license_number': 'MD-TEST-001',
        'specialization': 'Internal Medicine',
        'qualification': 'MD, MBBS',
    },
    {
        'tag': 'nurse',
        'first_name': 'Test',
        'last_name': 'Nurse',
        'user_type': 'nurse',
        'department': 'Medical Ward',
        'position': 'Registered Nurse',
        'hire_date': date(2021, 3, 1),
        'license_number': 'RN-TEST-001',
        'specialization': 'Medical-Surgical Nursing',
        'qualification': 'BSN, RN',
    },
    {
        'tag': 'receptionist',
        'first_name': 'Test',
        'last_name': 'Receptionist',
        'user_type': 'receptionist',
        'department': 'Front Desk',
        'position': 'Senior Receptionist',
        'hire_date': date(2022, 6, 15),
    },
    {
        'tag': 'labtech',
        'first_name': 'Test',
        'last_name': 'LabTech',
        'user_type': 'lab_technician',
        'department': 'Laboratory',
        'position': 'Lab Technician',
        'hire_date': date(2021, 9, 1),
    },
    {
        'tag': 'pharmacist',
        'first_name': 'Test',
        'last_name': 'Pharmacist',
        'user_type': 'pharmacist',
        'department': 'Pharmacy',
        'position': 'Clinical Pharmacist',
        'hire_date': date(2020, 11, 15),
    },
    {
        'tag': 'billing',
        'first_name': 'Test',
        'last_name': 'Billing',
        'user_type': 'billing',
        'department': 'Billing',
        'position': 'Billing Clerk',
        'hire_date': date(2021, 5, 10),
    },
]


class Command(BaseCommand):
    help = 'Seed staff users (no patients) via invite endpoint'

    def add_arguments(self, parser):
        parser.add_argument(
            '--reinvite',
            action='store_true',
            help='Re-send invite emails to existing users',
        )

    def handle(self, *args, **options):
        reinvite = options['reinvite']
        created_count = 0
        invited_count = 0
        skipped_count = 0
        error_count = 0

        admin_user = User.objects.filter(is_superuser=True).first()
        if not admin_user:
            self.stdout.write(self.style.ERROR(
                'No superuser found. Create one first (e.g., `python manage.py ensure_admin`).'
            ))
            return

        factory = APIRequestFactory()
        invite_view = StaffViewSet.as_view({'post': 'invite'})

        self.stdout.write(self.style.NOTICE('Seeding staff users via /api/users/staff/invite/ ...'))

        for staff_data in TEST_STAFF:
            email = f"v2tui.{staff_data['tag']}@inbox.testmail.app".lower()

            if User.objects.filter(email=email).exists() and not reinvite:
                self.stdout.write(f'  Skipped: {email} (already exists)')
                skipped_count += 1
                continue

            payload = {
                'email': email,
                'first_name': staff_data['first_name'],
                'last_name': staff_data['last_name'],
                'user_type': staff_data['user_type'],
                'department': staff_data['department'],
                'position': staff_data['position'],
                'hire_date': staff_data['hire_date'].isoformat(),
            }

            for opt in ['license_number', 'specialization', 'qualification']:
                if staff_data.get(opt):
                    payload[opt] = staff_data[opt]

            request = factory.post('/api/users/staff/invite/', payload, format='json')
            force_authenticate(request, user=admin_user)

            response = invite_view(request)

            if response.status_code in (200, 201):
                if User.objects.filter(email=email).exists():
                    if reinvite:
                        invited_count += 1
                    else:
                        created_count += 1
                self.stdout.write(self.style.SUCCESS(f'  Invited: {email}'))
                continue

            error_count += 1
            self.stdout.write(self.style.ERROR(f'  Error inviting {email}: {response.status_code} {response.data}'))

        self.stdout.write('')
        self.stdout.write(self.style.SUCCESS(
            f'Done! Created: {created_count}, Re-invited: {invited_count}, Skipped: {skipped_count}, Errors: {error_count}'
        ))
        self.stdout.write('')
        self.stdout.write('Staff emails use: v2tui.{tag}@inbox.testmail.app')
        self.stdout.write('Invited users must set a password via the reset link email.')
        for user_data in TEST_STAFF:
            email = f"v2tui.{user_data['tag']}@inbox.testmail.app".lower()
            self.stdout.write(f"  - {email} ({user_data['user_type']})")
