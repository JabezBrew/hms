"""
Model tests for nursing app.

Tests for:
- ShiftHandoff model
- TreatmentSheetEntry model
- SupplyRequest model
"""
import pytest
from datetime import date, timedelta
from decimal import Decimal
from django.utils import timezone
from django.db import IntegrityError

from apps.nursing.models import (
    ShiftHandoff, TreatmentSheetEntry, SupplyRequest
)
from apps.users.tests.factories import PatientProfileFactory, PractitionerProfileFactory
from .factories import (
    ShiftHandoffFactory, TreatmentSheetEntryFactory,
    SupplyRequestFactory, DispensedSupplyRequestFactory,
    AdmissionFactory, EncounterFactory
)


# =============================================================================
# ShiftHandoff Model Tests
# =============================================================================

@pytest.mark.tier1
class TestShiftHandoffModel:
    """Tests for ShiftHandoff model."""

    def test_shift_handoff_creation(self, db):
        """Test creating a shift handoff."""
        handoff = ShiftHandoffFactory(
            shift_type='day',
            patient_condition='Patient stable, vitals normal'
        )

        assert handoff.shift_type == 'day'
        assert handoff.patient_condition == 'Patient stable, vitals normal'
        assert handoff.from_nurse is not None
        assert handoff.to_nurse is not None

    def test_shift_handoff_string_representation(self, db):
        """Test __str__ returns patient, shift type, and date."""
        handoff = ShiftHandoffFactory(shift_type='evening')

        str_repr = str(handoff)
        assert handoff.patient.user.get_full_name() in str_repr

    def test_all_shift_types_valid(self, db):
        """Test all shift type choices can be created."""
        shift_types = ['day', 'evening', 'night']

        for shift_type in shift_types:
            handoff = ShiftHandoffFactory(shift_type=shift_type)
            assert handoff.shift_type == shift_type

    def test_shift_handoff_optional_fields(self, db):
        """Test optional fields can be null."""
        handoff = ShiftHandoffFactory(
            ongoing_issues=None,
            pending_tasks=None,
            medication_changes=None,
            key_events=None,
            care_plan_updates=None,
            family_updates=None
        )

        assert handoff.ongoing_issues is None
        assert handoff.pending_tasks is None

    def test_shift_handoff_ordering(self, db):
        """Test handoffs are ordered by date descending."""
        patient = PatientProfileFactory()
        today = date.today()

        handoff1 = ShiftHandoffFactory(
            patient=patient,
            shift_date=today - timedelta(days=2)
        )
        handoff2 = ShiftHandoffFactory(
            patient=patient,
            shift_date=today - timedelta(days=1)
        )
        handoff3 = ShiftHandoffFactory(
            patient=patient,
            shift_date=today
        )

        handoffs = list(ShiftHandoff.objects.filter(patient=patient))

        # Most recent date should be first
        assert handoffs[0].shift_date >= handoffs[1].shift_date

    def test_shift_handoff_indexes(self, db):
        """Test shift handoff indexes exist."""
        indexes = ShiftHandoff._meta.indexes
        indexed_fields = [tuple(idx.fields) for idx in indexes]

        assert ('patient', '-shift_date') in indexed_fields
        assert ('shift_date', 'shift_type') in indexed_fields
        assert ('from_nurse', 'to_nurse') in indexed_fields


# =============================================================================
# TreatmentSheetEntry Model Tests
# =============================================================================

