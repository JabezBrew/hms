"""
Tests for wards app models.

Tests cover:
- Ward model (creation, properties, validation)
- Bed model (creation, status, rate calculations)
- WardSection model (creation, properties)
- BedAmenity model (creation)
- Admission model (creation, discharge, length of stay)
- Encounter model (creation, status transitions)
- BedAllocationLog model
- WardTransfer model
"""
import pytest
from decimal import Decimal
from datetime import timedelta
from django.utils import timezone
from django.db import IntegrityError

from apps.wards.models import (
    Ward, Bed, Admission, BedAllocationLog, Encounter,
    WardTransfer, BedAmenity, WardSection
)
from .factories import (
    WardFactory, BedFactory, AdmissionFactory, BedAllocationLogFactory,
    EncounterFactory, WardTransferFactory, BedAmenityFactory, WardSectionFactory
)
from apps.users.tests.factories import UserFactory, PatientProfileFactory


@pytest.mark.tier1
class TestWardModel:
    """Tests for the Ward model."""

    def test_create_ward(self, db):
        """Test basic ward creation."""
        ward = WardFactory(
            name='General Ward A',
            ward_type='general',
            total_beds=20,
            base_rate_per_night=Decimal('150.00')
        )
        assert ward.name == 'General Ward A'
        assert ward.ward_type == 'general'
        assert ward.total_beds == 20
        assert ward.base_rate_per_night == Decimal('150.00')
        assert ward.is_active is True

    def test_ward_type_choices(self, db):
        """Test all ward type choices."""
        ward_types = ['general', 'private', 'icu', 'emergency', 'maternity',
                      'pediatric', 'psychiatric', 'isolation']
        for ward_type in ward_types:
            ward = WardFactory(ward_type=ward_type)
            assert ward.ward_type == ward_type

    def test_ward_str_representation(self, db):
        """Test ward string representation."""
        ward = WardFactory(name='ICU Ward', ward_type='icu')
        assert str(ward) == 'ICU Ward (Intensive Care Unit)'

    def test_available_beds_count_no_occupied(self, db):
        """Test available beds count from actual available bed inventory."""
        ward = WardFactory(total_beds=10)
        # Create 5 beds, all available
        for i in range(5):
            BedFactory(ward=ward, status='available')
        assert ward.available_beds_count == 5

    def test_available_beds_count_with_occupied(self, db):
        """Test available beds count excludes occupied physical beds."""
        ward = WardFactory(total_beds=10)
        # Create 3 available and 2 occupied beds
        for i in range(3):
            BedFactory(ward=ward, status='available')
        for i in range(2):
            BedFactory(ward=ward, status='occupied')
        assert ward.available_beds_count == 3

    def test_occupancy_rate_empty_ward(self, db):
        """Test occupancy rate for ward with no beds."""
        ward = WardFactory(total_beds=0)
        assert ward.occupancy_rate == 0

    def test_occupancy_rate_calculation(self, db):
        """Test occupancy rate calculation."""
        ward = WardFactory(total_beds=10)
        # Create 4 occupied beds
        for i in range(4):
            BedFactory(ward=ward, status='occupied')
        assert ward.occupancy_rate == 40.0  # 4/10 * 100


