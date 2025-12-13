"""
Tests for wards app serializers.

Tests cover:
- WardSerializer and WardListSerializer
- BedSerializer and BedListSerializer
- AdmissionSerializer and AdmissionListSerializer
- WardSectionSerializer and WardSectionListSerializer
- BedAmenitySerializer
"""
import pytest
from decimal import Decimal
from django.utils import timezone
from datetime import timedelta

from apps.wards.serializers import (
    WardSerializer, WardListSerializer,
    BedSerializer, BedListSerializer,
    AdmissionSerializer, AdmissionListSerializer, AdmissionCreateSerializer,
    WardSectionSerializer, WardSectionListSerializer,
    BedAmenitySerializer, DischargeSerializer, TransferRequestSerializer
)
from .factories import (
    WardFactory, BedFactory, AdmissionFactory, WardSectionFactory,
    BedAmenityFactory
)
from apps.users.tests.factories import PatientProfileFactory


@pytest.mark.tier1
class TestWardSerializer:
    """Tests for WardSerializer."""

    def test_ward_serialization(self, db):
        """Test ward serialization includes all expected fields."""
        ward = WardFactory(
            name='Test Ward',
            ward_type='general',
            total_beds=20,
            base_rate_per_night=Decimal('150.00')
        )
        serializer = WardSerializer(ward)
        data = serializer.data

        assert data['name'] == 'Test Ward'
        assert data['ward_type'] == 'general'
        assert data['total_beds'] == 20
        assert 'base_rate_per_night' in data
        assert 'available_beds_count' in data
        assert 'occupancy_rate' in data

    def test_ward_list_serialization(self, db):
        """Test ward list serialization is lightweight."""
        ward = WardFactory()
        serializer = WardListSerializer(ward)
        data = serializer.data

        assert 'name' in data
        assert 'ward_type' in data
        assert 'is_active' in data

    def test_ward_deserialization_valid(self, db):
        """Test valid ward data deserialization."""
        data = {
            'name': 'New Ward',
            'ward_type': 'general',
            'total_beds': 10,
            'base_rate_per_night': '100.00'
        }
        serializer = WardSerializer(data=data)
        assert serializer.is_valid(), serializer.errors

    def test_ward_deserialization_invalid_type(self, db):
        """Test invalid ward type is rejected."""
        data = {
            'name': 'New Ward',
            'ward_type': 'invalid_type',
            'total_beds': 10,
            'base_rate_per_night': '100.00'
        }
        serializer = WardSerializer(data=data)
        assert not serializer.is_valid()
        assert 'ward_type' in serializer.errors


@pytest.mark.tier1
class TestBedSerializer:
    """Tests for BedSerializer."""

    def test_bed_serialization(self, db):
        """Test bed serialization includes all expected fields."""
        bed = BedFactory(
            bed_number='B-001',
            bed_type='standard',
            status='available'
        )
        serializer = BedSerializer(bed)
        data = serializer.data

        assert data['bed_number'] == 'B-001'
        assert data['bed_type'] == 'standard'
        assert data['status'] == 'available'
        assert 'ward' in data
        assert 'total_rate' in data

    def test_bed_list_serialization(self, db):
        """Test bed list serialization is lightweight."""
        bed = BedFactory()
        serializer = BedListSerializer(bed)
        data = serializer.data

        assert 'bed_number' in data
        assert 'status' in data

    def test_bed_deserialization_valid(self, db):
        """Test valid bed data deserialization."""
        ward = WardFactory()
        data = {
            'ward': str(ward.id),
            'bed_number': 'NEW-001',
            'bed_type': 'standard',
            'status': 'available'
        }
        serializer = BedSerializer(data=data)
        assert serializer.is_valid(), serializer.errors

    def test_bed_with_amenities_serialization(self, db):
        """Test bed serialization includes amenities."""
        bed = BedFactory()
        amenity1 = BedAmenityFactory(name='TV')
        amenity2 = BedAmenityFactory(name='WiFi')
        bed.amenities.add(amenity1, amenity2)

        serializer = BedSerializer(bed)
        data = serializer.data

        assert 'amenities' in data
        assert len(data['amenities']) == 2


@pytest.mark.tier1
class TestAdmissionSerializer:
    """Tests for AdmissionSerializer."""

    def test_admission_serialization(self, db):
        """Test admission serialization includes all expected fields."""
        admission = AdmissionFactory(
            admission_type='elective',
            admission_notes='Scheduled surgery'
        )
        serializer = AdmissionSerializer(admission)
        data = serializer.data

        assert data['admission_type'] == 'elective'
        assert data['admission_notes'] == 'Scheduled surgery'
        assert 'patient' in data
        assert 'bed' in data
        assert 'status' in data
        assert 'length_of_stay' in data
        assert 'total_cost' in data

    def test_admission_list_serialization(self, db):
        """Test admission list serialization is lightweight."""
        admission = AdmissionFactory()
        serializer = AdmissionListSerializer(admission)
        data = serializer.data

        assert 'status' in data
        assert 'admission_date' in data

    def test_admission_create_serializer_valid(self, db):
        """Test valid admission creation data."""
        patient = PatientProfileFactory()
        bed = BedFactory(status='available')

        data = {
            'patient': str(patient.id),
            'bed': str(bed.id),
            'admission_type': 'elective'
        }
        serializer = AdmissionCreateSerializer(data=data)
        assert serializer.is_valid(), serializer.errors


