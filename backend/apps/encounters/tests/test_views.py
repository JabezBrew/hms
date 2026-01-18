"""
Tests for the Encounter API views.

Tests the EncounterViewSet endpoints including:
- CRUD operations
- Filtering and search
- Custom actions (finish, cancel, discharge)
- Statistics endpoint
"""
import pytest
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient
from django.utils import timezone
from datetime import timedelta

from apps.encounters.models import Encounter
from apps.encounters.tests.factories import EncounterFactory
from apps.users.tests.factories import (
    UserFactory,
    PatientProfileFactory,
    PractitionerProfileFactory,
)
from apps.wards.tests.factories import AdmissionFactory, BedFactory
from apps.organization.models import ClinicalUnit, Clinic, UnitTypeConfig
from apps.core.tests.factories import DepartmentFactory


@pytest.fixture
def api_client():
    """Return an authenticated API client."""
    user = UserFactory(user_type='admin')
    client = APIClient()
    client.force_authenticate(user=user)
    if user.primary_facility:
        client.credentials(HTTP_X_FACILITY_CODE=user.primary_facility.code)
    return client


@pytest.fixture
def unauthenticated_client():
    """Return an unauthenticated API client."""
    return APIClient()


def create_department_and_clinic(facility):
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
    department_unit = ClinicalUnit.objects.create(
        unit_type=department_type,
        parent=root_unit,
        code='OPD',
        name='Outpatient Department',
        is_active=True,
        core_department=core_department,
    )
    clinic = Clinic.objects.create(
        facility=facility,
        department=department_unit,
        code='OPD-GEN',
        name='General OPD',
        is_active=True,
    )
    return department_unit, clinic


@pytest.mark.django_db
class TestEncounterListView:
    """Tests for GET /api/encounters/"""

    def test_list_encounters(self, api_client):
        """Test listing encounters returns paginated results."""
        EncounterFactory.create_batch(5)

        response = api_client.get('/api/encounters/')

        assert response.status_code == status.HTTP_200_OK
        assert 'results' in response.data
        assert len(response.data['results']) == 5

    def test_list_encounters_unauthenticated(self, unauthenticated_client):
        """Test listing encounters requires authentication."""
        response = unauthenticated_client.get('/api/encounters/')

        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_filter_by_patient_uuid(self, api_client):
        """Test filtering by patient UUID."""
        patient = PatientProfileFactory()
        target = EncounterFactory(patient=patient)
        EncounterFactory()  # Different patient

        response = api_client.get(f'/api/encounters/?patient_id={patient.id}')

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data['results']) == 1
        assert response.data['results'][0]['id'] == str(target.id)

    def test_filter_by_patient_mrn(self, api_client):
        """Test filtering by patient MRN (non-UUID search)."""
        patient = PatientProfileFactory(medical_record_number='MRN123456')
        EncounterFactory(patient=patient)
        EncounterFactory()  # Different patient

        response = api_client.get('/api/encounters/?patient_id=MRN123456')

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data['results']) == 1

    def test_filter_by_practitioner(self, api_client):
        """Test filtering by practitioner UUID."""
        practitioner = PractitionerProfileFactory()
        EncounterFactory(practitioner=practitioner)
        EncounterFactory()  # Different practitioner

        response = api_client.get(f'/api/encounters/?practitioner_id={practitioner.id}')

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data['results']) == 1

    def test_filter_by_date(self, api_client):
        """Test filtering by encounter date."""
        today = timezone.now().date()
        EncounterFactory(start_time=timezone.now())
        EncounterFactory(start_time=timezone.now() - timedelta(days=1))

        response = api_client.get(f'/api/encounters/?date={today}')

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data['results']) == 1

    def test_filter_by_department_and_clinic(self, api_client):
        """Test filtering by department and clinic."""
        patient = PatientProfileFactory()
        department, clinic = create_department_and_clinic(patient.facility)
        target = EncounterFactory(
            patient=patient,
            clinic=clinic,
            department=department,
        )
        EncounterFactory()  # Different encounter

        response = api_client.get(f'/api/encounters/?department_id={department.id}')

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data['results']) == 1
        assert response.data['results'][0]['id'] == str(target.id)

        response = api_client.get(f'/api/encounters/?clinic_id={clinic.id}')

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data['results']) == 1
        assert response.data['results'][0]['id'] == str(target.id)

    def test_filter_by_status(self, api_client):
        """Test filtering by encounter status."""
        EncounterFactory(status='in-progress')
        EncounterFactory(status='planned')

        response = api_client.get('/api/encounters/?status=in-progress')

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data['results']) == 1
        assert response.data['results'][0]['status'] == 'in-progress'

    def test_filter_by_encounter_type(self, api_client):
        """Test filtering by encounter type."""
        EncounterFactory(encounter_type='inpatient')
        EncounterFactory(encounter_type='outpatient')

        response = api_client.get('/api/encounters/?encounter_type=inpatient')

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data['results']) == 1
        assert response.data['results'][0]['encounter_type'] == 'inpatient'

    def test_search_by_patient_name(self, api_client):
        """Test search by patient name."""
        user = UserFactory(first_name='John', last_name='Doe')
        patient = PatientProfileFactory(user=user)
        EncounterFactory(patient=patient)
        EncounterFactory()  # Different patient

        response = api_client.get('/api/encounters/?search=John')

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data['results']) == 1

    def test_ordering_by_start_time(self, api_client):
        """Test ordering by start_time."""
        e1 = EncounterFactory(start_time=timezone.now() - timedelta(days=1))
        e2 = EncounterFactory(start_time=timezone.now())

        response = api_client.get('/api/encounters/?ordering=-start_time')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['results'][0]['id'] == str(e2.id)
        assert response.data['results'][1]['id'] == str(e1.id)


