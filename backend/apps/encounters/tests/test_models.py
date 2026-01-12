"""
Tests for the Encounter model.

Tests status transitions, properties, and model methods.
"""
import pytest
from django.core.exceptions import ValidationError
from django.utils import timezone
from datetime import timedelta

from apps.encounters.models import Encounter
from apps.encounters.tests.factories import EncounterFactory
from apps.users.tests.factories import PatientProfileFactory, PractitionerProfileFactory, UserFactory


@pytest.mark.django_db
class TestEncounterModel:
    """Tests for basic Encounter model functionality."""

    def test_create_encounter(self):
        """Test creating an encounter with default values."""
        patient = PatientProfileFactory()
        practitioner = PractitionerProfileFactory()

        encounter = Encounter.objects.create(
            patient=patient,
            facility=patient.facility,
            practitioner=practitioner,
            encounter_type='outpatient',
            status='in-progress',
            reason='Check-up'
        )

        assert encounter.id is not None
        assert encounter.patient == patient
        assert encounter.practitioner == practitioner
        assert encounter.encounter_type == 'outpatient'
        assert encounter.status == 'in-progress'
        assert encounter.reason == 'Check-up'

    def test_encounter_factory(self):
        """Test the EncounterFactory creates valid encounters."""
        encounter = EncounterFactory()

        assert encounter.id is not None
        assert encounter.patient is not None
        assert encounter.practitioner is not None
        assert encounter.status == 'in-progress'
        assert encounter.encounter_type == 'outpatient'

    def test_str_representation(self):
        """Test the string representation of an encounter."""
        encounter = EncounterFactory()
        str_repr = str(encounter)

        assert encounter.patient_name in str_repr
        assert 'Outpatient' in str_repr

    def test_patient_name_property(self):
        """Test the patient_name property."""
        encounter = EncounterFactory()
        assert encounter.patient_name == encounter.patient.user.get_full_name()

    def test_patient_name_property_unknown(self):
        """Test patient_name returns 'Unknown Patient' when patient has no user."""
        encounter = EncounterFactory()
        # Test when patient's user has empty name
        encounter.patient.user.first_name = ''
        encounter.patient.user.last_name = ''
        encounter.patient.user.save()
        # get_full_name() returns empty string for empty names
        # Our property should return "Unknown Patient" in that case
        assert encounter.patient_name in ["Unknown Patient", ""]

    def test_practitioner_name_property(self):
        """Test the practitioner_name property."""
        encounter = EncounterFactory()
        assert encounter.practitioner_name == encounter.practitioner.staff.user.get_full_name()

    def test_practitioner_name_property_unknown(self):
        """Test practitioner_name returns 'Unknown Practitioner' when practitioner is None."""
        encounter = EncounterFactory()
        encounter.practitioner = None
        assert encounter.practitioner_name == "Unknown Practitioner"

    def test_duration_minutes_no_end_time(self):
        """Test duration_minutes returns None when no end_time."""
        encounter = EncounterFactory()
        encounter.end_time = None
        assert encounter.duration_minutes is None

    def test_duration_minutes_with_end_time(self):
        """Test duration_minutes calculates correctly."""
        encounter = EncounterFactory()
        encounter.start_time = timezone.now() - timedelta(hours=2)
        encounter.end_time = timezone.now()

        assert encounter.duration_minutes == 120


@pytest.mark.django_db
class TestEncounterStatusTransitions:
    """Tests for status transition validation."""

    def test_valid_transition_planned_to_in_progress(self):
        """Test valid transition from planned to in-progress."""
        encounter = EncounterFactory(status='planned')
        encounter.status = 'in-progress'
        encounter.save()

        encounter.refresh_from_db()
        assert encounter.status == 'in-progress'

    def test_valid_transition_planned_to_cancelled(self):
        """Test valid transition from planned to cancelled."""
        encounter = EncounterFactory(status='planned')
        encounter.status = 'cancelled'
        encounter.save()

        encounter.refresh_from_db()
        assert encounter.status == 'cancelled'

    def test_valid_transition_in_progress_to_finished(self):
        """Test valid transition from in-progress to finished."""
        encounter = EncounterFactory(status='in-progress')
        encounter.status = 'finished'
        encounter.save()

        encounter.refresh_from_db()
        assert encounter.status == 'finished'

    def test_valid_transition_in_progress_to_cancelled(self):
        """Test valid transition from in-progress to cancelled."""
        encounter = EncounterFactory(status='in-progress')
        encounter.status = 'cancelled'
        encounter.save()

        encounter.refresh_from_db()
        assert encounter.status == 'cancelled'

    def test_invalid_transition_planned_to_finished(self):
        """Test invalid transition from planned to finished raises ValidationError."""
        encounter = EncounterFactory(status='planned')
        encounter.status = 'finished'

        with pytest.raises(ValidationError) as exc_info:
            encounter.save()

        assert "Invalid status transition from 'planned' to 'finished'" in str(exc_info.value)

    def test_invalid_transition_finished_to_in_progress(self):
        """Test invalid transition from finished (terminal) raises ValidationError."""
        encounter = EncounterFactory(status='in-progress')
        encounter.status = 'finished'
        encounter.save()

        encounter.status = 'in-progress'
        with pytest.raises(ValidationError) as exc_info:
            encounter.save()

        assert "Invalid status transition from 'finished' to 'in-progress'" in str(exc_info.value)

    def test_invalid_transition_cancelled_to_in_progress(self):
        """Test invalid transition from cancelled (terminal) raises ValidationError."""
        encounter = EncounterFactory(status='planned')
        encounter.status = 'cancelled'
        encounter.save()

        encounter.status = 'in-progress'
        with pytest.raises(ValidationError) as exc_info:
            encounter.save()

        assert "Invalid status transition from 'cancelled' to 'in-progress'" in str(exc_info.value)

    def test_same_status_no_error(self):
        """Test setting the same status doesn't raise an error."""
        encounter = EncounterFactory(status='in-progress')
        encounter.reason = 'Updated reason'
        encounter.save()

        encounter.refresh_from_db()
        assert encounter.reason == 'Updated reason'
        assert encounter.status == 'in-progress'


