"""
Unit tests for patient registration with admission details.
"""
import os
import django
from unittest.mock import patch, MagicMock
from datetime import time

# Configure Django settings before importing Django modules
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'hms_backend.settings')
django.setup()

from django.test import TestCase
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient
from rest_framework import status
from django.utils import timezone

from apps.wards.models import Ward, Bed, Admission
from apps.encounters.models import Encounter
from apps.users.models import PatientProfile
from apps.core.tests.factories import DefaultFacilityFactory, DepartmentFactory
from apps.organization.models import Clinic, ClinicalUnit, UnitTypeConfig, ClinicSchedule

User = get_user_model()

class PatientRegistrationAdmissionTests(TestCase):
    """
    Test cases for patient registration with admission details.
    """
    def setUp(self):
        self.client = APIClient()
        self.facility = DefaultFacilityFactory()
        self.department = DepartmentFactory(facility=self.facility)
        self.emergency_department = DepartmentFactory(
            facility=self.facility,
            department_type='emergency',
            name='Emergency',
        )
        self.admin_user = User.objects.create_superuser(
            email='admin@example.com',
            username='adminuser',
            password='AdminPassword123',
            primary_facility=self.facility
        )
        self.admin_user.user_type = 'admin'
        self.admin_user.save(update_fields=['user_type'])
        self.client.force_authenticate(user=self.admin_user)
        self.client.credentials(HTTP_X_FACILITY_CODE=self.facility.code)

        # Create Ward and Bed
        self.ward = Ward.objects.create(
            name='General Ward',
            ward_type='general',
            total_beds=10,
            base_rate_per_night=100.00,
            department=self.department,
            created_by=self.admin_user
        )

        self.bed = Bed.objects.create(
            ward=self.ward,
            facility=self.facility,
            bed_number='101',
            bed_type='standard',
            status='available',
            created_by=self.admin_user
        )
        self.department_unit, self.emergency_unit = self._create_department_units(self.facility)
        self.clinic = self._create_clinic(self.facility, self.department_unit)

    def _create_department_units(self, facility):
        facility_type, _ = UnitTypeConfig.objects.get_or_create(
            code='facility',
            defaults={
                'name': 'Facility',
                'can_be_root': True,
                'depth_level': 0,
            },
        )
        if not facility_type.can_be_root or facility_type.depth_level != 0:
            facility_type.can_be_root = True
            facility_type.depth_level = 0
            facility_type.save(update_fields=['can_be_root', 'depth_level'])
        department_type, _ = UnitTypeConfig.objects.get_or_create(
            code='department',
            defaults={
                'name': 'Department',
                'depth_level': 1,
            },
        )
        if department_type.depth_level != 1:
            department_type.depth_level = 1
            department_type.save(update_fields=['depth_level'])
        department_type.allowed_parent_types.add(facility_type)
        root_unit = ClinicalUnit.objects.create(
            unit_type=facility_type,
            code=facility.code,
            name=facility.name,
            is_active=True,
        )
        department_unit = ClinicalUnit.objects.create(
            unit_type=department_type,
            parent=root_unit,
            code='OPD',
            name='Outpatient Department',
            is_active=True,
            core_department=self.department,
        )
        emergency_unit = ClinicalUnit.objects.create(
            unit_type=department_type,
            parent=root_unit,
            code='ED',
            name='Emergency Department',
            is_active=True,
            core_department=self.emergency_department,
        )
        return department_unit, emergency_unit

    def _create_clinic(self, facility, department):
        clinic = Clinic.objects.create(
            facility=facility,
            department=department,
            code='OPD-GEN',
            name='General OPD',
            is_active=True,
        )
        today = timezone.localtime(timezone.now()).weekday()
        ClinicSchedule.objects.create(
            facility=facility,
            department=department,
            clinic=clinic,
            day_of_week=today,
            start_time=time(0, 0),
            end_time=time(23, 59),
            is_active=True,
        )
        return clinic

    @patch('apps.fhir_client.client.FHIRClient.create_resource')
    def test_register_inpatient(self, mock_create_resource):
        """
        Test registering a patient with inpatient admission.
        """
        # Mock FHIR Patient creation
        mock_create_resource.return_value = {
            "resourceType": "Patient",
            "id": "patient-123",
            "meta": {"versionId": "1"}
        }
        
        url = reverse('patient-register')
        data = {
            'email': 'inpatient@example.com',
            'first_name': 'In',
            'last_name': 'Patient',
            'date_of_birth': '1990-01-01',
            'admission_details': {
                'type': 'inpatient',
                'department_id': str(self.department_unit.id),
                'bed_id': str(self.bed.id),
                'notes': 'Admitting for observation'
            }
        }
        
        response = self.client.post(url, data, format='json')
        
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        
        # Verify Admission created
        patient_profile = PatientProfile.objects.get(user__email='inpatient@example.com')
        admission = Admission.objects.get(patient=patient_profile)
        encounter = Encounter.objects.get(admission=admission)
        
        self.assertEqual(admission.bed, self.bed)
        self.assertEqual(admission.status, 'admitted')
        self.assertEqual(admission.admission_notes, 'Admitting for observation')
        self.assertEqual(admission.fhir_encounter_id, str(encounter.id))
        self.assertEqual(encounter.encounter_type, 'inpatient')
        
        # Verify Bed status updated
        self.bed.refresh_from_db()
        self.assertEqual(self.bed.status, 'occupied')
        
    @patch('apps.fhir_client.client.FHIRClient.create_resource')
    def test_register_outpatient(self, mock_create_resource):
        """
        Test registering a patient as outpatient (no admission).
        """
        # Mock FHIR Patient creation
        mock_create_resource.return_value = {
            "resourceType": "Patient",
            "id": "patient-456",
            "meta": {"versionId": "1"}
        }
        
        url = reverse('patient-register')
        data = {
            'email': 'outpatient@example.com',
            'first_name': 'Out',
            'last_name': 'Patient',
            'date_of_birth': '1990-01-01',
            'admission_details': {
                'type': 'outpatient',
                'department_id': str(self.department_unit.id),
                'clinic_id': str(self.clinic.id)
            }
        }
        
        response = self.client.post(url, data, format='json')
        
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        
        # Verify NO Admission created
        patient_profile = PatientProfile.objects.get(user__email='outpatient@example.com')
        self.assertFalse(Admission.objects.filter(patient=patient_profile).exists())
        encounter = Encounter.objects.get(patient=patient_profile)
        self.assertEqual(encounter.encounter_type, 'outpatient')

    @patch('apps.fhir_client.client.FHIRClient.create_resource')
    def test_register_emergency(self, mock_create_resource):
        """
        Test registering a patient via emergency department.
        """
        mock_create_resource.return_value = {
            "resourceType": "Patient",
            "id": "patient-emergency",
            "meta": {"versionId": "1"}
        }

        url = reverse('patient-register')
        data = {
            'email': 'emergency@example.com',
            'first_name': 'Emergency',
            'last_name': 'Patient',
            'date_of_birth': '1990-01-01',
            'admission_details': {
                'type': 'emergency',
                'department_id': str(self.emergency_unit.id),
                'notes': 'ED intake'
            }
        }

        response = self.client.post(url, data, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        patient_profile = PatientProfile.objects.get(user__email='emergency@example.com')
        self.assertFalse(Admission.objects.filter(patient=patient_profile).exists())
        encounter = Encounter.objects.get(patient=patient_profile)
        self.assertEqual(encounter.encounter_type, 'emergency')
        
    def test_register_inpatient_invalid_bed(self):
        """
        Test registering inpatient with invalid bed.
        """
        url = reverse('patient-register')
        data = {
            'email': 'invalidbed@example.com',
            'first_name': 'Invalid',
            'last_name': 'Bed',
            'date_of_birth': '1990-01-01',
            'admission_details': {
                'type': 'inpatient',
                'department_id': str(self.department_unit.id),
                'bed_id': 'invalid-uuid', # Invalid UUID
                'notes': 'Should fail'
            }
        }
        
        response = self.client.post(url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        
    def test_register_inpatient_occupied_bed(self):
        """
        Test registering inpatient with occupied bed.
        """
        # Set bed to occupied
        self.bed.status = 'occupied'
        self.bed.save()
        
        url = reverse('patient-register')
        data = {
            'email': 'occupiedbed@example.com',
            'first_name': 'Occupied',
            'last_name': 'Bed',
            'date_of_birth': '1990-01-01',
            'admission_details': {
                'type': 'inpatient',
                'department_id': str(self.department_unit.id),
                'bed_id': str(self.bed.id),
                'notes': 'Should fail'
            }
        }
        
        response = self.client.post(url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('not available', str(response.data))

    @patch('apps.fhir_client.client.FHIRClient.create_resource')
    def test_register_inpatient_waiting_list(self, mock_create_resource):
        """
        Test registering a patient with inpatient admission but no bed (waiting list).
        """
        # Mock FHIR Patient creation
        mock_create_resource.return_value = {
            "resourceType": "Patient",
            "id": "patient-waiting",
            "meta": {"versionId": "1"}
        }
        
        url = reverse('patient-register')
        data = {
            'email': 'waiting@example.com',
            'first_name': 'Waiting',
            'last_name': 'Patient',
            'date_of_birth': '1990-01-01',
            'admission_details': {
                'type': 'inpatient',
                'department_id': str(self.department_unit.id),
                'bed_id': '', # No bed ID
                'notes': 'Waiting for bed'
            }
        }
        
        response = self.client.post(url, data, format='json')
        
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        
        # Verify Admission created
        patient_profile = PatientProfile.objects.get(user__email='waiting@example.com')
        admission = Admission.objects.get(patient=patient_profile)
        encounter = Encounter.objects.get(admission=admission)
        
        self.assertIsNone(admission.bed)
        self.assertEqual(admission.status, 'waiting')
        self.assertEqual(admission.admission_notes, 'Waiting for bed')
        self.assertEqual(admission.fhir_encounter_id, str(encounter.id))
        self.assertEqual(encounter.status, 'planned')
        self.assertEqual(encounter.location, 'Waiting List')