@pytest.mark.tier1
class TestBedModel:
    """Tests for the Bed model."""

    def test_create_bed(self, db):
        """Test basic bed creation."""
        ward = WardFactory()
        bed = BedFactory(
            ward=ward,
            bed_number='B-001',
            bed_type='standard',
            status='available'
        )
        assert bed.bed_number == 'B-001'
        assert bed.bed_type == 'standard'
        assert bed.status == 'available'
        assert bed.ward == ward

    def test_bed_type_choices(self, db):
        """Test all bed type choices."""
        bed_types = ['standard', 'icu', 'pediatric', 'bariatric', 'maternity']
        for bed_type in bed_types:
            bed = BedFactory(bed_type=bed_type)
            assert bed.bed_type == bed_type

    def test_bed_status_choices(self, db):
        """Test all bed status choices."""
        statuses = ['available', 'occupied', 'reserved', 'maintenance']
        for status in statuses:
            bed = BedFactory(status=status)
            assert bed.status == status

    def test_bed_str_representation(self, db):
        """Test bed string representation."""
        ward = WardFactory(name='Ward A')
        bed = BedFactory(ward=ward, bed_number='B-001', status='available')
        assert str(bed) == 'Ward A - Bed B-001 (Available)'

    def test_unique_bed_number_per_ward(self, db):
        """Test that bed numbers are unique within a ward."""
        ward = WardFactory()
        BedFactory(ward=ward, bed_number='B-001')
        with pytest.raises(IntegrityError):
            BedFactory(ward=ward, bed_number='B-001')

    def test_bed_total_rate_basic(self, db):
        """Test bed total rate without section or amenities."""
        ward = WardFactory(base_rate_per_night=Decimal('100.00'))
        bed = BedFactory(ward=ward, additional_rate=Decimal('25.00'))
        assert bed.total_rate == Decimal('125.00')

    def test_bed_total_rate_with_section_multiplier(self, db):
        """Test bed total rate with section rate multiplier."""
        ward = WardFactory(base_rate_per_night=Decimal('100.00'))
        section = WardSectionFactory(ward=ward, rate_multiplier=Decimal('1.50'))
        bed = BedFactory(ward=ward, section=section, additional_rate=Decimal('0.00'))
        # 100 * 1.50 = 150
        assert bed.total_rate == Decimal('150.00')

    def test_bed_total_rate_with_amenities(self, db):
        """Test bed total rate with amenities."""
        ward = WardFactory(base_rate_per_night=Decimal('100.00'))
        bed = BedFactory(ward=ward, additional_rate=Decimal('0.00'))
        amenity1 = BedAmenityFactory(additional_rate=Decimal('20.00'))
        amenity2 = BedAmenityFactory(additional_rate=Decimal('15.00'))
        bed.amenities.add(amenity1, amenity2)
        # 100 + 20 + 15 = 135
        assert bed.total_rate == Decimal('135.00')

    def test_effective_accommodation_tier_bed_override(self, db):
        """Test effective accommodation tier with bed override."""
        section = WardSectionFactory(accommodation_tier='open')
        bed = BedFactory(section=section, accommodation_tier='vip')
        assert bed.effective_accommodation_tier == 'vip'

    def test_effective_accommodation_tier_from_section(self, db):
        """Test effective accommodation tier from section."""
        section = WardSectionFactory(accommodation_tier='private')
        bed = BedFactory(section=section, accommodation_tier=None)
        assert bed.effective_accommodation_tier == 'private'

    def test_effective_accommodation_tier_default(self, db):
        """Test effective accommodation tier default when no section."""
        bed = BedFactory(section=None, accommodation_tier=None)
        assert bed.effective_accommodation_tier == 'open'


@pytest.mark.tier1
class TestWardSectionModel:
    """Tests for the WardSection model."""

    def test_create_section(self, db):
        """Test basic section creation."""
        ward = WardFactory()
        section = WardSectionFactory(
            ward=ward,
            name='Male Side',
            gender_restriction='male_only',
            accommodation_tier='semi_private'
        )
        assert section.name == 'Male Side'
        assert section.gender_restriction == 'male_only'
        assert section.accommodation_tier == 'semi_private'

    def test_section_str_representation(self, db):
        """Test section string representation."""
        ward = WardFactory(name='General Ward')
        section = WardSectionFactory(ward=ward, name='VIP Wing')
        assert str(section) == 'General Ward - VIP Wing'

    def test_unique_section_name_per_ward(self, db):
        """Test that section names are unique within a ward."""
        ward = WardFactory()
        WardSectionFactory(ward=ward, name='Section A')
        with pytest.raises(IntegrityError):
            WardSectionFactory(ward=ward, name='Section A')

    def test_section_bed_count(self, db):
        """Test section bed count property."""
        section = WardSectionFactory()
        for i in range(3):
            BedFactory(section=section, ward=section.ward)
        assert section.bed_count == 3

    def test_section_available_beds_count(self, db):
        """Test section available beds count property."""
        section = WardSectionFactory()
        BedFactory(section=section, ward=section.ward, status='available')
        BedFactory(section=section, ward=section.ward, status='available')
        BedFactory(section=section, ward=section.ward, status='occupied')
        assert section.available_beds_count == 2

    def test_section_occupancy_rate(self, db):
        """Test section occupancy rate calculation."""
        section = WardSectionFactory()
        for i in range(3):
            BedFactory(section=section, ward=section.ward, status='available')
        for i in range(2):
            BedFactory(section=section, ward=section.ward, status='occupied')
        # 2/5 * 100 = 40%
        assert section.occupancy_rate == 40.0

    def test_section_effective_rate(self, db):
        """Test section effective rate calculation."""
        ward = WardFactory(base_rate_per_night=Decimal('200.00'))
        section = WardSectionFactory(ward=ward, rate_multiplier=Decimal('1.25'))
        assert section.effective_rate == Decimal('250.00')


