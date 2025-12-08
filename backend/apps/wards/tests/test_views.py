"""
Tests for wards app API views.

Tests cover:
- WardViewSet (CRUD, beds action, admissions action, analytics)
- BedViewSet (CRUD, available action)
- AdmissionViewSet (CRUD, discharge action)
- WardSectionViewSet (CRUD, beds action)
- BedAmenityViewSet (CRUD)
- WardTransferViewSet (CRUD, request_transfer action)

Note: All endpoints are under /api/wards/ prefix
"""
import pytest
from decimal import Decimal
from datetime import timedelta
from django.utils import timezone
from rest_framework import status

from apps.wards.models import Ward, Bed, Admission, WardSection, BedAmenity
from .factories import (
    WardFactory, BedFactory, AdmissionFactory, WardSectionFactory,
    BedAmenityFactory, EncounterFactory
)
from apps.users.tests.factories import PatientProfileFactory, PractitionerProfileFactory


# Base URL prefix for wards app
BASE_URL = '/api/wards'


@pytest.mark.tier1
class TestWardViewSet:
    """Tests for WardViewSet API endpoints."""

    def test_list_wards(self, admin_client, db):
        """Test listing all wards."""
        WardFactory.create_batch(3)
        response = admin_client.get(f'{BASE_URL}/wards/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['count'] == 3

    def test_list_wards_filter_by_type(self, admin_client, db):
        """Test filtering wards by type."""
        WardFactory(ward_type='general')
        WardFactory(ward_type='icu')
        WardFactory(ward_type='general')

        response = admin_client.get(f'{BASE_URL}/wards/', {'ward_type': 'general'})
        assert response.status_code == status.HTTP_200_OK
        assert response.data['count'] == 2

    def test_list_wards_search(self, admin_client, db):
        """Test searching wards by name."""
        WardFactory(name='General Ward A')
        WardFactory(name='ICU Ward')
        WardFactory(name='General Ward B')

        response = admin_client.get(f'{BASE_URL}/wards/', {'search': 'General'})
        assert response.status_code == status.HTTP_200_OK
        assert response.data['count'] == 2

    def test_create_ward(self, admin_client, db):
        """Test creating a new ward."""
        data = {
            'name': 'New Ward',
            'description': 'A new ward',
            'ward_type': 'general',
            'total_beds': 10,
            'base_rate_per_night': '150.00',
            'auto_create_beds': False
        }
        response = admin_client.post(f'{BASE_URL}/wards/', data, format='json')
        assert response.status_code == status.HTTP_201_CREATED
        assert Ward.objects.filter(name='New Ward').exists()

    def test_create_ward_auto_create_beds(self, admin_client, db):
        """Test creating a ward with auto bed creation."""
        data = {
            'name': 'Auto Bed Ward',
            'ward_type': 'general',
            'total_beds': 5,
            'base_rate_per_night': '100.00',
            'auto_create_beds': True
        }
        response = admin_client.post(f'{BASE_URL}/wards/', data, format='json')
        assert response.status_code == status.HTTP_201_CREATED
        ward = Ward.objects.get(name='Auto Bed Ward')
        assert ward.beds.count() == 5

    def test_retrieve_ward(self, admin_client, db):
        """Test retrieving a single ward."""
        ward = WardFactory(name='Test Ward')
        response = admin_client.get(f'{BASE_URL}/wards/{ward.id}/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['name'] == 'Test Ward'

    def test_update_ward(self, admin_client, db):
        """Test updating a ward."""
        ward = WardFactory(name='Old Name')
        data = {'name': 'New Name'}
        response = admin_client.patch(f'{BASE_URL}/wards/{ward.id}/', data, format='json')
        assert response.status_code == status.HTTP_200_OK
        ward.refresh_from_db()
        assert ward.name == 'New Name'

    def test_delete_ward(self, admin_client, db):
        """Test deleting a ward."""
        ward = WardFactory()
        response = admin_client.delete(f'{BASE_URL}/wards/{ward.id}/')
        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not Ward.objects.filter(id=ward.id).exists()

    def test_ward_beds_action(self, admin_client, db):
        """Test getting beds for a specific ward."""
        ward = WardFactory()
        BedFactory.create_batch(3, ward=ward)

        response = admin_client.get(f'{BASE_URL}/wards/{ward.id}/beds/')
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data['results']) == 3

    def test_ward_beds_filter_by_status(self, admin_client, db):
        """Test filtering ward beds by status."""
        ward = WardFactory()
        BedFactory(ward=ward, status='available')
        BedFactory(ward=ward, status='available')
        BedFactory(ward=ward, status='occupied')

        response = admin_client.get(f'{BASE_URL}/wards/{ward.id}/beds/', {'status': 'available'})
        assert response.status_code == status.HTTP_200_OK
        # Filter applied to beds
        assert len(response.data['results']) == 2

    def test_ward_admissions_action(self, admin_client, db):
        """Test getting admissions for a specific ward."""
        ward = WardFactory()
        bed = BedFactory(ward=ward, status='available')
        AdmissionFactory(bed=bed)

        response = admin_client.get(f'{BASE_URL}/wards/{ward.id}/admissions/')
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) >= 1

    def test_ward_requires_authentication(self, api_client, db):
        """Test that ward endpoints require authentication."""
        response = api_client.get(f'{BASE_URL}/wards/')
        assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.tier1
