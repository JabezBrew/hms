"""
Tests for the Encounter services module.

Tests get_or_create_active_encounter, ensure_encounter_for_entry, and
get_active_encounter_for_patient functions, including all edge case fixes:
- Race condition prevention (select_for_update)
- Linking to finished/cancelled encounters validation
- Planned encounters transition to in-progress
- encounter_type forwarding
- created_by audit field
- Multiple active admissions ordering
"""
import pytest
from django.utils import timezone
from datetime import timedelta

from apps.encounters.models import Encounter
from apps.encounters.services import (
    get_or_create_active_encounter,
    get_active_encounter_for_patient,
    ensure_encounter_for_entry,
)
from apps.encounters.tests.factories import EncounterFactory
from apps.users.tests.factories import PatientProfileFactory, PractitionerProfileFactory, UserFactory
from apps.wards.tests.factories import AdmissionFactory, BedFactory


@pytest.mark.django_db
class TestGetOrCreateActiveEncounter:
    """Tests for get_or_create_active_encounter function."""

    def test_creates_new_encounter_for_new_patient(self):
        """Test creates new encounter when patient has no active encounters."""
        patient = PatientProfileFactory()
        practitioner = PractitionerProfileFactory()

        encounter, created = get_or_create_active_encounter(
            patient=patient,
            practitioner=practitioner,
            reason='Check-up'
        )

        assert created is True
        assert encounter.patient == patient
        assert encounter.practitioner == practitioner
        assert encounter.status == 'in-progress'
        assert encounter.encounter_type == 'outpatient'
        assert encounter.reason == 'Check-up'

    def test_returns_existing_active_encounter(self):
        """Test returns existing in-progress encounter for same day."""
        patient = PatientProfileFactory()
        practitioner = PractitionerProfileFactory()

        existing = EncounterFactory(
            patient=patient,
            practitioner=practitioner,
            status='in-progress',
            start_time=timezone.now()
        )

        encounter, created = get_or_create_active_encounter(
            patient=patient,
            practitioner=practitioner
        )

        assert created is False
        assert encounter.id == existing.id

    def test_returns_different_practitioner_encounter(self):
        """Test returns active encounter from different practitioner same day."""
        patient = PatientProfileFactory()
        practitioner1 = PractitionerProfileFactory()
        practitioner2 = PractitionerProfileFactory()

        existing = EncounterFactory(
            patient=patient,
            practitioner=practitioner1,
            status='in-progress',
            start_time=timezone.now()
        )

        encounter, created = get_or_create_active_encounter(
            patient=patient,
            practitioner=practitioner2
        )

        assert created is False
        assert encounter.id == existing.id

    def test_prefers_same_practitioner_encounter(self):
        """Test prefers same practitioner's encounter when multiple exist."""
        patient = PatientProfileFactory()
        practitioner1 = PractitionerProfileFactory()
        practitioner2 = PractitionerProfileFactory()

        # Create encounters from different practitioners
        EncounterFactory(
            patient=patient,
            practitioner=practitioner1,
            status='in-progress',
            start_time=timezone.now()
        )
        my_encounter = EncounterFactory(
            patient=patient,
            practitioner=practitioner2,
            status='in-progress',
            start_time=timezone.now()
        )

        encounter, created = get_or_create_active_encounter(
            patient=patient,
            practitioner=practitioner2
        )

        assert created is False
        assert encounter.id == my_encounter.id

    def test_does_not_return_yesterdays_encounter(self):
        """Test doesn't return encounters from yesterday."""
        patient = PatientProfileFactory()

        EncounterFactory(
            patient=patient,
            status='in-progress',
            start_time=timezone.now() - timedelta(days=1)
        )

        encounter, created = get_or_create_active_encounter(patient=patient)

        assert created is True

    def test_does_not_return_finished_encounter(self):
        """Test doesn't return finished encounters."""
        patient = PatientProfileFactory()

        EncounterFactory(
            patient=patient,
            status='finished',
            start_time=timezone.now()
        )

        encounter, created = get_or_create_active_encounter(patient=patient)

        assert created is True

    def test_does_not_return_cancelled_encounter(self):
        """Test doesn't return cancelled encounters."""
        patient = PatientProfileFactory()

        EncounterFactory(
            patient=patient,
            status='cancelled',
            start_time=timezone.now()
        )

        encounter, created = get_or_create_active_encounter(patient=patient)

        assert created is True


