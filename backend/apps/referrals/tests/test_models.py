"""
Tests for referrals app models.

Tests cover:
- Referral model (creation, referral number generation, status transitions)
"""
import pytest
from django.utils import timezone
from datetime import timedelta

from apps.referrals.models import Referral, ReferralStatus, ReferralUrgency
from .factories import ReferralFactory
from apps.users.tests.factories import PatientProfileFactory, PractitionerProfileFactory


@pytest.mark.tier1
class TestReferralModel:
    """Tests for the Referral model."""

    def test_create_referral(self, db):
        """Test basic referral creation."""
        patient = PatientProfileFactory()
        referring_provider = PractitionerProfileFactory()
        referral = ReferralFactory(
            patient=patient,
            referring_provider=referring_provider,
            referred_to_department='Cardiology',
            referred_to_specialty='Cardiology',
            urgency='routine',
            status='draft',
            reason='Chest pain evaluation'
        )
        assert referral.patient == patient
        assert referral.referring_provider == referring_provider
        assert referral.referred_to_department == 'Cardiology'
        assert referral.urgency == 'routine'
        assert referral.status == 'draft'

    def test_referral_number_auto_generation(self, db):
        """Test referral number is auto-generated."""
        referral = ReferralFactory()
        assert referral.referral_number is not None
        assert referral.referral_number.startswith('REF-')

    def test_referral_number_sequential(self, db):
        """Test referral numbers are sequential."""
        referral1 = ReferralFactory()
        referral2 = ReferralFactory()
        # Extract sequence numbers
        num1 = int(referral1.referral_number.split('-')[-1])
        num2 = int(referral2.referral_number.split('-')[-1])
        assert num2 == num1 + 1

    def test_referral_str(self, db):
        """Test referral string representation."""
        referral = ReferralFactory(referred_to_department='Neurology')
        string_repr = str(referral)
        assert 'Referral' in string_repr
        assert referral.referral_number in string_repr
        assert 'Neurology' in string_repr

    def test_referral_status_choices(self, db):
        """Test all referral status choices."""
        statuses = ['draft', 'pending', 'accepted', 'scheduled', 'completed', 'declined', 'cancelled']
        for status in statuses:
            referral = ReferralFactory(status=status)
            assert referral.status == status

    def test_referral_urgency_choices(self, db):
        """Test all referral urgency choices."""
        urgencies = ['routine', 'urgent', 'emergency']
        for urgency in urgencies:
            referral = ReferralFactory(urgency=urgency)
            assert referral.urgency == urgency

    def test_referral_is_urgent_property(self, db):
        """Test is_urgent property."""
        routine_referral = ReferralFactory(urgency='routine')
        urgent_referral = ReferralFactory(urgency='urgent')
        emergency_referral = ReferralFactory(urgency='emergency')

        assert routine_referral.is_urgent is False
        assert urgent_referral.is_urgent is True
        assert emergency_referral.is_urgent is True

    def test_referral_with_specialist(self, db):
        """Test referral with assigned specialist."""
        specialist = PractitionerProfileFactory()
        referral = ReferralFactory(
            referred_to_provider=specialist,
            status='accepted'
        )
        assert referral.referred_to_provider == specialist

    def test_referral_type_choices(self, db):
        """Test referral type choices."""
        opd_referral = ReferralFactory(referral_type='opd')
        inpatient_referral = ReferralFactory(referral_type='inpatient')

        assert opd_referral.referral_type == 'opd'
        assert inpatient_referral.referral_type == 'inpatient'

    def test_referral_timestamps(self, db):
        """Test referral status timestamps."""
        referral = ReferralFactory(
            status='pending',
            submitted_at=timezone.now()
        )
        assert referral.submitted_at is not None
        assert referral.accepted_at is None
        assert referral.completed_at is None

    def test_referral_days_since_submission(self, db):
        """Test days_since_submission property."""
        referral = ReferralFactory(
            status='pending',
            submitted_at=timezone.now() - timedelta(days=5)
        )
        assert referral.days_since_submission == 5

    def test_referral_days_since_submission_not_submitted(self, db):
        """Test days_since_submission when not submitted."""
        referral = ReferralFactory(status='draft', submitted_at=None)
        assert referral.days_since_submission is None

    def test_referral_requires_action_property(self, db):
        """Test requires_action property."""
        draft_referral = ReferralFactory(status='draft')
        pending_referral = ReferralFactory(status='pending')
        scheduled_referral = ReferralFactory(status='scheduled')
        completed_referral = ReferralFactory(status='completed')

        assert draft_referral.requires_action is False
        assert pending_referral.requires_action is True
        assert scheduled_referral.requires_action is True
        assert completed_referral.requires_action is False

    def test_referral_decline(self, db):
        """Test referral decline with reason."""
        referral = ReferralFactory(
            status='declined',
            declined_at=timezone.now(),
            decline_reason='Patient already seen by another specialist'
        )
        assert referral.status == 'declined'
        assert referral.decline_reason == 'Patient already seen by another specialist'

    def test_referral_specialist_notes(self, db):
        """Test referral with specialist notes and recommendations."""
        referral = ReferralFactory(
            status='completed',
            specialist_notes='Patient examined. ECG shows normal sinus rhythm.',
            recommendations='Continue current medication. Follow up in 3 months.'
        )
        assert referral.specialist_notes
        assert 'ECG' in referral.specialist_notes
        assert 'Follow up' in referral.recommendations
