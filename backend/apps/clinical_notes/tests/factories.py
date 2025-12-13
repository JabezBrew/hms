"""
Clinical notes test factories.

Factory classes for creating clinical notes test data.
"""
import factory
from datetime import date, timedelta
from django.utils import timezone

from apps.clinical_notes.models import (
    NoteTemplate, NoteEntry, NoteEntryVersion, Prescription
)
from apps.users.tests.factories import (
    UserFactory, DoctorUserFactory, PatientProfileFactory, PractitionerProfileFactory
)


class NoteTemplateFactory(factory.django.DjangoModelFactory):
    """Factory for NoteTemplate model."""

    class Meta:
        model = NoteTemplate

    title = factory.Sequence(lambda n: f'Template {n}')
    description = factory.Faker('sentence')
    is_active = True
    visibility = 'private'
    department = None
    category = 'custom'
    icon = 'file-text'
    estimated_steps = 3
    is_public = False
    created_by = factory.SubFactory(DoctorUserFactory)
    structure = factory.LazyFunction(lambda: {
        'sections': [
            {'name': 'Chief Complaint', 'type': 'textarea', 'required': True},
            {'name': 'Assessment', 'type': 'textarea', 'required': True},
            {'name': 'Plan', 'type': 'textarea', 'required': True},
        ]
    })


class PublicNoteTemplateFactory(NoteTemplateFactory):
    """Factory for public note templates."""

    visibility = 'public'
    is_public = True


class RoleBasedNoteTemplateFactory(NoteTemplateFactory):
    """Factory for role-based note templates."""

    visibility = 'role'


class DepartmentNoteTemplateFactory(NoteTemplateFactory):
    """Factory for department-based note templates."""

    visibility = 'department'
    department = 'Internal Medicine'


class SOAPNoteTemplateFactory(NoteTemplateFactory):
    """Factory for SOAP note templates."""

    title = factory.Sequence(lambda n: f'SOAP Note Template {n}')
    category = 'soap'
    estimated_steps = 4
    structure = factory.LazyFunction(lambda: {
        'sections': [
            {'name': 'Subjective', 'type': 'textarea', 'required': True},
            {'name': 'Objective', 'type': 'textarea', 'required': True},
            {'name': 'Assessment', 'type': 'textarea', 'required': True},
            {'name': 'Plan', 'type': 'textarea', 'required': True},
        ]
    })


class ProgressNoteTemplateFactory(NoteTemplateFactory):
    """Factory for progress note templates."""

    title = factory.Sequence(lambda n: f'Progress Note Template {n}')
    category = 'progress'
    estimated_steps = 3
    structure = factory.LazyFunction(lambda: {
        'sections': [
            {'name': 'Interval History', 'type': 'textarea', 'required': True},
            {'name': 'Assessment', 'type': 'textarea', 'required': True},
            {'name': 'Plan', 'type': 'textarea', 'required': True},
        ]
    })


class ProcedureNoteTemplateFactory(NoteTemplateFactory):
    """Factory for procedure note templates."""

    title = factory.Sequence(lambda n: f'Procedure Note Template {n}')
    category = 'procedure'
    estimated_steps = 5
    structure = factory.LazyFunction(lambda: {
        'sections': [
            {'name': 'Procedure', 'type': 'text', 'required': True},
            {'name': 'Indication', 'type': 'textarea', 'required': True},
            {'name': 'Technique', 'type': 'textarea', 'required': True},
            {'name': 'Findings', 'type': 'textarea', 'required': False},
            {'name': 'Complications', 'type': 'textarea', 'required': True},
        ]
    })


class AdmissionNoteTemplateFactory(NoteTemplateFactory):
    """Factory for admission note templates."""

    title = factory.Sequence(lambda n: f'Admission Note Template {n}')
    category = 'admission'
    estimated_steps = 6


class DischargeNoteTemplateFactory(NoteTemplateFactory):
    """Factory for discharge note templates."""

    title = factory.Sequence(lambda n: f'Discharge Summary Template {n}')
    category = 'discharge'
    estimated_steps = 5


class NursingNoteTemplateFactory(NoteTemplateFactory):
    """Factory for nursing note templates."""

    title = factory.Sequence(lambda n: f'Nursing Note Template {n}')
    category = 'nursing'
    estimated_steps = 3


class ConsultationNoteTemplateFactory(NoteTemplateFactory):
    """Factory for consultation note templates."""

    title = factory.Sequence(lambda n: f'Consultation Note Template {n}')
    category = 'consultation'
    estimated_steps = 5


class SystemNoteTemplateFactory(NoteTemplateFactory):
    """Factory for system (no creator) templates."""

    created_by = None
    visibility = 'public'
    is_public = True


class NoteEntryFactory(factory.django.DjangoModelFactory):
    """Factory for NoteEntry model."""

    class Meta:
        model = NoteEntry

    template = factory.SubFactory(NoteTemplateFactory)
    patient = factory.SubFactory(PatientProfileFactory)
    encounter = factory.SubFactory(
        'apps.nursing.tests.factories.EncounterFactory'
    )
    practitioner = factory.SubFactory(PractitionerProfileFactory)
    composition_fhir_id = None
    data = factory.LazyFunction(lambda: {
        'Chief Complaint': 'Patient presenting with headache',
        'Assessment': 'Tension headache',
        'Plan': 'Rest, OTC pain relievers'
    })
    copied_from = None