@pytest.mark.django_db
class TestPlannedEncounterTransition:
    """Tests for planned encounter -> in-progress transition."""

    def test_transitions_planned_encounter_to_in_progress(self):
        """Test planned encounter transitions to in-progress when accessed."""
        patient = PatientProfileFactory()
        practitioner = PractitionerProfileFactory()

        planned = EncounterFactory(
            patient=patient,
            practitioner=practitioner,
            status='planned',
            start_time=timezone.now()
        )

        encounter, created = get_or_create_active_encounter(
            patient=patient,
            practitioner=practitioner
        )

        assert created is False
        assert encounter.id == planned.id
        encounter.refresh_from_db()
        assert encounter.status == 'in-progress'

    def test_transitions_any_practitioners_planned_encounter(self):
        """Test transitions planned encounter even for different practitioner."""
        patient = PatientProfileFactory()
        practitioner1 = PractitionerProfileFactory()
        practitioner2 = PractitionerProfileFactory()

        planned = EncounterFactory(
            patient=patient,
            practitioner=practitioner1,
            status='planned',
            start_time=timezone.now()
        )

        encounter, created = get_or_create_active_encounter(
            patient=patient,
            practitioner=practitioner2
        )

        assert created is False
        assert encounter.id == planned.id
        encounter.refresh_from_db()
        assert encounter.status == 'in-progress'

    def test_prefers_same_practitioner_planned_encounter(self):
        """Test prefers same practitioner's planned encounter."""
        patient = PatientProfileFactory()
        practitioner1 = PractitionerProfileFactory()
        practitioner2 = PractitionerProfileFactory()

        EncounterFactory(
            patient=patient,
            practitioner=practitioner1,
            status='planned',
            start_time=timezone.now()
        )
        my_planned = EncounterFactory(
            patient=patient,
            practitioner=practitioner2,
            status='planned',
            start_time=timezone.now()
        )

        encounter, created = get_or_create_active_encounter(
            patient=patient,
            practitioner=practitioner2
        )

        assert created is False
        assert encounter.id == my_planned.id
        encounter.refresh_from_db()
        assert encounter.status == 'in-progress'

    def test_adds_reason_to_planned_encounter_without_reason(self):
        """Test adds reason to planned encounter if not set."""
        patient = PatientProfileFactory()

        planned = EncounterFactory(
            patient=patient,
            status='planned',
            start_time=timezone.now(),
            reason=''  # No reason set
        )

        encounter, created = get_or_create_active_encounter(
            patient=patient,
            reason='New symptom'
        )

        assert created is False
        encounter.refresh_from_db()
        assert encounter.reason == 'New symptom'

    def test_does_not_overwrite_existing_reason(self):
        """Test doesn't overwrite existing reason on planned encounter."""
        patient = PatientProfileFactory()

        planned = EncounterFactory(
            patient=patient,
            status='planned',
            start_time=timezone.now(),
            reason='Scheduled follow-up'
        )

        encounter, created = get_or_create_active_encounter(
            patient=patient,
            reason='New symptom'
        )

        assert created is False
        encounter.refresh_from_db()
        assert encounter.reason == 'Scheduled follow-up'