@pytest.mark.django_db
class TestEncounterRetrieveView:
    """Tests for GET /api/encounters/{id}/"""

    def test_retrieve_encounter(self, api_client):
        """Test retrieving a single encounter."""
        encounter = EncounterFactory()

        response = api_client.get(f'/api/encounters/{encounter.id}/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['id'] == str(encounter.id)
        assert 'patient_details' in response.data
        assert 'practitioner_details' in response.data

    def test_retrieve_nonexistent_encounter(self, api_client):
        """Test retrieving nonexistent encounter returns 404."""
        fake_uuid = '00000000-0000-0000-0000-000000000000'

        response = api_client.get(f'/api/encounters/{fake_uuid}/')

        assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
class TestEncounterCreateView:
    """Tests for POST /api/encounters/"""

    def test_create_encounter(self, api_client):
        """Test creating a new encounter."""
        patient = PatientProfileFactory()
        practitioner = PractitionerProfileFactory()
        department, clinic = create_department_and_clinic(patient.facility)

        data = {
            'patient_id': str(patient.id),
            'practitioner_id': str(practitioner.id),
            'department_id': str(department.id),
            'clinic_id': str(clinic.id),
            'encounter_type': 'outpatient',
            'status': 'in-progress',
            'reason': 'Check-up',
        }

        response = api_client.post('/api/encounters/', data)

        assert response.status_code == status.HTTP_201_CREATED
        assert Encounter.objects.filter(patient=patient).exists()

    def test_create_encounter_sets_created_by(self, api_client):
        """Test created encounter has created_by set to current user."""
        patient = PatientProfileFactory()
        practitioner = PractitionerProfileFactory()
        department, clinic = create_department_and_clinic(patient.facility)

        data = {
            'patient_id': str(patient.id),
            'practitioner_id': str(practitioner.id),
            'department_id': str(department.id),
            'clinic_id': str(clinic.id),
            'encounter_type': 'outpatient',
            'status': 'in-progress',
        }

        response = api_client.post('/api/encounters/', data)

        assert response.status_code == status.HTTP_201_CREATED, f"Response: {response.data}"
        encounter = Encounter.objects.get(patient=patient)
        assert encounter.created_by is not None

    def test_create_encounter_invalid_patient(self, api_client):
        """Test creating encounter with invalid patient returns error."""
        data = {
            'patient_id': '00000000-0000-0000-0000-000000000000',
            'encounter_type': 'outpatient',
        }

        response = api_client.post('/api/encounters/', data)

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_create_encounter_without_patient(self, api_client):
        """Test creating encounter without patient returns error."""
        data = {
            'encounter_type': 'outpatient',
        }

        response = api_client.post('/api/encounters/', data)

        assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
class TestEncounterUpdateView:
    """Tests for PUT/PATCH /api/encounters/{id}/"""

    def test_partial_update_encounter(self, api_client):
        """Test partial update of encounter."""
        encounter = EncounterFactory(status='in-progress')

        response = api_client.patch(
            f'/api/encounters/{encounter.id}/',
            {'status': 'finished'}
        )

        assert response.status_code == status.HTTP_200_OK
        encounter.refresh_from_db()
        assert encounter.status == 'finished'

    def test_update_marks_for_resync(self, api_client):
        """Test update marks encounter for FHIR re-sync."""
        encounter = EncounterFactory(fhir_synced=True)

        api_client.patch(
            f'/api/encounters/{encounter.id}/',
            {'discharge_disposition': 'home'}
        )

        encounter.refresh_from_db()
        assert encounter.fhir_synced is False


@pytest.mark.django_db
class TestEncounterFinishAction:
    """Tests for POST /api/encounters/{id}/finish/"""

    def test_finish_encounter(self, api_client):
        """Test finishing an encounter."""
        encounter = EncounterFactory(status='in-progress')

        response = api_client.post(f'/api/encounters/{encounter.id}/finish/')

        assert response.status_code == status.HTTP_200_OK
        encounter.refresh_from_db()
        assert encounter.status == 'finished'
        assert encounter.end_time is not None

    def test_finish_encounter_with_details(self, api_client):
        """Test finishing with discharge details."""
        encounter = EncounterFactory(status='in-progress')

        response = api_client.post(
            f'/api/encounters/{encounter.id}/finish/',
            {
                'discharge_disposition': 'home',
                'destination': "Patient's residence"
            }
        )

        assert response.status_code == status.HTTP_200_OK
        encounter.refresh_from_db()
        assert encounter.discharge_disposition == 'home'
        assert encounter.destination == "Patient's residence"

    def test_finish_already_finished_returns_error(self, api_client):
        """Test finishing already finished encounter returns error."""
        encounter = EncounterFactory(status='in-progress')
        encounter.finish()

        response = api_client.post(f'/api/encounters/{encounter.id}/finish/')

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'already finished' in response.data['error']


@pytest.mark.django_db
class TestEncounterCancelAction:
    """Tests for POST /api/encounters/{id}/cancel/"""

    def test_cancel_encounter(self, api_client):
        """Test cancelling an encounter."""
        encounter = EncounterFactory(status='in-progress')

        response = api_client.post(f'/api/encounters/{encounter.id}/cancel/')

        assert response.status_code == status.HTTP_200_OK
        encounter.refresh_from_db()
        assert encounter.status == 'cancelled'

    def test_cancel_planned_encounter(self, api_client):
        """Test cancelling a planned encounter."""
        encounter = EncounterFactory(status='planned')

        response = api_client.post(f'/api/encounters/{encounter.id}/cancel/')

        assert response.status_code == status.HTTP_200_OK
        encounter.refresh_from_db()
        assert encounter.status == 'cancelled'

    def test_cancel_finished_encounter_returns_error(self, api_client):
        """Test cancelling finished encounter returns error."""
        encounter = EncounterFactory(status='in-progress')
        encounter.finish()

        response = api_client.post(f'/api/encounters/{encounter.id}/cancel/')

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'Cannot cancel' in response.data['error']

    def test_cancel_already_cancelled_returns_error(self, api_client):
        """Test cancelling already cancelled encounter returns error."""
        encounter = EncounterFactory(status='planned')
        encounter.cancel()

        response = api_client.post(f'/api/encounters/{encounter.id}/cancel/')

        assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
class TestEncounterDischargeAction:
    """Tests for POST /api/encounters/{id}/discharge/"""

    def test_discharge_inpatient(self, api_client):
        """Test discharging an inpatient."""
        patient = PatientProfileFactory()
        bed = BedFactory()
        admission = AdmissionFactory(patient=patient, bed=bed, status='admitted')
        encounter = EncounterFactory(
            patient=patient,
            encounter_type='inpatient',
            status='in-progress',
            admission=admission
        )

        response = api_client.post(
            f'/api/encounters/{encounter.id}/discharge/',
            {
                'discharge_notes': 'Patient recovered well',
                'discharge_disposition': 'home',
                'destination': "Patient's home"
            }
        )

        assert response.status_code == status.HTTP_200_OK
        encounter.refresh_from_db()
        assert encounter.status == 'finished'
        admission.refresh_from_db()
        assert admission.status == 'discharged'

    def test_discharge_outpatient_returns_error(self, api_client):
        """Test discharging outpatient returns error."""
        encounter = EncounterFactory(encounter_type='outpatient', status='in-progress')

        response = api_client.post(f'/api/encounters/{encounter.id}/discharge/')

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'Only inpatient' in response.data['error']

    def test_discharge_already_finished_returns_error(self, api_client):
        """Test discharging already finished encounter returns error."""
        patient = PatientProfileFactory()
        bed = BedFactory()
        admission = AdmissionFactory(patient=patient, bed=bed)
        encounter = EncounterFactory(
            patient=patient,
            encounter_type='inpatient',
            status='in-progress',
            admission=admission
        )
        encounter.finish()

        response = api_client.post(f'/api/encounters/{encounter.id}/discharge/')

        assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
class TestEncounterStatsAction:
    """Tests for GET /api/encounters/stats/"""

    def test_get_stats(self, api_client):
        """Test getting encounter statistics."""
        EncounterFactory(status='in-progress', encounter_type='outpatient')
        EncounterFactory(status='finished', encounter_type='outpatient')
        EncounterFactory(status='in-progress', encounter_type='inpatient')

        response = api_client.get('/api/encounters/stats/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['total'] == 3
        assert 'by_status' in response.data
        assert 'by_type' in response.data
        assert response.data['by_status']['in-progress'] == 2
        assert response.data['by_status']['finished'] == 1

    def test_stats_respects_filters(self, api_client):
        """Test stats respects query filters."""
        patient = PatientProfileFactory()
        EncounterFactory(patient=patient, status='in-progress')
        EncounterFactory(patient=patient, status='finished')
        EncounterFactory(status='in-progress')  # Different patient

        response = api_client.get(f'/api/encounters/stats/?patient_id={patient.id}')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['total'] == 2


@pytest.mark.django_db
class TestEncounterForPatientAction:
    """Tests for GET /api/encounters/for_patient/"""

    def test_get_encounters_for_patient(self, api_client):
        """Test getting all encounters for a patient."""
        patient = PatientProfileFactory()
        EncounterFactory(patient=patient)
        EncounterFactory(patient=patient)
        EncounterFactory()  # Different patient

        response = api_client.get(f'/api/encounters/for_patient/?patient_id={patient.id}')

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) == 2

    def test_for_patient_requires_patient_id(self, api_client):
        """Test for_patient requires patient_id parameter."""
        response = api_client.get('/api/encounters/for_patient/')

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'patient_id parameter is required' in response.data['error']


@pytest.mark.django_db
class TestEncounterQueryOptimization:
    """Tests to verify query optimization (N+1 prevention)."""

    def test_list_queries_are_optimized(self, api_client, django_assert_max_num_queries):
        """Test list view uses optimized queries."""
        EncounterFactory.create_batch(10)

        # Should use a fixed number of queries regardless of result count
        # 1 count + 1 results (with select_related) = 2 queries
        # This verifies no N+1 problem
        with django_assert_max_num_queries(5):
            response = api_client.get('/api/encounters/')

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data['results']) == 10