class CopiedNoteEntryFactory(NoteEntryFactory):
    """Factory for copied note entries."""

    @factory.lazy_attribute
    def copied_from(self):
        # Create a source note to copy from
        return NoteEntryFactory()


class SOAPNoteEntryFactory(NoteEntryFactory):
    """Factory for SOAP note entries."""

    template = factory.SubFactory(SOAPNoteTemplateFactory)
    data = factory.LazyFunction(lambda: {
        'Subjective': 'Patient reports headache for 2 days',
        'Objective': 'Vitals normal, neurological exam normal',
        'Assessment': 'Tension headache',
        'Plan': 'Rest, ibuprofen PRN'
    })


class NoteEntryVersionFactory(factory.django.DjangoModelFactory):
    """Factory for NoteEntryVersion model."""

    class Meta:
        model = NoteEntryVersion

    note_entry = factory.SubFactory(NoteEntryFactory)
    version_number = factory.Sequence(lambda n: n + 1)
    data = factory.LazyFunction(lambda: {
        'Chief Complaint': 'Original complaint',
        'Assessment': 'Original assessment',
        'Plan': 'Original plan'
    })
    edited_by = factory.SubFactory(DoctorUserFactory)
    edit_reason = factory.Faker('sentence')


class PrescriptionFactory(factory.django.DjangoModelFactory):
    """Factory for Prescription model."""

    class Meta:
        model = Prescription

    patient = factory.SubFactory(PatientProfileFactory)
    prescribed_by = factory.SubFactory(PractitionerProfileFactory)
    medication_name = factory.Faker('sentence', nb_words=2)
    dosage = '500mg'
    route = 'oral'
    frequency = 'daily'
    duration_days = 7
    start_date = factory.LazyFunction(date.today)
    end_date = None  # Will be calculated from duration
    instructions = factory.Faker('sentence')
    reason = factory.Faker('sentence')
    status = 'active'
    encounter = factory.SubFactory(
        'apps.nursing.tests.factories.EncounterFactory'
    )


class ActivePrescriptionFactory(PrescriptionFactory):
    """Factory for active prescriptions."""

    status = 'active'
    start_date = factory.LazyFunction(date.today)
    duration_days = 14


class CompletedPrescriptionFactory(PrescriptionFactory):
    """Factory for completed prescriptions."""

    status = 'completed'
    start_date = factory.LazyFunction(lambda: date.today() - timedelta(days=14))
    duration_days = 7
    end_date = factory.LazyFunction(lambda: date.today() - timedelta(days=7))


class DiscontinuedPrescriptionFactory(PrescriptionFactory):
    """Factory for discontinued prescriptions."""

    status = 'discontinued'
    discontinued_at = factory.LazyFunction(timezone.now)
    discontinued_by = factory.SubFactory(PractitionerProfileFactory)
    discontinue_reason = 'Adverse reaction'


class OnHoldPrescriptionFactory(PrescriptionFactory):
    """Factory for prescriptions on hold."""

    status = 'on_hold'


class PRNPrescriptionFactory(PrescriptionFactory):
    """Factory for PRN (as needed) prescriptions."""

    frequency = 'prn'
    duration_days = None
    end_date = None


class IVPrescriptionFactory(PrescriptionFactory):
    """Factory for IV prescriptions."""

    route = 'iv'
    frequency = 'q6h'


class StatPrescriptionFactory(PrescriptionFactory):
    """Factory for STAT (immediate) prescriptions."""

    frequency = 'stat'
    duration_days = 1


# Helper functions
def create_note_with_versions(num_versions=3, **kwargs):
    """
    Create a note entry with multiple version history.

    Args:
        num_versions: Number of versions to create
        **kwargs: Additional note entry attributes

    Returns:
        Tuple of (NoteEntry, list of NoteEntryVersion)
    """
    note = NoteEntryFactory(**kwargs)
    versions = []

    for i in range(1, num_versions + 1):
        version = NoteEntryVersion.objects.create(
            note_entry=note,
            version_number=i,
            data={'version': i, 'content': f'Version {i} content'},
            edit_reason=f'Edit {i}'
        )
        versions.append(version)

    return note, versions


def create_prescription_set(patient, prescriber, count=5):
    """
    Create a set of prescriptions for a patient.

    Args:
        patient: PatientProfile to prescribe for
        prescriber: PractitionerProfile who prescribes
        count: Number of prescriptions to create

    Returns:
        List of Prescription objects
    """
    prescriptions = []
    medications = [
        ('Aspirin', '81mg', 'oral', 'daily'),
        ('Metformin', '500mg', 'oral', 'bid'),
        ('Lisinopril', '10mg', 'oral', 'daily'),
        ('Omeprazole', '20mg', 'oral', 'daily'),
        ('Atorvastatin', '20mg', 'oral', 'qhs'),
    ]

    for i in range(min(count, len(medications))):
        med, dose, route, freq = medications[i]
        prescription = PrescriptionFactory(
            patient=patient,
            prescribed_by=prescriber,
            medication_name=med,
            dosage=dose,
            route=route,
            frequency=freq
        )
        prescriptions.append(prescription)

    return prescriptions
