"""
Factory Boy factories for nursing app models.

Provides test data factories for:
- VitalSigns
- NursingTask
- NursingAlert
- MedicationAdministration
- ShiftHandoff
- TreatmentSheetEntry
- SupplyRequest
"""
import factory
from factory import fuzzy
from datetime import datetime, date, timedelta, time
from decimal import Decimal
from django.utils import timezone

from apps.nursing.models import (
    VitalSigns, NursingTask, NursingAlert,
    MedicationAdministration, ShiftHandoff,
    TreatmentSheetEntry, SupplyRequest
)
from apps.users.tests.factories import (
    AdminUserFactory, DoctorUserFactory, NurseUserFactory,
    PatientProfileFactory, PractitionerProfileFactory, StaffFactory
)


# =============================================================================
# Ward-related Factories (needed for nursing tests)
# =============================================================================

class WardFactory(factory.django.DjangoModelFactory):
    """Factory for creating Ward instances."""

    class Meta:
        model = 'wards.Ward'

    name = factory.Sequence(lambda n: f"Ward {n}")
    description = factory.Faker('sentence')
    ward_type = factory.Faker('random_element', elements=[
        'general', 'private', 'icu', 'emergency', 'maternity', 'pediatric'
    ])
    is_active = True
    total_beds = factory.Faker('random_int', min=10, max=50)
    base_rate_per_night = factory.Faker('pydecimal', left_digits=3, right_digits=2, positive=True)

    @factory.lazy_attribute
    def created_by(self):
        from apps.users.models import User
        admin = User.objects.filter(user_type='admin').first()
        if not admin:
            admin = AdminUserFactory()
        return admin

    @factory.lazy_attribute
    def updated_by(self):
        return self.created_by


class BedFactory(factory.django.DjangoModelFactory):
    """Factory for creating Bed instances."""

    class Meta:
        model = 'wards.Bed'

    ward = factory.SubFactory(WardFactory)
    bed_number = factory.Sequence(lambda n: f"B{n:03d}")
    bed_type = 'standard'
    status = 'available'
    additional_rate = Decimal('0.00')


class EncounterFactory(factory.django.DjangoModelFactory):
    """Factory for creating Encounter instances."""

    class Meta:
        model = 'wards.Encounter'

    patient = factory.SubFactory(PatientProfileFactory)
    practitioner = factory.SubFactory(PractitionerProfileFactory)
    encounter_type = 'outpatient'
    status = 'in-progress'
    reason = factory.Faker('sentence')
    location = factory.Faker('city')
    start_time = factory.LazyFunction(timezone.now)

    @factory.lazy_attribute
    def created_by(self):
        from apps.users.models import User
        admin = User.objects.filter(user_type='admin').first()
        if not admin:
            admin = AdminUserFactory()
        return admin


class AdmissionFactory(factory.django.DjangoModelFactory):
    """Factory for creating Admission instances."""

    class Meta:
        model = 'wards.Admission'

    patient = factory.SubFactory(PatientProfileFactory)
    bed = factory.SubFactory(BedFactory)
    admission_date = factory.LazyFunction(timezone.now)
    status = 'admitted'
    admission_type = 'elective'
    daily_rate = factory.Faker('pydecimal', left_digits=3, right_digits=2, positive=True)

    @factory.lazy_attribute
    def created_by(self):
        from apps.users.models import User
        admin = User.objects.filter(user_type='admin').first()
        if not admin:
            admin = AdminUserFactory()
        return admin

    @factory.lazy_attribute
    def updated_by(self):
        return self.created_by


# =============================================================================
# Vital Signs Factories
# =============================================================================

class VitalSignsFactory(factory.django.DjangoModelFactory):
    """Factory for creating VitalSigns instances."""

    class Meta:
        model = VitalSigns

    patient = factory.SubFactory(PatientProfileFactory)
    recorded_by = factory.SubFactory(PractitionerProfileFactory)
    encounter = factory.SubFactory(EncounterFactory)

    # Normal vital sign values
    temperature = factory.Faker('pydecimal', left_digits=2, right_digits=1, min_value=36.0, max_value=37.5)
    heart_rate = factory.Faker('random_int', min=60, max=100)
    blood_pressure_systolic = factory.Faker('random_int', min=100, max=140)
    blood_pressure_diastolic = factory.Faker('random_int', min=60, max=90)
    respiratory_rate = factory.Faker('random_int', min=12, max=20)
    oxygen_saturation = factory.Faker('random_int', min=95, max=100)
    pain_level = factory.Faker('random_int', min=0, max=3)

    recorded_at = factory.LazyFunction(timezone.now)
    is_critical = False


class CriticalVitalSignsFactory(VitalSignsFactory):
    """Factory for creating VitalSigns with critical values."""

    # Critical values that should trigger alerts
    temperature = Decimal('40.0')  # High fever
    heart_rate = 130  # Tachycardia
    blood_pressure_systolic = 185  # Hypertensive
    oxygen_saturation = 88  # Hypoxemia

    is_critical = True