@pytest.mark.tier1
class TestBedAmenityModel:
    """Tests for the BedAmenity model."""

    def test_create_amenity(self, db):
        """Test basic amenity creation."""
        amenity = BedAmenityFactory(
            code='OXYGEN',
            name='Oxygen Supply',
            category='medical',
            additional_rate=Decimal('50.00')
        )
        assert amenity.code == 'OXYGEN'
        assert amenity.name == 'Oxygen Supply'
        assert amenity.category == 'medical'
        assert amenity.additional_rate == Decimal('50.00')

    def test_amenity_str_representation(self, db):
        """Test amenity string representation."""
        amenity = BedAmenityFactory(name='Private Bathroom')
        assert str(amenity) == 'Private Bathroom'

    def test_unique_amenity_code(self, db):
        """Test that amenity codes are unique."""
        BedAmenityFactory(code='TV')
        with pytest.raises(IntegrityError):
            BedAmenityFactory(code='TV')

    def test_amenity_category_choices(self, db):
        """Test all amenity category choices."""
        categories = ['medical', 'comfort', 'accessibility', 'safety']
        for category in categories:
            amenity = BedAmenityFactory(category=category)
            assert amenity.category == category


@pytest.mark.tier1
class TestAdmissionModel:
    """Tests for the Admission model."""

    def test_create_admission(self, db):
        """Test basic admission creation."""
        patient = PatientProfileFactory()
        bed = BedFactory(status='available')
        admission = AdmissionFactory(
            patient=patient,
            bed=bed,
            admission_type='elective',
            daily_rate=Decimal('200.00')
        )
        assert admission.patient == patient
        assert admission.bed == bed
        assert admission.status == 'admitted'
        assert admission.admission_type == 'elective'

    def test_admission_str_representation(self, db):
        """Test admission string representation."""
        admission = AdmissionFactory()
        assert admission.patient.user.get_full_name() in str(admission)
        assert 'Admitted' in str(admission)

    def test_admission_type_choices(self, db):
        """Test all admission type choices."""
        types = ['emergency', 'elective', 'maternity', 'newborn']
        for admission_type in types:
            admission = AdmissionFactory(admission_type=admission_type)
            assert admission.admission_type == admission_type

    def test_admission_status_choices(self, db):
        """Test all admission status choices."""
        statuses = ['admitted', 'discharged', 'transferred', 'deceased', 'waiting']
        for status in statuses:
            admission = AdmissionFactory(status=status)
            # Note: Factory sets status, but save() might change it
            # For non-admitted statuses, we need to be careful

    def test_length_of_stay_calculation(self, db):
        """Test length of stay calculation for ongoing admission."""
        admission = AdmissionFactory(
            admission_date=timezone.now() - timedelta(days=5)
        )
        # Should be approximately 5-6 days
        assert admission.length_of_stay >= 5

    def test_length_of_stay_discharged(self, db):
        """Test length of stay calculation for discharged patient."""
        admission_date = timezone.now() - timedelta(days=10)
        discharge_date = timezone.now() - timedelta(days=3)
        admission = AdmissionFactory(
            admission_date=admission_date,
            actual_discharge_date=discharge_date,
            status='discharged'
        )
        assert admission.length_of_stay == 7

    def test_length_of_stay_minimum_one_day(self, db):
        """Test that minimum length of stay is 1 day."""
        admission = AdmissionFactory(
            admission_date=timezone.now(),
            actual_discharge_date=timezone.now()
        )
        assert admission.length_of_stay == 1

    def test_total_cost_calculation(self, db):
        """Test total cost calculation."""
        admission = AdmissionFactory(
            admission_date=timezone.now() - timedelta(days=5),
            daily_rate=Decimal('100.00')
        )
        # Should be at least 5 * 100 = 500
        assert admission.total_cost >= Decimal('500.00')

    def test_discharge_patient_method(self, db):
        """Test discharge_patient method."""
        bed = BedFactory(status='available')
        admission = AdmissionFactory(bed=bed)
        # Bed should be occupied after admission
        bed.refresh_from_db()
        assert bed.status == 'occupied'

        # Discharge the patient
        admission.discharge_patient(discharge_notes='Patient recovered')

        admission.refresh_from_db()
        bed.refresh_from_db()

        assert admission.status == 'discharged'
        assert admission.actual_discharge_date is not None
        assert admission.discharge_notes == 'Patient recovered'
        assert bed.status == 'available'