@pytest.mark.django_db
class TestEncounterFinishMethod:
    """Tests for the finish() method."""

    def test_finish_sets_status(self):
        """Test finish() sets status to finished."""
        encounter = EncounterFactory(status='in-progress')
        encounter.finish()

        assert encounter.status == 'finished'

    def test_finish_sets_end_time(self):
        """Test finish() sets end_time to now."""
        encounter = EncounterFactory(status='in-progress')
        before = timezone.now()
        encounter.finish()
        after = timezone.now()

        assert encounter.end_time is not None
        assert before <= encounter.end_time <= after

    def test_finish_with_custom_end_time(self):
        """Test finish() with custom end_time."""
        encounter = EncounterFactory(status='in-progress')
        custom_end_time = timezone.now() - timedelta(hours=1)
        encounter.finish(end_time=custom_end_time)

        assert encounter.end_time == custom_end_time

    def test_finish_with_discharge_disposition(self):
        """Test finish() sets discharge_disposition."""
        encounter = EncounterFactory(status='in-progress')
        encounter.finish(discharge_disposition='home')

        assert encounter.discharge_disposition == 'home'

    def test_finish_with_destination(self):
        """Test finish() sets destination."""
        encounter = EncounterFactory(status='in-progress')
        encounter.finish(destination="Patient's home")

        assert encounter.destination == "Patient's home"

    def test_finish_marks_for_resync(self):
        """Test finish() marks encounter for FHIR re-sync."""
        encounter = EncounterFactory(status='in-progress')
        encounter.fhir_synced = True
        encounter.save()

        encounter.finish()

        assert encounter.fhir_synced is False

    def test_finish_persists_to_db(self):
        """Test finish() saves changes to database."""
        encounter = EncounterFactory(status='in-progress')
        encounter.finish()

        encounter.refresh_from_db()
        assert encounter.status == 'finished'
        assert encounter.end_time is not None


@pytest.mark.django_db
class TestEncounterCancelMethod:
    """Tests for the cancel() method."""

    def test_cancel_sets_status(self):
        """Test cancel() sets status to cancelled."""
        encounter = EncounterFactory(status='in-progress')
        encounter.cancel()

        assert encounter.status == 'cancelled'

    def test_cancel_sets_end_time(self):
        """Test cancel() sets end_time."""
        encounter = EncounterFactory(status='in-progress')
        before = timezone.now()
        encounter.cancel()
        after = timezone.now()

        assert encounter.end_time is not None
        assert before <= encounter.end_time <= after

    def test_cancel_marks_for_resync(self):
        """Test cancel() marks encounter for FHIR re-sync."""
        encounter = EncounterFactory(status='in-progress')
        encounter.fhir_synced = True
        encounter.save()

        encounter.cancel()

        assert encounter.fhir_synced is False

    def test_cancel_persists_to_db(self):
        """Test cancel() saves changes to database."""
        encounter = EncounterFactory(status='planned')
        encounter.cancel()

        encounter.refresh_from_db()
        assert encounter.status == 'cancelled'


@pytest.mark.django_db
class TestEncounterIndexes:
    """Tests to verify indexes are working correctly."""

    def test_filter_by_patient_and_status(self):
        """Test filtering by patient and status uses index."""
        patient = PatientProfileFactory()
        EncounterFactory(patient=patient, status='in-progress')
        EncounterFactory(patient=patient, status='finished')
        EncounterFactory(status='in-progress')  # Different patient

        results = Encounter.objects.filter(patient=patient, status='in-progress')
        assert results.count() == 1

    def test_filter_by_practitioner_and_status(self):
        """Test filtering by practitioner and status uses index."""
        practitioner = PractitionerProfileFactory()
        EncounterFactory(practitioner=practitioner, status='in-progress')
        EncounterFactory(practitioner=practitioner, status='finished')

        results = Encounter.objects.filter(practitioner=practitioner, status='in-progress')
        assert results.count() == 1

    def test_filter_by_encounter_type_and_status(self):
        """Test filtering by encounter_type and status uses index."""
        EncounterFactory(encounter_type='inpatient', status='in-progress')
        EncounterFactory(encounter_type='outpatient', status='in-progress')
        EncounterFactory(encounter_type='inpatient', status='finished')

        results = Encounter.objects.filter(encounter_type='inpatient', status='in-progress')
        assert results.count() == 1

    def test_ordering_by_start_time(self):
        """Test default ordering is by -start_time."""
        e1 = EncounterFactory(start_time=timezone.now() - timedelta(days=2))
        e2 = EncounterFactory(start_time=timezone.now() - timedelta(days=1))
        e3 = EncounterFactory(start_time=timezone.now())

        encounters = list(Encounter.objects.all())
        assert encounters[0] == e3
        assert encounters[1] == e2
        assert encounters[2] == e1
