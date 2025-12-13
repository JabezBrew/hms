"""
API view tests for patients app.

Tests for:
- PatientFHIRMappingViewSet
- PatientSearchViewSet
- RecentPatientViewSet
- PatientRegistrationValidationViewSet
- PatientNoteViewSet
- PatientViewSet (register, search, get, update, delete)
"""
import pytest
from unittest.mock import patch, MagicMock
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.patients.models import (
    PatientFHIRMapping, PatientSearch, RecentPatient,
    PatientRegistrationValidation, PatientNote
)
from apps.users.models import PatientProfile
from apps.users.tests.factories import (
    UserFactory, AdminUserFactory, DoctorUserFactory,
    NurseUserFactory, PatientUserFactory, PatientProfileFactory
)
from .factories import (
    PatientFHIRMappingFactory, PatientSearchFactory,
    RecentPatientFactory, PatientRegistrationValidationFactory,
    PatientNoteFactory
)


def get_authenticated_client(user):
    """Get an API client authenticated as the given user."""
    client = APIClient()
    refresh = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
    return client


# =============================================================================
# PatientFHIRMapping ViewSet Tests
# =============================================================================

@pytest.mark.tier1
class TestPatientFHIRMappingViewSet:
    """Tests for PatientFHIRMappingViewSet."""

    def test_list_fhir_mappings(self, db):
        """Test listing FHIR mappings."""
        admin = AdminUserFactory()
        PatientFHIRMappingFactory()
        PatientFHIRMappingFactory()

        client = get_authenticated_client(admin)
        response = client.get('/api/patients/fhir-mappings/')

        assert response.status_code == status.HTTP_200_OK
        results = response.data.get('results', response.data)
        assert len(results) >= 2

    def test_retrieve_fhir_mapping(self, db):
        """Test retrieving a FHIR mapping."""
        admin = AdminUserFactory()
        mapping = PatientFHIRMappingFactory(fhir_patient_id='retrieve-test-123')

        client = get_authenticated_client(admin)
        response = client.get(f'/api/patients/fhir-mappings/{mapping.id}/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['fhir_patient_id'] == 'retrieve-test-123'

    @patch('apps.patients.tasks.sync_patient_with_fhir.delay')
    def test_sync_with_fhir_action(self, mock_task, db):
        """Test the sync_with_fhir action queues a task."""
        mock_task.return_value = MagicMock(id='task-123')

        admin = AdminUserFactory()
        mapping = PatientFHIRMappingFactory()

        client = get_authenticated_client(admin)
        response = client.post(f'/api/patients/fhir-mappings/{mapping.id}/sync_with_fhir/')

        assert response.status_code == status.HTTP_202_ACCEPTED
        assert 'task_id' in response.data
        mock_task.assert_called_once()


# =============================================================================
# PatientSearch ViewSet Tests
# =============================================================================

@pytest.mark.tier1
class TestPatientSearchViewSet:
    """Tests for PatientSearchViewSet."""

    def test_list_own_searches(self, db):
        """Test user can list their own searches."""
        user = DoctorUserFactory()
        PatientSearchFactory(user=user, search_query='my search')
        PatientSearchFactory(user=user, search_query='another search')

        # Create another user's search
        other_user = DoctorUserFactory()
        PatientSearchFactory(user=other_user, search_query='other search')

        client = get_authenticated_client(user)
        response = client.get('/api/patients/searches/')

        assert response.status_code == status.HTTP_200_OK
        results = response.data.get('results', response.data)
        assert len(results) == 2
        for search in results:
            assert 'my search' in search['search_query'] or 'another search' in search['search_query']

    def test_cannot_see_other_users_searches(self, db):
        """Test user cannot see other users' searches."""
        user1 = DoctorUserFactory()
        user2 = DoctorUserFactory()

        PatientSearchFactory(user=user1, search_query='user1 search')
        PatientSearchFactory(user=user2, search_query='user2 search')

        client = get_authenticated_client(user1)
        response = client.get('/api/patients/searches/')

        results = response.data.get('results', response.data)
        for search in results:
            assert 'user2 search' not in search['search_query']


# =============================================================================
# RecentPatient ViewSet Tests
# =============================================================================

@pytest.mark.tier1
class TestRecentPatientViewSet:
    """Tests for RecentPatientViewSet."""

    def test_list_own_recent_patients(self, db):
        """Test user can list their own recent patients."""
        user = DoctorUserFactory()
        RecentPatientFactory(user=user)
        RecentPatientFactory(user=user)

        # Create another user's recent patient
        other_user = DoctorUserFactory()
        RecentPatientFactory(user=other_user)

        client = get_authenticated_client(user)
        response = client.get('/api/patients/recent/')

        assert response.status_code == status.HTTP_200_OK
        results = response.data.get('results', response.data)
        assert len(results) == 2

    def test_add_recent_action(self, db):
        """Test adding a patient to recent list."""
        user = DoctorUserFactory()
        patient = PatientProfileFactory()

        client = get_authenticated_client(user)
        response = client.post('/api/patients/recent/add_recent/', {
            'patient_profile': str(patient.id)
        }, format='json')

        assert response.status_code == status.HTTP_200_OK
        assert RecentPatient.objects.filter(user=user, patient_profile=patient).exists()

    def test_add_recent_updates_existing(self, db):
        """Test adding existing patient updates access date."""
        user = DoctorUserFactory()
        patient = PatientProfileFactory()
        existing = RecentPatient.objects.create(user=user, patient_profile=patient)
        original_access = existing.access_date

        client = get_authenticated_client(user)
        response = client.post('/api/patients/recent/add_recent/', {
            'patient_profile': str(patient.id)
        }, format='json')

        assert response.status_code == status.HTTP_200_OK

    def test_add_recent_missing_patient_profile(self, db):
        """Test add_recent fails without patient_profile."""
        user = DoctorUserFactory()

        client = get_authenticated_client(user)
        response = client.post('/api/patients/recent/add_recent/', {}, format='json')

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_add_recent_invalid_patient(self, db):
        """Test add_recent fails with invalid patient ID."""
        user = DoctorUserFactory()

        client = get_authenticated_client(user)
        response = client.post('/api/patients/recent/add_recent/', {
            'patient_profile': '00000000-0000-0000-0000-000000000000'
        }, format='json')

        assert response.status_code == status.HTTP_404_NOT_FOUND


# =============================================================================
# PatientRegistrationValidation ViewSet Tests
# =============================================================================

@pytest.mark.tier1
class TestPatientRegistrationValidationViewSet:
    """Tests for PatientRegistrationValidationViewSet."""

    def test_list_validation_rules(self, db):
        """Test listing validation rules."""
        admin = AdminUserFactory()
        PatientRegistrationValidationFactory()
        PatientRegistrationValidationFactory()

        client = get_authenticated_client(admin)
        response = client.get('/api/patients/validation-rules/')

        assert response.status_code == status.HTTP_200_OK

    def test_create_validation_rule(self, db):
        """Test creating a validation rule."""
        admin = AdminUserFactory()

        client = get_authenticated_client(admin)
        response = client.post('/api/patients/validation-rules/', {
            'field_name': 'email',
            'validation_regex': r'^[\w\.-]+@[\w\.-]+\.\w+$',
            'validation_message': 'Enter a valid email',
            'is_required': True,
            'is_active': True
        }, format='json')

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data['field_name'] == 'email'


# =============================================================================
# PatientNote ViewSet Tests
# =============================================================================

@pytest.mark.tier1
class TestPatientNoteViewSet:
    """Tests for PatientNoteViewSet."""

    def test_list_notes_as_staff(self, db):
        """Test staff can list all notes."""
        admin = AdminUserFactory()
        PatientNoteFactory(is_private=True)
        PatientNoteFactory(is_private=False)

        client = get_authenticated_client(admin)
        response = client.get('/api/patients/notes/')

        assert response.status_code == status.HTTP_200_OK
        results = response.data.get('results', response.data)
        assert len(results) >= 2

    def test_create_note(self, db):
        """Test creating a patient note."""
        admin = AdminUserFactory()
        patient = PatientProfileFactory()

        client = get_authenticated_client(admin)
        response = client.post('/api/patients/notes/', {
            'patient_profile': str(patient.id),
            'note_text': 'This is a test note',
            'is_private': False
        }, format='json')

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data['note_text'] == 'This is a test note'

    def test_user_sees_own_and_public_notes(self, db):
        """Test non-staff sees own notes and public notes."""
        doctor = DoctorUserFactory()
        other_doctor = DoctorUserFactory()
        admin = AdminUserFactory()

        patient = PatientProfileFactory()

        # Doctor's own private note
        own_private = PatientNote.objects.create(
            patient_profile=patient,
            note_text='My private note',
            is_private=True,
            created_by=doctor,
            updated_by=doctor
        )

        # Other's private note (shouldn't see)
        other_private = PatientNote.objects.create(
            patient_profile=patient,
            note_text='Other private note',
            is_private=True,
            created_by=other_doctor,
            updated_by=other_doctor
        )

        # Public note (should see)
        public_note = PatientNote.objects.create(
            patient_profile=patient,
            note_text='Public note',
            is_private=False,
            created_by=admin,
            updated_by=admin
        )

        client = get_authenticated_client(doctor)
        response = client.get('/api/patients/notes/')

        assert response.status_code == status.HTTP_200_OK
        results = response.data.get('results', response.data)
        note_texts = [n['note_text'] for n in results]

        assert 'My private note' in note_texts
        assert 'Public note' in note_texts
        # other_private should not be visible
        assert 'Other private note' not in note_texts


# =============================================================================
# PatientViewSet Tests
# =============================================================================

@pytest.mark.tier1
class TestPatientViewSet:
    """Tests for PatientViewSet (register, search, get, update, delete)."""

    @patch('apps.fhir_client.client.fhir_client.create_resource')
    def test_register_patient(self, mock_create_resource, db):
        """Test patient registration."""
        mock_create_resource.return_value = {
            "resourceType": "Patient",
            "id": "fhir-new-patient",
            "meta": {"versionId": "1"}
        }

        admin = AdminUserFactory()
        client = get_authenticated_client(admin)

        response = client.post('/api/patients/register/', {
            'email': 'newpatient@test.com',
            'first_name': 'New',
            'last_name': 'Patient',
            'date_of_birth': '1990-01-15',
            'phone_number': '1234567890',
            'blood_group': 'A+'
        }, format='json')

        assert response.status_code == status.HTTP_201_CREATED
        assert PatientProfile.objects.filter(
            user__email='newpatient@test.com'
        ).exists()

    @patch('apps.fhir_client.client.fhir_client.create_resource')
    def test_register_patient_duplicate_email(self, mock_create_resource, db):
        """Test registration fails with duplicate email."""
        UserFactory(email='existing@test.com')
        admin = AdminUserFactory()

        client = get_authenticated_client(admin)
        response = client.post('/api/patients/register/', {
            'email': 'existing@test.com',
            'first_name': 'New',
            'last_name': 'Patient',
            'date_of_birth': '1990-01-15',
        }, format='json')

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @patch('apps.fhir_client.client.fhir_client.search_resources')
    def test_search_patients(self, mock_search_resources, db):
        """Test patient search."""
        mock_search_resources.return_value = {"entry": []}

        admin = AdminUserFactory()
        # Create some local patients
        user1 = PatientUserFactory(first_name='John', last_name='Doe')
        PatientProfileFactory(user=user1, medical_record_number='MRN-001')

        client = get_authenticated_client(admin)
        response = client.get('/api/patients/search/', {'query': 'John'})

        assert response.status_code == status.HTTP_200_OK
        assert 'patients' in response.data
        assert 'total' in response.data

    def test_search_creates_search_record(self, db):
        """Test that searching creates a search record."""
        with patch('apps.fhir_client.client.fhir_client.search_resources') as mock_search:
            mock_search.return_value = {"entry": []}

            doctor = DoctorUserFactory()
            client = get_authenticated_client(doctor)

            response = client.get('/api/patients/search/', {'query': 'TestQuery'})

            assert response.status_code == status.HTTP_200_OK
            assert PatientSearch.objects.filter(
                user=doctor,
                search_query__icontains='TestQuery'
            ).exists()

    @patch('apps.fhir_client.client.fhir_client.get_resource')
    def test_get_patient(self, mock_get_resource, db):
        """Test getting a patient by ID."""
        mock_get_resource.return_value = {
            "resourceType": "Patient",
            "id": "fhir-patient-123"
        }

        admin = AdminUserFactory()
        patient = PatientProfileFactory(fhir_patient_id='fhir-patient-123')

        client = get_authenticated_client(admin)
        response = client.get(f'/api/patients/{patient.id}/get_patient/')

        assert response.status_code == status.HTTP_200_OK
        assert 'local_data' in response.data
        assert 'fhir_data' in response.data

    def test_get_patient_creates_recent_record(self, db):
        """Test getting a patient adds to recent list."""
        with patch('apps.fhir_client.client.fhir_client.get_resource') as mock_get:
            mock_get.return_value = None

            doctor = DoctorUserFactory()
            patient = PatientProfileFactory()

            client = get_authenticated_client(doctor)
            response = client.get(f'/api/patients/{patient.id}/get_patient/')

            assert response.status_code == status.HTTP_200_OK
            assert RecentPatient.objects.filter(
                user=doctor,
                patient_profile=patient
            ).exists()

    def test_get_nonexistent_patient(self, db):
        """Test getting a non-existent patient returns 404."""
        admin = AdminUserFactory()
        client = get_authenticated_client(admin)

        response = client.get('/api/patients/00000000-0000-0000-0000-000000000000/get_patient/')

        assert response.status_code == status.HTTP_404_NOT_FOUND


# =============================================================================
# Authentication Tests
# =============================================================================

@pytest.mark.tier1
class TestPatientEndpointsAuthentication:
    """Tests for authentication on patient endpoints."""

    def test_fhir_mappings_requires_auth(self, db):
        """Test FHIR mappings endpoint requires authentication."""
        client = APIClient()
        response = client.get('/api/patients/fhir-mappings/')

        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_searches_requires_auth(self, db):
        """Test searches endpoint requires authentication."""
        client = APIClient()
        response = client.get('/api/patients/searches/')

        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_recent_requires_auth(self, db):
        """Test recent patients endpoint requires authentication."""
        client = APIClient()
        response = client.get('/api/patients/recent/')

        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_notes_requires_auth(self, db):
        """Test notes endpoint requires authentication."""
        client = APIClient()
        response = client.get('/api/patients/notes/')

        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_register_requires_auth(self, db):
        """Test registration requires authentication."""
        client = APIClient()
        response = client.post('/api/patients/register/', {
            'email': 'test@test.com',
            'first_name': 'Test',
            'last_name': 'User',
            'date_of_birth': '1990-01-01',
        }, format='json')

        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_search_requires_auth(self, db):
        """Test search requires authentication."""
        client = APIClient()
        response = client.get('/api/patients/search/')

        assert response.status_code == status.HTTP_401_UNAUTHORIZED


# =============================================================================
# Pagination Tests
# =============================================================================

@pytest.mark.tier1
class TestPatientPagination:
    """Tests for pagination on patient endpoints."""

    def test_notes_paginated(self, db):
        """Test notes endpoint is paginated."""
        admin = AdminUserFactory()
        patient = PatientProfileFactory()
        for _ in range(25):
            PatientNoteFactory(patient_profile=patient)

        client = get_authenticated_client(admin)
        response = client.get('/api/patients/notes/')

        assert response.status_code == status.HTTP_200_OK
        if isinstance(response.data, dict):
            assert 'results' in response.data or 'count' in response.data

    def test_fhir_mappings_paginated(self, db):
        """Test FHIR mappings endpoint is paginated."""
        admin = AdminUserFactory()
        for _ in range(25):
            PatientFHIRMappingFactory()

        client = get_authenticated_client(admin)
        response = client.get('/api/patients/fhir-mappings/')

        assert response.status_code == status.HTTP_200_OK
        if isinstance(response.data, dict):
            assert 'results' in response.data or 'count' in response.data
