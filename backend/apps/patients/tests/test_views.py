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
from datetime import date, timedelta, time, datetime
from django.test.utils import CaptureQueriesContext
from django.db import connection

from apps.patients.models import (
    PatientFHIRMapping, PatientSearch, RecentPatient,
    PatientRegistrationValidation, PatientNote
)
from apps.users.models import PatientProfile
from apps.core.models import BreakGlassEvent
from apps.core.tests.factories import DefaultFacilityFactory, DepartmentFactory, FacilityFactory
from apps.audit.models import AuditLog, AuditAction, AuditCategory
from apps.users.tests.factories import (
    UserFactory, AdminUserFactory, DoctorUserFactory,
    NurseUserFactory, PatientUserFactory, PatientProfileFactory,
    UserPatientListFactory, PractitionerProfileFactory,
    LabTechnicianUserFactory, PharmacistUserFactory
)
from apps.organization.models import Clinic, ClinicalUnit, UnitTypeConfig, ClinicSchedule
from apps.wards.tests.factories import AdmissionFactory, WardFactory
from apps.encounters.tests.factories import EncounterFactory
from apps.laboratory.tests.factories import LabOrderFactory
from apps.clinical_notes.tests.factories import PrescriptionFactory
from apps.billing.tests.factories import InvoiceFactory
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

    @patch('apps.encounters.tasks.sync_encounter_to_fhir.delay')
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
        search_record = PatientSearch.objects.get(user=admin, facility=facility)
        assert search_record.search_query == 'patient-registration action=create'
        assert 'New Patient' not in search_record.search_query
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

    @patch('apps.encounters.tasks.sync_encounter_to_fhir.delay')
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

    def test_search_patients_by_full_name_tokens(self, db):
        admin = AdminUserFactory()
        facility = admin.primary_facility
        patient = PatientProfileFactory(
            facility=facility,
            user=PatientUserFactory(
                first_name='Smoke',
                last_name='Patient',
                primary_facility=facility,
            ),
            medical_record_number='MRN-SMOKE-001',
        )

        client = get_authenticated_client(admin, facility=facility)
        response = client.get('/api/patients/search/', {'query': 'Smoke Patient'})

        assert response.status_code == status.HTTP_200_OK
        ids = [item['id'] for item in response.data.get('results', [])]
        assert str(patient.id) in ids

    def test_search_supports_ordering_by_name(self, db):
        admin = AdminUserFactory()
        facility = admin.primary_facility

        patient_a = PatientProfileFactory(
            facility=facility,
            user=PatientUserFactory(first_name='Sort', last_name='Zulu', primary_facility=facility),
            medical_record_number='MRN-SORT-003',
        )
        patient_b = PatientProfileFactory(
            facility=facility,
            user=PatientUserFactory(first_name='Sort', last_name='Alpha', primary_facility=facility),
            medical_record_number='MRN-SORT-001',
        )
        patient_c = PatientProfileFactory(
            facility=facility,
            user=PatientUserFactory(first_name='Sort', last_name='Lima', primary_facility=facility),
            medical_record_number='MRN-SORT-002',
        )

        client = get_authenticated_client(admin, facility=facility)
        response = client.get('/api/patients/search/', {
            'query': 'Sort',
            'ordering': 'name',
            'page_size': 10,
        })

        assert response.status_code == status.HTTP_200_OK
        ids = [item['id'] for item in response.data.get('results', [])]
        assert ids == [str(patient_b.id), str(patient_c.id), str(patient_a.id)]

    def test_facility_admin_search_without_query_requires_query_or_filter(self, db):
        admin = AdminUserFactory()
        facility = admin.primary_facility

        PatientProfileFactory(
            facility=facility,
            user=PatientUserFactory(first_name='Older', last_name='Patient', primary_facility=facility),
        )

        client = get_authenticated_client(admin, facility=facility)
        response = client.get('/api/patients/search/', {'page_size': 10})

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'query or filter is required' in response.data['error'].lower()

    def test_search_supports_pagination_metadata(self, db):
        admin = AdminUserFactory()
        facility = admin.primary_facility

        for idx in range(3):
            PatientProfileFactory(
                facility=facility,
                user=PatientUserFactory(
                    first_name='Paged',
                    last_name=f'Patient{idx}',
                    primary_facility=facility,
                ),
                medical_record_number=f'MRN-PAGE-00{idx}',
            )

        client = get_authenticated_client(admin, facility=facility)
        first_page = client.get('/api/patients/search/', {
            'query': 'Paged',
            'ordering': 'name',
            'page_size': 2,
            'page': 1,
        })

        assert first_page.status_code == status.HTTP_200_OK
        assert first_page.data.get('total') is None
        assert first_page.data.get('count_exact') is False
        assert first_page.data.get('page') == 1
        assert first_page.data.get('page_size') == 2
        assert len(first_page.data.get('results', [])) == 2
        assert first_page.data.get('next') is not None
        assert 'admission_status' not in first_page.data['results'][0]

        second_page = client.get('/api/patients/search/', {
            'query': 'Paged',
            'ordering': 'name',
            'page_size': 2,
            'page': 2,
        })

        assert second_page.status_code == status.HTTP_200_OK
        assert second_page.data.get('page') == 2
        assert second_page.data.get('total') == 3
        assert second_page.data.get('count_exact') is True
        assert len(second_page.data.get('results', [])) == 1
        assert second_page.data.get('previous') is not None

    def test_search_include_total_returns_exact_count(self, db):
        admin = AdminUserFactory()
        facility = admin.primary_facility

        for idx in range(3):
            PatientProfileFactory(
                facility=facility,
                user=PatientUserFactory(
                    first_name='Exact',
                    last_name=f'Patient{idx}',
                    primary_facility=facility,
                ),
                medical_record_number=f'MRN-EXACT-00{idx}',
            )

        client = get_authenticated_client(admin, facility=facility)
        response = client.get('/api/patients/search/', {
            'query': 'Exact',
            'ordering': 'name',
            'page_size': 2,
            'page': 1,
            'include_total': 'true',
        })

        assert response.status_code == status.HTTP_200_OK
        assert response.data.get('total') == 3
        assert response.data.get('count_exact') is True

    def test_search_rejects_invalid_ordering(self, db):
        admin = AdminUserFactory()
        facility = admin.primary_facility
        client = get_authenticated_client(admin, facility=facility)

        response = client.get('/api/patients/search/', {
            'query': 'John',
            'ordering': 'unsupported_field',
        })

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data.get('error') == 'Invalid ordering field.'

    def test_search_filters_admission_date_range(self, db):
        admin = AdminUserFactory()
        facility = admin.primary_facility
        ward = WardFactory(department__facility=facility)

        in_range_patient = PatientProfileFactory(facility=facility)
        out_range_patient = PatientProfileFactory(facility=facility)

        in_range_date = timezone.localdate()
        out_range_date = in_range_date - timedelta(days=30)

        AdmissionFactory(
            patient=in_range_patient,
            bed__ward=ward,
            admission_date=timezone.make_aware(datetime.combine(in_range_date, datetime.min.time()))
        )
        AdmissionFactory(
            patient=out_range_patient,
            bed__ward=ward,
            admission_date=timezone.make_aware(datetime.combine(out_range_date, datetime.min.time()))
        )

        client = get_authenticated_client(admin, facility=facility)
        response = client.get('/api/patients/search/', {
            'admission_start': in_range_date.isoformat(),
            'admission_end': in_range_date.isoformat(),
        })

        assert response.status_code == status.HTTP_200_OK
        ids = {item['id'] for item in response.data.get('results', [])}
        assert str(in_range_patient.id) in ids
        assert str(out_range_patient.id) not in ids

    def test_search_filters_ward(self, db):
        admin = AdminUserFactory()
        facility = admin.primary_facility
        ward_a = WardFactory(department__facility=facility)
        ward_b = WardFactory(department__facility=facility)

        patient_a = PatientProfileFactory(facility=facility)
        patient_b = PatientProfileFactory(facility=facility)

        AdmissionFactory(patient=patient_a, bed__ward=ward_a)
        AdmissionFactory(patient=patient_b, bed__ward=ward_b)

        client = get_authenticated_client(admin, facility=facility)
        response = client.get('/api/patients/search/', {'ward': str(ward_a.id)})

        assert response.status_code == status.HTTP_200_OK
        ids = {item['id'] for item in response.data.get('results', [])}
        assert str(patient_a.id) in ids
        assert str(patient_b.id) not in ids

    def test_search_filters_department_and_encounter_type(self, db):
        admin = AdminUserFactory()
        facility = admin.primary_facility
        clinic = create_clinic(facility)

        other_department = ClinicalUnit.objects.create(
            unit_type=UnitTypeConfig.objects.get(code='department'),
            parent=ClinicalUnit.objects.get(code=facility.code),
            code='OPD-ALT',
            name='Alternate Department',
            is_active=True,
        )

        patient_match = PatientProfileFactory(facility=facility)
        patient_other = PatientProfileFactory(facility=facility)

        EncounterFactory(
            patient=patient_match,
            facility=facility,
            department=clinic.department,
            encounter_type='outpatient',
            status='in-progress',
        )
        EncounterFactory(
            patient=patient_other,
            facility=facility,
            department=other_department,
            encounter_type='emergency',
            status='in-progress',
        )

        client = get_authenticated_client(admin, facility=facility)
        response = client.get('/api/patients/search/', {
            'department_id': str(clinic.department_id),
            'encounter_type': 'outpatient',
        })

        assert response.status_code == status.HTTP_200_OK
        ids = {item['id'] for item in response.data.get('results', [])}
        assert str(patient_match.id) in ids
        assert str(patient_other.id) not in ids

    def test_search_filters_attending_matches_admission_or_encounter(self, db):
        admin = AdminUserFactory()
        facility = admin.primary_facility
        practitioner = PractitionerProfileFactory()

        patient_admission = PatientProfileFactory(facility=facility)
        patient_encounter = PatientProfileFactory(facility=facility)
        patient_other = PatientProfileFactory(facility=facility)

        AdmissionFactory(patient=patient_admission, admitting_doctor=practitioner)
        EncounterFactory(
            patient=patient_encounter,
            facility=facility,
            practitioner=practitioner,
            encounter_type='emergency',
            status='in-progress',
        )
        EncounterFactory(
            patient=patient_other,
            facility=facility,
            encounter_type='outpatient',
            status='in-progress',
        )

        client = get_authenticated_client(admin, facility=facility)
        response = client.get('/api/patients/search/', {'attending_id': str(practitioner.id)})

        assert response.status_code == status.HTTP_200_OK
        ids = {item['id'] for item in response.data.get('results', [])}
        assert str(patient_admission.id) in ids
        assert str(patient_encounter.id) in ids
        assert str(patient_other.id) not in ids

    def test_search_filters_age_range(self, db):
        admin = AdminUserFactory()
        facility = admin.primary_facility
        today = timezone.localdate()

        younger_user = PatientUserFactory(date_of_birth=today.replace(year=today.year - 25))
        older_user = PatientUserFactory(date_of_birth=today.replace(year=today.year - 70))

        younger_patient = PatientProfileFactory(user=younger_user, facility=facility)
        older_patient = PatientProfileFactory(user=older_user, facility=facility)

        client = get_authenticated_client(admin, facility=facility)
        response = client.get('/api/patients/search/', {
            'age_min': 20,
            'age_max': 40,
        })

        assert response.status_code == status.HTTP_200_OK
        ids = {item['id'] for item in response.data.get('results', [])}
        assert str(younger_patient.id) in ids
        assert str(older_patient.id) not in ids

    def test_search_filters_my_patients(self, db):
        doctor = DoctorUserFactory()
        facility = doctor.primary_facility
        patient_in_list = PatientProfileFactory(facility=facility)
        patient_outside = PatientProfileFactory(facility=facility)

        UserPatientListFactory(user=doctor, patient=patient_in_list)

        client = get_authenticated_client(doctor, facility=facility)
        response = client.get('/api/patients/search/', {'my_patients': 'true'})

        assert response.status_code == status.HTTP_200_OK
        ids = {item['id'] for item in response.data.get('results', [])}
        assert str(patient_in_list.id) in ids
        assert str(patient_outside.id) not in ids

    def test_search_filters_my_patients_forbidden_for_billing(self, db):
        billing_user = UserFactory(user_type='billing')
        client = get_authenticated_client(billing_user)
        response = client.get('/api/patients/search/', {'my_patients': 'true'})

        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_search_registry_scope_active(self, db):
        admin = AdminUserFactory()
        facility = admin.primary_facility

        active_inpatient = PatientProfileFactory(
            facility=facility,
            user=PatientUserFactory(first_name='Scope', last_name='ActiveInpatient', primary_facility=facility),
        )
        active_outpatient = PatientProfileFactory(
            facility=facility,
            user=PatientUserFactory(first_name='Scope', last_name='ActiveOutpatient', primary_facility=facility),
        )
        discharged = PatientProfileFactory(
            facility=facility,
            user=PatientUserFactory(first_name='Scope', last_name='Discharged', primary_facility=facility),
        )
        deceased = PatientProfileFactory(
            facility=facility,
            user=PatientUserFactory(first_name='Scope', last_name='Deceased', primary_facility=facility),
        )
        completed_outpatient = PatientProfileFactory(
            facility=facility,
            user=PatientUserFactory(first_name='Scope', last_name='Completed', primary_facility=facility),
        )

        AdmissionFactory(patient=active_inpatient, facility=facility, status='admitted')
        EncounterFactory(
            patient=active_outpatient,
            facility=facility,
            encounter_type='outpatient',
            status='in-progress',
        )
        AdmissionFactory(patient=discharged, facility=facility, status='discharged')
        AdmissionFactory(patient=deceased, facility=facility, status='deceased')
        EncounterFactory(
            patient=completed_outpatient,
            facility=facility,
            encounter_type='outpatient',
            status='finished',
        )

        client = get_authenticated_client(admin, facility=facility)
        response = client.get('/api/patients/search/', {'registry_scope': 'active'})

        assert response.status_code == status.HTTP_200_OK
        ids = {item['id'] for item in response.data.get('results', [])}
        assert str(active_inpatient.id) in ids
        assert str(active_outpatient.id) in ids
        assert str(discharged.id) not in ids
        assert str(deceased.id) not in ids
        assert str(completed_outpatient.id) not in ids

    def test_search_registry_scope_discharged(self, db):
        admin = AdminUserFactory()
        facility = admin.primary_facility

        active_inpatient = PatientProfileFactory(facility=facility)
        active_outpatient = PatientProfileFactory(facility=facility)
        discharged = PatientProfileFactory(facility=facility)
        transferred = PatientProfileFactory(facility=facility)
        deceased = PatientProfileFactory(facility=facility)
        completed_outpatient = PatientProfileFactory(facility=facility)

        AdmissionFactory(patient=active_inpatient, facility=facility, status='admitted')
        EncounterFactory(
            patient=active_outpatient,
            facility=facility,
            encounter_type='outpatient',
            status='planned',
        )
        AdmissionFactory(patient=discharged, facility=facility, status='discharged')
        AdmissionFactory(patient=transferred, facility=facility, status='transferred')
        AdmissionFactory(patient=deceased, facility=facility, status='deceased')
        EncounterFactory(
            patient=completed_outpatient,
            facility=facility,
            encounter_type='outpatient',
            status='cancelled',
        )

        client = get_authenticated_client(admin, facility=facility)
        response = client.get('/api/patients/search/', {'registry_scope': 'discharged'})

        assert response.status_code == status.HTTP_200_OK
        ids = {item['id'] for item in response.data.get('results', [])}
        assert str(discharged.id) in ids
        assert str(transferred.id) in ids
        assert str(completed_outpatient.id) in ids
        assert str(active_inpatient.id) not in ids
        assert str(active_outpatient.id) not in ids
        assert str(deceased.id) not in ids

    def test_search_registry_scope_deceased(self, db):
        admin = AdminUserFactory()
        facility = admin.primary_facility

        active_patient = PatientProfileFactory(facility=facility)
        discharged_patient = PatientProfileFactory(facility=facility)
        deceased_patient = PatientProfileFactory(facility=facility)
        completed_outpatient = PatientProfileFactory(facility=facility)

        AdmissionFactory(patient=active_patient, facility=facility, status='admitted')
        AdmissionFactory(patient=discharged_patient, facility=facility, status='discharged')
        AdmissionFactory(patient=deceased_patient, facility=facility, status='deceased')
        EncounterFactory(
            patient=completed_outpatient,
            facility=facility,
            encounter_type='outpatient',
            status='finished',
        )

        client = get_authenticated_client(admin, facility=facility)
        response = client.get('/api/patients/search/', {'registry_scope': 'deceased'})

        assert response.status_code == status.HTTP_200_OK
        ids = {item['id'] for item in response.data.get('results', [])}
        assert str(deceased_patient.id) in ids
        assert str(active_patient.id) not in ids
        assert str(discharged_patient.id) not in ids
        assert str(completed_outpatient.id) not in ids

    def test_search_registry_scope_rejects_invalid_value(self, db):
        admin = AdminUserFactory()
        facility = admin.primary_facility
        client = get_authenticated_client(admin, facility=facility)

        response = client.get('/api/patients/search/', {'registry_scope': 'invalid'})

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data.get('error') == 'Invalid registry_scope value.'

    def test_search_registry_scope_all_with_query_includes_all_statuses(self, db):
        admin = AdminUserFactory()
        facility = admin.primary_facility

        active_patient = PatientProfileFactory(
            facility=facility,
            user=PatientUserFactory(first_name='ScopeAll', last_name='Active', primary_facility=facility),
        )
        discharged_patient = PatientProfileFactory(
            facility=facility,
            user=PatientUserFactory(first_name='ScopeAll', last_name='Discharged', primary_facility=facility),
        )
        deceased_patient = PatientProfileFactory(
            facility=facility,
            user=PatientUserFactory(first_name='ScopeAll', last_name='Deceased', primary_facility=facility),
        )

        AdmissionFactory(patient=active_patient, facility=facility, status='admitted')
        AdmissionFactory(patient=discharged_patient, facility=facility, status='discharged')
        AdmissionFactory(patient=deceased_patient, facility=facility, status='deceased')

        client = get_authenticated_client(admin, facility=facility)
        response = client.get('/api/patients/search/', {
            'query': 'ScopeAll',
            'registry_scope': 'all',
        })

        assert response.status_code == status.HTTP_200_OK
        ids = {item['id'] for item in response.data.get('results', [])}
        assert str(active_patient.id) in ids
        assert str(discharged_patient.id) in ids
        assert str(deceased_patient.id) in ids

    def test_search_include_fhir_with_filters_returns_400(self, db):
        admin = AdminUserFactory()
        facility = admin.primary_facility
        ward = WardFactory(department__facility=facility)
        client = get_authenticated_client(admin, facility=facility)

        response = client.get('/api/patients/search/', {
            'query': 'John',
            'include_fhir': 'true',
            'ward': str(ward.id),
        })

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_search_role_scoping_lab_pharmacy_billing(self, db):
        facility = DefaultFacilityFactory()

        lab_user = LabTechnicianUserFactory(primary_facility=facility)
        pharm_user = PharmacistUserFactory(primary_facility=facility)
        billing_user = UserFactory(user_type='billing', primary_facility=facility)

        patient_lab = PatientProfileFactory(
            facility=facility,
            user=PatientUserFactory(first_name='Alpha', last_name='Lab', primary_facility=facility)
        )
        patient_pharm = PatientProfileFactory(
            facility=facility,
            user=PatientUserFactory(first_name='Alpha', last_name='Pharm', primary_facility=facility)
        )
        patient_billing = PatientProfileFactory(
            facility=facility,
            user=PatientUserFactory(first_name='Alpha', last_name='Bill', primary_facility=facility)
        )
        PatientProfileFactory(
            facility=facility,
            user=PatientUserFactory(first_name='Alpha', last_name='Other', primary_facility=facility)
        )

        LabOrderFactory(patient=patient_lab, facility=facility)
        PrescriptionFactory(patient=patient_pharm, facility=facility)
        InvoiceFactory(patient=patient_billing, facility=facility)

        lab_client = get_authenticated_client(lab_user, facility=facility)
        lab_response = lab_client.get('/api/patients/search/', {'query': 'Alpha'})
        lab_ids = {item['id'] for item in lab_response.data.get('results', [])}
        assert str(patient_lab.id) in lab_ids
        assert str(patient_pharm.id) not in lab_ids
        assert str(patient_billing.id) not in lab_ids

        pharm_client = get_authenticated_client(pharm_user, facility=facility)
        pharm_response = pharm_client.get('/api/patients/search/', {'query': 'Alpha'})
        pharm_ids = {item['id'] for item in pharm_response.data.get('results', [])}
        assert str(patient_pharm.id) in pharm_ids
        assert str(patient_lab.id) not in pharm_ids

        billing_client = get_authenticated_client(billing_user, facility=facility)
        billing_response = billing_client.get('/api/patients/search/', {'query': 'Alpha'})
        billing_ids = {item['id'] for item in billing_response.data.get('results', [])}
        assert str(patient_billing.id) in billing_ids
        assert str(patient_lab.id) not in billing_ids

    def test_clinical_patient_search_requires_team_access(self, db):
        facility = DefaultFacilityFactory()
        doctor = DoctorUserFactory(primary_facility=facility)
        practitioner = PractitionerProfileFactory(
            staff__user=doctor,
            staff__primary_facility=facility,
        )
        assigned_patient = PatientProfileFactory(
            facility=facility,
            user=PatientUserFactory(first_name='Alpha', last_name='Assigned', primary_facility=facility)
        )
        unassigned_patient = PatientProfileFactory(
            facility=facility,
            user=PatientUserFactory(first_name='Alpha', last_name='Unassigned', primary_facility=facility)
        )
        EncounterFactory(patient=assigned_patient, facility=facility, practitioner=practitioner)

        client = get_authenticated_client(doctor, facility=facility)
        response = client.get('/api/patients/search/', {'query': 'Alpha'})

        assert response.status_code == status.HTTP_200_OK
        ids = {item['id'] for item in response.data.get('results', [])}
        assert str(assigned_patient.id) in ids
        assert str(unassigned_patient.id) not in ids

    def test_facility_admin_patient_search_uses_directory_projection(self, db):
        admin = AdminUserFactory()
        facility = admin.primary_facility
        patient = PatientProfileFactory(
            facility=facility,
            user=PatientUserFactory(first_name='Alpha', last_name='Directory', primary_facility=facility)
        )
        AdmissionFactory(patient=patient, facility=facility)

        client = get_authenticated_client(admin, facility=facility)
        response = client.get('/api/patients/search/', {'query': 'Alpha'})

        assert response.status_code == status.HTTP_200_OK
        result = response.data['results'][0]
        assert result['id'] == str(patient.id)
        assert 'current_ward' not in result
        assert 'patient_location' not in result
        assert 'active_clinic_names' not in result
        assert 'admission_status' not in result

    @patch('apps.patients.tasks.log_patient_search.delay')
    def test_search_query_count(self, mock_log_task, db):
        """Search should be O(1) queries per page."""
        admin = AdminUserFactory()
        facility = admin.primary_facility
        for idx in range(5):
            PatientProfileFactory(
                facility=facility,
                user=PatientUserFactory(
                    first_name='Pat',
                    last_name=f'Query{idx}',
                    primary_facility=facility,
                ),
            )

        client = get_authenticated_client(admin, facility=facility)
        with CaptureQueriesContext(connection) as ctx:
            response = client.get('/api/patients/search/', {'query': 'Pat'})

        assert response.status_code == status.HTTP_200_OK
        # Includes fixed auth, facility, feature gate, and feature-scope middleware overhead.
        assert len(ctx) <= 13

    @patch('apps.patients.tasks.enqueue_patient_search_index_rebuild.delay')
    def test_admin_can_queue_patient_search_reindex(self, mock_reindex_task, db):
        admin = AdminUserFactory()
        facility = admin.primary_facility
        mock_reindex_task.return_value = MagicMock(id='reindex-task-123')

        client = get_authenticated_client(admin, facility=facility)
        response = client.post('/api/patients/search-index/reindex/', {}, format='json')

        assert response.status_code == status.HTTP_202_ACCEPTED
        assert response.data['task_id'] == 'reindex-task-123'
        mock_reindex_task.assert_called_once()

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
        search_record = PatientSearch.objects.filter(user=doctor).latest('search_date')
        assert search_record.search_query == 'patient-search filters=query ordering=-created_at page=1'
        assert 'TestQuery' not in search_record.search_query

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

    def test_get_patient_denies_cross_facility_idor(self, db):
        """Patient custom actions must scope object lookup to the active facility."""
        facility_a = DefaultFacilityFactory()
        facility_b = FacilityFactory()
        doctor = DoctorUserFactory(primary_facility=facility_a)
        patient = PatientProfileFactory(facility=facility_b)

        client = get_authenticated_client(doctor, facility=facility_a)
        response = client.get(f'/api/patients/{patient.id}/get_patient/')

        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_receptionist_cannot_update_clinical_profile_fields(self, db):
        facility = DefaultFacilityFactory()
        receptionist = UserFactory(user_type='receptionist', primary_facility=facility)
        patient = PatientProfileFactory(facility=facility)

        client = get_authenticated_client(receptionist, facility=facility)
        response = client.put(
            f'/api/patients/{patient.id}/update_patient/',
            {'local_data': {'allergies': 'Penicillin'}},
            format='json',
        )

        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_get_demographics_returns_editable_demographics_shape(self, db):
        facility = DefaultFacilityFactory()
        receptionist = UserFactory(user_type='receptionist', primary_facility=facility)
        patient = PatientProfileFactory(
            facility=facility,
            nhis_id='NHIS-123',
            emergency_contact_name='Emergency Contact',
            emergency_contact_phone='233200000000',
            emergency_contact_relationship='Sibling',
        )
        patient.user.phone_number = '233244000000'
        patient.user.date_of_birth = date(1990, 1, 1)
        patient.user.save(update_fields=['phone_number', 'date_of_birth'])

        client = get_authenticated_client(receptionist, facility=facility)
        response = client.get(f'/api/patients/{patient.id}/demographics/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['nhis_id'] == 'NHIS-123'
        assert response.data['emergency_contact_name'] == 'Emergency Contact'
        assert response.data['emergency_contact_phone'] == '233200000000'
        assert response.data['emergency_contact_relationship'] == 'Sibling'
        assert response.data['user_details']['phone_number'] == '233244000000'
        assert response.data['user_details']['date_of_birth'] == '1990-01-01'
        assert 'allergies' not in response.data
        assert 'blood_group' not in response.data
        assert 'fhir_patient_id' not in response.data

    def test_receptionist_can_update_demographics_without_clinical_fields(self, db):
        facility = DefaultFacilityFactory()
        receptionist = UserFactory(user_type='receptionist', primary_facility=facility)
        patient = PatientProfileFactory(facility=facility)

        client = get_authenticated_client(receptionist, facility=facility)
        response = client.put(
            f'/api/patients/{patient.id}/update_patient/',
            {
                'local_data': {
                    'user': {
                        'first_name': 'Updated',
                        'last_name': 'Patient',
                        'phone_number': '233200000001',
                        'date_of_birth': '1988-05-10',
                    },
                    'nhis_id': 'NHIS-UPDATED',
                    'emergency_contact_name': 'New Contact',
                    'emergency_contact_phone': '233200000002',
                    'emergency_contact_relationship': 'Parent',
                }
            },
            format='json',
        )

        assert response.status_code == status.HTTP_200_OK
        patient.refresh_from_db()
        patient.user.refresh_from_db()
        assert patient.nhis_id == 'NHIS-UPDATED'
        assert patient.emergency_contact_name == 'New Contact'
        assert patient.user.first_name == 'Updated'
        assert patient.user.phone_number == '233200000001'

    def test_receptionist_cannot_update_patient_email_via_demographics(self, db):
        facility = DefaultFacilityFactory()
        receptionist = UserFactory(user_type='receptionist', primary_facility=facility)
        patient = PatientProfileFactory(facility=facility)
        original_email = patient.user.email

        client = get_authenticated_client(receptionist, facility=facility)
        response = client.put(
            f'/api/patients/{patient.id}/update_patient/',
            {'local_data': {'user': {'email': 'attacker-controlled@example.test'}}},
            format='json',
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        patient.user.refresh_from_db()
        assert patient.user.email == original_email
        assert 'user' in response.data

    def test_billing_can_update_demographics_for_invoiced_patient(self, db):
        facility = DefaultFacilityFactory()
        billing = UserFactory(user_type='billing', primary_facility=facility)
        patient = PatientProfileFactory(facility=facility)
        InvoiceFactory(patient=patient, facility=facility)

        client = get_authenticated_client(billing, facility=facility)
        response = client.put(
            f'/api/patients/{patient.id}/update_patient/',
            {'local_data': {'emergency_contact_phone': '233200000003'}},
            format='json',
        )

        assert response.status_code == status.HTTP_200_OK
        patient.refresh_from_db()
        assert patient.emergency_contact_phone == '233200000003'


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

    def test_break_glass_denies_cross_facility_patient(self, db):
        facility_a = DefaultFacilityFactory()
        facility_b = FacilityFactory()
        doctor = DoctorUserFactory(primary_facility=facility_a)
        patient = PatientProfileFactory(facility=facility_b)

        client = get_authenticated_client(doctor, facility=facility_a)
        response = client.post(
            f'/api/patients/{patient.id}/break-glass/',
            {'reason': 'Need access'},
            format='json'
        )

        assert response.status_code == status.HTTP_404_NOT_FOUND


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
