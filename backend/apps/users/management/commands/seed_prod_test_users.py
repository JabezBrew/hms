from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model
from apps.users.models import Staff, PractitionerProfile, PractitionerFHIRMapping
from apps.users.identifiers import generate_unique_employee_id
from apps.core.models import Facility
from apps.fhir_client.client import fhir_client
from apps.fhir_client.utils import (
    create_human_name, create_identifier, create_contact_point,
    create_address, generate_fhir_id
)

User = get_user_model()

class Command(BaseCommand):
    help = 'Seeds production test users directly via ORM'

    def handle(self, *args, **options):
        test_users = [
            {
                'email': 'doctor@hms.com',
                'first_name': 'Test',
                'last_name': 'Doctor',
                'phone_number': '+1234567890',
                'date_of_birth': '1985-01-15',
                'user_type': 'doctor',
                'department': 'Internal Medicine',
                'position': 'Attending Physician',
                'hire_date': '2020-01-15',
                'license_number': 'MD-TEST-001',
                'specialization': 'Internal Medicine',
                'qualification': 'MD, MBBS',
            },
            {
                'email': 'nurse@hms.com',
                'first_name': 'Test',
                'last_name': 'Nurse',
                'phone_number': '+1234567891',
                'date_of_birth': '1990-03-20',
                'user_type': 'nurse',
                'department': 'Medical Ward',
                'position': 'Registered Nurse',
                'hire_date': '2021-03-01',
                'license_number': 'RN-TEST-001',
                'specialization': 'Medical-Surgical Nursing',
                'qualification': 'BSN, RN',
            },
            {
                'email': 'receptionist@hms.com',
                'first_name': 'Test',
                'last_name': 'Receptionist',
                'phone_number': '+1234567892',
                'date_of_birth': '1992-06-10',
                'user_type': 'receptionist',
                'department': 'Front Desk',
                'position': 'Senior Receptionist',
                'hire_date': '2022-06-15',
            },
            {
                'email': 'lab_tech@hms.com',
                'first_name': 'Test',
                'last_name': 'LabTech',
                'phone_number': '+1234567893',
                'date_of_birth': '1988-09-05',
                'user_type': 'lab_technician',
                'department': 'Laboratory',
                'position': 'Lab Technician',
                'hire_date': '2021-09-01',
            },
            {
                'email': 'pharmacist@hms.com',
                'first_name': 'Test',
                'last_name': 'Pharmacist',
                'phone_number': '+1234567894',
                'date_of_birth': '1987-11-25',
                'user_type': 'pharmacist',
                'department': 'Pharmacy',
                'position': 'Clinical Pharmacist',
                'hire_date': '2020-11-15',
            },
        ]

        # Use admin user for audit fields if available, otherwise first superuser
        admin_user = User.objects.filter(email='admin@hms.com').first()
        if not admin_user:
            admin_user = User.objects.filter(is_superuser=True).first()
        
        if not admin_user:
            self.stdout.write(self.style.ERROR('No admin/superuser found. Please create one first.'))
            return

        facility = admin_user.primary_facility or Facility.objects.filter(is_active=True).order_by('created_at').first()
        if not facility:
            self.stdout.write(self.style.ERROR('No active facility found. Create a facility before seeding users.'))
            return

        for user_data in test_users:
            email = user_data['email']
            
            if User.objects.filter(email=email).exists():
                self.stdout.write(self.style.WARNING(f'User {email} already exists. Skipping.'))
                continue

            self.stdout.write(f'Creating {email}...')

            # Create User
            user = User.objects.create_user(
                email=email,
                username=email,
                password='Admin123!', # Set explicit password
                first_name=user_data['first_name'],
                last_name=user_data['last_name'],
                phone_number=user_data['phone_number'],
                date_of_birth=user_data['date_of_birth'],
                user_type=user_data['user_type'],
                is_active=True,
                primary_facility=facility,
            )
            user.facilities.add(facility)

            # Generate unique employee ID
            employee_id = generate_unique_employee_id(facility)

            # Create Staff
            staff = Staff.objects.create(
                user=user,
                employee_id=employee_id,
                department=user_data['department'],
                position=user_data['position'],
                hire_date=user_data['hire_date'],
                primary_facility=facility,
                created_by=admin_user,
                updated_by=admin_user
            )

            # Create PractitionerProfile for doctors/nurses
            if user_data['user_type'] in ['doctor', 'nurse']:
                practitioner_profile = PractitionerProfile.objects.create(
                    staff=staff,
                    license_number=user_data.get('license_number'),
                    specialization=user_data.get('specialization'),
                    qualification=user_data.get('qualification'),
                    created_by=admin_user,
                    updated_by=admin_user
                )

                # Create FHIR Practitioner resource
                fhir_practitioner_data = {
                    "resourceType": "Practitioner",
                    "id": generate_fhir_id(),
                    "active": True,
                    "name": [
                        create_human_name(
                            family=user_data['last_name'],
                            given=[user_data['first_name']]
                        )
                    ],
                    "identifier": [
                        create_identifier(
                            system="http://hospital.example.org/fhir/identifier/employee",
                            value=employee_id
                        ),
                        create_identifier(
                            system="http://hospital.example.org/fhir/identifier/license",
                            value=user_data.get('license_number')
                        )
                    ]
                }

                if user_data.get('phone_number'):
                    fhir_practitioner_data["telecom"] = [
                        create_contact_point(
                            system="phone",
                            value=user_data['phone_number'],
                            use="work"
                        )
                    ]

                try:
                    # Create FHIR resource
                    fhir_practitioner = fhir_client.create_resource("Practitioner", fhir_practitioner_data)

                    # Create Mapping
                    PractitionerFHIRMapping.objects.create(
                        practitioner_profile=practitioner_profile,
                        fhir_practitioner_id=fhir_practitioner["id"],
                        fhir_resource_version=fhir_practitioner.get("meta", {}).get("versionId"),
                        created_by=admin_user,
                        updated_by=admin_user
                    )

                    # Update profile
                    practitioner_profile.fhir_practitioner_id = fhir_practitioner["id"]
                    practitioner_profile.save()
                    
                    self.stdout.write(self.style.SUCCESS(f'Successfully created {email} with FHIR resource'))
                
                except Exception as e:
                    self.stdout.write(self.style.ERROR(f'Created local user {email} but failed to sync to FHIR: {e}'))
            
            else:
                self.stdout.write(self.style.SUCCESS(f'Successfully created {email}'))
