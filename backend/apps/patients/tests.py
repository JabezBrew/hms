"""
Unit tests for the patients app.
"""
import os
import django

# Configure Django settings before importing Django modules
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'hms_backend.settings')
django.setup()

from django.test import TestCase
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient
from rest_framework import status
from unittest.mock import patch, MagicMock

from .models import (
    PatientFHIRMapping, PatientSearch, RecentPatient,
    PatientRegistrationValidation, PatientNote
)
from .serializers import (
    PatientFHIRMappingSerializer, PatientSearchSerializer,
    RecentPatientSerializer, PatientRegistrationValidationSerializer,
    PatientNoteSerializer, PatientRegistrationSerializer
)
from ..users.models import PatientProfile

User = get_user_model()

class PatientModelTests(TestCase):
    """
    Test cases for the patient models.
    """
    def setUp(self):
        self.user = User.objects.create_user(
            email='patient@example.com',
            username='patientuser',
            password='patientpassword',
            first_name='Patient',
            last_name='User',
            user_type='patient'
        )
        self.admin_user = User.objects.create_superuser(
            email='admin@example.com',
            username='adminuser',
            password='adminpassword'
        )
        self.patient_profile = PatientProfile.objects.create(
            user=self.user,
            medical_record_number='MRN001',
            nhis_id='NHIS001',
            blood_group='A+',
            allergies='None',
            emergency_contact_name='Emergency Contact',
            emergency_contact_phone='9876543210',
            emergency_contact_relationship='Spouse',
            created_by=self.admin_user,
            updated_by=self.admin_user
        )

    def test_patient_fhir_mapping_creation(self):
        """
        Test creating a PatientFHIRMapping.
        """
        mapping = PatientFHIRMapping.objects.create(
            patient_profile=self.patient_profile,
            fhir_patient_id='patient-123',
            fhir_resource_version='1',
            is_synced=True,
            created_by=self.admin_user,
            updated_by=self.admin_user
        )
        self.assertEqual(mapping.patient_profile, self.patient_profile)
        self.assertEqual(mapping.fhir_patient_id, 'patient-123')
        self.assertEqual(mapping.fhir_resource_version, '1')
        self.assertTrue(mapping.is_synced)

    def test_patient_search_creation(self):
        """
        Test creating a PatientSearch.
        """
        search = PatientSearch.objects.create(
            user=self.admin_user,
            search_query='Patient User'
        )
        self.assertEqual(search.user, self.admin_user)
        self.assertEqual(search.search_query, 'Patient User')

    def test_recent_patient_creation(self):
        """
        Test creating a RecentPatient.
        """
        recent = RecentPatient.objects.create(
            user=self.admin_user,
            patient_profile=self.patient_profile
        )
        self.assertEqual(recent.user, self.admin_user)
        self.assertEqual(recent.patient_profile, self.patient_profile)

    def test_patient_registration_validation_creation(self):
        """
        Test creating a PatientRegistrationValidation.
        """
        validation = PatientRegistrationValidation.objects.create(
            field_name='phone_number',
            validation_regex=r'^\d{10}$',
            validation_message='Phone number must be 10 digits',
            is_required=True,
            is_active=True,
            created_by=self.admin_user,
            updated_by=self.admin_user
        )
        self.assertEqual(validation.field_name, 'phone_number')
        self.assertEqual(validation.validation_regex, r'^\d{10}$')
        self.assertEqual(validation.validation_message, 'Phone number must be 10 digits')
        self.assertTrue(validation.is_required)
        self.assertTrue(validation.is_active)

    def test_patient_note_creation(self):
        """
        Test creating a PatientNote.
        """
        note = PatientNote.objects.create(
            patient_profile=self.patient_profile,
            note_text='This is a test note',
            is_private=True,
            created_by=self.admin_user,
            updated_by=self.admin_user
        )
        self.assertEqual(note.patient_profile, self.patient_profile)
        self.assertEqual(note.note_text, 'This is a test note')
        self.assertTrue(note.is_private)


