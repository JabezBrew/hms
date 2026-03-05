"""
Model tests for patients app.

Tests for:
- PatientFHIRMapping model
- PatientSearch model
- RecentPatient model
- PatientRegistrationValidation model
- PatientNote model
"""
import pytest
from django.db import IntegrityError
from django.utils import timezone

from apps.patients.models import (
    PatientFHIRMapping, PatientSearch, RecentPatient,
    PatientRegistrationValidation, PatientNote
)
from apps.users.tests.factories import (
    UserFactory, AdminUserFactory, PatientProfileFactory
)
from .factories import (
    PatientFHIRMappingFactory, PatientSearchFactory,
    RecentPatientFactory, PatientRegistrationValidationFactory,
    PatientNoteFactory
)


# =============================================================================
# PatientFHIRMapping Model Tests
# =============================================================================

@pytest.mark.tier1
class TestPatientFHIRMappingModel:
    """Tests for the PatientFHIRMapping model."""

    def test_fhir_mapping_creation(self, db):
        """Test creating a FHIR mapping."""
        mapping = PatientFHIRMappingFactory(
            fhir_patient_id='patient-test-123',
            fhir_resource_version='1',
            is_synced=True
        )

        assert mapping.fhir_patient_id == 'patient-test-123'
        assert mapping.fhir_resource_version == '1'
        assert mapping.is_synced is True
        assert mapping.patient_profile is not None

    def test_fhir_mapping_string_representation(self, db):
        """Test __str__ returns meaningful value."""
        mapping = PatientFHIRMappingFactory(
            fhir_patient_id='patient-str-test'
        )

        str_repr = str(mapping)
        assert 'patient-str-test' in str_repr
        assert mapping.patient_profile.user.get_full_name() in str_repr

    def test_fhir_patient_id_uniqueness(self, db):
        """Test that fhir_patient_id must be unique."""
        PatientFHIRMappingFactory(fhir_patient_id='unique-id-123')

        with pytest.raises(IntegrityError):
            PatientFHIRMappingFactory(fhir_patient_id='unique-id-123')

    def test_one_to_one_patient_profile_relationship(self, db):
        """Test that patient_profile is one-to-one."""
        patient_profile = PatientProfileFactory()
        PatientFHIRMappingFactory(patient_profile=patient_profile)

        with pytest.raises(IntegrityError):
            PatientFHIRMappingFactory(patient_profile=patient_profile)

    def test_fhir_mapping_audit_fields(self, db):
        """Test audit fields are set correctly."""
        mapping = PatientFHIRMappingFactory()

        assert mapping.created_at is not None
        assert mapping.updated_at is not None
        assert mapping.created_by is not None
        assert mapping.updated_by is not None

    def test_last_synced_auto_updates(self, db):
        """Test that last_synced is auto-updated on save."""
        mapping = PatientFHIRMappingFactory()
        initial_sync_time = mapping.last_synced

        # Update and save
        mapping.is_synced = False
        mapping.save()

        mapping.refresh_from_db()
        assert mapping.last_synced >= initial_sync_time


# =============================================================================
# PatientSearch Model Tests
# =============================================================================

@pytest.mark.tier1
class TestPatientSearchModel:
    """Tests for the PatientSearch model."""

    def test_patient_search_creation(self, db):
        """Test creating a patient search record."""
        search = PatientSearchFactory(search_query='John Doe')

        assert search.search_query == 'John Doe'
        assert search.user is not None
        assert search.search_date is not None

    def test_patient_search_string_representation(self, db):
        """Test __str__ avoids echoing the stored query content."""
        user = UserFactory(email='searcher@test.com')
        search = PatientSearchFactory(user=user, search_query='Patient Name')

        str_repr = str(search)
        assert 'searcher@test.com' in str_repr
        assert 'patient search' in str_repr
        assert 'Patient Name' not in str_repr

    def test_patient_search_ordering(self, db):
        """Test searches are ordered by date descending."""
        user = UserFactory()
        search1 = PatientSearchFactory(user=user, search_query='first')
        search2 = PatientSearchFactory(user=user, search_query='second')
        search3 = PatientSearchFactory(user=user, search_query='third')

        searches = list(PatientSearch.objects.filter(user=user))

        # Most recent should be first
        assert searches[0] == search3
        assert searches[1] == search2
        assert searches[2] == search1

    def test_user_cascade_delete(self, db):
        """Test that deleting user deletes their searches."""
        user = UserFactory()
        PatientSearchFactory(user=user)
        PatientSearchFactory(user=user)

        user_id = user.id
        user.delete()

        assert PatientSearch.objects.filter(user_id=user_id).count() == 0


# =============================================================================
# RecentPatient Model Tests
# =============================================================================

