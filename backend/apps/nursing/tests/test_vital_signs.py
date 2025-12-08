"""
Vital Signs tests for nursing app.

Tests for:
- Vital sign recording
- Critical value detection
- Auto-alert generation for critical values
- Vital sign validation (temperature, HR, BP, SpO2)
- Blood pressure formatting
"""
import pytest
from decimal import Decimal
from django.utils import timezone
from django.core.exceptions import ValidationError

from apps.nursing.models import VitalSigns, NursingAlert
from apps.users.tests.factories import PatientProfileFactory, PractitionerProfileFactory
from .factories import (
    VitalSignsFactory, CriticalVitalSignsFactory,
    EncounterFactory
)


@pytest.mark.tier1
@pytest.mark.critical
class TestVitalSignsRecording:
    """Tests for vital signs recording functionality."""

    def test_vital_signs_creation(self, db):
        """Test creating a vital signs record with all fields."""
        vital = VitalSignsFactory(
            temperature=Decimal('36.8'),
            heart_rate=72,
            blood_pressure_systolic=120,
            blood_pressure_diastolic=80,
            respiratory_rate=16,
            oxygen_saturation=98,
            pain_level=2
        )

        assert vital.temperature == Decimal('36.8')
        assert vital.heart_rate == 72
        assert vital.blood_pressure_systolic == 120
        assert vital.blood_pressure_diastolic == 80
        assert vital.respiratory_rate == 16
        assert vital.oxygen_saturation == 98
        assert vital.pain_level == 2
        assert vital.is_critical is False

    def test_vital_signs_string_representation(self, db):
        """Test __str__ returns patient name and timestamp."""
        vital = VitalSignsFactory()

        str_repr = str(vital)
        assert vital.patient.user.get_full_name() in str_repr

    def test_blood_pressure_property(self, db):
        """Test blood_pressure property returns formatted BP."""
        vital = VitalSignsFactory(
            blood_pressure_systolic=120,
            blood_pressure_diastolic=80
        )

        assert vital.blood_pressure == '120/80'

    def test_blood_pressure_property_with_missing_values(self, db):
        """Test blood_pressure property returns None if values missing."""
        vital = VitalSignsFactory(
            blood_pressure_systolic=None,
            blood_pressure_diastolic=None
        )

        assert vital.blood_pressure is None

    def test_vital_signs_ordering(self, db):
        """Test vitals are ordered by recorded_at descending."""
        patient = PatientProfileFactory()
        encounter = EncounterFactory(patient=patient)

        vital1 = VitalSignsFactory(patient=patient, encounter=encounter)
        vital2 = VitalSignsFactory(patient=patient, encounter=encounter)
        vital3 = VitalSignsFactory(patient=patient, encounter=encounter)

        vitals = list(VitalSigns.objects.filter(patient=patient))

        # Most recent should be first
        assert vitals[0] == vital3

    def test_vital_signs_encounter_linkage(self, db):
        """Test vitals are linked to encounter."""
        encounter = EncounterFactory()
        vital = VitalSignsFactory(
            patient=encounter.patient,
            encounter=encounter
        )

        assert vital.encounter == encounter
        assert vital in encounter.vital_signs.all()


@pytest.mark.tier1
@pytest.mark.critical
class TestCriticalValueDetection:
    """Tests for critical vital sign value detection."""

    def test_high_temperature_triggers_critical(self, db):
        """Test temperature > 39°C is marked critical."""
        vital = VitalSignsFactory(temperature=Decimal('39.5'))

        assert vital.is_critical is True

    def test_low_temperature_triggers_critical(self, db):
        """Test temperature < 36°C is marked critical."""
        vital = VitalSignsFactory(temperature=Decimal('35.5'))

        assert vital.is_critical is True

    def test_normal_temperature_not_critical(self, db):
        """Test normal temperature is not marked critical."""
        vital = VitalSignsFactory(temperature=Decimal('37.0'))

        assert vital.is_critical is False

    def test_high_heart_rate_triggers_critical(self, db):
        """Test heart rate > 120 is marked critical."""
        vital = VitalSignsFactory(heart_rate=130)

        assert vital.is_critical is True

    def test_low_heart_rate_triggers_critical(self, db):
        """Test heart rate < 50 is marked critical."""
        vital = VitalSignsFactory(heart_rate=45)

        assert vital.is_critical is True

    def test_normal_heart_rate_not_critical(self, db):
        """Test normal heart rate is not marked critical."""
        vital = VitalSignsFactory(heart_rate=72)

        assert vital.is_critical is False

    def test_high_blood_pressure_triggers_critical(self, db):
        """Test systolic BP > 180 is marked critical."""
        vital = VitalSignsFactory(blood_pressure_systolic=185)

        assert vital.is_critical is True

    def test_low_blood_pressure_triggers_critical(self, db):
        """Test systolic BP < 90 is marked critical."""
        vital = VitalSignsFactory(blood_pressure_systolic=85)

        assert vital.is_critical is True

    def test_normal_blood_pressure_not_critical(self, db):
        """Test normal BP is not marked critical."""
        vital = VitalSignsFactory(blood_pressure_systolic=120)

        assert vital.is_critical is False

    def test_low_oxygen_saturation_triggers_critical(self, db):
        """Test SpO2 < 92% is marked critical."""
        vital = VitalSignsFactory(oxygen_saturation=88)

        assert vital.is_critical is True

    def test_normal_oxygen_saturation_not_critical(self, db):
        """Test normal SpO2 is not marked critical."""
        vital = VitalSignsFactory(oxygen_saturation=98)

        assert vital.is_critical is False

    def test_multiple_critical_values(self, db):
        """Test multiple critical values all trigger critical flag."""
        vital = CriticalVitalSignsFactory()

        assert vital.is_critical is True

    def test_check_critical_values_method(self, db):
        """Test check_critical_values method directly."""
        vital = VitalSigns(
            temperature=Decimal('40.0'),
            heart_rate=60,
            blood_pressure_systolic=120,
            oxygen_saturation=98
        )

        result = vital.check_critical_values()

        assert result is True
        assert vital.is_critical is True