# =============================================================================
# Nursing Task Factories
# =============================================================================

class NursingTaskFactory(factory.django.DjangoModelFactory):
    """Factory for creating NursingTask instances."""

    class Meta:
        model = NursingTask

    patient = factory.SubFactory(PatientProfileFactory)
    task_type = factory.Faker('random_element', elements=[
        'medication', 'assessment', 'vitals', 'wound_care',
        'hygiene', 'nutrition', 'mobility', 'documentation', 'other'
    ])
    description = factory.Faker('paragraph')
    scheduled_time = factory.LazyFunction(
        lambda: timezone.now() + timedelta(hours=1)
    )
    assigned_to = factory.SubFactory(PractitionerProfileFactory)
    priority = 'medium'
    status = 'pending'

    @factory.lazy_attribute
    def created_by(self):
        from apps.users.models import User
        admin = User.objects.filter(user_type='admin').first()
        if not admin:
            admin = AdminUserFactory()
        return admin


class OverdueNursingTaskFactory(NursingTaskFactory):
    """Factory for creating overdue NursingTask instances."""

    scheduled_time = factory.LazyFunction(
        lambda: timezone.now() - timedelta(hours=2)
    )
    status = 'overdue'


class CompletedNursingTaskFactory(NursingTaskFactory):
    """Factory for creating completed NursingTask instances."""

    status = 'completed'
    completed_time = factory.LazyFunction(timezone.now)
    completed_by = factory.SubFactory(PractitionerProfileFactory)
    completion_notes = factory.Faker('sentence')


# =============================================================================
# Nursing Alert Factories
# =============================================================================

class NursingAlertFactory(factory.django.DjangoModelFactory):
    """Factory for creating NursingAlert instances."""

    class Meta:
        model = NursingAlert

    patient = factory.SubFactory(PatientProfileFactory)
    alert_type = factory.Faker('random_element', elements=[
        'vital_signs', 'medication', 'task_overdue',
        'patient_fall', 'deterioration', 'equipment', 'other'
    ])
    severity = factory.Faker('random_element', elements=[
        'low', 'medium', 'high', 'critical'
    ])
    message = factory.Faker('paragraph')
    is_acknowledged = False


class CriticalAlertFactory(NursingAlertFactory):
    """Factory for creating critical NursingAlert instances."""

    alert_type = 'vital_signs'
    severity = 'critical'
    message = 'Critical vital signs detected'


class AcknowledgedAlertFactory(NursingAlertFactory):
    """Factory for creating acknowledged NursingAlert instances."""

    is_acknowledged = True
    acknowledged_by = factory.SubFactory(PractitionerProfileFactory)
    acknowledged_at = factory.LazyFunction(timezone.now)
    resolution_notes = factory.Faker('sentence')


# =============================================================================
# Medication Administration Factories
# =============================================================================

class MedicationAdministrationFactory(factory.django.DjangoModelFactory):
    """Factory for creating MedicationAdministration instances."""

    class Meta:
        model = MedicationAdministration

    patient = factory.SubFactory(PatientProfileFactory)
    medication_name = factory.Faker('random_element', elements=[
        'Paracetamol', 'Amoxicillin', 'Omeprazole', 'Metformin',
        'Atenolol', 'Lisinopril', 'Aspirin', 'Ibuprofen'
    ])
    dosage = factory.Faker('random_element', elements=[
        '500mg', '250mg', '100mg', '10mg', '5mg', '20mg'
    ])
    route = factory.Faker('random_element', elements=[
        'Oral', 'IV', 'IM', 'SC', 'Topical', 'Rectal'
    ])
    frequency = factory.Faker('random_element', elements=[
        'daily', 'bid', 'tid', 'qid', 'q6h', 'q8h', 'prn'
    ])

    scheduled_time = factory.LazyFunction(
        lambda: timezone.now() + timedelta(hours=1)
    )
    status = 'scheduled'
    prescribed_by = factory.SubFactory(PractitionerProfileFactory)
    is_dispensed = False

    @factory.lazy_attribute
    def created_by(self):
        from apps.users.models import User
        admin = User.objects.filter(user_type='admin').first()
        if not admin:
            admin = AdminUserFactory()
        return admin


class AdministeredMedicationFactory(MedicationAdministrationFactory):
    """Factory for creating administered medication records."""

    status = 'administered'
    administered_time = factory.LazyFunction(timezone.now)
    administered_by = factory.SubFactory(PractitionerProfileFactory)
    administration_notes = factory.Faker('sentence')
    is_dispensed = True


class OverdueMedicationFactory(MedicationAdministrationFactory):
    """Factory for creating overdue medication records."""

    scheduled_time = factory.LazyFunction(
        lambda: timezone.now() - timedelta(hours=2)
    )
    status = 'scheduled'


# =============================================================================
# Shift Handoff Factories
# =============================================================================

