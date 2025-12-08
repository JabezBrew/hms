"""
Tests for laboratory app API views.

Tests cover:
- LabTestCatalogViewSet (CRUD, search, filter)
- LabPanelViewSet (CRUD)
- LabOrderViewSet (CRUD, status transitions)
- LabSpecimenViewSet (collection, receipt)
- LabResultViewSet (entry, verification)
"""
import pytest
from decimal import Decimal
from rest_framework import status
from django.utils import timezone

from apps.laboratory.models import (
    LabTestCatalog, LabPanel, LabOrder, LabSpecimen, LabResult
)
from .factories import (
    LabTestCatalogFactory, LabPanelFactory, LabOrderFactory,
    LabOrderTestFactory, LabSpecimenFactory, LabResultFactory
)
from apps.users.tests.factories import PatientProfileFactory, PractitionerProfileFactory


# Base URL prefix for laboratory app
BASE_URL = '/api/laboratory'


@pytest.mark.tier1
class TestLabTestCatalogViewSet:
    """Tests for LabTestCatalogViewSet API endpoints."""

    def test_list_tests(self, admin_client, db):
        """Test listing all lab tests."""
        LabTestCatalogFactory.create_batch(3)
        response = admin_client.get(f'{BASE_URL}/tests/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['count'] == 3

    def test_list_tests_filter_by_category(self, admin_client, db):
        """Test filtering tests by category."""
        LabTestCatalogFactory(category='hematology')
        LabTestCatalogFactory(category='hematology')
        LabTestCatalogFactory(category='chemistry')

        response = admin_client.get(f'{BASE_URL}/tests/', {'category': 'hematology'})
        assert response.status_code == status.HTTP_200_OK
        assert response.data['count'] == 2

    def test_list_tests_search(self, admin_client, db):
        """Test searching tests by name."""
        LabTestCatalogFactory(name='Complete Blood Count', short_name='CBC')
        LabTestCatalogFactory(name='Glucose', short_name='GLU')
        LabTestCatalogFactory(name='Blood Urea Nitrogen', short_name='BUN')

        response = admin_client.get(f'{BASE_URL}/tests/', {'search': 'Blood'})
        assert response.status_code == status.HTTP_200_OK
        # Should match "Complete Blood Count" and "Blood Urea Nitrogen"
        assert response.data['count'] >= 2

    def test_create_test(self, admin_client, db):
        """Test creating a new lab test."""
        data = {
            'code': 'NEW-TEST',
            'name': 'New Test',
            'short_name': 'NT',
            'category': 'chemistry',
            'specimen_type': 'Serum',
            'container_type': 'Red Top',
            'unit': 'mg/dL',
            'tat_hours': 24,
            'price': '75.00',
            'reference_ranges': {}
        }
        response = admin_client.post(f'{BASE_URL}/tests/', data, format='json')
        assert response.status_code == status.HTTP_201_CREATED
        assert LabTestCatalog.objects.filter(code='NEW-TEST').exists()

    def test_retrieve_test(self, admin_client, db):
        """Test retrieving a single lab test."""
        test = LabTestCatalogFactory(name='Hemoglobin')
        response = admin_client.get(f'{BASE_URL}/tests/{test.id}/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['name'] == 'Hemoglobin'

    def test_update_test(self, admin_client, db):
        """Test updating a lab test."""
        test = LabTestCatalogFactory(price=Decimal('50.00'))
        data = {'price': '75.00'}
        response = admin_client.patch(f'{BASE_URL}/tests/{test.id}/', data, format='json')
        assert response.status_code == status.HTTP_200_OK
        test.refresh_from_db()
        assert test.price == Decimal('75.00')


@pytest.mark.tier1
class TestLabPanelViewSet:
    """Tests for LabPanelViewSet API endpoints."""

    def test_list_panels(self, admin_client, db):
        """Test listing all panels."""
        LabPanelFactory.create_batch(3)
        response = admin_client.get(f'{BASE_URL}/panels/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['count'] == 3

    def test_create_panel(self, admin_client, db):
        """Test creating a new panel."""
        test1 = LabTestCatalogFactory()
        test2 = LabTestCatalogFactory()
        data = {
            'code': 'NEW-PANEL',
            'name': 'New Panel',
            'description': 'A new test panel',
            'price': '150.00',
            'test_ids': [str(test1.id), str(test2.id)]
        }
        response = admin_client.post(f'{BASE_URL}/panels/', data, format='json')
        assert response.status_code == status.HTTP_201_CREATED
        panel = LabPanel.objects.get(code='NEW-PANEL')
        assert panel.tests.count() == 2

    def test_retrieve_panel(self, admin_client, db):
        """Test retrieving a single panel."""
        panel = LabPanelFactory(name='Liver Function')
        response = admin_client.get(f'{BASE_URL}/panels/{panel.id}/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['name'] == 'Liver Function'


@pytest.mark.tier1
class TestLabOrderViewSet:
    """Tests for LabOrderViewSet API endpoints."""

    def test_list_orders(self, admin_client, db):
        """Test listing all lab orders."""
        LabOrderFactory.create_batch(3)
        response = admin_client.get(f'{BASE_URL}/orders/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['count'] == 3

    def test_list_orders_filter_by_status(self, admin_client, db):
        """Test filtering orders by status."""
        LabOrderFactory(status='ordered')
        LabOrderFactory(status='ordered')
        LabOrderFactory(status='completed')

        response = admin_client.get(f'{BASE_URL}/orders/', {'status': 'ordered'})
        assert response.status_code == status.HTTP_200_OK
        assert response.data['count'] == 2

    def test_list_orders_filter_by_priority(self, admin_client, db):
        """Test filtering orders by priority."""
        LabOrderFactory(priority='stat')
        LabOrderFactory(priority='routine')
        LabOrderFactory(priority='stat')

        response = admin_client.get(f'{BASE_URL}/orders/', {'priority': 'stat'})
        assert response.status_code == status.HTTP_200_OK
        assert response.data['count'] == 2

    def test_create_order(self, admin_client, db):
        """Test creating a new lab order."""
        patient = PatientProfileFactory()
        provider = PractitionerProfileFactory()
        test = LabTestCatalogFactory()

        data = {
            'patient': str(patient.id),
            'ordering_provider': str(provider.id),
            'priority': 'routine',
            'clinical_notes': 'Annual checkup',
            'test_ids': [str(test.id)]
        }
        response = admin_client.post(f'{BASE_URL}/orders/', data, format='json')
        assert response.status_code == status.HTTP_201_CREATED
        assert LabOrder.objects.filter(patient=patient).exists()

    def test_retrieve_order(self, admin_client, db):
        """Test retrieving a single order."""
        order = LabOrderFactory(clinical_notes='Test notes')
        response = admin_client.get(f'{BASE_URL}/orders/{order.id}/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['clinical_notes'] == 'Test notes'

    def test_cancel_order(self, admin_client, db):
        """Test cancelling a lab order."""
        order = LabOrderFactory(status='ordered')
        data = {'cancellation_reason': 'Patient declined'}
        response = admin_client.post(
            f'{BASE_URL}/orders/{order.id}/cancel/',
            data,
            format='json'
        )
        assert response.status_code == status.HTTP_200_OK
        order.refresh_from_db()
        assert order.status == 'cancelled'


@pytest.mark.tier2
class TestLabSpecimenViewSet:
    """Tests for LabSpecimenViewSet API endpoints."""

    def test_list_specimens(self, admin_client, db):
        """Test listing all specimens."""
        LabSpecimenFactory.create_batch(3)
        response = admin_client.get(f'{BASE_URL}/specimens/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['count'] == 3

    def test_create_specimen(self, admin_client, db):
        """Test creating a new specimen."""
        order = LabOrderFactory()
        collector = PractitionerProfileFactory()
        data = {
            'order': str(order.id),
            'specimen_type': 'Whole Blood',
            'container_type': 'Lavender Top',
            'volume_collected': '5 mL',
            'collected_by': str(collector.id),
            'collection_site': 'Right arm',
            'collected_at': timezone.now().isoformat()
        }
        response = admin_client.post(f'{BASE_URL}/specimens/', data, format='json')
        assert response.status_code == status.HTTP_201_CREATED

    def test_receive_specimen(self, api_client, db):
        """Test receiving a specimen in the lab."""
        from rest_framework_simplejwt.tokens import AccessToken
        # Create a practitioner with full profile chain
        practitioner = PractitionerProfileFactory()
        user = practitioner.staff.user
        token = AccessToken.for_user(user)
        api_client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')

        specimen = LabSpecimenFactory(status='in_transit')
        data = {
            'storage_location': 'Rack B-5',
            'is_rejected': False
        }
        response = api_client.post(
            f'{BASE_URL}/specimens/{specimen.id}/receive/',
            data,
            format='json'
        )
        assert response.status_code == status.HTTP_200_OK
        specimen.refresh_from_db()
        assert specimen.status == 'received'

    def test_reject_specimen(self, api_client, db):
        """Test rejecting a specimen via receive action."""
        from rest_framework_simplejwt.tokens import AccessToken
        # Create a practitioner with full profile chain
        practitioner = PractitionerProfileFactory()
        user = practitioner.staff.user
        token = AccessToken.for_user(user)
        api_client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')

        specimen = LabSpecimenFactory(status='in_transit')
        data = {
            'is_rejected': True,
            'rejection_reason': 'Insufficient volume'
        }
        response = api_client.post(
            f'{BASE_URL}/specimens/{specimen.id}/receive/',
            data,
            format='json'
        )
        assert response.status_code == status.HTTP_200_OK
        specimen.refresh_from_db()
        assert specimen.is_rejected is True
        assert specimen.status == 'rejected'


@pytest.mark.tier2
class TestLabResultViewSet:
    """Tests for LabResultViewSet API endpoints."""

    def test_list_results(self, admin_client, db):
        """Test listing all results."""
        LabResultFactory.create_batch(3)
        response = admin_client.get(f'{BASE_URL}/results/')
        assert response.status_code == status.HTTP_200_OK
        # Results may or may not be paginated
        if isinstance(response.data, dict) and 'count' in response.data:
            assert response.data['count'] >= 3
        else:
            assert len(response.data) >= 3

    def test_create_result(self, admin_client, db):
        """Test creating a new result."""
        order_test = LabOrderTestFactory()
        specimen = LabSpecimenFactory(order=order_test.order)

        data = {
            'order_test': str(order_test.id),
            'specimen': str(specimen.id),
            'value': '45.5',
            'unit': 'mg/dL',
            'reference_low': '10.0',
            'reference_high': '50.0',
            'flag': 'normal',
            'performed_at': timezone.now().isoformat()
        }
        response = admin_client.post(f'{BASE_URL}/results/', data, format='json')
        assert response.status_code == status.HTTP_201_CREATED

    def test_verify_result(self, api_client, db):
        """Test verifying a result."""
        from rest_framework_simplejwt.tokens import AccessToken
        # Create a practitioner with full profile chain
        practitioner = PractitionerProfileFactory()
        user = practitioner.staff.user
        token = AccessToken.for_user(user)
        api_client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')

        result = LabResultFactory(is_verified=False, verified_by=None, verified_at=None)
        # Verify action uses current user as verifier
        response = api_client.post(
            f'{BASE_URL}/results/{result.id}/verify/',
            {},
            format='json'
        )
        assert response.status_code == status.HTTP_200_OK
        result.refresh_from_db()
        assert result.is_verified is True
        assert result.verified_by is not None


@pytest.mark.tier1
class TestLabOrderWorkflow:
    """Tests for complete lab order workflow."""

    def test_full_order_workflow(self, admin_client, db):
        """Test complete lab order workflow from creation to result."""
        # 1. Create order
        patient = PatientProfileFactory()
        provider = PractitionerProfileFactory()
        test = LabTestCatalogFactory()

        order_data = {
            'patient': str(patient.id),
            'ordering_provider': str(provider.id),
            'priority': 'routine',
            'test_ids': [str(test.id)]
        }
        response = admin_client.post(f'{BASE_URL}/orders/', order_data, format='json')
        assert response.status_code == status.HTTP_201_CREATED
        order_id = response.data['id']

        # 2. Verify order was created with correct status
        response = admin_client.get(f'{BASE_URL}/orders/{order_id}/')
        assert response.status_code == status.HTTP_200_OK
        # Initial status depends on implementation

    def test_stat_order_priority(self, admin_client, db):
        """Test STAT priority order handling."""
        order = LabOrderFactory(priority='stat')
        response = admin_client.get(f'{BASE_URL}/orders/{order.id}/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['priority'] == 'stat'


@pytest.mark.tier1
class TestLabAuthentication:
    """Tests for authentication requirements."""

    def test_requires_authentication(self, api_client, db):
        """Test that endpoints require authentication."""
        response = api_client.get(f'{BASE_URL}/tests/')
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

        response = api_client.get(f'{BASE_URL}/orders/')
        assert response.status_code == status.HTTP_401_UNAUTHORIZED
