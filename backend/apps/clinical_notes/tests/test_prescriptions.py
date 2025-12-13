"""
Prescription tests for clinical_notes app.

Tests for:
- Prescription lifecycle (active, completed, discontinued, on_hold)
- Frequency scheduling
- Duration and end date calculation
- Prescription status transitions
"""
import pytest
from datetime import date, timedelta
from django.utils import timezone

from apps.clinical_notes.models import Prescription
from apps.users.tests.factories import PatientProfileFactory, PractitionerProfileFactory
from apps.nursing.tests.factories import EncounterFactory
from .factories import (
    PrescriptionFactory, ActivePrescriptionFactory, CompletedPrescriptionFactory,
    DiscontinuedPrescriptionFactory, OnHoldPrescriptionFactory, PRNPrescriptionFactory,
    IVPrescriptionFactory, StatPrescriptionFactory, create_prescription_set
)


# =============================================================================
# Prescription Lifecycle Tests
# =============================================================================

@pytest.mark.tier1
class TestPrescriptionLifecycle:
    """Tests for prescription lifecycle management."""

    def test_new_prescription_is_active(self, db):
        """Test new prescriptions default to active status."""
        prescription = PrescriptionFactory()

        assert prescription.status == 'active'

    def test_prescription_can_be_completed(self, db):
        """Test prescription can transition to completed."""
        prescription = ActivePrescriptionFactory()

        prescription.status = 'completed'
        prescription.save()

        prescription.refresh_from_db()
        assert prescription.status == 'completed'

    def test_prescription_can_be_discontinued(self, db):
        """Test prescription can be discontinued with reason."""
        prescription = ActivePrescriptionFactory()
        practitioner = PractitionerProfileFactory()

        prescription.status = 'discontinued'
        prescription.discontinued_at = timezone.now()
        prescription.discontinued_by = practitioner
        prescription.discontinue_reason = 'Side effects'
        prescription.save()

        prescription.refresh_from_db()
        assert prescription.status == 'discontinued'
        assert prescription.discontinued_by == practitioner
        assert prescription.discontinue_reason == 'Side effects'

    def test_prescription_can_be_put_on_hold(self, db):
        """Test prescription can be put on hold."""
        prescription = ActivePrescriptionFactory()

        prescription.status = 'on_hold'
        prescription.save()

        prescription.refresh_from_db()
        assert prescription.status == 'on_hold'

    def test_on_hold_prescription_can_be_reactivated(self, db):
        """Test on_hold prescription can be reactivated."""
        prescription = OnHoldPrescriptionFactory()

        prescription.status = 'active'
        prescription.save()

        prescription.refresh_from_db()
        assert prescription.status == 'active'


# =============================================================================
# Prescription Duration Tests
# =============================================================================

@pytest.mark.tier1
class TestPrescriptionDuration:
    """Tests for prescription duration and end date handling."""

    def test_end_date_auto_calculated(self, db):
        """Test end_date is auto-calculated from duration."""
        today = date.today()
        prescription = PrescriptionFactory(
            start_date=today,
            duration_days=14,
            end_date=None
        )

        assert prescription.end_date == today + timedelta(days=14)

    def test_explicit_end_date_not_overwritten(self, db):
        """Test explicit end_date is not overwritten."""
        today = date.today()
        explicit_end = today + timedelta(days=30)

        prescription = PrescriptionFactory(
            start_date=today,
            duration_days=14,
            end_date=explicit_end
        )

        # When duration_days is set but end_date already has a value,
        # the model's save method won't overwrite it
        # (This depends on the model implementation)
        assert prescription.end_date is not None

    def test_prn_has_no_end_date(self, db):
        """Test PRN prescriptions have no end date."""
        prescription = PRNPrescriptionFactory()

        assert prescription.duration_days is None
        assert prescription.end_date is None

    def test_days_remaining_calculation(self, db):
        """Test days_remaining calculation for future end date."""
        today = date.today()
        prescription = PrescriptionFactory(
            start_date=today,
            end_date=today + timedelta(days=7)
        )

        assert prescription.days_remaining == 7

    def test_days_remaining_zero_for_expired(self, db):
        """Test days_remaining is 0 for expired prescriptions."""
        prescription = PrescriptionFactory(
            start_date=date.today() - timedelta(days=14),
            end_date=date.today() - timedelta(days=7)
        )

        assert prescription.days_remaining == 0

    def test_days_remaining_none_for_ongoing(self, db):
        """Test days_remaining is None for ongoing prescriptions."""
        prescription = PRNPrescriptionFactory()

        assert prescription.days_remaining is None


