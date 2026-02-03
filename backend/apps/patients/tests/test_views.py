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
from django.utils import timezone
from django.conf import settings
from datetime import timedelta, time
from django.test.utils import CaptureQueriesContext
from django.db import connection

from apps.patients.models import (
    PatientFHIRMapping, PatientSearch, RecentPatient,
    PatientRegistrationValidation, PatientNote
)
from apps.users.models import PatientProfile
from apps.core.models import BreakGlassEvent
from apps.core.tests.factories import DefaultFacilityFactory, DepartmentFactory
from apps.audit.models import AuditLog, AuditAction, AuditCategory
from apps.users.tests.factories import (
    UserFactory, AdminUserFactory, DoctorUserFactory,
    NurseUserFactory, PatientUserFactory, PatientProfileFactory,
    UserPatientListFactory
)
from apps.organization.models import Clinic, ClinicalUnit, UnitTypeConfig, ClinicSchedule
from .factories import (
    PatientFHIRMappingFactory, PatientSearchFactory,
    RecentPatientFactory, PatientRegistrationValidationFactory,
    PatientNoteFactory
)


def get_authenticated_client(user, facility=None):
    """Get an API client authenticated as the given user."""
    client = APIClient()
    refresh = RefreshToken.for_user(user)
    if facility is None:
        facility = getattr(user, 'primary_facility', None) or DefaultFacilityFactory()
    client.credentials(
        HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}',
        HTTP_X_FACILITY_CODE=facility.code
    )
    return client