class PatientSerializerTests(TestCase):
    """
    Test cases for the patient serializers.
    """
    def setUp(self):
        self.user = User.objects.create_user(
            email='patient@example.com',
            username='patientuser',
            password='patientpassword',
            first_name='Patient',
            last_name='User',
            user_type='patient'
        )
        self.admin_user = User.objects.create_superuser(
            email='admin@example.com',
            username='adminuser',
            password='adminpassword'
        )
        self.patient_profile = PatientProfile.objects.create(
            user=self.user,
            medical_record_number='MRN001',
            nhis_id='NHIS001',
            blood_group='A+',
            allergies='None',
            emergency_contact_name='Emergency Contact',
            emergency_contact_phone='9876543210',
            emergency_contact_relationship='Spouse',
            created_by=self.admin_user,
            updated_by=self.admin_user
        )

    def test_patient_fhir_mapping_serializer(self):
        """
        Test the PatientFHIRMappingSerializer.
        """
        mapping = PatientFHIRMapping.objects.create(
            patient_profile=self.patient_profile,
            fhir_patient_id='patient-123',
            fhir_resource_version='1',
            is_synced=True,
            created_by=self.admin_user,
            updated_by=self.admin_user
        )
        serializer = PatientFHIRMappingSerializer(mapping)
        self.assertEqual(serializer.data['fhir_patient_id'], 'patient-123')
        self.assertEqual(serializer.data['fhir_resource_version'], '1')
        self.assertTrue(serializer.data['is_synced'])
        self.assertIn('patient_profile_details', serializer.data)

    def test_patient_search_serializer(self):
        """
        Test the PatientSearchSerializer.
        """
        search = PatientSearch.objects.create(
            user=self.admin_user,
            search_query='Patient User'
        )
        serializer = PatientSearchSerializer(search)
        self.assertEqual(serializer.data['search_query'], 'Patient User')
        self.assertIn('user_details', serializer.data)

    def test_recent_patient_serializer(self):
        """
        Test the RecentPatientSerializer.
        """
        recent = RecentPatient.objects.create(
            user=self.admin_user,
            patient_profile=self.patient_profile
        )
        serializer = RecentPatientSerializer(recent)
        self.assertIn('user_details', serializer.data)
        self.assertIn('patient_profile_details', serializer.data)

    def test_patient_registration_validation_serializer(self):
        """
        Test the PatientRegistrationValidationSerializer.
        """
        validation = PatientRegistrationValidation.objects.create(
            field_name='phone_number',
            validation_regex=r'^\d{10}$',
            validation_message='Phone number must be 10 digits',
            is_required=True,
            is_active=True,
            created_by=self.admin_user,
            updated_by=self.admin_user
        )
        serializer = PatientRegistrationValidationSerializer(validation)
        self.assertEqual(serializer.data['field_name'], 'phone_number')
        self.assertEqual(serializer.data['validation_regex'], r'^\d{10}$')
        self.assertEqual(serializer.data['validation_message'], 'Phone number must be 10 digits')
        self.assertTrue(serializer.data['is_required'])
        self.assertTrue(serializer.data['is_active'])

    def test_patient_note_serializer(self):
        """
        Test the PatientNoteSerializer.
        """
        note = PatientNote.objects.create(
            patient_profile=self.patient_profile,
            note_text='This is a test note',
            is_private=True,
            created_by=self.admin_user,
            updated_by=self.admin_user
        )
        serializer = PatientNoteSerializer(note)
        self.assertEqual(serializer.data['note_text'], 'This is a test note')
        self.assertTrue(serializer.data['is_private'])
        self.assertIn('patient_profile_details', serializer.data)
        self.assertIn('created_by_details', serializer.data)