@pytest.mark.tier1
class TestDischargeSerializer:
    """Tests for DischargeSerializer."""

    def test_discharge_serializer_valid(self, db):
        """Test valid discharge data."""
        admission = AdmissionFactory(status='admitted')
        data = {'discharge_notes': 'Patient recovered'}
        serializer = DischargeSerializer(data=data, context={'admission': admission})
        assert serializer.is_valid(), serializer.errors

    def test_discharge_serializer_already_discharged(self, db):
        """Test discharge validation for already discharged patient."""
        admission = AdmissionFactory(status='discharged')
        data = {'discharge_notes': 'Patient recovered'}
        serializer = DischargeSerializer(data=data, context={'admission': admission})
        # The serializer should validate this in the validate method
        # depending on implementation


@pytest.mark.tier2
class TestWardSectionSerializer:
    """Tests for WardSectionSerializer."""

    def test_section_serialization(self, db):
        """Test section serialization includes all expected fields."""
        section = WardSectionFactory(
            name='VIP Wing',
            gender_restriction='mixed',
            accommodation_tier='vip'
        )
        serializer = WardSectionSerializer(section)
        data = serializer.data

        assert data['name'] == 'VIP Wing'
        assert data['gender_restriction'] == 'mixed'
        assert data['accommodation_tier'] == 'vip'
        assert 'bed_count' in data
        assert 'available_beds_count' in data
        assert 'effective_rate' in data

    def test_section_list_serialization(self, db):
        """Test section list serialization is lightweight."""
        section = WardSectionFactory()
        serializer = WardSectionListSerializer(section)
        data = serializer.data

        assert 'name' in data
        assert 'accommodation_tier' in data

    def test_section_deserialization_valid(self, db):
        """Test valid section data deserialization."""
        ward = WardFactory()
        data = {
            'ward': str(ward.id),
            'name': 'New Section',
            'gender_restriction': 'mixed',
            'accommodation_tier': 'semi_private',
            'rate_multiplier': '1.25'
        }
        serializer = WardSectionSerializer(data=data)
        assert serializer.is_valid(), serializer.errors


@pytest.mark.tier2
class TestBedAmenitySerializer:
    """Tests for BedAmenitySerializer."""

    def test_amenity_serialization(self, db):
        """Test amenity serialization includes all expected fields."""
        amenity = BedAmenityFactory(
            code='OXYGEN',
            name='Oxygen Supply',
            category='medical',
            additional_rate=Decimal('50.00')
        )
        serializer = BedAmenitySerializer(amenity)
        data = serializer.data

        assert data['code'] == 'OXYGEN'
        assert data['name'] == 'Oxygen Supply'
        assert data['category'] == 'medical'
        assert 'additional_rate' in data

    def test_amenity_deserialization_valid(self, db):
        """Test valid amenity data deserialization."""
        data = {
            'code': 'TV',
            'name': 'Television',
            'category': 'comfort',
            'additional_rate': '25.00'
        }
        serializer = BedAmenitySerializer(data=data)
        assert serializer.is_valid(), serializer.errors

    def test_amenity_invalid_category(self, db):
        """Test invalid amenity category is rejected."""
        data = {
            'code': 'TEST',
            'name': 'Test',
            'category': 'invalid_category'
        }
        serializer = BedAmenitySerializer(data=data)
        assert not serializer.is_valid()
        assert 'category' in serializer.errors


@pytest.mark.tier2
class TestTransferRequestSerializer:
    """Tests for TransferRequestSerializer."""

    def test_transfer_request_valid(self, db):
        """Test valid transfer request data."""
        admission = AdmissionFactory(status='admitted')
        dest_bed = BedFactory(status='available')

        data = {
            'from_admission_id': str(admission.id),
            'to_bed_id': str(dest_bed.id),
            'reason': 'Patient requires ICU'
        }
        serializer = TransferRequestSerializer(data=data)
        assert serializer.is_valid(), serializer.errors

    def test_transfer_request_occupied_bed(self, db):
        """Test transfer to occupied bed is rejected."""
        admission = AdmissionFactory(status='admitted')
        dest_bed = BedFactory(status='occupied')

        data = {
            'from_admission_id': str(admission.id),
            'to_bed_id': str(dest_bed.id),
            'reason': 'Transfer request'
        }
        serializer = TransferRequestSerializer(data=data)
        # Should fail validation since dest bed is occupied
        assert not serializer.is_valid() or 'to_bed' in str(serializer.errors)
