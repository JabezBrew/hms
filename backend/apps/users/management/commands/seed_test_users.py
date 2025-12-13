"""
Management command to seed test users for E2E testing.

Creates test users with known credentials for Playwright E2E tests.
These users are required for the E2E test suite to function.

Usage:
    python manage.py seed_test_users
    python manage.py seed_test_users --force  # Recreate existing users
"""
from django.core.management.base import BaseCommand
from django.db import transaction
from apps.users.models import User, Staff, PractitionerProfile, PatientProfile
from datetime import date


# Test users configuration - matches E2E test and load test expectations
TEST_USERS = [
    {
        'email': 'doctor@hms.com',
        'password': 'TestPass123!',
        'first_name': 'Test',
        'last_name': 'Doctor',
        'user_type': 'doctor',
        'username': 'test_doctor',
        'staff': {
            'employee_id': 'EMP-DOC-001',
            'department': 'Internal Medicine',
            'position': 'Attending Physician',
            'hire_date': date(2020, 1, 15),
        },
        'practitioner': {
            'license_number': 'MD-TEST-001',
            'specialization': 'Internal Medicine',
            'qualification': 'MD, MBBS',
        },
    },
    {
        'email': 'nurse@hms.com',
        'password': 'TestPass123!',
        'first_name': 'Test',
        'last_name': 'Nurse',
        'user_type': 'nurse',
        'username': 'test_nurse',
        'staff': {
            'employee_id': 'EMP-NUR-001',
            'department': 'Medical Ward',
            'position': 'Registered Nurse',
            'hire_date': date(2021, 3, 1),
        },
        'practitioner': {
            'license_number': 'RN-TEST-001',
            'specialization': 'Medical-Surgical Nursing',
            'qualification': 'BSN, RN',
        },
    },
    {
        'email': 'receptionist@hms.com',
        'password': 'TestPass123!',
        'first_name': 'Test',
        'last_name': 'Receptionist',
        'user_type': 'receptionist',
        'username': 'test_receptionist',
        'staff': {
            'employee_id': 'EMP-REC-001',
            'department': 'Front Desk',
            'position': 'Senior Receptionist',
            'hire_date': date(2022, 6, 15),
        },
    },
    {
        'email': 'lab_tech@hms.com',
        'password': 'TestPass123!',
        'first_name': 'Test',
        'last_name': 'LabTech',
        'user_type': 'lab_technician',
        'username': 'test_lab_tech',
        'staff': {
            'employee_id': 'EMP-LAB-001',
            'department': 'Laboratory',
            'position': 'Lab Technician',
            'hire_date': date(2021, 9, 1),
        },
    },
    {
        'email': 'pharmacist@hms.com',
        'password': 'TestPass123!',
        'first_name': 'Test',
        'last_name': 'Pharmacist',
        'user_type': 'pharmacist',
        'username': 'test_pharmacist',
        'staff': {
            'employee_id': 'EMP-PHA-001',
            'department': 'Pharmacy',
            'position': 'Clinical Pharmacist',
            'hire_date': date(2020, 11, 15),
        },
    },
    {
        'email': 'patient@hms.com',
        'password': 'TestPass123!',
        'first_name': 'John',
        'last_name': 'Doe',
        'user_type': 'patient',
        'username': 'test_patient',
        'date_of_birth': date(1985, 6, 15),
        'patient_profile': {
            'medical_record_number': 'MRN-TEST-001',
            'blood_group': 'O+',
            'allergies': 'Penicillin',
            'emergency_contact_name': 'Jane Doe',
            'emergency_contact_phone': '+1234567890',
            'emergency_contact_relationship': 'Spouse',
        },
    },
]


class Command(BaseCommand):
    help = 'Seed test users for E2E testing'

    def add_arguments(self, parser):
        parser.add_argument(
            '--force',
            action='store_true',
            help='Force recreate existing test users',
        )

    def handle(self, *args, **options):
        force = options['force']
        created_count = 0
        updated_count = 0
        skipped_count = 0

        self.stdout.write(self.style.NOTICE('Seeding test users for E2E tests...'))

        for user_data in TEST_USERS:
            email = user_data['email']

            try:
                with transaction.atomic():
                    existing_user = User.objects.filter(email=email).first()

                    if existing_user and not force:
                        self.stdout.write(f'  Skipped: {email} (already exists)')
                        skipped_count += 1
                        continue

                    if existing_user and force:
                        # Delete existing user and related objects
                        existing_user.delete()
                        self.stdout.write(f'  Deleted existing: {email}')

                    # Create user
                    user = User.objects.create_user(
                        email=user_data['email'],
                        username=user_data['username'],
                        password=user_data['password'],
                        first_name=user_data['first_name'],
                        last_name=user_data['last_name'],
                        user_type=user_data['user_type'],
                        is_staff=user_data.get('is_staff', False),
                        is_superuser=user_data.get('is_superuser', False),
                        date_of_birth=user_data.get('date_of_birth'),
                    )

                    # Create staff profile if specified
                    staff_data = user_data.get('staff')
                    if staff_data:
                        staff = Staff.objects.create(
                            user=user,
                            **staff_data
                        )

                        # Create practitioner profile if specified
                        practitioner_data = user_data.get('practitioner')
                        if practitioner_data:
                            PractitionerProfile.objects.create(
                                staff=staff,
                                **practitioner_data
                            )

                    # Create patient profile if specified
                    patient_data = user_data.get('patient_profile')
                    if patient_data:
                        PatientProfile.objects.create(
                            user=user,
                            **patient_data
                        )

                    if existing_user:
                        self.stdout.write(self.style.WARNING(f'  Recreated: {email}'))
                        updated_count += 1
                    else:
                        self.stdout.write(self.style.SUCCESS(f'  Created: {email}'))
                        created_count += 1

            except Exception as e:
                self.stdout.write(self.style.ERROR(f'  Error creating {email}: {str(e)}'))

        self.stdout.write('')
        self.stdout.write(self.style.SUCCESS(f'Done! Created: {created_count}, Updated: {updated_count}, Skipped: {skipped_count}'))
        self.stdout.write('')
        self.stdout.write('Test users available:')
        for user_data in TEST_USERS:
            self.stdout.write(f"  - {user_data['email']} / TestPass123! ({user_data['user_type']})")
