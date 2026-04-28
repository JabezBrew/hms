from decimal import Decimal

import pytest
from django.utils import timezone

from apps.billing.tests.factories import PaymentFactory
from apps.clinical_notes.models import Prescription
from apps.discharge.models import DischargeCase, DischargeTask
from apps.discharge.services import (
    add_advisory_task,
    cancel_discharge_case,
    clear_billing,
    finalize_discharge,
    reopen_discharge_case,
    submit_medical_discharge,
)
from apps.encounters.tests.factories import EncounterFactory
from apps.users.tests.factories import DoctorUserFactory, PatientProfileFactory, PractitionerProfileFactory
from apps.wards.models import BedAllocationLog
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
    encounter = EncounterFactory(
        patient=patient,
        facility=default_facility,
        practitioner=practitioner,
        encounter_type='inpatient',
        admission=admission,
        status='in-progress',
        created_by=doctor_user,
    )
    return patient, practitioner, admission, encounter


@pytest.mark.django_db
class TestDischargeServices:
    def test_submit_medical_discharge_creates_case_and_keeps_bed_occupied(self, default_facility):
        doctor = DoctorUserFactory(primary_facility=default_facility)
        _, _, admission, encounter = _build_inpatient_context(default_facility, doctor)
        ready_at = timezone.now()

        case = submit_medical_discharge(
            admission=admission,
            workflow=None,
            actor=doctor,
            medical_ready_at=ready_at,
            discharge_disposition='home',
            discharge_summary='Stable for discharge after antibiotics.',
            follow_up_appointments='Clinic review in 48 hours.',
            discharge_prescriptions=[
                {
                    'medication_name': 'Amoxicillin',
                    'dosage': '500mg',
                    'frequency': 'daily',
                    'instructions': 'Take after meals.',
                }
            ],
            notes_snapshot={'transportation': 'family'},
        )

        admission.refresh_from_db()
        encounter.refresh_from_db()
        admission.bed.refresh_from_db()

        billing_task = case.tasks.get(task_type=DischargeTask.TaskType.BILLING_CLEARANCE)
        nursing_task = case.tasks.get(task_type=DischargeTask.TaskType.NURSING_FINALIZATION)
        pharmacy_task = case.tasks.get(task_type=DischargeTask.TaskType.PHARMACY_FOLLOWUP)

        assert case.status == DischargeCase.Status.AWAITING_CLEARANCE
        assert admission.status == 'pending_discharge'
        assert admission.actual_discharge_date is None
        assert admission.bed.status == 'occupied'
        assert encounter.status == 'in-progress'
        assert case.discharge_note_id is not None
        assert Prescription.objects.filter(discharge_case=case).count() == 1
        assert billing_task.blocking is True
        assert nursing_task.blocking is True
        assert pharmacy_task.blocking is False
        assert pharmacy_task.status == DischargeTask.Status.PENDING

    def test_billing_clearance_and_finalization_require_acknowledged_advisories(self, default_facility, user_factory):
        doctor = DoctorUserFactory(primary_facility=default_facility)
        _, _, admission, encounter = _build_inpatient_context(default_facility, doctor)
        billing_user = user_factory(user_type='billing', first_name='Bill', last_name='User')
        nurse_user = user_factory(user_type='nurse', first_name='Nurse', last_name='User')

        case = submit_medical_discharge(
            admission=admission,
            workflow=None,
            actor=doctor,
            medical_ready_at=timezone.now(),
            discharge_disposition='home',
            discharge_summary='Medically ready pending billing clearance.',
            follow_up_appointments='Review in one week.',
            discharge_prescriptions=[],
            notes_snapshot={},
        )

        invoice = admission.invoices.get()
        invoice.status = 'pending'
        invoice.auto_update_enabled = False
        invoice.total_amount = Decimal('100.00')
        invoice.patient_responsibility = Decimal('40.00')
        invoice.insurance_amount = Decimal('60.00')
        invoice.save(update_fields=[
            'status',
            'auto_update_enabled',
            'total_amount',
            'patient_responsibility',
            'insurance_amount',
            'updated_at',
        ])
        PaymentFactory(
            invoice=invoice,
            amount=Decimal('40.00'),
            payer='patient',
            status='posted',
            payment_method='cash',
            created_by=billing_user,
            updated_by=billing_user,
        )

        case = clear_billing(case=case, actor=billing_user)
        manual_task = add_advisory_task(
            case=case,
            actor=doctor,
            task_type=DischargeTask.TaskType.DOCUMENTS,
            assigned_role='admin',
            notes='Collect take-home documents.',
        )

        case.refresh_from_db()
        billing_task = case.tasks.get(task_type=DischargeTask.TaskType.BILLING_CLEARANCE)
        assert case.status == DischargeCase.Status.READY_FOR_FINALIZATION
        assert billing_task.status == DischargeTask.Status.COMPLETED
        assert Decimal(invoice.insurance_balance_due) == Decimal('60.00')

        with pytest.raises(ValueError, match='acknowledged'):
            finalize_discharge(case=case, actor=nurse_user)

        finalized = finalize_discharge(
            case=case,
            actor=nurse_user,
            acknowledge_task_ids=[manual_task.id],
        )

        admission.refresh_from_db()
        encounter.refresh_from_db()
        admission.bed.refresh_from_db()
        manual_task.refresh_from_db()

        assert finalized.status == DischargeCase.Status.FINALIZED
        assert admission.status == 'discharged'
        assert admission.actual_discharge_date is not None
        assert admission.bed.status == 'available'
        assert encounter.status == 'finished'
        assert manual_task.status == DischargeTask.Status.ACKNOWLEDGED_UNRESOLVED
        assert BedAllocationLog.objects.filter(admission=admission).exists()

    def test_cancel_and_reopen_restore_active_admission_and_invoice_sync(self, default_facility):
        doctor = DoctorUserFactory(primary_facility=default_facility)
        _, _, admission, _ = _build_inpatient_context(default_facility, doctor)

        case = submit_medical_discharge(
            admission=admission,
            workflow=None,
            actor=doctor,
            medical_ready_at=timezone.now(),
            discharge_disposition='home',
            discharge_summary='Ready for discharge.',
            follow_up_appointments='Routine clinic review.',
            discharge_prescriptions=[],
            notes_snapshot={},
        )

        invoice = admission.invoices.get()
        assert invoice.auto_update_enabled is False

        cancelled = cancel_discharge_case(case=case, actor=doctor, reason='Patient requested one more review.')
        admission.refresh_from_db()
        invoice.refresh_from_db()

        assert cancelled.status == DischargeCase.Status.CANCELLED
        assert admission.status == 'admitted'
        assert invoice.auto_update_enabled is True
        assert invoice.status == 'draft'

        reopened = reopen_discharge_case(case=cancelled, actor=doctor)
        admission.refresh_from_db()
        invoice.refresh_from_db()

        assert reopened.status == DischargeCase.Status.REOPENED
        assert admission.status == 'admitted'
        assert invoice.auto_update_enabled is True
        assert invoice.status == 'draft'
        assert reopened.tasks.get(task_type=DischargeTask.TaskType.BILLING_CLEARANCE).status == DischargeTask.Status.PENDING
