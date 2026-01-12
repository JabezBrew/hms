"""
Model tests for clinical_notes app.

Tests for:
- NoteTemplate model
- NoteEntry model
- NoteEntryVersion model
- Prescription model
"""
import pytest
from datetime import date, timedelta
from django.utils import timezone

from apps.clinical_notes.models import (
    NoteTemplate, NoteEntry, NoteEntryVersion, Prescription
)
from apps.users.tests.factories import PatientProfileFactory, DoctorUserFactory, PractitionerProfileFactory
from apps.nursing.tests.factories import EncounterFactory
from .factories import (
    NoteTemplateFactory, PublicNoteTemplateFactory, SOAPNoteTemplateFactory,
    SystemNoteTemplateFactory, NoteEntryFactory, SOAPNoteEntryFactory,
    NoteEntryVersionFactory, PrescriptionFactory, ActivePrescriptionFactory,
    DiscontinuedPrescriptionFactory, PRNPrescriptionFactory,
    create_note_with_versions
)


# =============================================================================
# NoteTemplate Model Tests
# =============================================================================

@pytest.mark.tier1
class TestNoteTemplateModel:
    """Tests for NoteTemplate model."""

    def test_template_creation(self, db):
        """Test creating a note template with all fields."""
        user = DoctorUserFactory()
        template = NoteTemplateFactory(
            title='Test Template',
            description='A test template',
            category='progress',
            visibility='private',
            created_by=user
        )

        assert template.title == 'Test Template'
        assert template.category == 'progress'
        assert template.visibility == 'private'
        assert template.created_by == user

    def test_template_string_representation(self, db):
        """Test __str__ returns template title."""
        template = NoteTemplateFactory(title='SOAP Note')

        assert str(template) == 'SOAP Note'

    def test_all_visibility_choices_valid(self, db):
        """Test all visibility choices can be created."""
        visibility_choices = ['private', 'role', 'department', 'public']

        for visibility in visibility_choices:
            template = NoteTemplateFactory(visibility=visibility)
            assert template.visibility == visibility

    def test_all_category_choices_valid(self, db):
        """Test all category choices can be created."""
        categories = [
            'general', 'soap', 'progress', 'procedure',
            'admission', 'discharge', 'nursing', 'consultation', 'custom'
        ]

        for category in categories:
            template = NoteTemplateFactory(category=category)
            assert template.category == category

    def test_is_system_template_with_no_creator(self, db):
        """Test is_system_template returns True when no creator."""
        template = SystemNoteTemplateFactory()

        assert template.is_system_template is True

    def test_is_system_template_with_creator(self, db):
        """Test is_system_template returns False when creator exists."""
        template = NoteTemplateFactory()

        assert template.is_system_template is False

    def test_public_visibility_syncs_is_public(self, db):
        """Test public visibility syncs with is_public field."""
        template = NoteTemplateFactory(visibility='public')
        template.save()

        assert template.is_public is True

    def test_is_public_syncs_visibility(self, db):
        """Test is_public=True syncs with visibility field."""
        template = NoteTemplateFactory(is_public=True, visibility='private')
        template.save()

        assert template.visibility == 'public'

    def test_template_structure_json(self, db):
        """Test template structure JSON field."""
        template = SOAPNoteTemplateFactory()

        assert 'sections' in template.structure
        assert len(template.structure['sections']) == 4

    def test_template_ordering(self, db):
        """Test templates are ordered by created_at descending."""
        user = DoctorUserFactory()

        template1 = NoteTemplateFactory(created_by=user)
        template2 = NoteTemplateFactory(created_by=user)
        template3 = NoteTemplateFactory(created_by=user)

        templates = list(NoteTemplate.objects.filter(created_by=user))

        # Most recent should be first
        assert templates[0] == template3
        assert templates[1] == template2
        assert templates[2] == template1

    def test_template_indexes(self, db):
        """Test template indexes exist."""
        indexes = NoteTemplate._meta.indexes
        indexed_fields = [tuple(idx.fields) for idx in indexes]

        assert ('visibility', 'is_active') in indexed_fields
        assert ('category', 'is_active') in indexed_fields
        assert ('created_by', 'visibility') in indexed_fields

    def test_department_template(self, db):
        """Test department-based template."""
        template = NoteTemplateFactory(
            visibility='department',
            department='Cardiology'
        )

        assert template.visibility == 'department'
        assert template.department == 'Cardiology'


# =============================================================================
# NoteEntry Model Tests
# =============================================================================