class ShiftHandoffFactory(factory.django.DjangoModelFactory):
    """Factory for creating ShiftHandoff instances."""

    class Meta:
        model = ShiftHandoff

    patient = factory.SubFactory(PatientProfileFactory)
    shift_date = factory.LazyFunction(lambda: date.today())
    shift_type = factory.Faker('random_element', elements=['day', 'evening', 'night'])
    from_nurse = factory.SubFactory(PractitionerProfileFactory)
    to_nurse = factory.SubFactory(PractitionerProfileFactory)

    patient_condition = factory.Faker('paragraph')
    ongoing_issues = factory.Faker('sentence')
    pending_tasks = factory.Faker('sentence')
    medication_changes = factory.Faker('sentence')
    key_events = factory.Faker('sentence')
    care_plan_updates = factory.Faker('sentence')
    family_updates = factory.Faker('sentence')

    @factory.lazy_attribute
    def created_by(self):
        from apps.users.models import User
        admin = User.objects.filter(user_type='admin').first()
        if not admin:
            admin = AdminUserFactory()
        return admin


# =============================================================================
# Treatment Sheet Entry Factories
# =============================================================================

class TreatmentSheetEntryFactory(factory.django.DjangoModelFactory):
    """Factory for creating TreatmentSheetEntry instances."""

    class Meta:
        model = TreatmentSheetEntry

    patient = factory.SubFactory(PatientProfileFactory)
    admission = factory.SubFactory(AdmissionFactory)
    encounter = factory.SubFactory(EncounterFactory)

    medication_name = factory.Faker('random_element', elements=[
        'Paracetamol', 'Amoxicillin', 'Omeprazole', 'Metformin'
    ])
    dosage = factory.Faker('random_element', elements=[
        '500mg', '250mg', '100mg', '10mg'
    ])
    route = factory.Faker('random_element', elements=['Oral', 'IV', 'IM', 'SC'])
    frequency = factory.Faker('random_element', elements=[
        'daily', 'bid', 'tid', 'qid'
    ])

    start_datetime = factory.LazyFunction(timezone.now)
    duration_days = factory.Faker('random_int', min=3, max=14)
    status = 'active'
    ordered_by = factory.SubFactory(PractitionerProfileFactory)

    total_doses_ordered = 0
    total_doses_dispensed = 0
    total_doses_administered = 0

    @factory.lazy_attribute
    def created_by(self):
        from apps.users.models import User
        admin = User.objects.filter(user_type='admin').first()
        if not admin:
            admin = AdminUserFactory()
        return admin


# =============================================================================
# Supply Request Factories
# =============================================================================

class SupplyRequestFactory(factory.django.DjangoModelFactory):
    """Factory for creating SupplyRequest instances."""

    class Meta:
        model = SupplyRequest

    treatment_entry = factory.SubFactory(TreatmentSheetEntryFactory)
    quantity_requested = factory.Faker('random_int', min=5, max=20)
    status = 'pending'
    requested_by = factory.SubFactory(PractitionerProfileFactory)
    notes = factory.Faker('sentence')


class DispensedSupplyRequestFactory(SupplyRequestFactory):
    """Factory for creating dispensed supply requests."""

    status = 'dispensed'
    quantity_dispensed = factory.SelfAttribute('quantity_requested')
    dispensed_at = factory.LazyFunction(timezone.now)

    @factory.lazy_attribute
    def dispensed_by(self):
        from apps.users.models import User
        admin = User.objects.filter(user_type='admin').first()
        if not admin:
            admin = AdminUserFactory()
        return admin


# =============================================================================
# Batch Creation Helpers
# =============================================================================

def create_patient_with_vitals(count=5, include_critical=False):
    """Create a patient with multiple vital sign records."""
    patient = PatientProfileFactory()
    encounter = EncounterFactory(patient=patient)

    vitals = [VitalSignsFactory(patient=patient, encounter=encounter) for _ in range(count)]

    if include_critical:
        critical = CriticalVitalSignsFactory(patient=patient, encounter=encounter)
        vitals.append(critical)

    return patient, vitals


def create_patient_with_medications(count=3, include_overdue=False):
    """Create a patient with medication administration records."""
    patient = PatientProfileFactory()

    meds = [MedicationAdministrationFactory(patient=patient) for _ in range(count)]

    if include_overdue:
        overdue = OverdueMedicationFactory(patient=patient)
        meds.append(overdue)

    return patient, meds


def create_nursing_shift_data(patient=None):
    """Create comprehensive nursing shift data for a patient."""
    if patient is None:
        patient = PatientProfileFactory()

    encounter = EncounterFactory(patient=patient)

    return {
        'patient': patient,
        'vitals': [VitalSignsFactory(patient=patient, encounter=encounter) for _ in range(3)],
        'tasks': [NursingTaskFactory(patient=patient) for _ in range(2)],
        'medications': [MedicationAdministrationFactory(patient=patient) for _ in range(2)],
        'alerts': [NursingAlertFactory(patient=patient)],
    }