@pytest.mark.tier1
class TestTreatmentSheetEntryModel:
    """Tests for TreatmentSheetEntry model."""

    def test_treatment_entry_creation(self, db):
        """Test creating a treatment sheet entry."""
        entry = TreatmentSheetEntryFactory(
            medication_name='Amoxicillin',
            dosage='500mg',
            route='Oral',
            frequency='TID',
            status='active'
        )

        assert entry.medication_name == 'Amoxicillin'
        assert entry.dosage == '500mg'
        assert entry.route == 'Oral'
        assert entry.frequency == 'TID'
        assert entry.status == 'active'

    def test_treatment_entry_string_representation(self, db):
        """Test __str__ returns patient, medication, and status."""
        entry = TreatmentSheetEntryFactory(
            medication_name='Metformin',
            status='active'
        )

        str_repr = str(entry)
        assert entry.patient.user.get_full_name() in str_repr
        assert 'Metformin' in str_repr
        assert 'active' in str_repr

    def test_all_status_values_valid(self, db):
        """Test all status values can be set."""
        statuses = ['active', 'completed', 'discontinued', 'on_hold']

        for status in statuses:
            entry = TreatmentSheetEntryFactory(status=status)
            assert entry.status == status

    def test_duration_days_optional(self, db):
        """Test duration_days can be null (ongoing treatment)."""
        entry = TreatmentSheetEntryFactory(duration_days=None)

        assert entry.duration_days is None

    def test_end_datetime_optional(self, db):
        """Test end_datetime can be null."""
        entry = TreatmentSheetEntryFactory(end_datetime=None)

        assert entry.end_datetime is None

    def test_supply_remaining_property(self, db):
        """Test supply_remaining property calculation."""
        entry = TreatmentSheetEntryFactory(
            total_doses_dispensed=20,
            total_doses_administered=12
        )

        assert entry.supply_remaining == 8

    def test_days_of_supply_remaining_property(self, db):
        """Test days_of_supply_remaining property."""
        entry = TreatmentSheetEntryFactory(
            frequency='bid',
            total_doses_dispensed=10,
            total_doses_administered=4
        )

        # 6 remaining / 2 per day = 3 days
        assert entry.days_of_supply_remaining == 3.0

    def test_treatment_entry_ordering(self, db):
        """Test entries are ordered by start_datetime descending."""
        patient = PatientProfileFactory()
        now = timezone.now()

        entry1 = TreatmentSheetEntryFactory(
            patient=patient,
            start_datetime=now - timedelta(days=2)
        )
        entry2 = TreatmentSheetEntryFactory(
            patient=patient,
            start_datetime=now - timedelta(days=1)
        )
        entry3 = TreatmentSheetEntryFactory(
            patient=patient,
            start_datetime=now
        )

        entries = list(TreatmentSheetEntry.objects.filter(patient=patient))

        # Most recent should be first
        assert entries[0].start_datetime >= entries[1].start_datetime

    def test_treatment_entry_indexes(self, db):
        """Test treatment sheet entry indexes exist."""
        indexes = TreatmentSheetEntry._meta.indexes
        indexed_fields = [tuple(idx.fields) for idx in indexes]

        assert ('admission', 'status') in indexed_fields
        assert ('patient', 'status', '-start_datetime') in indexed_fields
        assert ('status', '-start_datetime') in indexed_fields

    def test_discontinuation_tracking(self, db):
        """Test discontinuation fields."""
        practitioner = PractitionerProfileFactory()
        entry = TreatmentSheetEntryFactory(status='active')

        entry.status = 'discontinued'
        entry.discontinued_at = timezone.now()
        entry.discontinued_by = practitioner
        entry.discontinuation_reason = 'Adverse reaction'
        entry.save()

        entry.refresh_from_db()
        assert entry.status == 'discontinued'
        assert entry.discontinued_by == practitioner
        assert entry.discontinuation_reason == 'Adverse reaction'


# =============================================================================
# SupplyRequest Model Tests
# =============================================================================

