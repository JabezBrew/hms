"""
Nursing services tests.

Tests for:
- generate_mar_entries_for_prescription()
- generate_daily_mar_entries()
- dispense_medication()
- create_treatment_entry_with_mar()
- calculate_supply_needed()
- create_supply_request()
- dispense_supply_request()
"""
import pytest
from datetime import date, time, timedelta
from decimal import Decimal
from unittest.mock import patch, MagicMock
from django.utils import timezone

from apps.nursing.models import (
    MedicationAdministration, TreatmentSheetEntry, SupplyRequest
)
from apps.nursing.services import (
    get_scheduled_times_for_frequency,
    generate_mar_entries_for_prescription,
    generate_daily_mar_entries,
    dispense_medication,
    get_pending_dispensing,
    get_dispensed_ready_for_admin,
    calculate_daily_doses,
    create_treatment_entry_with_mar,
    calculate_supply_needed,
    create_supply_request,
    dispense_supply_request,
    reject_supply_request,
    get_pending_supply_requests,
    get_treatment_sheet_by_admission,
    update_administered_count,
    FREQUENCY_SCHEDULES
)
from apps.users.tests.factories import (
    AdminUserFactory, PatientProfileFactory, PractitionerProfileFactory
)
from .factories import (
    MedicationAdministrationFactory, TreatmentSheetEntryFactory,
    SupplyRequestFactory, EncounterFactory, AdmissionFactory
)


@pytest.mark.tier1
class TestFrequencySchedules:
    """Tests for frequency schedule mapping."""

    def test_frequency_schedules_defined(self, db):
        """Test all frequency schedules are defined."""
        expected_frequencies = [
            'once', 'daily', 'bid', 'tid', 'qid',
            'q4h', 'q6h', 'q8h', 'q12h', 'qhs', 'weekly', 'stat', 'prn'
        ]

        for freq in expected_frequencies:
            assert freq in FREQUENCY_SCHEDULES

    def test_daily_frequency_has_one_time(self, db):
        """Test daily frequency has one scheduled time."""
        times = get_scheduled_times_for_frequency('daily')
        assert len(times) == 1

    def test_bid_frequency_has_two_times(self, db):
        """Test BID frequency has two scheduled times."""
        times = get_scheduled_times_for_frequency('bid')
        assert len(times) == 2

    def test_tid_frequency_has_three_times(self, db):
        """Test TID frequency has three scheduled times."""
        times = get_scheduled_times_for_frequency('tid')
        assert len(times) == 3

    def test_qid_frequency_has_four_times(self, db):
        """Test QID frequency has four scheduled times."""
        times = get_scheduled_times_for_frequency('qid')
        assert len(times) == 4

    def test_q4h_frequency_has_six_times(self, db):
        """Test Q4H frequency has six scheduled times."""
        times = get_scheduled_times_for_frequency('q4h')
        assert len(times) == 6

    def test_prn_frequency_has_no_times(self, db):
        """Test PRN frequency has no scheduled times."""
        times = get_scheduled_times_for_frequency('prn')
        assert len(times) == 0

    def test_unknown_frequency_defaults_to_daily(self, db):
        """Test unknown frequency defaults to 9 AM."""
        times = get_scheduled_times_for_frequency('unknown')
        assert len(times) == 1
        assert times[0] == time(9, 0)


@pytest.mark.tier1
class TestCalculateDailyDoses:
    """Tests for calculate_daily_doses function."""

    def test_daily_returns_one(self, db):
        """Test daily frequency returns 1."""
        assert calculate_daily_doses('daily') == 1

    def test_bid_returns_two(self, db):
        """Test BID frequency returns 2."""
        assert calculate_daily_doses('bid') == 2

    def test_tid_returns_three(self, db):
        """Test TID frequency returns 3."""
        assert calculate_daily_doses('tid') == 3

    def test_qid_returns_four(self, db):
        """Test QID frequency returns 4."""
        assert calculate_daily_doses('qid') == 4

    def test_q4h_returns_six(self, db):
        """Test Q4H frequency returns 6."""
        assert calculate_daily_doses('q4h') == 6

    def test_q6h_returns_four(self, db):
        """Test Q6H frequency returns 4."""
        assert calculate_daily_doses('q6h') == 4

    def test_q8h_returns_three(self, db):
        """Test Q8H frequency returns 3."""
        assert calculate_daily_doses('q8h') == 3

    def test_case_insensitive(self, db):
        """Test frequency matching is case insensitive."""
        assert calculate_daily_doses('BID') == 2
        assert calculate_daily_doses('Bid') == 2