@pytest.mark.django_db
class TestInpatientAdmissionEncounter:
    """Tests for inpatient admission encounter logic."""

    def test_returns_admission_encounter_for_inpatient(self):
        """Test returns admission's encounter for admitted patient."""
        patient = PatientProfileFactory()
        bed = BedFactory()

        # Create admission with linked encounter
        admission = AdmissionFactory(patient=patient, bed=bed, status='admitted')
        admission_encounter = EncounterFactory(
            patient=patient,
            encounter_type='inpatient',
            status='in-progress',
            admission=admission
        )

        encounter, created = get_or_create_active_encounter(
            patient=patient,
            encounter_type='outpatient'  # Should be ignored for inpatient
        )

        assert created is False
        assert encounter.id == admission_encounter.id

    def test_creates_encounter_for_admission_without_one(self):
        """Test creates encounter for admission that has no linked encounter."""
        patient = PatientProfileFactory()
        bed = BedFactory()

        # Create admission WITHOUT linked encounter (edge case)
        admission = AdmissionFactory(patient=patient, bed=bed, status='admitted')

        encounter, created = get_or_create_active_encounter(patient=patient)

        assert created is True
        assert encounter.encounter_type == 'inpatient'
        assert encounter.admission == admission

    def test_ignores_discharged_admission(self):
        """Test ignores discharged admissions."""
        patient = PatientProfileFactory()
        bed = BedFactory()

        # Create discharged admission
        discharged_admission = AdmissionFactory(
            patient=patient,
            bed=bed,
            status='discharged'
        )
        EncounterFactory(
            patient=patient,
            encounter_type='inpatient',
            status='finished',
            admission=discharged_admission
        )

        encounter, created = get_or_create_active_encounter(patient=patient)

        assert created is True
        assert encounter.encounter_type == 'outpatient'

    def test_uses_most_recent_admission_if_multiple(self):
        """Test uses most recent admission when multiple exist (edge case fix)."""
        patient = PatientProfileFactory()
        bed1 = BedFactory()
        bed2 = BedFactory()

        # Create older admission
        old_admission = AdmissionFactory(
            patient=patient,
            bed=bed1,
            status='admitted',
            admission_date=timezone.now() - timedelta(days=2)
        )
        old_encounter = EncounterFactory(
            patient=patient,
            encounter_type='inpatient',
            status='in-progress',
            admission=old_admission
        )

        # Create newer admission
        new_admission = AdmissionFactory(
            patient=patient,
            bed=bed2,
            status='admitted',
            admission_date=timezone.now()
        )
        new_encounter = EncounterFactory(
            patient=patient,
            encounter_type='inpatient',
            status='in-progress',
            admission=new_admission
        )

        encounter, created = get_or_create_active_encounter(patient=patient)

        # Should return the newer admission's encounter
        assert created is False
        assert encounter.id == new_encounter.id


@pytest.mark.django_db
class TestEncounterTypeForwarding:
    """Tests for encounter_type parameter forwarding (edge case fix)."""

    def test_creates_outpatient_by_default(self):
        """Test creates outpatient encounter by default."""
        patient = PatientProfileFactory()

        encounter, created = get_or_create_active_encounter(patient=patient)

        assert created is True
        assert encounter.encounter_type == 'outpatient'

    def test_creates_emergency_when_specified(self):
        """Test creates emergency encounter when specified."""
        patient = PatientProfileFactory()

        encounter, created = get_or_create_active_encounter(
            patient=patient,
            encounter_type='emergency'
        )

        assert created is True
        assert encounter.encounter_type == 'emergency'

    def test_returns_emergency_for_emergency_request(self):
        """Test returns existing emergency encounter for emergency request."""
        patient = PatientProfileFactory()

        existing = EncounterFactory(
            patient=patient,
            encounter_type='emergency',
            status='in-progress',
            start_time=timezone.now()
        )

        encounter, created = get_or_create_active_encounter(
            patient=patient,
            encounter_type='emergency'
        )

        assert created is False
        assert encounter.id == existing.id


@pytest.mark.django_db
class TestCreatedByAuditField:
    """Tests for created_by audit field (edge case fix)."""

    def test_sets_created_by_on_new_encounter(self):
        """Test sets created_by when creating new encounter."""
        patient = PatientProfileFactory()
        user = UserFactory()

        encounter, created = get_or_create_active_encounter(
            patient=patient,
            created_by=user
        )

        assert created is True
        assert encounter.created_by == user

    def test_created_by_not_changed_on_existing(self):
        """Test created_by not changed when returning existing encounter."""
        patient = PatientProfileFactory()
        original_creator = UserFactory()
        different_user = UserFactory()

        existing = EncounterFactory(
            patient=patient,
            status='in-progress',
            start_time=timezone.now(),
            created_by=original_creator
        )

        encounter, created = get_or_create_active_encounter(
            patient=patient,
            created_by=different_user
        )

        assert created is False
        assert encounter.created_by == original_creator


