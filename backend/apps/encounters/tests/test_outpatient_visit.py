import datetime

import pytest
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from apps.core.tests.factories import DefaultFacilityFactory
from apps.users.tests.factories import PatientProfileFactory, PractitionerProfileFactory
from apps.organization.models import Clinic, ClinicalUnit, UnitTypeConfig
from apps.appointments.tests.factories import AppointmentTypeFactory, PractitionerAvailabilityRuleFactory
from apps.appointments.models import Appointment
from apps.encounters.models import Encounter, OutpatientVisit, TriageQueue


BASE_URL = '/api/encounters'


def create_clinic(facility):
    facility_type = UnitTypeConfig.objects.create(
        code=f"facility-{facility.id}",
        name='Facility',
        can_be_root=True,
        depth_level=0,
    )
    department_type = UnitTypeConfig.objects.create(
        code=f"department-{facility.id}",
        name='Department',
        depth_level=1,
    )
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
    )
    return Clinic.objects.create(
        facility=facility,
        department=department,
        code='OPD-GEN',
        name='General OPD',
        is_active=True,
    )


@pytest.mark.django_db
class TestOutpatientVisitFlow:
    @staticmethod
    def _patient_client(user, facility):
        token = AccessToken.for_user(user)
        client = APIClient()
        client.credentials(
            HTTP_AUTHORIZATION=f'Bearer {token}',
            HTTP_X_FACILITY_CODE=facility.code,
        )
        return client

    def test_start_visit_creates_outpatient_visit(self, admin_client):
        facility = DefaultFacilityFactory()
        clinic = create_clinic(facility)
        patient = PatientProfileFactory(facility=facility)
        practitioner = PractitionerProfileFactory()
        appointment_type = AppointmentTypeFactory()

        start_time = timezone.now() + datetime.timedelta(minutes=30)
        end_time = start_time + datetime.timedelta(minutes=30)
        appointment = Appointment.objects.create(
            facility=facility,
            patient=patient,
            practitioner=practitioner,
            clinic=clinic,
            appointment_type=appointment_type,
            status='booked',
            start_time=start_time,
            end_time=end_time,
        )

        response = admin_client.post(f'/api/appointments/appointments/{appointment.id}/start_visit/')
        assert response.status_code == status.HTTP_201_CREATED

        encounter_id = response.data['encounter_id']
        visit = OutpatientVisit.objects.get(encounter_id=encounter_id)
        assert visit.appointment_id == appointment.id
        encounter = Encounter.objects.get(id=encounter_id)
        assert encounter.status == 'planned'
        assert encounter.start_time == appointment.start_time

    def test_waiting_room_lists_visits(self, admin_client):
        facility = DefaultFacilityFactory()
        clinic = create_clinic(facility)
        patient = PatientProfileFactory(facility=facility)
        practitioner = PractitionerProfileFactory()
        appointment_type = AppointmentTypeFactory()

        start_time = timezone.now() + datetime.timedelta(minutes=20)
        end_time = start_time + datetime.timedelta(minutes=30)
        appointment = Appointment.objects.create(
            facility=facility,
            patient=patient,
            practitioner=practitioner,
            clinic=clinic,
            appointment_type=appointment_type,
            status='booked',
            start_time=start_time,
            end_time=end_time,
        )

        response = admin_client.post(f'/api/appointments/appointments/{appointment.id}/start_visit/')
        encounter_id = response.data['encounter_id']
        visit = OutpatientVisit.objects.get(encounter_id=encounter_id)
        assert visit.visit_status == OutpatientVisit.VisitStatus.WAITING

        response = admin_client.get(f'{BASE_URL}/visits/waiting_room/?clinic={clinic.id}')
        assert response.status_code == status.HTTP_200_OK
        assert any(item['encounter_id'] == encounter_id for item in response.data)

    def test_start_consultation_promotes_encounter(self, admin_client):
        facility = DefaultFacilityFactory()
        clinic = create_clinic(facility)
        patient = PatientProfileFactory(facility=facility)
        practitioner = PractitionerProfileFactory()
        appointment_type = AppointmentTypeFactory()

        start_time = timezone.now() + datetime.timedelta(minutes=15)
        end_time = start_time + datetime.timedelta(minutes=30)
        appointment = Appointment.objects.create(
            facility=facility,
            patient=patient,
            practitioner=practitioner,
            clinic=clinic,
            appointment_type=appointment_type,
            status='booked',
            start_time=start_time,
            end_time=end_time,
        )

        response = admin_client.post(f'/api/appointments/appointments/{appointment.id}/start_visit/')
        encounter_id = response.data['encounter_id']

        response = admin_client.post(f'{BASE_URL}/visits/{encounter_id}/start_consultation/')
        assert response.status_code == status.HTTP_200_OK

        visit = OutpatientVisit.objects.get(encounter_id=encounter_id)
        encounter = Encounter.objects.get(id=encounter_id)
        assert visit.visit_status == OutpatientVisit.VisitStatus.IN_PROGRESS
        assert encounter.status == 'in-progress'

    def test_end_consultation_finishes_encounter_and_sets_ready_checkout(self, admin_client):
        facility = DefaultFacilityFactory()
        clinic = create_clinic(facility)
        patient = PatientProfileFactory(facility=facility)
        practitioner = PractitionerProfileFactory()
        appointment_type = AppointmentTypeFactory()

        start_time = timezone.now() + datetime.timedelta(minutes=10)
        end_time = start_time + datetime.timedelta(minutes=30)
        appointment = Appointment.objects.create(
            facility=facility,
            patient=patient,
            practitioner=practitioner,
            clinic=clinic,
            appointment_type=appointment_type,
            status='booked',
            start_time=start_time,
            end_time=end_time,
        )

        response = admin_client.post(f'/api/appointments/appointments/{appointment.id}/start_visit/')
        encounter_id = response.data['encounter_id']
        admin_client.post(f'{BASE_URL}/visits/{encounter_id}/start_consultation/')

        response = admin_client.post(f'{BASE_URL}/visits/{encounter_id}/end_consultation/')
        assert response.status_code == status.HTTP_200_OK

        visit = OutpatientVisit.objects.get(encounter_id=encounter_id)
        encounter = Encounter.objects.get(id=encounter_id)
        assert visit.visit_status == OutpatientVisit.VisitStatus.READY_CHECKOUT
        assert encounter.status == 'finished'
        assert encounter.end_time is not None

    def test_patient_cannot_start_consultation(self, admin_client):
        facility = DefaultFacilityFactory()
        clinic = create_clinic(facility)
        patient = PatientProfileFactory(facility=facility)
        practitioner = PractitionerProfileFactory()
        appointment_type = AppointmentTypeFactory()

        start_time = timezone.now() + datetime.timedelta(minutes=15)
        end_time = start_time + datetime.timedelta(minutes=30)
        appointment = Appointment.objects.create(
            facility=facility,
            patient=patient,
            practitioner=practitioner,
            clinic=clinic,
            appointment_type=appointment_type,
            status='booked',
            start_time=start_time,
            end_time=end_time,
        )

        response = admin_client.post(f'/api/appointments/appointments/{appointment.id}/start_visit/')
        encounter_id = response.data['encounter_id']

        patient_client = self._patient_client(patient.user, facility)
        response = patient_client.post(f'{BASE_URL}/visits/{encounter_id}/start_consultation/')
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_patient_cannot_end_consultation_or_mark_no_show(self, admin_client):
        facility = DefaultFacilityFactory()
        clinic = create_clinic(facility)
        patient = PatientProfileFactory(facility=facility)
        practitioner = PractitionerProfileFactory()
        appointment_type = AppointmentTypeFactory()

        start_time = timezone.now() + datetime.timedelta(minutes=15)
        end_time = start_time + datetime.timedelta(minutes=30)
        appointment = Appointment.objects.create(
            facility=facility,
            patient=patient,
            practitioner=practitioner,
            clinic=clinic,
            appointment_type=appointment_type,
            status='booked',
            start_time=start_time,
            end_time=end_time,
        )

        response = admin_client.post(f'/api/appointments/appointments/{appointment.id}/start_visit/')
        encounter_id = response.data['encounter_id']

        patient_client = self._patient_client(patient.user, facility)
        end_response = patient_client.post(f'{BASE_URL}/visits/{encounter_id}/end_consultation/')
        no_show_response = patient_client.post(f'{BASE_URL}/visits/{encounter_id}/no_show/')
        assert end_response.status_code == status.HTTP_403_FORBIDDEN
        assert no_show_response.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.django_db