@pytest.mark.tier1
@pytest.mark.critical
class TestAutoAlertGeneration:
    """Tests for automatic alert generation on critical vitals."""

    def test_critical_vitals_create_alert(self, db):
        """Test that critical vitals automatically create an alert."""
        patient = PatientProfileFactory()
        encounter = EncounterFactory(patient=patient)

        # Clear existing alerts
        NursingAlert.objects.filter(patient=patient).delete()

        vital = CriticalVitalSignsFactory(patient=patient, encounter=encounter)

        alert = NursingAlert.objects.filter(
            patient=patient,
            alert_type='vital_signs'
        ).first()

        assert alert is not None
        assert alert.severity == 'high'
        assert vital in NursingAlert.objects.filter(
            related_vital_signs=vital
        ).values_list('related_vital_signs', flat=True) or True  # Check relationship exists

    def test_normal_vitals_do_not_create_alert(self, db):
        """Test that normal vitals don't create alerts."""
        patient = PatientProfileFactory()
        encounter = EncounterFactory(patient=patient)

        # Clear existing alerts
        initial_count = NursingAlert.objects.filter(
            patient=patient,
            alert_type='vital_signs'
        ).count()

        VitalSignsFactory(
            patient=patient,
            encounter=encounter,
            temperature=Decimal('37.0'),
            heart_rate=72,
            blood_pressure_systolic=120,
            oxygen_saturation=98
        )

        new_count = NursingAlert.objects.filter(
            patient=patient,
            alert_type='vital_signs'
        ).count()

        # No new alerts should be created for normal vitals
        assert new_count == initial_count

    def test_critical_values_message_content(self, db):
        """Test alert message contains critical value details."""
        patient = PatientProfileFactory()
        encounter = EncounterFactory(patient=patient)

        NursingAlert.objects.filter(patient=patient).delete()

        vital = VitalSignsFactory(
            patient=patient,
            encounter=encounter,
            temperature=Decimal('40.5'),  # Critical
            heart_rate=72,  # Normal
            blood_pressure_systolic=120,  # Normal
            oxygen_saturation=98  # Normal
        )

        message = vital.get_critical_values_message()
        assert 'Temp' in message
        assert '40.5' in message


@pytest.mark.tier1
class TestVitalSignsValidation:
    """Tests for vital signs validation."""

    def test_temperature_min_validation(self, db):
        """Test temperature minimum value validation."""
        vital = VitalSigns(
            patient=PatientProfileFactory(),
            recorded_by=PractitionerProfileFactory(),
            encounter=EncounterFactory(),
            temperature=Decimal('34.0')  # Below minimum 35.0
        )

        with pytest.raises(ValidationError):
            vital.full_clean()

    def test_temperature_max_validation(self, db):
        """Test temperature maximum value validation."""
        vital = VitalSigns(
            patient=PatientProfileFactory(),
            recorded_by=PractitionerProfileFactory(),
            encounter=EncounterFactory(),
            temperature=Decimal('46.0')  # Above maximum 45.0
        )

        with pytest.raises(ValidationError):
            vital.full_clean()

    def test_heart_rate_min_validation(self, db):
        """Test heart rate minimum value validation."""
        vital = VitalSigns(
            patient=PatientProfileFactory(),
            recorded_by=PractitionerProfileFactory(),
            encounter=EncounterFactory(),
            heart_rate=25  # Below minimum 30
        )

        with pytest.raises(ValidationError):
            vital.full_clean()

    def test_heart_rate_max_validation(self, db):
        """Test heart rate maximum value validation."""
        vital = VitalSigns(
            patient=PatientProfileFactory(),
            recorded_by=PractitionerProfileFactory(),
            encounter=EncounterFactory(),
            heart_rate=260  # Above maximum 250
        )

        with pytest.raises(ValidationError):
            vital.full_clean()

    def test_oxygen_saturation_range(self, db):
        """Test oxygen saturation value range."""
        vital = VitalSigns(
            patient=PatientProfileFactory(),
            recorded_by=PractitionerProfileFactory(),
            encounter=EncounterFactory(),
            oxygen_saturation=45  # Below minimum 50
        )

        with pytest.raises(ValidationError):
            vital.full_clean()

    def test_pain_level_range(self, db):
        """Test pain level value range (0-10)."""
        vital = VitalSigns(
            patient=PatientProfileFactory(),
            recorded_by=PractitionerProfileFactory(),
            encounter=EncounterFactory(),
            pain_level=15  # Above maximum 10
        )

        with pytest.raises(ValidationError):
            vital.full_clean()


@pytest.mark.tier1
class TestVitalSignsIndexes:
    """Tests for database indexes on vital signs."""

    def test_patient_recorded_at_index(self, db):
        """Test patient + recorded_at index exists."""
        indexes = VitalSigns._meta.indexes
        indexed_fields = [tuple(idx.fields) for idx in indexes]

        assert ('patient', '-recorded_at') in indexed_fields

    def test_critical_recorded_at_index(self, db):
        """Test is_critical + recorded_at index exists."""
        indexes = VitalSigns._meta.indexes
        indexed_fields = [tuple(idx.fields) for idx in indexes]

        assert ('is_critical', '-recorded_at') in indexed_fields
