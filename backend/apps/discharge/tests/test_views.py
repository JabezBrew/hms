import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.discharge.models import DischargeTask
from apps.discharge.services import submit_medical_discharge
from apps.encounters.tests.factories import EncounterFactory
from apps.users.tests.factories import DoctorUserFactory, PatientProfileFactory, PractitionerProfileFactory
from apps.wards.tests.factories import AdmissionFactory


def _build_inpatient_context(default_facility, doctor_user):
    patient = PatientProfileFactory(facility=default_facility)
    practitioner = PractitionerProfileFactory(
        staff__user=doctor_user,
        staff__primary_facility=default_facility,
        staff__user__primary_facility=default_facility,
    )
    admission = AdmissionFactory(
        patient=patient,
        facility=default_facility,
        bed__ward__department__facility=default_facility,
        admitting_doctor=practitioner,
        status='admitted',
    )
    EncounterFactory(
        patient=patient,
        facility=default_facility,
        practitioner=practitioner,
        encounter_type='inpatient',
        admission=admission,
        status='in-progress',
        created_by=doctor_user,
    )
    return admission


@pytest.mark.django_db
def test_billing_task_list_excludes_non_billing_tasks(default_facility, user_factory):
    doctor = DoctorUserFactory(primary_facility=default_facility)
    admission = _build_inpatient_context(default_facility, doctor)
    billing_user = user_factory(user_type='billing', primary_facility=default_facility)

    case = submit_medical_discharge(
        admission=admission,
        workflow=None,
        actor=doctor,
        medical_ready_at=timezone.now(),
        discharge_disposition='home',
        discharge_summary='Ready for discharge.',
        follow_up_appointments='Review in one week.',
        discharge_prescriptions=[],
        notes_snapshot={},
    )
    DischargeTask.objects.filter(
        case=case,
        task_type=DischargeTask.TaskType.PHARMACY_FOLLOWUP,
    ).update(snapshot={'medications': ['Sensitive Rx']})
    DischargeTask.objects.filter(
        case=case,
        task_type=DischargeTask.TaskType.LAB_FOLLOWUP,
    ).update(snapshot={'open_orders': ['LAB-SECRET-4242']})

    client = APIClient()
    client.force_authenticate(user=billing_user)
    response = client.get('/api/discharges/tasks/')

    assert response.status_code == 200
    task_types = [task['task_type'] for task in response.data['results']]
    assert task_types == [DischargeTask.TaskType.BILLING_CLEARANCE]


@pytest.mark.django_db
def test_billing_case_detail_only_returns_billing_task(default_facility, user_factory):
    doctor = DoctorUserFactory(primary_facility=default_facility)
    admission = _build_inpatient_context(default_facility, doctor)
    billing_user = user_factory(user_type='billing', primary_facility=default_facility)

    case = submit_medical_discharge(
        admission=admission,
        workflow=None,
        actor=doctor,
        medical_ready_at=timezone.now(),
        discharge_disposition='home',
        discharge_summary='Ready for discharge.',
        follow_up_appointments='Review in one week.',
        discharge_prescriptions=[],
        notes_snapshot={},
    )

    client = APIClient()
    client.force_authenticate(user=billing_user)
    response = client.get(f'/api/discharges/cases/{case.id}/')

    assert response.status_code == 200
    task_types = [task['task_type'] for task in response.data['tasks']]
    assert task_types == [DischargeTask.TaskType.BILLING_CLEARANCE]