@pytest.mark.tier1
class TestSupplyRequestModel:
    """Tests for SupplyRequest model."""

    def test_supply_request_creation(self, db):
        """Test creating a supply request."""
        request = SupplyRequestFactory(
            quantity_requested=10,
            status='pending',
            notes='Urgent'
        )

        assert request.quantity_requested == 10
        assert request.status == 'pending'
        assert request.notes == 'Urgent'
        assert request.requested_by is not None

    def test_supply_request_string_representation(self, db):
        """Test __str__ returns medication, quantity, and status."""
        entry = TreatmentSheetEntryFactory(medication_name='Paracetamol')
        request = SupplyRequestFactory(
            treatment_entry=entry,
            quantity_requested=15,
            status='pending'
        )

        str_repr = str(request)
        assert 'Paracetamol' in str_repr
        assert '15' in str_repr
        assert 'pending' in str_repr

    def test_all_status_values_valid(self, db):
        """Test all status values can be set."""
        statuses = ['pending', 'dispensed', 'rejected']

        for status in statuses:
            request = SupplyRequestFactory(status=status)
            assert request.status == status

    def test_dispensed_supply_request(self, db):
        """Test dispensed supply request factory."""
        request = DispensedSupplyRequestFactory()

        assert request.status == 'dispensed'
        assert request.quantity_dispensed is not None
        assert request.dispensed_at is not None
        assert request.dispensed_by is not None

    def test_quantity_dispensed_can_differ(self, db):
        """Test dispensed quantity can differ from requested."""
        request = SupplyRequestFactory(
            quantity_requested=20,
            status='dispensed',
            quantity_dispensed=15
        )

        assert request.quantity_requested == 20
        assert request.quantity_dispensed == 15

    def test_rejection_tracking(self, db):
        """Test rejection fields."""
        request = SupplyRequestFactory(status='pending')

        request.status = 'rejected'
        request.rejection_reason = 'Out of stock'
        request.save()

        request.refresh_from_db()
        assert request.status == 'rejected'
        assert request.rejection_reason == 'Out of stock'

    def test_supply_request_ordering(self, db):
        """Test requests are ordered by requested_at descending."""
        entry = TreatmentSheetEntryFactory()

        req1 = SupplyRequestFactory(treatment_entry=entry)
        req2 = SupplyRequestFactory(treatment_entry=entry)
        req3 = SupplyRequestFactory(treatment_entry=entry)

        requests = list(SupplyRequest.objects.filter(treatment_entry=entry))

        # Most recent should be first
        assert requests[0].requested_at >= requests[1].requested_at

    def test_supply_request_indexes(self, db):
        """Test supply request indexes exist."""
        indexes = SupplyRequest._meta.indexes
        indexed_fields = [tuple(idx.fields) for idx in indexes]

        assert ('status', '-requested_at') in indexed_fields
        assert ('treatment_entry', '-requested_at') in indexed_fields
        assert ('requested_by', 'status') in indexed_fields

    def test_cascade_delete_with_treatment_entry(self, db):
        """Test supply requests are deleted with treatment entry."""
        entry = TreatmentSheetEntryFactory()
        request = SupplyRequestFactory(treatment_entry=entry)
        request_id = request.id

        entry.delete()

        assert not SupplyRequest.objects.filter(id=request_id).exists()


# =============================================================================
# Model Relationship Tests
# =============================================================================

@pytest.mark.tier1
class TestNursingModelRelationships:
    """Tests for relationships between nursing models."""

    def test_treatment_entry_to_supply_requests(self, db):
        """Test treatment entry can have multiple supply requests."""
        entry = TreatmentSheetEntryFactory()

        req1 = SupplyRequestFactory(treatment_entry=entry)
        req2 = SupplyRequestFactory(treatment_entry=entry)
        req3 = SupplyRequestFactory(treatment_entry=entry)

        assert entry.supply_requests.count() == 3

    def test_treatment_entry_to_medication_admins(self, db):
        """Test treatment entry can have multiple medication administrations."""
        from .factories import MedicationAdministrationFactory

        entry = TreatmentSheetEntryFactory()

        med1 = MedicationAdministrationFactory(
            treatment_entry=entry,
            patient=entry.patient
        )
        med2 = MedicationAdministrationFactory(
            treatment_entry=entry,
            patient=entry.patient
        )

        assert entry.dose_administrations.count() == 2

    def test_patient_to_treatment_entries(self, db):
        """Test patient can have multiple treatment entries."""
        patient = PatientProfileFactory()

        entry1 = TreatmentSheetEntryFactory(patient=patient)
        entry2 = TreatmentSheetEntryFactory(patient=patient)

        assert patient.treatment_sheet_entries.count() == 2

    def test_patient_to_shift_handoffs(self, db):
        """Test patient can have multiple shift handoffs."""
        patient = PatientProfileFactory()

        handoff1 = ShiftHandoffFactory(patient=patient)
        handoff2 = ShiftHandoffFactory(patient=patient)

        assert patient.shift_handoffs.count() == 2