@pytest.mark.tier1
class TestDispenseMedication:
    """Tests for dispense_medication function."""

    def test_dispense_medication(self, db):
        """Test dispensing a medication."""
        mar = MedicationAdministrationFactory(is_dispensed=False)
        pharmacist = AdminUserFactory()

        result = dispense_medication(mar, pharmacist)

        assert result.is_dispensed is True
        assert result.dispensed_by == pharmacist
        assert result.dispensed_at is not None

    def test_dispense_updates_in_db(self, db):
        """Test dispensing persists to database."""
        mar = MedicationAdministrationFactory(is_dispensed=False)
        pharmacist = AdminUserFactory()

        dispense_medication(mar, pharmacist)

        mar.refresh_from_db()
        assert mar.is_dispensed is True


@pytest.mark.tier1
class TestGetPendingDispensing:
    """Tests for get_pending_dispensing function."""

    def test_returns_undispensed_scheduled_meds(self, db):
        """Test returns scheduled, undispensed medications."""
        # Scheduled, not dispensed - should be returned
        scheduled = MedicationAdministrationFactory(
            status='scheduled',
            is_dispensed=False
        )

        # Already dispensed - should not be returned
        dispensed = MedicationAdministrationFactory(
            status='scheduled',
            is_dispensed=True
        )

        # Already administered - should not be returned
        administered = MedicationAdministrationFactory(
            status='administered',
            is_dispensed=True
        )

        pending = get_pending_dispensing()
        pending_ids = list(pending.values_list('id', flat=True))

        assert scheduled.id in pending_ids
        assert dispensed.id not in pending_ids
        assert administered.id not in pending_ids

    def test_filter_by_patient(self, db):
        """Test filtering by patient."""
        patient1 = PatientProfileFactory()
        patient2 = PatientProfileFactory()

        med1 = MedicationAdministrationFactory(
            patient=patient1,
            status='scheduled',
            is_dispensed=False
        )
        med2 = MedicationAdministrationFactory(
            patient=patient2,
            status='scheduled',
            is_dispensed=False
        )

        pending = get_pending_dispensing(patient_id=patient1.id)
        pending_ids = list(pending.values_list('id', flat=True))

        assert med1.id in pending_ids
        assert med2.id not in pending_ids


@pytest.mark.tier1
class TestCalculateSupplyNeeded:
    """Tests for calculate_supply_needed function."""

    def test_calculate_supply_for_daily(self, db):
        """Test supply calculation for daily medication."""
        entry = TreatmentSheetEntryFactory(frequency='daily')

        needed = calculate_supply_needed(entry, days=3)

        assert needed == 3  # 1 dose per day * 3 days

    def test_calculate_supply_for_bid(self, db):
        """Test supply calculation for BID medication."""
        entry = TreatmentSheetEntryFactory(frequency='bid')

        needed = calculate_supply_needed(entry, days=3)

        assert needed == 6  # 2 doses per day * 3 days

    def test_calculate_supply_for_tid(self, db):
        """Test supply calculation for TID medication."""
        entry = TreatmentSheetEntryFactory(frequency='tid')

        needed = calculate_supply_needed(entry, days=3)

        assert needed == 9  # 3 doses per day * 3 days


@pytest.mark.tier1
class TestCreateSupplyRequest:
    """Tests for create_supply_request function."""

    def test_create_supply_request(self, db):
        """Test creating a supply request."""
        entry = TreatmentSheetEntryFactory()
        nurse = PractitionerProfileFactory()

        request = create_supply_request(
            treatment_entry=entry,
            quantity=10,
            requested_by=nurse,
            notes='Urgent'
        )

        assert request.treatment_entry == entry
        assert request.quantity_requested == 10
        assert request.requested_by == nurse
        assert request.notes == 'Urgent'
        assert request.status == 'pending'

    def test_supply_request_saved_to_db(self, db):
        """Test supply request is saved to database."""
        entry = TreatmentSheetEntryFactory()
        nurse = PractitionerProfileFactory()

        request = create_supply_request(entry, 5, nurse)

        assert SupplyRequest.objects.filter(id=request.id).exists()


@pytest.mark.tier1
class TestDispenseSupplyRequest:
    """Tests for dispense_supply_request function."""

    def test_dispense_supply_request(self, db):
        """Test dispensing a supply request."""
        entry = TreatmentSheetEntryFactory(total_doses_dispensed=0)
        request = SupplyRequestFactory(
            treatment_entry=entry,
            quantity_requested=10,
            status='pending'
        )
        pharmacist = AdminUserFactory()

        result = dispense_supply_request(request, 10, pharmacist)

        assert result.status == 'dispensed'
        assert result.quantity_dispensed == 10
        assert result.dispensed_by == pharmacist
        assert result.dispensed_at is not None

    def test_dispense_updates_treatment_entry_count(self, db):
        """Test dispensing updates treatment entry counts."""
        entry = TreatmentSheetEntryFactory(total_doses_dispensed=5)
        request = SupplyRequestFactory(
            treatment_entry=entry,
            quantity_requested=10,
            status='pending'
        )
        pharmacist = AdminUserFactory()

        dispense_supply_request(request, 10, pharmacist)

        entry.refresh_from_db()
        assert entry.total_doses_dispensed == 15  # 5 + 10