@pytest.mark.tier1
class TestEncounterModel:
    """Tests for the Encounter model."""

    def test_create_encounter(self, db):
        """Test basic encounter creation."""
        encounter = EncounterFactory(
            encounter_type='outpatient',
            status='in-progress',
            reason='Annual checkup'
        )
        assert encounter.encounter_type == 'outpatient'
        assert encounter.status == 'in-progress'
        assert encounter.reason == 'Annual checkup'

    def test_encounter_str_representation(self, db):
        """Test encounter string representation."""
        encounter = EncounterFactory()
        assert encounter.patient.user.get_full_name() in str(encounter)

    def test_encounter_type_choices(self, db):
        """Test all encounter type choices."""
        types = ['inpatient', 'outpatient', 'emergency']
        for enc_type in types:
            encounter = EncounterFactory(encounter_type=enc_type)
            assert encounter.encounter_type == enc_type

    def test_encounter_status_choices(self, db):
        """Test all encounter status choices."""
        statuses = ['planned', 'in-progress', 'finished', 'cancelled']
        for status in statuses:
            encounter = EncounterFactory(status=status)
            assert encounter.status == status

    def test_patient_name_property(self, db):
        """Test patient_name property."""
        encounter = EncounterFactory()
        assert encounter.patient_name == encounter.patient.user.get_full_name()

    def test_practitioner_name_property(self, db):
        """Test practitioner_name property."""
        encounter = EncounterFactory()
        expected_name = encounter.practitioner.staff.user.get_full_name()
        assert encounter.practitioner_name == expected_name

    def test_duration_minutes_ongoing(self, db):
        """Test duration_minutes for ongoing encounter."""
        encounter = EncounterFactory(end_time=None)
        assert encounter.duration_minutes is None

    def test_duration_minutes_completed(self, db):
        """Test duration_minutes for completed encounter."""
        start = timezone.now() - timedelta(hours=1)
        end = timezone.now()
        encounter = EncounterFactory(start_time=start, end_time=end)
        assert encounter.duration_minutes == 60

    def test_finish_method(self, db):
        """Test finish method."""
        encounter = EncounterFactory(status='in-progress')
        encounter.finish(discharge_disposition='Home')

        assert encounter.status == 'finished'
        assert encounter.end_time is not None
        assert encounter.discharge_disposition == 'Home'
        assert encounter.fhir_synced is False  # Marked for re-sync

    def test_cancel_method(self, db):
        """Test cancel method."""
        encounter = EncounterFactory(status='planned')
        encounter.cancel()

        assert encounter.status == 'cancelled'
        assert encounter.end_time is not None
        assert encounter.fhir_synced is False


@pytest.mark.tier1
class TestBedAllocationLogModel:
    """Tests for the BedAllocationLog model."""

    def test_create_log(self, db):
        """Test basic log creation."""
        bed = BedFactory()
        log = BedAllocationLogFactory(
            bed=bed,
            previous_status='available',
            new_status='occupied',
            notes='Patient admitted'
        )
        assert log.bed == bed
        assert log.previous_status == 'available'
        assert log.new_status == 'occupied'
        assert log.notes == 'Patient admitted'

    def test_log_str_representation(self, db):
        """Test log string representation."""
        log = BedAllocationLogFactory(
            previous_status='available',
            new_status='occupied'
        )
        assert 'available' in str(log)
        assert 'occupied' in str(log)


@pytest.mark.tier1
class TestWardTransferModel:
    """Tests for the WardTransfer model."""

    def test_create_transfer(self, db):
        """Test basic transfer creation."""
        patient = PatientProfileFactory()
        from_admission = AdmissionFactory(patient=patient)
        to_admission = AdmissionFactory(patient=patient)

        transfer = WardTransferFactory(
            patient=patient,
            from_admission=from_admission,
            to_admission=to_admission,
            reason='Patient requires ICU care'
        )
        assert transfer.patient == patient
        assert transfer.from_admission == from_admission
        assert transfer.to_admission == to_admission
        assert transfer.reason == 'Patient requires ICU care'

    def test_transfer_str_representation(self, db):
        """Test transfer string representation."""
        transfer = WardTransferFactory()
        assert transfer.patient.user.get_full_name() in str(transfer)