class TestTriageQueueFlow:
    def test_triage_assign_creates_appointment(self, admin_client):
        facility = DefaultFacilityFactory()
        clinic = create_clinic(facility)
        patient = PatientProfileFactory(facility=facility)
        practitioner = PractitionerProfileFactory()
        appointment_type = AppointmentTypeFactory()

        PractitionerAvailabilityRuleFactory(
            practitioner=practitioner,
            facility=facility,
            days_of_week=[timezone.now().weekday()],
            start_time=datetime.time(9, 0),
            end_time=datetime.time(17, 0),
            slot_duration=30,
            active_from=timezone.now().date(),
        )

        start_time = timezone.now().replace(hour=10, minute=0, second=0, microsecond=0)

        response = admin_client.post(
            f'{BASE_URL}/triage/',
            {
                'patient': str(patient.id),
                'priority': 'routine',
                'chief_complaint': 'Walk-in checkup',
            },
            format='json'
        )
        assert response.status_code == status.HTTP_201_CREATED

        triage_id = response.data['id']
        response = admin_client.post(
            f'{BASE_URL}/triage/{triage_id}/triage/',
            {'priority': 'urgent', 'notes': 'Needs fast check'},
            format='json'
        )
        assert response.status_code == status.HTTP_200_OK

        response = admin_client.post(
            f'{BASE_URL}/triage/{triage_id}/assign/',
            {
                'clinic_id': str(clinic.id),
                'appointment_type_id': str(appointment_type.id),
                'start_time': start_time.isoformat(),
                'practitioner_id': str(practitioner.id),
            },
            format='json'
        )
        assert response.status_code == status.HTTP_200_OK
        assert Appointment.objects.filter(id=response.data['appointment_id']).exists()

    def test_nurse_can_triage_walk_in_without_existing_team_access(
        self,
        settings,
        nurse_client,
        default_facility,
    ):
        settings.TEAM_ACCESS_STRICT = True
        patient = PatientProfileFactory(facility=default_facility)

        create_response = nurse_client.post(
            f'{BASE_URL}/triage/',
            {
                'patient': str(patient.id),
                'priority': 'routine',
                'chief_complaint': 'Walk-in checkup',
            },
            format='json',
        )
        assert create_response.status_code == status.HTTP_201_CREATED

        list_response = nurse_client.get(f'{BASE_URL}/triage/')
        assert list_response.status_code == status.HTTP_200_OK
        assert any(
            str(item['patient']) == str(patient.id) and
            item['chief_complaint'] == 'Walk-in checkup'
            for item in list_response.data['results']
        )

        triage_response = nurse_client.post(
            f'{BASE_URL}/triage/{create_response.data["id"]}/triage/',
            {'priority': 'urgent', 'notes': 'Technical assessment complete'},
            format='json',
        )
        assert triage_response.status_code == status.HTTP_200_OK

        entry = TriageQueue.objects.get(id=create_response.data['id'])
        assert entry.status == TriageQueue.Status.TRIAGED
        assert entry.priority == TriageQueue.Priority.URGENT
        assert entry.triage_notes == 'Technical assessment complete'

    @pytest.mark.parametrize(
        'blocked_user_type',
        ['receptionist', 'lab_technician', 'pharmacist', 'billing', 'patient'],
    )
    def test_non_triage_roles_cannot_list_create_or_mutate_triage_queue(
        self,
        api_client,
        user_factory,
        default_facility,
        blocked_user_type,
    ):
        user = user_factory(user_type=blocked_user_type, primary_facility=default_facility)
        patient = PatientProfileFactory(facility=default_facility)
        entry = TriageQueue.objects.create(
            facility=default_facility,
            patient=patient,
            priority=TriageQueue.Priority.ROUTINE,
            chief_complaint='Severe chest pain',
            status=TriageQueue.Status.WAITING,
        )
        api_client.force_authenticate(user=user)
        api_client.credentials(HTTP_X_FACILITY_CODE=default_facility.code)

        list_response = api_client.get(f'{BASE_URL}/triage/')
        assert list_response.status_code == status.HTTP_403_FORBIDDEN

        create_response = api_client.post(
            f'{BASE_URL}/triage/',
            {
                'patient': str(patient.id),
                'priority': 'urgent',
                'chief_complaint': 'Unauthorized intake',
            },
            format='json',
        )
        assert create_response.status_code == status.HTTP_403_FORBIDDEN

        triage_response = api_client.post(
            f'{BASE_URL}/triage/{entry.id}/triage/',
            {'priority': 'urgent', 'notes': 'unauthorized'},
            format='json',
        )
        assert triage_response.status_code == status.HTTP_403_FORBIDDEN

        cancel_response = api_client.post(f'{BASE_URL}/triage/{entry.id}/cancel/')
        assert cancel_response.status_code == status.HTTP_403_FORBIDDEN
        entry.refresh_from_db()
        assert entry.status == TriageQueue.Status.WAITING