@pytest.mark.tier1
class TestRejectSupplyRequest:
    """Tests for reject_supply_request function."""

    def test_reject_supply_request(self, db):
        """Test rejecting a supply request."""
        request = SupplyRequestFactory(status='pending')
        pharmacist = AdminUserFactory()

        result = reject_supply_request(
            request,
            rejection_reason='Out of stock',
            rejected_by=pharmacist
        )

        assert result.status == 'rejected'
        assert result.rejection_reason == 'Out of stock'


@pytest.mark.tier1
class TestGetPendingSupplyRequests:
    """Tests for get_pending_supply_requests function."""

    def test_returns_pending_requests(self, db):
        """Test returns only pending supply requests."""
        pending = SupplyRequestFactory(status='pending')
        dispensed = SupplyRequestFactory(status='dispensed')
        rejected = SupplyRequestFactory(status='rejected')

        result = get_pending_supply_requests()
        result_ids = list(result.values_list('id', flat=True))

        assert pending.id in result_ids
        assert dispensed.id not in result_ids
        assert rejected.id not in result_ids

    def test_filter_by_patient(self, db):
        """Test filtering by patient."""
        patient1 = PatientProfileFactory()
        patient2 = PatientProfileFactory()

        entry1 = TreatmentSheetEntryFactory(patient=patient1)
        entry2 = TreatmentSheetEntryFactory(patient=patient2)

        req1 = SupplyRequestFactory(treatment_entry=entry1, status='pending')
        req2 = SupplyRequestFactory(treatment_entry=entry2, status='pending')

        result = get_pending_supply_requests(patient_id=patient1.id)
        result_ids = list(result.values_list('id', flat=True))

        assert req1.id in result_ids
        assert req2.id not in result_ids


@pytest.mark.tier1
class TestGetTreatmentSheetByAdmission:
    """Tests for get_treatment_sheet_by_admission function."""

    def test_returns_active_entries(self, db):
        """Test returns only active treatment entries."""
        admission = AdmissionFactory()

        active = TreatmentSheetEntryFactory(
            admission=admission,
            patient=admission.patient,
            status='active'
        )
        discontinued = TreatmentSheetEntryFactory(
            admission=admission,
            patient=admission.patient,
            status='discontinued'
        )

        result = get_treatment_sheet_by_admission(admission.id)
        result_ids = list(result.values_list('id', flat=True))

        assert active.id in result_ids
        assert discontinued.id not in result_ids


@pytest.mark.tier1
class TestUpdateAdministeredCount:
    """Tests for update_administered_count function."""

    def test_updates_count(self, db):
        """Test updating administered count."""
        entry = TreatmentSheetEntryFactory(total_doses_administered=0)

        # Create administered medications
        MedicationAdministrationFactory(
            treatment_entry=entry,
            patient=entry.patient,
            status='administered'
        )
        MedicationAdministrationFactory(
            treatment_entry=entry,
            patient=entry.patient,
            status='administered'
        )
        # Scheduled one shouldn't count
        MedicationAdministrationFactory(
            treatment_entry=entry,
            patient=entry.patient,
            status='scheduled'
        )

        count = update_administered_count(entry)

        assert count == 2
        entry.refresh_from_db()
        assert entry.total_doses_administered == 2


@pytest.mark.tier1
class TestTreatmentSheetEntryProperties:
    """Tests for TreatmentSheetEntry properties."""

    def test_supply_remaining_calculation(self, db):
        """Test supply_remaining property."""
        entry = TreatmentSheetEntryFactory(
            total_doses_dispensed=20,
            total_doses_administered=12
        )

        assert entry.supply_remaining == 8

    def test_supply_remaining_when_negative(self, db):
        """Test supply_remaining when administered exceeds dispensed."""
        entry = TreatmentSheetEntryFactory(
            total_doses_dispensed=10,
            total_doses_administered=15
        )

        assert entry.supply_remaining == -5

    def test_days_of_supply_remaining_daily(self, db):
        """Test days of supply calculation for daily medication."""
        entry = TreatmentSheetEntryFactory(
            frequency='daily',
            total_doses_dispensed=10,
            total_doses_administered=3
        )

        # 7 doses remaining / 1 dose per day = 7 days
        assert entry.days_of_supply_remaining == 7

    def test_days_of_supply_remaining_bid(self, db):
        """Test days of supply calculation for BID medication."""
        entry = TreatmentSheetEntryFactory(
            frequency='bid',
            total_doses_dispensed=10,
            total_doses_administered=4
        )

        # 6 doses remaining / 2 doses per day = 3 days
        assert entry.days_of_supply_remaining == 3.0

    def test_days_of_supply_remaining_when_none(self, db):
        """Test days of supply when no supply remaining."""
        entry = TreatmentSheetEntryFactory(
            frequency='daily',
            total_doses_dispensed=5,
            total_doses_administered=5
        )

        assert entry.days_of_supply_remaining == 0