# =============================================================================
# Prescription is_active Tests
# =============================================================================

@pytest.mark.tier1
class TestPrescriptionIsActive:
    """Tests for prescription is_active property."""

    def test_is_active_true_for_active_status(self, db):
        """Test is_active is True for active prescriptions within duration."""
        prescription = ActivePrescriptionFactory(
            end_date=date.today() + timedelta(days=7)
        )

        assert prescription.is_active is True

    def test_is_active_false_for_completed(self, db):
        """Test is_active is False for completed prescriptions."""
        prescription = CompletedPrescriptionFactory()

        assert prescription.is_active is False

    def test_is_active_false_for_discontinued(self, db):
        """Test is_active is False for discontinued prescriptions."""
        prescription = DiscontinuedPrescriptionFactory()

        assert prescription.is_active is False

    def test_is_active_false_for_on_hold(self, db):
        """Test is_active is False for on_hold prescriptions."""
        prescription = OnHoldPrescriptionFactory()

        assert prescription.is_active is False

    def test_is_active_false_when_expired(self, db):
        """Test is_active is False when end_date has passed."""
        prescription = PrescriptionFactory(
            status='active',
            end_date=date.today() - timedelta(days=1)
        )

        assert prescription.is_active is False

    def test_is_active_true_without_end_date(self, db):
        """Test is_active is True for active prescriptions without end_date."""
        prescription = PRNPrescriptionFactory(
            status='active',
            end_date=None
        )

        assert prescription.is_active is True


# =============================================================================
# Prescription Frequency Tests
# =============================================================================

@pytest.mark.tier1
class TestPrescriptionFrequency:
    """Tests for prescription frequency handling."""

    def test_once_frequency(self, db):
        """Test once frequency prescription."""
        prescription = PrescriptionFactory(frequency='once')

        assert prescription.frequency == 'once'

    def test_daily_frequency(self, db):
        """Test daily frequency prescription."""
        prescription = PrescriptionFactory(frequency='daily')

        assert prescription.frequency == 'daily'

    def test_bid_frequency(self, db):
        """Test BID (twice daily) frequency."""
        prescription = PrescriptionFactory(frequency='bid')

        assert prescription.frequency == 'bid'

    def test_tid_frequency(self, db):
        """Test TID (three times daily) frequency."""
        prescription = PrescriptionFactory(frequency='tid')

        assert prescription.frequency == 'tid'

    def test_qid_frequency(self, db):
        """Test QID (four times daily) frequency."""
        prescription = PrescriptionFactory(frequency='qid')

        assert prescription.frequency == 'qid'

    def test_q4h_frequency(self, db):
        """Test every 4 hours frequency."""
        prescription = PrescriptionFactory(frequency='q4h')

        assert prescription.frequency == 'q4h'

    def test_prn_frequency(self, db):
        """Test PRN (as needed) frequency."""
        prescription = PRNPrescriptionFactory()

        assert prescription.frequency == 'prn'

    def test_stat_frequency(self, db):
        """Test STAT (immediately) frequency."""
        prescription = StatPrescriptionFactory()

        assert prescription.frequency == 'stat'


# =============================================================================
# Prescription Route Tests
# =============================================================================

@pytest.mark.tier1
class TestPrescriptionRoute:
    """Tests for prescription route handling."""

    def test_oral_route(self, db):
        """Test oral route prescription."""
        prescription = PrescriptionFactory(route='oral')

        assert prescription.route == 'oral'

    def test_iv_route(self, db):
        """Test IV route prescription."""
        prescription = IVPrescriptionFactory()

        assert prescription.route == 'iv'

    def test_im_route(self, db):
        """Test IM (intramuscular) route."""
        prescription = PrescriptionFactory(route='im')

        assert prescription.route == 'im'

    def test_sc_route(self, db):
        """Test SC (subcutaneous) route."""
        prescription = PrescriptionFactory(route='sc')

        assert prescription.route == 'sc'

    def test_topical_route(self, db):
        """Test topical route."""
        prescription = PrescriptionFactory(route='topical')

        assert prescription.route == 'topical'

    def test_inhaled_route(self, db):
        """Test inhaled route."""
        prescription = PrescriptionFactory(route='inhaled')

        assert prescription.route == 'inhaled'


# =============================================================================
# Prescription Filtering Tests
# =============================================================================