class PatientAPITests(TestCase):
    """
    Test cases for the patient API endpoints.
    """
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            email='patient@example.com',
            username='patientuser',
            password='patientpassword',
            first_name='Patient',
            last_name='User',
            user_type='patient'
        )
        self.admin_user = User.objects.create_superuser(
            email='admin@example.com',
            username='adminuser',
            password='adminpassword'
        )
        self.patient_profile = PatientProfile.objects.create(
            user=self.user,
            medical_record_number='MRN001',
            nhis_id='NHIS001',
            blood_group='A+',
            allergies='None',
            emergency_contact_name='Emergency Contact',
            emergency_contact_phone='9876543210',
            emergency_contact_relationship='Spouse',
            created_by=self.admin_user,
            updated_by=self.admin_user
        )
        self.client.force_authenticate(user=self.admin_user)

    def test_patient_fhir_mapping_list(self):
        """
        Test retrieving a list of patient FHIR mappings.
        """
        PatientFHIRMapping.objects.create(
            patient_profile=self.patient_profile,
            fhir_patient_id='patient-123',
            fhir_resource_version='1',
            is_synced=True,
            created_by=self.admin_user,
            updated_by=self.admin_user
        )
        url = reverse('patientfhirmapping-list')
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['results']), 1)

    def test_patient_search_list(self):
        """
        Test retrieving a list of patient searches.
        """
        PatientSearch.objects.create(
            user=self.admin_user,
            search_query='Patient User'
        )
        url = reverse('patientsearch-list')
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['results']), 1)

    def test_recent_patient_list(self):
        """
        Test retrieving a list of recent patients.
        """
        RecentPatient.objects.create(
            user=self.admin_user,
            patient_profile=self.patient_profile
        )
        url = reverse('recentpatient-list')
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['results']), 1)

    def test_patient_registration_validation_list(self):
        """
        Test retrieving a list of patient registration validations.
        """
        PatientRegistrationValidation.objects.create(
            field_name='phone_number',
            validation_regex=r'^\d{10}$',
            validation_message='Phone number must be 10 digits',
            is_required=True,
            is_active=True,
            created_by=self.admin_user,
            updated_by=self.admin_user
        )
        url = reverse('patientregistrationvalidation-list')
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['results']), 1)

    def test_patient_note_list(self):
        """
        Test retrieving a list of patient notes.
        """
        PatientNote.objects.create(
            patient_profile=self.patient_profile,
            note_text='This is a test note',
            is_private=True,
            created_by=self.admin_user,
            updated_by=self.admin_user
        )
        url = reverse('patientnote-list')
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['results']), 1)

    @patch('apps.fhir_client.client.FHIRClient.create_resource')
    def test_patient_registration(self, mock_create_resource):
        """
        Test patient registration.
        """
        # Mock the FHIR client response
        mock_create_resource.return_value = {
            "resourceType": "Patient",
            "id": "patient-123",
            "meta": {"versionId": "1"}
        }

        url = reverse('patient-register')
        data = {
            'email': 'newpatient@example.com',
            'password': 'newpassword',
            'confirm_password': 'newpassword',
            'first_name': 'New',
            'last_name': 'Patient',
            'phone_number': '1234567890',
            'date_of_birth': '1990-01-01',
            'medical_record_number': 'MRN002',
            'nhis_id': 'NHIS002',
            'blood_group': 'B+',
            'allergies': 'None',
            'emergency_contact_name': 'Emergency Contact',
            'emergency_contact_phone': '9876543210',
            'emergency_contact_relationship': 'Spouse',
            'address_line1': '123 Main St',
            'city': 'Anytown',
            'state': 'CA',
            'postal_code': '12345',
            'country': 'USA'
        }
        response = self.client.post(url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(User.objects.count(), 3)  # admin_user, user, and new patient
        self.assertEqual(PatientProfile.objects.count(), 2)  # patient_profile and new patient profile

    @patch('apps.fhir_client.client.FHIRClient.search_resources')
    def test_patient_search(self, mock_search_resources):
        """
        Test patient search.
        """
        # Mock the FHIR client response
        mock_search_resources.return_value = {
            "resourceType": "Bundle",
            "type": "searchset",
            "total": 1,
            "entry": [
                {
                    "resource": {
                        "resourceType": "Patient",
                        "id": "patient-123",
                        "name": [{"family": "User", "given": ["Patient"]}]
                    }
                }
            ]
        }

        url = reverse('patient-search')
        response = self.client.get(url, {'query': 'Patient'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['total'], 1)
        self.assertEqual(len(response.data['patients']), 1)

    @patch('apps.fhir_client.client.FHIRClient.get_resource')
    def test_get_patient(self, mock_get_resource):
        """
        Test getting a patient.
        """
        # Mock the FHIR client response
        mock_get_resource.return_value = {
            "resourceType": "Patient",
            "id": "patient-123",
            "name": [{"family": "User", "given": ["Patient"]}]
        }

        # Set the FHIR patient ID on the patient profile
        self.patient_profile.fhir_patient_id = 'patient-123'
        self.patient_profile.save()

        url = reverse('patient-get-patient', args=[self.patient_profile.id])
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('local_data', response.data)
        self.assertIn('fhir_data', response.data)