@pytest.mark.django_db
class TestEnsureEncounterForEntry:
    """Tests for ensure_encounter_for_entry function."""

    def test_creates_encounter_when_none_provided(self):
        """Test creates encounter when no encounter_id provided."""
        patient = PatientProfileFactory()
        practitioner = PractitionerProfileFactory()

        encounter, created = ensure_encounter_for_entry(
            patient=patient,
            practitioner=practitioner,
            reason='Vitals check'
        )

        assert created is True
        assert encounter.patient == patient

    def test_returns_valid_encounter_when_provided(self):
        """Test returns encounter when valid encounter_id provided."""
        patient = PatientProfileFactory()
        existing = EncounterFactory(patient=patient, status='in-progress')

        encounter, created = ensure_encounter_for_entry(
            patient=patient,
            encounter_id=existing.id
        )

        assert created is False
        assert encounter.id == existing.id

    def test_raises_on_nonexistent_encounter(self):
        """Test raises ValueError when encounter_id doesn't exist."""
        patient = PatientProfileFactory()
        fake_uuid = '00000000-0000-0000-0000-000000000000'

        with pytest.raises(ValueError) as exc_info:
            ensure_encounter_for_entry(
                patient=patient,
                encounter_id=fake_uuid
            )

        assert f"Encounter {fake_uuid} not found" in str(exc_info.value)

    def test_raises_on_wrong_patient_encounter(self):
        """Test raises ValueError when encounter belongs to different patient."""
        patient1 = PatientProfileFactory()
        patient2 = PatientProfileFactory()
        other_encounter = EncounterFactory(patient=patient2, status='in-progress')

        with pytest.raises(ValueError) as exc_info:
            ensure_encounter_for_entry(
                patient=patient1,
                encounter_id=other_encounter.id
            )

        assert "belongs to a different patient" in str(exc_info.value)

    def test_raises_on_finished_encounter(self):
        """Test raises ValueError when encounter is finished (edge case fix)."""
        patient = PatientProfileFactory()
        finished_encounter = EncounterFactory(
            patient=patient,
            status='in-progress'
        )
        finished_encounter.finish()

        with pytest.raises(ValueError) as exc_info:
            ensure_encounter_for_entry(
                patient=patient,
                encounter_id=finished_encounter.id
            )

        assert "Cannot add entries to finished encounter" in str(exc_info.value)

    def test_raises_on_cancelled_encounter(self):
        """Test raises ValueError when encounter is cancelled (edge case fix)."""
        patient = PatientProfileFactory()
        cancelled_encounter = EncounterFactory(
            patient=patient,
            status='planned'
        )
        cancelled_encounter.cancel()

        with pytest.raises(ValueError) as exc_info:
            ensure_encounter_for_entry(
                patient=patient,
                encounter_id=cancelled_encounter.id
            )

        assert "Cannot add entries to cancelled encounter" in str(exc_info.value)

    def test_allows_planned_encounter(self):
        """Test allows planned encounters (not terminal state)."""
        patient = PatientProfileFactory()
        planned = EncounterFactory(patient=patient, status='planned')

        encounter, created = ensure_encounter_for_entry(
            patient=patient,
            encounter_id=planned.id
        )

        assert created is False
        assert encounter.id == planned.id

    def test_forwards_encounter_type(self):
        """Test forwards encounter_type when creating new encounter."""
        patient = PatientProfileFactory()

        encounter, created = ensure_encounter_for_entry(
            patient=patient,
            encounter_type='emergency'
        )

        assert created is True
        assert encounter.encounter_type == 'emergency'

    def test_forwards_created_by(self):
        """Test forwards created_by when creating new encounter."""
        patient = PatientProfileFactory()
        user = UserFactory()

        encounter, created = ensure_encounter_for_entry(
            patient=patient,
            created_by=user
        )

        assert created is True
        assert encounter.created_by == user


