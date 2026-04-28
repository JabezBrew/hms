from decimal import Decimal

import pytest
from django.utils import timezone

from apps.admissions.models import AdmissionCase, AdmissionTask, BedReservation
from apps.admissions.services import activate_admission_case, reserve_bed_for_case, start_admission_case
from apps.billing.models import FacilityBillingSettings
from apps.billing.tests.factories import FacilityBillingSettingsFactory
from apps.encounters.models import Encounter
from apps.notifications.models import InboxItem
from apps.users.tests.factories import DoctorUserFactory, PatientProfileFactory, PractitionerProfileFactory
from apps.wards.models import Admission, Bed
from apps.wards.tests.factories import BedFactory


@pytest.mark.django_db
class TestAdmissionCaseServices:
    def test_start_case_creates_blocking_tasks_and_inbox_items(self, default_facility):
        actor = DoctorUserFactory(primary_facility=default_facility)
        patient = PatientProfileFactory(facility=default_facility, user__primary_facility=default_facility)

        case = start_admission_case(
            patient=patient,
            facility=default_facility,
            actor=actor,
            payload={'admission_reason': 'Community acquired pneumonia'},
        )

        assert case.admission_id is None
        assert case.status == AdmissionCase.Status.AWAITING_CLEARANCE

        tasks = {task.task_type: task for task in case.tasks.all()}
        assert tasks[AdmissionTask.TaskType.MEDICAL_ADMISSION_ORDER].status == AdmissionTask.Status.COMPLETED
        assert tasks[AdmissionTask.TaskType.PLACEMENT].status == AdmissionTask.Status.PENDING
        assert tasks[AdmissionTask.TaskType.REGISTRATION_COMPLETION].status == AdmissionTask.Status.NOT_REQUIRED
        assert tasks[AdmissionTask.TaskType.FINANCIAL_CLEARANCE].status == AdmissionTask.Status.NOT_REQUIRED

        assert InboxItem.objects.filter(
            facility=default_facility,
            source_type=InboxItem.SourceType.ADMISSION,
            source_id=tasks[AdmissionTask.TaskType.PLACEMENT].id,
            recipient_role='nurse',
        ).exists()

    def test_reserving_bed_marks_bed_reserved_not_occupied(self, default_facility):
        actor = DoctorUserFactory(primary_facility=default_facility)
        patient = PatientProfileFactory(facility=default_facility, user__primary_facility=default_facility)
        bed = BedFactory(ward__department__facility=default_facility, facility=default_facility, status='available')

        case = start_admission_case(
            patient=patient,
            facility=default_facility,
            actor=actor,
            payload={'admission_reason': 'Observation'},
        )
        case = reserve_bed_for_case(case=case, actor=actor, bed=bed)

        bed.refresh_from_db()
        assert bed.status == 'reserved'
        assert case.status == AdmissionCase.Status.READY_FOR_ACTIVATION
        assert BedReservation.objects.filter(case=case, bed=bed, status=BedReservation.Status.ACTIVE).exists()
        assert not Admission.objects.filter(patient=patient, facility=default_facility).exists()

    def test_activation_creates_live_admission_and_encounter(self, default_facility):
        actor = DoctorUserFactory(primary_facility=default_facility)
        practitioner = PractitionerProfileFactory(
            staff__user=actor,
            staff__primary_facility=default_facility,
            staff__user__primary_facility=default_facility,
        )
        patient = PatientProfileFactory(facility=default_facility, user__primary_facility=default_facility)
        bed = BedFactory(ward__department__facility=default_facility, facility=default_facility, status='available')

        case = start_admission_case(
            patient=patient,
            facility=default_facility,
            actor=actor,
            payload={
                'admission_reason': 'Acute asthma exacerbation',
                'admission_note': 'Admit for bronchodilator therapy and observation.',
            },
            requested_admission_type='emergency',
            admitting_practitioner=practitioner,
        )
        reserve_bed_for_case(case=case, actor=actor, bed=bed)
        case = activate_admission_case(case=case, actor=actor, activated_at=timezone.now())

        bed.refresh_from_db()
        case.refresh_from_db()

        assert case.admission is not None
        assert case.status == AdmissionCase.Status.INTAKE_IN_PROGRESS
        assert bed.status == 'occupied'
        assert case.admission.status == 'admitted'
        assert Encounter.objects.filter(admission=case.admission, patient=patient, facility=default_facility).exists()

        tasks = {task.task_type: task for task in case.tasks.all()}
        assert tasks[AdmissionTask.TaskType.NURSING_INTAKE].status == AdmissionTask.Status.PENDING
        assert tasks[AdmissionTask.TaskType.ADMISSION_DOCUMENTATION].status == AdmissionTask.Status.COMPLETED


@pytest.mark.django_db
class TestLegacyAdmissionCreateShim:
    def test_legacy_create_returns_case_when_financial_blocker_remains(self, admin_client, default_facility):
        FacilityBillingSettings.objects.filter(facility=default_facility).delete()
        FacilityBillingSettingsFactory(
            facility=default_facility,
            require_deposit_for_admission=True,
            minimum_deposit_amount=Decimal('100.00'),
            minimum_deposit_percentage=Decimal('25.00'),
        )

        patient = PatientProfileFactory(facility=default_facility, user__primary_facility=default_facility)
        bed = BedFactory(ward__department__facility=default_facility, facility=default_facility, status='available')

        response = admin_client.post(
            '/api/wards/admissions/',
            {
                'patient': str(patient.id),
                'bed': str(bed.id),
                'admission_date': timezone.now().isoformat(),
                'admission_type': 'elective',
                'admission_notes': 'Awaiting billing clearance.',
            },
            format='json',
        )

        assert response.status_code == 202
        assert response.data['activated'] is False
        assert response.data['admission_case_id']

        bed.refresh_from_db()
        assert bed.status == 'reserved'
        assert not Admission.objects.filter(patient=patient, facility=default_facility).exists()
