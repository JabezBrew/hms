"""
Unit tests for patient registration with admission details.
"""
import os
import django
from unittest.mock import patch, MagicMock

# Configure Django settings before importing Django modules
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'hms_backend.settings')
django.setup()

from django.test import TestCase
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient
from rest_framework import status

from apps.wards.models import Ward, Bed, Admission
from apps.users.models import PatientProfile
from apps.core.tests.factories import DefaultFacilityFactory, DepartmentFactory

User = get_user_model()

class PatientRegistrationAdmissionTests(TestCase):
    """
    Test cases for patient registration with admission details.
    """
    def setUp(self):
        self.client = APIClient()
        self.facility = DefaultFacilityFactory()
        self.department = DepartmentFactory(facility=self.facility)
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

    @patch('apps.wards.proxies.EncounterProxy.create')
    @patch('apps.fhir_client.client.FHIRClient.create_resource')
    def test_register_inpatient(self, mock_create_resource, mock_encounter_create):
        """
        Test registering a patient with inpatient admission.
        """
        # Mock FHIR Patient creation
        mock_create_resource.return_value = {
            "resourceType": "Patient",
            "id": "patient-123",
            "meta": {"versionId": "1"}
        }
        
        # Mock Encounter creation
        mock_encounter_create.return_value = {
            "resourceType": "Encounter",
            "id": "encounter-123",
            "status": "in-progress"
        }
        
        url = reverse('patient-register')
        data = {
            'email': 'inpatient@example.com',
            'first_name': 'In',
            'last_name': 'Patient',
            'date_of_birth': '1990-01-01',
            'admission_details': {
                'type': 'inpatient',
                'bed_id': str(self.bed.id),
                'notes': 'Admitting for observation'
            }
        }
        
        response = self.client.post(url, data, format='json')
        
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        
        # Verify Admission created
        patient_profile = PatientProfile.objects.get(user__email='inpatient@example.com')
        admission = Admission.objects.get(patient=patient_profile)
        
        self.assertEqual(admission.bed, self.bed)
        self.assertEqual(admission.status, 'admitted')
        self.assertEqual(admission.admission_notes, 'Admitting for observation')
        self.assertEqual(admission.fhir_encounter_id, 'encounter-123')
        
        # Verify Bed status updated
        self.bed.refresh_from_db()
        self.assertEqual(self.bed.status, 'occupied')
        
        # Verify EncounterProxy called
        mock_encounter_create.assert_called_once()
        
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
                'type': 'outpatient'
            }
        }
        
        response = self.client.post(url, data, format='json')
        
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        
        # Verify NO Admission created
        patient_profile = PatientProfile.objects.get(user__email='outpatient@example.com')
        self.assertFalse(Admission.objects.filter(patient=patient_profile).exists())
        
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
                'bed_id': str(self.bed.id),
                'notes': 'Should fail'
            }
        }
        
        response = self.client.post(url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('not available', str(response.data))

    @patch('apps.wards.proxies.EncounterProxy.create')
    @patch('apps.fhir_client.client.FHIRClient.create_resource')
    def test_register_inpatient_waiting_list(self, mock_create_resource, mock_encounter_create):
        """
        Test registering a patient with inpatient admission but no bed (waiting list).
        """
        # Mock FHIR Patient creation
        mock_create_resource.return_value = {
            "resourceType": "Patient",
            "id": "patient-waiting",
            "meta": {"versionId": "1"}
        }
        
        # Mock Encounter creation
        mock_encounter_create.return_value = {
            "resourceType": "Encounter",
            "id": "encounter-waiting",
            "status": "planned"
        }
        
        url = reverse('patient-register')
        data = {
            'email': 'waiting@example.com',
            'first_name': 'Waiting',
            'last_name': 'Patient',
            'date_of_birth': '1990-01-01',
            'admission_details': {
                'type': 'inpatient',
                'bed_id': '', # No bed ID
                'notes': 'Waiting for bed'
            }
        }
        
        response = self.client.post(url, data, format='json')
        
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        
        # Verify Admission created
        patient_profile = PatientProfile.objects.get(user__email='waiting@example.com')
        admission = Admission.objects.get(patient=patient_profile)
        
        self.assertIsNone(admission.bed)
        self.assertEqual(admission.status, 'waiting')
        self.assertEqual(admission.admission_notes, 'Waiting for bed')
        self.assertEqual(admission.fhir_encounter_id, 'encounter-waiting')
        
        # Verify EncounterProxy called with correct status
        mock_encounter_create.assert_called_once()
        call_args = mock_encounter_create.call_args[1]
        self.assertEqual(call_args['status'], 'planned')
        self.assertEqual(call_args['location'], 'Waiting List')