@pytest.mark.tier1
class TestNoteEntryModel:
    """Tests for NoteEntry model."""

    def test_note_entry_creation(self, db):
        """Test creating a note entry."""
        template = NoteTemplateFactory()
        patient = PatientProfileFactory()
        practitioner = PractitionerProfileFactory()
        encounter = EncounterFactory(patient=patient)

        entry = NoteEntry.objects.create(
            template=template,
            patient=patient,
            facility=patient.facility,
            encounter=encounter,
            practitioner=practitioner,
            data={'test': 'data'}
        )

        assert entry.template == template
        assert entry.patient == patient
        assert entry.practitioner == practitioner
        assert entry.encounter == encounter

    def test_note_entry_string_representation(self, db):
        """Test __str__ returns template title and patient name."""
        entry = NoteEntryFactory()

        str_repr = str(entry)
        assert entry.template.title in str_repr

    def test_note_entry_data_json(self, db):
        """Test note entry data JSON field."""
        entry = SOAPNoteEntryFactory()

        assert 'Subjective' in entry.data
        assert 'Objective' in entry.data
        assert 'Assessment' in entry.data
        assert 'Plan' in entry.data

    def test_note_entry_ordering(self, db):
        """Test entries are ordered by created_at descending."""
        patient = PatientProfileFactory()

        entry1 = NoteEntryFactory(patient=patient)
        entry2 = NoteEntryFactory(patient=patient)
        entry3 = NoteEntryFactory(patient=patient)

        entries = list(NoteEntry.objects.filter(patient=patient))

        # Most recent should be first
        assert entries[0] == entry3
        assert entries[1] == entry2
        assert entries[2] == entry1

    def test_note_entry_indexes(self, db):
        """Test note entry indexes exist."""
        indexes = NoteEntry._meta.indexes
        indexed_fields = [tuple(idx.fields) for idx in indexes]

        assert ('patient', '-created_at') in indexed_fields
        assert ('encounter', '-created_at') in indexed_fields

    def test_copied_from_tracking(self, db):
        """Test copied_from field for audit trail."""
        original = NoteEntryFactory()
        copy = NoteEntryFactory(copied_from=original)

        assert copy.copied_from == original
        assert original.copies.count() == 1
        assert original.copies.first() == copy


# =============================================================================
# NoteEntryVersion Model Tests
# =============================================================================

@pytest.mark.tier1
class TestNoteEntryVersionModel:
    """Tests for NoteEntryVersion model."""

    def test_version_creation(self, db):
        """Test creating a note entry version."""
        entry = NoteEntryFactory()
        user = DoctorUserFactory()

        version = NoteEntryVersion.objects.create(
            note_entry=entry,
            facility=entry.facility,
            version_number=1,
            data={'content': 'Original content'},
            edited_by=user,
            edit_reason='Initial version'
        )

        assert version.note_entry == entry
        assert version.version_number == 1
        assert version.edited_by == user

    def test_version_string_representation(self, db):
        """Test __str__ returns version number and note entry."""
        version = NoteEntryVersionFactory(version_number=3)

        str_repr = str(version)
        assert 'Version 3' in str_repr

    def test_create_version_class_method(self, db):
        """Test create_version class method."""
        entry = NoteEntryFactory(data={'original': 'data'})
        user = DoctorUserFactory()

        version = NoteEntryVersion.create_version(
            note_entry=entry,
            edited_by=user,
            edit_reason='Test edit'
        )

        assert version.version_number == 1
        assert version.data == entry.data
        assert version.edit_reason == 'Test edit'

    def test_create_version_increments_number(self, db):
        """Test create_version increments version number."""
        entry = NoteEntryFactory()
        user = DoctorUserFactory()

        version1 = NoteEntryVersion.create_version(entry, user)
        version2 = NoteEntryVersion.create_version(entry, user)
        version3 = NoteEntryVersion.create_version(entry, user)

        assert version1.version_number == 1
        assert version2.version_number == 2
        assert version3.version_number == 3

    def test_version_ordering(self, db):
        """Test versions are ordered by version_number descending."""
        note, versions = create_note_with_versions(num_versions=3)

        fetched_versions = list(NoteEntryVersion.objects.filter(note_entry=note))

        # Highest version should be first
        assert fetched_versions[0].version_number >= fetched_versions[1].version_number

    def test_version_unique_together(self, db):
        """Test note_entry and version_number are unique together."""
        entry = NoteEntryFactory()

        NoteEntryVersion.objects.create(
            note_entry=entry,
            facility=entry.facility,
            version_number=1,
            data={'test': 'data'}
        )

        from django.db import IntegrityError
        with pytest.raises(IntegrityError):
            NoteEntryVersion.objects.create(
                note_entry=entry,
                facility=entry.facility,
                version_number=1,  # Same version number
                data={'test': 'duplicate'}
            )

    def test_version_indexes(self, db):
        """Test version indexes exist."""
        indexes = NoteEntryVersion._meta.indexes
        indexed_fields = [tuple(idx.fields) for idx in indexes]

        assert ('note_entry', '-version_number') in indexed_fields
        assert ('note_entry', '-created_at') in indexed_fields