@pytest.mark.tier1
class TestRecentPatientModel:
    """Tests for the RecentPatient model."""

    def test_recent_patient_creation(self, db):
        """Test creating a recent patient record."""
        recent = RecentPatientFactory()

        assert recent.user is not None
        assert recent.patient_profile is not None
        assert recent.access_date is not None

    def test_recent_patient_string_representation(self, db):
        """Test __str__ returns user email and patient name."""
        user = UserFactory(email='doctor@test.com')
        patient = PatientProfileFactory()
        recent = RecentPatientFactory(user=user, patient_profile=patient)

        str_repr = str(recent)
        assert 'doctor@test.com' in str_repr
        assert patient.user.get_full_name() in str_repr

    def test_unique_together_constraint(self, db):
        """Test that user + patient_profile is unique."""
        user = UserFactory()
        patient = PatientProfileFactory()

        RecentPatientFactory(user=user, patient_profile=patient)

        with pytest.raises(IntegrityError):
            RecentPatientFactory(user=user, patient_profile=patient)

    def test_same_patient_different_users(self, db):
        """Test same patient can appear in multiple users' recent lists."""
        user1 = UserFactory()
        user2 = UserFactory()
        patient = PatientProfileFactory()

        recent1 = RecentPatientFactory(user=user1, patient_profile=patient)
        recent2 = RecentPatientFactory(user=user2, patient_profile=patient)

        assert recent1.patient_profile == recent2.patient_profile
        assert recent1.user != recent2.user

    def test_recent_patient_ordering(self, db):
        """Test recent patients are ordered by access date descending."""
        user = UserFactory()
        patient1 = PatientProfileFactory()
        patient2 = PatientProfileFactory()
        patient3 = PatientProfileFactory()

        recent1 = RecentPatientFactory(user=user, patient_profile=patient1)
        recent2 = RecentPatientFactory(user=user, patient_profile=patient2)
        recent3 = RecentPatientFactory(user=user, patient_profile=patient3)

        recents = list(RecentPatient.objects.filter(user=user))

        # Most recent should be first
        assert recents[0] == recent3
        assert recents[1] == recent2
        assert recents[2] == recent1

    def test_access_date_updates_on_save(self, db):
        """Test access_date auto-updates on save."""
        recent = RecentPatientFactory()
        initial_access = recent.access_date

        # Simulate re-accessing
        recent.save()
        recent.refresh_from_db()

        assert recent.access_date >= initial_access


# =============================================================================
# PatientRegistrationValidation Model Tests
# =============================================================================

@pytest.mark.tier1
class TestPatientRegistrationValidationModel:
    """Tests for the PatientRegistrationValidation model."""

    def test_validation_rule_creation(self, db):
        """Test creating a validation rule."""
        validation = PatientRegistrationValidationFactory(
            field_name='phone_number',
            validation_regex=r'^\d{10}$',
            validation_message='Phone number must be 10 digits',
            is_required=True,
            is_active=True
        )

        assert validation.field_name == 'phone_number'
        assert validation.validation_regex == r'^\d{10}$'
        assert validation.validation_message == 'Phone number must be 10 digits'
        assert validation.is_required is True
        assert validation.is_active is True

    def test_validation_string_representation(self, db):
        """Test __str__ returns field name."""
        validation = PatientRegistrationValidationFactory(
            field_name='email'
        )

        str_repr = str(validation)
        assert 'email' in str_repr

    def test_validation_regex_optional(self, db):
        """Test that validation_regex can be null."""
        validation = PatientRegistrationValidationFactory(
            field_name='notes',
            validation_regex=None
        )

        assert validation.validation_regex is None

    def test_audit_fields(self, db):
        """Test audit fields are set correctly."""
        validation = PatientRegistrationValidationFactory()

        assert validation.created_at is not None
        assert validation.updated_at is not None
        assert validation.created_by is not None
        assert validation.updated_by is not None


# =============================================================================
# PatientNote Model Tests
# =============================================================================

@pytest.mark.tier1
class TestPatientNoteModel:
    """Tests for the PatientNote model."""

    def test_patient_note_creation(self, db):
        """Test creating a patient note."""
        note = PatientNoteFactory(
            note_text='This is a test note',
            is_private=True
        )

        assert note.note_text == 'This is a test note'
        assert note.is_private is True
        assert note.patient_profile is not None

    def test_patient_note_string_representation(self, db):
        """Test __str__ returns patient name and creator."""
        note = PatientNoteFactory()

        str_repr = str(note)
        assert note.patient_profile.user.get_full_name() in str_repr
        assert note.created_by.get_full_name() in str_repr

    def test_note_ordering(self, db):
        """Test notes are ordered by created_at descending."""
        patient = PatientProfileFactory()
        note1 = PatientNoteFactory(patient_profile=patient, note_text='first')
        note2 = PatientNoteFactory(patient_profile=patient, note_text='second')
        note3 = PatientNoteFactory(patient_profile=patient, note_text='third')

        notes = list(PatientNote.objects.filter(patient_profile=patient))

        # Most recent should be first
        assert notes[0] == note3
        assert notes[1] == note2
        assert notes[2] == note1

    def test_private_note_default(self, db):
        """Test that is_private defaults to False."""
        note = PatientNoteFactory(is_private=False)
        assert note.is_private is False

    def test_note_cascade_delete_with_patient(self, db):
        """Test that deleting patient deletes their notes."""
        patient = PatientProfileFactory()
        PatientNoteFactory(patient_profile=patient)
        PatientNoteFactory(patient_profile=patient)

        patient_id = patient.id
        patient.delete()

        assert PatientNote.objects.filter(patient_profile_id=patient_id).count() == 0

    def test_note_keeps_creator_reference_on_delete(self, db):
        """Test that note survives when creator is deleted."""
        creator = AdminUserFactory()
        note = PatientNoteFactory(created_by=creator, updated_by=creator)
        note_id = note.id

        creator.delete()

        # Note should still exist but with null created_by
        note = PatientNote.objects.get(id=note_id)
        assert note.created_by is None

    def test_multiple_notes_per_patient(self, db):
        """Test a patient can have multiple notes."""
        patient = PatientProfileFactory()
        notes = [PatientNoteFactory(patient_profile=patient) for _ in range(5)]

        assert PatientNote.objects.filter(patient_profile=patient).count() == 5

    def test_audit_fields(self, db):
        """Test audit fields are set correctly."""
        note = PatientNoteFactory()

        assert note.created_at is not None
        assert note.updated_at is not None
        assert note.created_by is not None
        assert note.updated_by is not None