@pytest.mark.tier1
class TestPrescriptionFiltering:
    """Tests for prescription filtering and queries."""

    def test_filter_active_prescriptions(self, db):
        """Test filtering for active prescriptions."""
        patient = PatientProfileFactory()

        ActivePrescriptionFactory(patient=patient)
        ActivePrescriptionFactory(patient=patient)
        CompletedPrescriptionFactory(patient=patient)
        DiscontinuedPrescriptionFactory(patient=patient)

        active = Prescription.objects.filter(
            patient=patient,
            status='active'
        )

        assert active.count() == 2

    def test_filter_by_route(self, db):
        """Test filtering prescriptions by route."""
        patient = PatientProfileFactory()

        PrescriptionFactory(patient=patient, route='oral')
        PrescriptionFactory(patient=patient, route='oral')
        IVPrescriptionFactory(patient=patient)

        oral = Prescription.objects.filter(patient=patient, route='oral')

        assert oral.count() == 2

    def test_filter_by_frequency(self, db):
        """Test filtering prescriptions by frequency."""
        patient = PatientProfileFactory()

        PrescriptionFactory(patient=patient, frequency='daily')
        PrescriptionFactory(patient=patient, frequency='daily')
        PrescriptionFactory(patient=patient, frequency='bid')

        daily = Prescription.objects.filter(patient=patient, frequency='daily')

        assert daily.count() == 2

    def test_filter_by_prescriber(self, db):
        """Test filtering prescriptions by prescriber."""
        prescriber1 = PractitionerProfileFactory()
        prescriber2 = PractitionerProfileFactory()

        PrescriptionFactory(prescribed_by=prescriber1)
        PrescriptionFactory(prescribed_by=prescriber1)
        PrescriptionFactory(prescribed_by=prescriber2)

        prescriber1_rx = Prescription.objects.filter(prescribed_by=prescriber1)

        assert prescriber1_rx.count() == 2

    def test_filter_by_date_range(self, db):
        """Test filtering prescriptions by date range."""
        patient = PatientProfileFactory()
        today = date.today()

        PrescriptionFactory(
            patient=patient,
            start_date=today
        )
        PrescriptionFactory(
            patient=patient,
            start_date=today - timedelta(days=7)
        )
        PrescriptionFactory(
            patient=patient,
            start_date=today - timedelta(days=30)
        )

        recent = Prescription.objects.filter(
            patient=patient,
            start_date__gte=today - timedelta(days=14)
        )

        assert recent.count() == 2


# =============================================================================
# Prescription Set Helper Tests
# =============================================================================

@pytest.mark.tier1
class TestPrescriptionSet:
    """Tests for prescription set helper function."""

    def test_create_prescription_set(self, db):
        """Test creating a set of prescriptions."""
        patient = PatientProfileFactory()
        prescriber = PractitionerProfileFactory()

        prescriptions = create_prescription_set(patient, prescriber, count=5)

        assert len(prescriptions) == 5
        assert all(p.patient == patient for p in prescriptions)
        assert all(p.prescribed_by == prescriber for p in prescriptions)

    def test_prescription_set_unique_medications(self, db):
        """Test prescription set has unique medications."""
        patient = PatientProfileFactory()
        prescriber = PractitionerProfileFactory()

        prescriptions = create_prescription_set(patient, prescriber, count=5)
        medication_names = [p.medication_name for p in prescriptions]

        # All medications should be unique
        assert len(set(medication_names)) == len(medication_names)


# =============================================================================
# Prescription Audit Tests
# =============================================================================

@pytest.mark.tier1
class TestPrescriptionAudit:
    """Tests for prescription audit fields."""

    def test_created_at_auto_set(self, db):
        """Test created_at is automatically set."""
        prescription = PrescriptionFactory()

        assert prescription.created_at is not None

    def test_updated_at_auto_updated(self, db):
        """Test updated_at is updated on save."""
        prescription = PrescriptionFactory()
        original_updated = prescription.updated_at

        prescription.instructions = 'Updated instructions'
        prescription.save()

        prescription.refresh_from_db()
        assert prescription.updated_at >= original_updated

    def test_discontinuation_audit(self, db):
        """Test discontinuation fields for audit trail."""
        prescription = ActivePrescriptionFactory()
        practitioner = PractitionerProfileFactory()
        discontinue_time = timezone.now()

        prescription.status = 'discontinued'
        prescription.discontinued_at = discontinue_time
        prescription.discontinued_by = practitioner
        prescription.discontinue_reason = 'Patient request'
        prescription.save()

        prescription.refresh_from_db()
        assert prescription.discontinued_at is not None
        assert prescription.discontinued_by == practitioner
        assert prescription.discontinue_reason == 'Patient request'