class TestBedViewSet:
    """Tests for BedViewSet API endpoints."""

    def test_list_beds(self, admin_client, db):
        """Test listing all beds."""
        BedFactory.create_batch(3)
        response = admin_client.get(f'{BASE_URL}/beds/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['count'] == 3

    def test_list_beds_filter_by_ward(self, admin_client, db):
        """Test filtering beds by ward."""
        ward1 = WardFactory()
        ward2 = WardFactory()
        BedFactory.create_batch(2, ward=ward1)
        BedFactory(ward=ward2)

        response = admin_client.get(f'{BASE_URL}/beds/', {'ward': str(ward1.id)})
        assert response.status_code == status.HTTP_200_OK
        assert response.data['count'] == 2

    def test_list_beds_filter_by_status(self, admin_client, db):
        """Test filtering beds by status."""
        BedFactory(status='available')
        BedFactory(status='available')
        BedFactory(status='occupied')

        response = admin_client.get(f'{BASE_URL}/beds/', {'status': 'available'})
        assert response.status_code == status.HTTP_200_OK
        assert response.data['count'] == 2

    def test_create_bed(self, admin_client, db):
        """Test creating a new bed."""
        ward = WardFactory()
        data = {
            'ward': str(ward.id),
            'bed_number': 'NEW-001',
            'bed_type': 'standard',
            'status': 'available'
        }
        response = admin_client.post(f'{BASE_URL}/beds/', data, format='json')
        assert response.status_code == status.HTTP_201_CREATED
        assert Bed.objects.filter(bed_number='NEW-001').exists()

    def test_retrieve_bed(self, admin_client, db):
        """Test retrieving a single bed."""
        bed = BedFactory(bed_number='B-123')
        response = admin_client.get(f'{BASE_URL}/beds/{bed.id}/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['bed_number'] == 'B-123'

    def test_update_bed_status(self, admin_client, db):
        """Test updating bed status."""
        bed = BedFactory(status='available')
        data = {'status': 'maintenance'}
        response = admin_client.patch(f'{BASE_URL}/beds/{bed.id}/', data, format='json')
        assert response.status_code == status.HTTP_200_OK
        bed.refresh_from_db()
        assert bed.status == 'maintenance'

    def test_available_beds_action(self, admin_client, db):
        """Test getting available beds."""
        ward = WardFactory()
        BedFactory(ward=ward, status='available')
        BedFactory(ward=ward, status='available')
        BedFactory(ward=ward, status='occupied')

        response = admin_client.get(f'{BASE_URL}/beds/available/')
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) == 2

    def test_available_beds_filter_by_ward(self, admin_client, db):
        """Test filtering available beds by ward."""
        ward1 = WardFactory()
        ward2 = WardFactory()
        BedFactory(ward=ward1, status='available')
        BedFactory(ward=ward2, status='available')

        response = admin_client.get(f'{BASE_URL}/beds/available/', {'ward': str(ward1.id)})
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) == 1

    def test_available_beds_filter_by_gender(self, admin_client, db):
        """Test filtering available beds by gender compatibility."""
        ward = WardFactory()
        male_section = WardSectionFactory(ward=ward, gender_restriction='male_only')
        mixed_section = WardSectionFactory(ward=ward, gender_restriction='mixed')
        BedFactory(ward=ward, section=male_section, status='available')
        BedFactory(ward=ward, section=mixed_section, status='available')

        # Female patient should not get male-only section beds
        response = admin_client.get(f'{BASE_URL}/beds/available/', {'gender': 'F'})
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) == 1

    def test_bed_admissions_action(self, admin_client, db):
        """Test getting admissions for a specific bed."""
        bed = BedFactory(status='available')
        AdmissionFactory(bed=bed)

        response = admin_client.get(f'{BASE_URL}/beds/{bed.id}/admissions/')
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) >= 1


