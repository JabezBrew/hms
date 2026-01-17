import datetime

import pytest
from django.utils import timezone
from rest_framework import status

from apps.core.tests.factories import DefaultFacilityFactory
from apps.users.tests.factories import PatientProfileFactory, PractitionerProfileFactory
from apps.organization.models import Clinic, ClinicalUnit, UnitTypeConfig
from apps.appointments.tests.factories import AppointmentTypeFactory, RecurringScheduleFactory
from apps.appointments.models import Appointment
from apps.encounters.models import OutpatientVisit


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
    def test_start_visit_creates_outpatient_visit(self, admin_client):
        facility = DefaultFacilityFactory()
        clinic = create_clinic(facility)
        patient = PatientProfileFactory(facility=facility)
        practitioner = PractitionerProfileFactory()
        appointment_type = AppointmentTypeFactory()

        start_time = timezone.now() + datetime.timedelta(hours=1)
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

    def test_waiting_room_lists_visits(self, admin_client):
        facility = DefaultFacilityFactory()
        clinic = create_clinic(facility)
        patient = PatientProfileFactory(facility=facility)
        practitioner = PractitionerProfileFactory()
        appointment_type = AppointmentTypeFactory()

        start_time = timezone.now() + datetime.timedelta(hours=2)
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
        visit.visit_status = OutpatientVisit.VisitStatus.WAITING
        visit.save(update_fields=['visit_status', 'updated_at'])

        response = admin_client.get(f'{BASE_URL}/visits/waiting_room/?clinic={clinic.id}')
        assert response.status_code == status.HTTP_200_OK
        assert any(item['encounter_id'] == encounter_id for item in response.data)


@pytest.mark.django_db
class TestTriageQueueFlow:
    def test_triage_assign_creates_appointment(self, admin_client):
        facility = DefaultFacilityFactory()
        clinic = create_clinic(facility)
        patient = PatientProfileFactory(facility=facility)
        practitioner = PractitionerProfileFactory()
        appointment_type = AppointmentTypeFactory()

        RecurringScheduleFactory(
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