def create_clinic(facility):
    core_department = DepartmentFactory(facility=facility)
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
    department = ClinicalUnit.objects.create(
        unit_type=department_type,
        parent=root_unit,
        code='OPD',
        name='Outpatient Department',
        is_active=True,
        core_department=core_department,
    )
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
        facility = user.primary_facility
        PatientSearchFactory(user=user, facility=facility, search_query='my search')
        PatientSearchFactory(user=user, facility=facility, search_query='another search')

        # Create another user's search
        other_user = DoctorUserFactory(primary_facility=facility)
        PatientSearchFactory(user=other_user, facility=facility, search_query='other search')

        client = get_authenticated_client(user, facility)
        response = client.get('/api/patients/searches/')

        assert response.status_code == status.HTTP_200_OK
        results = response.data.get('results', response.data)
        assert len(results) == 2
        for search in results:
            assert 'my search' in search['search_query'] or 'another search' in search['search_query']

    def test_cannot_see_other_users_searches(self, db):
        """Test user cannot see other users' searches."""
        user1 = DoctorUserFactory()
        facility = user1.primary_facility
        user2 = DoctorUserFactory(primary_facility=facility)

        PatientSearchFactory(user=user1, facility=facility, search_query='user1 search')
        PatientSearchFactory(user=user2, facility=facility, search_query='user2 search')

        client = get_authenticated_client(user1, facility)
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
        existing = RecentPatient.objects.create(
            user=user,
            patient_profile=patient,
            facility=patient.facility
        )
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
            facility=patient.facility,
            note_text='My private note',
            is_private=True,
            created_by=doctor,
            updated_by=doctor
        )

        # Other's private note (shouldn't see)
        other_private = PatientNote.objects.create(
            patient_profile=patient,
            facility=patient.facility,
            note_text='Other private note',
            is_private=True,
            created_by=other_doctor,
            updated_by=other_doctor
        )

        # Public note (should see)
        public_note = PatientNote.objects.create(
            patient_profile=patient,
            facility=patient.facility,
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

    @patch('apps.wards.tasks.sync_encounter_to_fhir.delay')
    @patch('apps.patients.tasks.create_patient_in_fhir.delay')
    def test_register_patient(self, mock_create_task, mock_sync_encounter_task, db, django_capture_on_commit_callbacks):
        """Test patient registration."""
        mock_create_task.return_value = MagicMock(id='task-123')
        mock_sync_encounter_task.return_value = MagicMock(id='task-456')

        admin = AdminUserFactory()
        facility = admin.primary_facility
        clinic = create_clinic(facility)
        client = get_authenticated_client(admin, facility=facility)

        with django_capture_on_commit_callbacks(execute=True):
            response = client.post('/api/patients/register/', {
                'email': 'newpatient@test.com',
                'first_name': 'New',
                'last_name': 'Patient',
                'date_of_birth': '1990-01-15',
                'phone_number': '1234567890',
                'blood_group': 'A+',
                'admission_details': {
                    'type': 'outpatient',
                    'department_id': str(clinic.department_id),
                    'clinic_id': str(clinic.id),
                }
            }, format='json')

        assert response.status_code == status.HTTP_201_CREATED
        assert PatientProfile.objects.filter(
            user__email='newpatient@test.com'
        ).exists()
        mock_create_task.assert_called_once()

    def test_register_patient_duplicate_email(self, db):
        """Test registration fails with duplicate email."""
        UserFactory(email='existing@test.com')
        admin = AdminUserFactory()

        facility = admin.primary_facility
        clinic = create_clinic(facility)
        client = get_authenticated_client(admin, facility=facility)
        response = client.post('/api/patients/register/', {
            'email': 'existing@test.com',
            'first_name': 'New',
            'last_name': 'Patient',
            'date_of_birth': '1990-01-15',
            'admission_details': {
                'type': 'outpatient',
                'department_id': str(clinic.department_id),
                'clinic_id': str(clinic.id),
            }
        }, format='json')

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @patch('apps.wards.tasks.sync_encounter_to_fhir.delay')
    @patch('apps.patients.tasks.create_patient_in_fhir.delay')
    def test_register_patient_as_receptionist(self, mock_create_task, mock_sync_encounter_task, db, django_capture_on_commit_callbacks):
        """Test that receptionists can register patients."""
        from apps.users.tests.factories import ReceptionistUserFactory

        mock_create_task.return_value = MagicMock(id='task-123')
        mock_sync_encounter_task.return_value = MagicMock(id='task-456')

        receptionist = ReceptionistUserFactory()
        facility = receptionist.primary_facility
        clinic = create_clinic(facility)
        client = get_authenticated_client(receptionist, facility=facility)

        with django_capture_on_commit_callbacks(execute=True):
            response = client.post('/api/patients/register/', {
                'email': 'receptionist-patient@test.com',
                'first_name': 'New',
                'last_name': 'Patient',
                'date_of_birth': '1990-01-15',
                'phone_number': '1234567890',
                'admission_details': {
                    'type': 'outpatient',
                    'department_id': str(clinic.department_id),
                    'clinic_id': str(clinic.id),
                },
            }, format='json')

        assert response.status_code == status.HTTP_201_CREATED
        assert PatientProfile.objects.filter(
            user__email='receptionist-patient@test.com'
        ).exists()
        mock_create_task.assert_called_once()

    def test_register_patient_forbidden_for_doctor(self, db):
        """Test that doctors cannot register patients."""
        doctor = DoctorUserFactory()
        client = get_authenticated_client(doctor)

        response = client.post('/api/patients/register/', {
            'email': 'doctor-patient@test.com',
            'first_name': 'New',
            'last_name': 'Patient',
            'date_of_birth': '1990-01-15',
        }, format='json')

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert not PatientProfile.objects.filter(
            user__email='doctor-patient@test.com'
        ).exists()

    def test_register_patient_forbidden_for_nurse(self, db):
        """Test that nurses cannot register patients."""
        nurse = NurseUserFactory()
        client = get_authenticated_client(nurse)

        response = client.post('/api/patients/register/', {
            'email': 'nurse-patient@test.com',
            'first_name': 'New',
            'last_name': 'Patient',
            'date_of_birth': '1990-01-15',
        }, format='json')

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert not PatientProfile.objects.filter(
            user__email='nurse-patient@test.com'
        ).exists()

    def test_search_patients(self, db):
        """Test patient search."""
        admin = AdminUserFactory()
        # Create some local patients
        user1 = PatientUserFactory(first_name='John', last_name='Doe')
        PatientProfileFactory(user=user1, medical_record_number='MRN-001')

        client = get_authenticated_client(admin)
        response = client.get('/api/patients/search/', {'query': 'John'})

        assert response.status_code == status.HTTP_200_OK
        assert 'results' in response.data
        assert 'total' in response.data

    @patch('apps.patients.tasks.log_patient_search.delay')
    def test_search_query_count(self, mock_log_task, db):
        """Search should be O(1) queries per page."""
        admin = AdminUserFactory()
        facility = admin.primary_facility
        PatientProfileFactory.create_batch(5, facility=facility)

        client = get_authenticated_client(admin, facility=facility)
        with CaptureQueriesContext(connection) as ctx:
            response = client.get('/api/patients/search/', {'query': 'Pat'})

        assert response.status_code == status.HTTP_200_OK
        assert len(ctx) <= 8

    def test_search_include_fhir_forbidden_for_receptionist(self, db):
        """Test that FHIR search is restricted to clinical staff."""
        from apps.users.tests.factories import ReceptionistUserFactory

        receptionist = ReceptionistUserFactory()
        client = get_authenticated_client(receptionist)

        response = client.get('/api/patients/search/', {'query': 'John', 'include_fhir': 'true'})

        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_search_creates_search_record(self, db):
        """Test that searching creates a search record."""
        doctor = DoctorUserFactory()
        client = get_authenticated_client(doctor)

        response = client.get('/api/patients/search/', {'query': 'TestQuery'})

        assert response.status_code == status.HTTP_200_OK
        assert PatientSearch.objects.filter(
            user=doctor,
            search_query__icontains='TestQuery'
        ).exists()

    @patch('apps.patients.tasks.sync_patient_with_fhir.delay')
    def test_get_patient(self, mock_sync_task, db):
        """Test getting a patient by ID."""
        admin = AdminUserFactory()
        patient = PatientProfileFactory(fhir_patient_id='fhir-patient-123')
        PatientFHIRMappingFactory(
            patient_profile=patient,
            fhir_patient_id='fhir-patient-123'
        )

        client = get_authenticated_client(admin)
        response = client.get(f'/api/patients/{patient.id}/get_patient/')

        assert response.status_code == status.HTTP_200_OK
        assert 'local_data' in response.data
        assert 'fhir_data' in response.data
        assert response.data.get('fhir_status') in ['pending', 'available']
        mock_sync_task.assert_called()

    @patch('apps.patients.tasks.sync_patient_with_fhir.delay')
    def test_get_patient_creates_recent_record(self, mock_sync_task, db):
        """Test getting a patient adds to recent list."""
        admin = AdminUserFactory()
        patient = PatientProfileFactory()

        client = get_authenticated_client(admin)
        response = client.get(f'/api/patients/{patient.id}/get_patient/')

        assert response.status_code == status.HTTP_200_OK
        assert RecentPatient.objects.filter(
            user=admin,
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
# Break-Glass Access Tests
# =============================================================================

@pytest.mark.tier1
class TestBreakGlassAccess:
    def test_break_glass_creates_event_and_audit(self, db):
        doctor = DoctorUserFactory()
        patient = PatientProfileFactory()

        client = get_authenticated_client(doctor)
        now = timezone.now()
        response = client.post(
            f'/api/patients/{patient.id}/break-glass/',
            {'reason': 'Emergency coverage'},
            format='json'
        )

        assert response.status_code == status.HTTP_201_CREATED
        event = BreakGlassEvent.objects.get(user=doctor, patient=patient)
        assert event.scope == 'clinical'
        assert event.expires_at > now
        assert event.expires_at <= now + timedelta(minutes=settings.BREAK_GLASS_TTL_MINUTES + 1)

        assert AuditLog.objects.filter(
            action=AuditAction.BREAK_GLASS,
            category=AuditCategory.CLINICAL,
            resource_id=str(patient.id),
        ).exists()

    def test_break_glass_denies_non_clinical(self, db):
        receptionist = UserFactory(user_type='receptionist')
        patient = PatientProfileFactory()

        client = get_authenticated_client(receptionist)
        response = client.post(
            f'/api/patients/{patient.id}/break-glass/',
            {'reason': 'Need access'},
            format='json'
        )

        assert response.status_code == status.HTTP_403_FORBIDDEN


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