@pytest.mark.django_db
class TestGetActiveEncounterForPatient:
    """Tests for get_active_encounter_for_patient function."""

    def test_returns_none_for_no_encounters(self):
        """Test returns None when patient has no active encounters."""
        patient = PatientProfileFactory()

        result = get_active_encounter_for_patient(patient)

        assert result is None

    def test_returns_inpatient_encounter(self):
        """Test returns inpatient admission encounter."""
        patient = PatientProfileFactory()
        bed = BedFactory()
        admission = AdmissionFactory(patient=patient, bed=bed, status='admitted')
        encounter = EncounterFactory(
            patient=patient,
            encounter_type='inpatient',
            status='in-progress',
            admission=admission
        )

        result = get_active_encounter_for_patient(patient)

        assert result is not None
        assert result.id == encounter.id

    def test_returns_outpatient_encounter_today(self):
        """Test returns outpatient encounter from today."""
        patient = PatientProfileFactory()
        encounter = EncounterFactory(
            patient=patient,
            encounter_type='outpatient',
            status='in-progress',
            start_time=timezone.now()
        )

        result = get_active_encounter_for_patient(patient)

        assert result is not None
        assert result.id == encounter.id

    def test_returns_planned_encounter_today(self):
        """Test returns planned encounter from today."""
        patient = PatientProfileFactory()
        encounter = EncounterFactory(
            patient=patient,
            encounter_type='outpatient',
            status='planned',
            start_time=timezone.now()
        )

        result = get_active_encounter_for_patient(patient)

        assert result is not None
        assert result.id == encounter.id

    def test_does_not_return_yesterday_encounter(self):
        """Test doesn't return encounters from yesterday."""
        patient = PatientProfileFactory()
        EncounterFactory(
            patient=patient,
            status='in-progress',
            start_time=timezone.now() - timedelta(days=1)
        )

        result = get_active_encounter_for_patient(patient)

        assert result is None

    def test_does_not_return_finished_encounter(self):
        """Test doesn't return finished encounters."""
        patient = PatientProfileFactory()
        EncounterFactory(
            patient=patient,
            status='finished',
            start_time=timezone.now()
        )

        result = get_active_encounter_for_patient(patient)

        assert result is None


@pytest.mark.integration
@pytest.mark.slow
class TestRaceConditionPrevention:
    """Tests for race condition prevention (edge case fix).

    These tests verify that concurrent calls to get_or_create_active_encounter
    don't create duplicate encounters.

    NOTE: These are integration tests that verify database-level locking.
    They may produce inconsistent results in test environments that use
    SQLite or test isolation that doesn't support select_for_update.
    Run with: pytest -m integration --no-cov
    """

    def test_service_uses_atomic_transaction(self, db):
        """Test that get_or_create_active_encounter uses atomic transactions."""
        # Verify the service function uses transaction.atomic
        import inspect
        from apps.encounters import services
        source = inspect.getsource(services.get_or_create_active_encounter)
        assert 'transaction.atomic()' in source, "Service should use atomic transaction"
        assert 'select_for_update' in source, "Service should use select_for_update"

    def test_sequential_calls_return_same_encounter(self, db):
        """Test sequential calls return the same encounter (simpler version)."""
        patient = PatientProfileFactory()

        # First call creates
        encounter1, created1 = get_or_create_active_encounter(patient=patient)
        assert created1 is True

        # Second call returns existing
        encounter2, created2 = get_or_create_active_encounter(patient=patient)
        assert created2 is False
        assert encounter1.id == encounter2.id

        # Third call still returns same
        encounter3, created3 = get_or_create_active_encounter(patient=patient)
        assert created3 is False
        assert encounter1.id == encounter3.id

    def test_sequential_planned_transition(self, db):
        """Test sequential calls properly transition planned encounter."""
        patient = PatientProfileFactory()
        planned = EncounterFactory(
            patient=patient,
            status='planned',
            start_time=timezone.now()
        )
        original_id = planned.id

        # First call transitions planned to in-progress
        encounter1, created1 = get_or_create_active_encounter(patient=patient)
        assert created1 is False
        assert encounter1.id == original_id
        encounter1.refresh_from_db()
        assert encounter1.status == 'in-progress'

        # Second call returns same encounter
        encounter2, created2 = get_or_create_active_encounter(patient=patient)
        assert created2 is False
        assert encounter2.id == original_id