# =============================================================================
# Prescription Model Tests
# =============================================================================

@pytest.mark.tier1
class TestPrescriptionModel:
    """Tests for Prescription model."""

    def test_prescription_creation(self, db):
        """Test creating a prescription with all fields."""
        patient = PatientProfileFactory()
        prescriber = PractitionerProfileFactory()
        encounter = EncounterFactory(patient=patient)

        prescription = Prescription.objects.create(
            patient=patient,
            facility=patient.facility,
            prescribed_by=prescriber,
            encounter=encounter,
            medication_name='Aspirin',
            dosage='81mg',
            route='oral',
            frequency='daily',
            duration_days=30
        )

        assert prescription.medication_name == 'Aspirin'
        assert prescription.dosage == '81mg'
        assert prescription.route == 'oral'
        assert prescription.frequency == 'daily'

    def test_prescription_string_representation(self, db):
        """Test __str__ returns medication and patient."""
        prescription = PrescriptionFactory(
            medication_name='Metformin',
            dosage='500mg'
        )

        str_repr = str(prescription)
        assert 'Metformin' in str_repr
        assert '500mg' in str_repr

    def test_all_route_choices_valid(self, db):
        """Test all route choices can be created."""
        routes = [
            'oral', 'iv', 'im', 'sc', 'topical', 'inhaled',
            'sublingual', 'rectal', 'ophthalmic', 'otic',
            'nasal', 'transdermal', 'other'
        ]

        for route in routes:
            prescription = PrescriptionFactory(route=route)
            assert prescription.route == route

    def test_all_frequency_choices_valid(self, db):
        """Test all frequency choices can be created."""
        frequencies = [
            'once', 'daily', 'bid', 'tid', 'qid', 'q4h',
            'q6h', 'q8h', 'q12h', 'qhs', 'prn', 'stat',
            'weekly', 'other'
        ]

        for frequency in frequencies:
            prescription = PrescriptionFactory(frequency=frequency)
            assert prescription.frequency == frequency

    def test_all_status_choices_valid(self, db):
        """Test all status choices can be created."""
        statuses = ['active', 'completed', 'discontinued', 'on_hold', 'draft']

        for status in statuses:
            prescription = PrescriptionFactory(status=status)
            assert prescription.status == status

    def test_end_date_calculated_from_duration(self, db):
        """Test end_date is calculated from duration_days."""
        start = date.today()
        prescription = PrescriptionFactory(
            start_date=start,
            duration_days=7,
            end_date=None
        )

        assert prescription.end_date == start + timedelta(days=7)

    def test_is_active_property_active(self, db):
        """Test is_active returns True for active prescriptions."""
        prescription = ActivePrescriptionFactory()

        assert prescription.is_active is True

    def test_is_active_property_discontinued(self, db):
        """Test is_active returns False for discontinued prescriptions."""
        prescription = DiscontinuedPrescriptionFactory()

        assert prescription.is_active is False

    def test_is_active_property_expired(self, db):
        """Test is_active returns False for expired prescriptions."""
        prescription = PrescriptionFactory(
            status='active',
            start_date=date.today() - timedelta(days=30),
            end_date=date.today() - timedelta(days=1)
        )

        assert prescription.is_active is False

    def test_days_remaining_property(self, db):
        """Test days_remaining property calculation."""
        prescription = PrescriptionFactory(
            start_date=date.today(),
            end_date=date.today() + timedelta(days=10)
        )

        assert prescription.days_remaining == 10

    def test_days_remaining_property_none_for_ongoing(self, db):
        """Test days_remaining is None for prescriptions without end_date."""
        prescription = PRNPrescriptionFactory(end_date=None)

        assert prescription.days_remaining is None

    def test_days_remaining_property_zero_when_expired(self, db):
        """Test days_remaining is 0 for expired prescriptions."""
        prescription = PrescriptionFactory(
            start_date=date.today() - timedelta(days=10),
            end_date=date.today() - timedelta(days=1)
        )

        assert prescription.days_remaining == 0

    def test_prescription_ordering(self, db):
        """Test prescriptions are ordered by created_at descending."""
        patient = PatientProfileFactory()

        rx1 = PrescriptionFactory(patient=patient)
        rx2 = PrescriptionFactory(patient=patient)
        rx3 = PrescriptionFactory(patient=patient)

        prescriptions = list(Prescription.objects.filter(patient=patient))

        # Most recent should be first
        assert prescriptions[0] == rx3
        assert prescriptions[1] == rx2
        assert prescriptions[2] == rx1

    def test_discontinuation_tracking(self, db):
        """Test prescription discontinuation fields."""
        prescription = DiscontinuedPrescriptionFactory()

        assert prescription.status == 'discontinued'
        assert prescription.discontinued_at is not None
        assert prescription.discontinued_by is not None
        assert prescription.discontinue_reason == 'Adverse reaction'