@pytest.mark.tier1
class TestAdmissionViewSet:
    """Tests for AdmissionViewSet API endpoints."""

    def test_list_admissions(self, admin_client, db):
        """Test listing all admissions."""
        AdmissionFactory.create_batch(3)
        response = admin_client.get(f'{BASE_URL}/admissions/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['count'] == 3

    def test_list_admissions_filter_by_status(self, admin_client, db):
        """Test filtering admissions by status."""
        AdmissionFactory(status='admitted')
        AdmissionFactory(status='admitted')
        AdmissionFactory(status='discharged')

        response = admin_client.get(f'{BASE_URL}/admissions/', {'status': 'admitted'})
        assert response.status_code == status.HTTP_200_OK
        assert response.data['count'] == 2

    def test_create_admission(self, admin_client, db):
        """Test creating a new admission."""
        patient = PatientProfileFactory()
        bed = BedFactory(status='available')
        doctor = PractitionerProfileFactory()

        data = {
            'patient': str(patient.id),
            'bed': str(bed.id),
            'admission_type': 'elective',
            'admission_notes': 'Scheduled surgery',
            'admitting_doctor': str(doctor.id)
        }
        response = admin_client.post(f'{BASE_URL}/admissions/', data, format='json')
        assert response.status_code == status.HTTP_201_CREATED

        # Verify bed is now occupied
        bed.refresh_from_db()
        assert bed.status == 'occupied'

    def test_retrieve_admission(self, admin_client, db):
        """Test retrieving a single admission."""
        admission = AdmissionFactory(admission_notes='Test notes')
        response = admin_client.get(f'{BASE_URL}/admissions/{admission.id}/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['admission_notes'] == 'Test notes'

    def test_discharge_action(self, admin_client, db):
        """Test discharging a patient."""
        admission = AdmissionFactory(status='admitted')
        data = {'discharge_notes': 'Patient recovered fully'}

        response = admin_client.post(
            f'{BASE_URL}/admissions/{admission.id}/discharge/',
            data,
            format='json'
        )
        assert response.status_code == status.HTTP_200_OK

        admission.refresh_from_db()
        assert admission.status == 'discharged'
        assert admission.discharge_notes == 'Patient recovered fully'

    def test_discharge_releases_bed(self, admin_client, db):
        """Test that discharging releases the bed."""
        bed = BedFactory(status='available')
        admission = AdmissionFactory(bed=bed)
        bed.refresh_from_db()
        assert bed.status == 'occupied'

        response = admin_client.post(
            f'{BASE_URL}/admissions/{admission.id}/discharge/',
            {},
            format='json'
        )
        assert response.status_code == status.HTTP_200_OK

        bed.refresh_from_db()
        assert bed.status == 'available'


@pytest.mark.tier2
class TestWardSectionViewSet:
    """Tests for WardSectionViewSet API endpoints."""

    def test_list_sections(self, admin_client, db):
        """Test listing all sections."""
        WardSectionFactory.create_batch(3)
        response = admin_client.get(f'{BASE_URL}/sections/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['count'] == 3

    def test_list_sections_filter_by_ward(self, admin_client, db):
        """Test filtering sections by ward."""
        ward = WardFactory()
        WardSectionFactory(ward=ward)
        WardSectionFactory(ward=ward)
        WardSectionFactory()  # Different ward

        response = admin_client.get(f'{BASE_URL}/sections/', {'ward': str(ward.id)})
        assert response.status_code == status.HTTP_200_OK
        assert response.data['count'] == 2

    def test_create_section(self, admin_client, db):
        """Test creating a new section."""
        ward = WardFactory()
        data = {
            'ward': str(ward.id),
            'name': 'VIP Wing',
            'gender_restriction': 'mixed',
            'accommodation_tier': 'vip',
            'rate_multiplier': '2.00'
        }
        response = admin_client.post(f'{BASE_URL}/sections/', data, format='json')
        assert response.status_code == status.HTTP_201_CREATED
        assert WardSection.objects.filter(name='VIP Wing').exists()

    def test_retrieve_section(self, admin_client, db):
        """Test retrieving a single section."""
        section = WardSectionFactory(name='Test Section')
        response = admin_client.get(f'{BASE_URL}/sections/{section.id}/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['name'] == 'Test Section'

    def test_update_section(self, admin_client, db):
        """Test updating a section."""
        section = WardSectionFactory(rate_multiplier=Decimal('1.00'))
        data = {'rate_multiplier': '1.50'}
        response = admin_client.patch(
            f'{BASE_URL}/sections/{section.id}/',
            data,
            format='json'
        )
        assert response.status_code == status.HTTP_200_OK
        section.refresh_from_db()
        assert section.rate_multiplier == Decimal('1.50')

    def test_section_beds_action(self, admin_client, db):
        """Test getting beds for a specific section."""
        section = WardSectionFactory()
        BedFactory.create_batch(2, section=section, ward=section.ward)

        response = admin_client.get(f'{BASE_URL}/sections/{section.id}/beds/')
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) == 2


@pytest.mark.tier2
class TestBedAmenityViewSet:
    """Tests for BedAmenityViewSet API endpoints."""

    def test_list_amenities(self, admin_client, db):
        """Test listing all amenities."""
        BedAmenityFactory.create_batch(3)
        response = admin_client.get(f'{BASE_URL}/amenities/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['count'] == 3

    def test_list_amenities_filter_by_category(self, admin_client, db):
        """Test filtering amenities by category."""
        BedAmenityFactory(category='medical')
        BedAmenityFactory(category='medical')
        BedAmenityFactory(category='comfort')

        response = admin_client.get(f'{BASE_URL}/amenities/', {'category': 'medical'})
        assert response.status_code == status.HTTP_200_OK
        assert response.data['count'] == 2

    def test_create_amenity(self, admin_client, db):
        """Test creating a new amenity."""
        data = {
            'code': 'TV',
            'name': 'Television',
            'category': 'comfort',
            'additional_rate': '25.00'
        }
        response = admin_client.post(f'{BASE_URL}/amenities/', data, format='json')
        assert response.status_code == status.HTTP_201_CREATED
        assert BedAmenity.objects.filter(code='TV').exists()

    def test_retrieve_amenity(self, admin_client, db):
        """Test retrieving a single amenity."""
        amenity = BedAmenityFactory(name='WiFi')
        response = admin_client.get(f'{BASE_URL}/amenities/{amenity.id}/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['name'] == 'WiFi'

    def test_non_admin_cannot_create_amenity(self, nurse_client, db):
        """Test that non-admin users cannot create amenities."""
        data = {
            'code': 'TEST',
            'name': 'Test Amenity',
            'category': 'comfort'
        }
        response = nurse_client.post(f'{BASE_URL}/amenities/', data, format='json')
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_non_admin_can_list_amenities(self, nurse_client, db):
        """Test that non-admin users can list amenities."""
        BedAmenityFactory.create_batch(2)
        response = nurse_client.get(f'{BASE_URL}/amenities/')
        assert response.status_code == status.HTTP_200_OK


@pytest.mark.tier2
class TestWardTransferViewSet:
    """Tests for WardTransferViewSet API endpoints."""

    def test_request_transfer(self, admin_client, db):
        """Test requesting a patient transfer."""
        # Create source admission
        source_bed = BedFactory(status='available')
        admission = AdmissionFactory(bed=source_bed)
        source_bed.refresh_from_db()
        assert source_bed.status == 'occupied'

        # Create destination bed
        dest_bed = BedFactory(status='available')

        data = {
            'from_admission': str(admission.id),
            'to_bed': str(dest_bed.id),
            'reason': 'Patient requires ICU care'
        }
        response = admin_client.post(
            f'{BASE_URL}/transfers/request_transfer/',
            data,
            format='json'
        )
        assert response.status_code == status.HTTP_200_OK
        assert 'transfer' in response.data

        # Verify source bed is now available
        source_bed.refresh_from_db()
        assert source_bed.status == 'available'

        # Verify destination bed is now occupied
        dest_bed.refresh_from_db()
        assert dest_bed.status == 'occupied'


@pytest.mark.tier1
class TestWardAnalytics:
    """Tests for ward analytics endpoint."""

    def test_analytics_endpoint(self, admin_client, db):
        """Test ward analytics endpoint returns expected data structure."""
        ward = WardFactory()
        bed = BedFactory(ward=ward, status='available')
        AdmissionFactory(bed=bed)

        response = admin_client.get(f'{BASE_URL}/wards/analytics/')
        assert response.status_code == status.HTTP_200_OK
        assert 'occupancy_trends' in response.data
        assert 'length_of_stay' in response.data
        assert 'ward_utilization' in response.data
        assert 'admissions_by_ward' in response.data

    def test_analytics_filter_by_ward(self, admin_client, db):
        """Test ward analytics filtered by specific ward."""
        ward = WardFactory()
        response = admin_client.get(f'{BASE_URL}/wards/analytics/', {'ward_id': str(ward.id)})
        assert response.status_code == status.HTTP_200_OK

    def test_analytics_date_range(self, admin_client, db):
        """Test ward analytics with date range filters."""
        start_date = (timezone.now() - timedelta(days=7)).isoformat()
        end_date = timezone.now().isoformat()

        response = admin_client.get(f'{BASE_URL}/wards/analytics/', {
            'start_date': start_date,
            'end_date': end_date
        })
        assert response.status_code == status.HTTP_200_OK