# =============================================================================
# Model Relationship Tests
# =============================================================================

@pytest.mark.tier1
class TestClinicalNotesRelationships:
    """Tests for relationships between clinical notes models."""

    def test_template_to_entries(self, db):
        """Test template can have multiple entries."""
        template = NoteTemplateFactory()

        NoteEntryFactory(template=template)
        NoteEntryFactory(template=template)
        NoteEntryFactory(template=template)

        assert template.entries.count() == 3

    def test_note_entry_to_versions(self, db):
        """Test note entry can have multiple versions."""
        note, versions = create_note_with_versions(num_versions=5)

        assert note.versions.count() == 5

    def test_patient_to_note_entries(self, db):
        """Test patient can have multiple note entries."""
        patient = PatientProfileFactory()

        NoteEntryFactory(patient=patient)
        NoteEntryFactory(patient=patient)

        assert patient.note_entries.count() == 2

    def test_patient_to_prescriptions(self, db):
        """Test patient can have multiple prescriptions."""
        patient = PatientProfileFactory()

        PrescriptionFactory(patient=patient)
        PrescriptionFactory(patient=patient)
        PrescriptionFactory(patient=patient)

        assert patient.prescriptions.count() == 3

    def test_practitioner_to_note_entries(self, db):
        """Test practitioner can have multiple note entries."""
        practitioner = PractitionerProfileFactory()

        NoteEntryFactory(practitioner=practitioner)
        NoteEntryFactory(practitioner=practitioner)

        assert practitioner.note_entries.count() == 2

    def test_practitioner_to_prescriptions(self, db):
        """Test practitioner can prescribe multiple medications."""
        practitioner = PractitionerProfileFactory()

        PrescriptionFactory(prescribed_by=practitioner)
        PrescriptionFactory(prescribed_by=practitioner)

        assert practitioner.prescriptions.count() == 2

    def test_cascade_delete_template_deletes_entries(self, db):
        """Test deleting template deletes associated entries."""
        template = NoteTemplateFactory()
        entry = NoteEntryFactory(template=template)
        entry_id = entry.id

        template.delete()

        assert not NoteEntry.objects.filter(id=entry_id).exists()

    def test_cascade_delete_entry_deletes_versions(self, db):
        """Test deleting entry deletes associated versions."""
        note, versions = create_note_with_versions(num_versions=3)
        version_ids = [v.id for v in versions]

        note.delete()

        for vid in version_ids:
            assert not NoteEntryVersion.objects.filter(id=vid).exists()


# =============================================================================
# Template Filtering Tests
# =============================================================================

@pytest.mark.tier1
class TestTemplateFiltering:
    """Tests for template filtering and visibility."""

    def test_filter_public_templates(self, db):
        """Test filtering for public templates."""
        NoteTemplateFactory(visibility='public')
        NoteTemplateFactory(visibility='public')
        NoteTemplateFactory(visibility='private')

        public_templates = NoteTemplate.objects.filter(visibility='public')

        assert public_templates.count() == 2

    def test_filter_by_category(self, db):
        """Test filtering templates by category."""
        SOAPNoteTemplateFactory()
        SOAPNoteTemplateFactory()
        NoteTemplateFactory(category='progress')

        soap_templates = NoteTemplate.objects.filter(category='soap')

        assert soap_templates.count() == 2

    def test_filter_active_templates(self, db):
        """Test filtering for active templates."""
        NoteTemplateFactory(is_active=True)
        NoteTemplateFactory(is_active=True)
        NoteTemplateFactory(is_active=False)

        active_templates = NoteTemplate.objects.filter(is_active=True)

        assert active_templates.count() == 2

    def test_filter_by_department(self, db):
        """Test filtering templates by department."""
        NoteTemplateFactory(visibility='department', department='Cardiology')
        NoteTemplateFactory(visibility='department', department='Cardiology')
        NoteTemplateFactory(visibility='department', department='Neurology')

        cardiology_templates = NoteTemplate.objects.filter(department='Cardiology')

        assert cardiology_templates.count() == 2
