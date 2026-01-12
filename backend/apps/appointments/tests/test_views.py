"""
Tests for appointments app API views.

Tests cover:
- AppointmentTypeViewSet (CRUD)
- RecurringScheduleViewSet (CRUD, preview_slots)
- BlockedTimeViewSet (CRUD)

Note: FHIR-dependent endpoints are mocked.
"""
import pytest
from datetime import time, date, timedelta
from unittest.mock import patch, MagicMock
from rest_framework import status

from apps.appointments.models import (
    AppointmentType, RecurringSchedule, BlockedTime
)
from .factories import (
    AppointmentTypeFactory, RecurringScheduleFactory, BlockedTimeFactory
)
from apps.users.tests.factories import PractitionerProfileFactory, PatientProfileFactory
from apps.core.tests.factories import DefaultFacilityFactory


# Base URL prefix for appointments app
BASE_URL = '/api/appointments'


@pytest.mark.tier1
class TestAppointmentTypeViewSet:
    """Tests for AppointmentTypeViewSet API endpoints."""

    def test_list_appointment_types(self, admin_client, db):
        """Test listing all appointment types."""
        AppointmentTypeFactory.create_batch(3)
        response = admin_client.get(f'{BASE_URL}/types/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['count'] == 3

    def test_create_appointment_type(self, admin_client, db):
        """Test creating a new appointment type."""
        data = {
            'name': 'New Consultation',
            'description': 'A new type of consultation',
            'duration_minutes': 45,
            'category': 'in_person',
            'color': '#FF5733'
        }
        response = admin_client.post(f'{BASE_URL}/types/', data, format='json')
        assert response.status_code == status.HTTP_201_CREATED
        assert AppointmentType.objects.filter(name='New Consultation').exists()

    def test_retrieve_appointment_type(self, admin_client, db):
        """Test retrieving a single appointment type."""
        apt_type = AppointmentTypeFactory(name='Test Type')
        response = admin_client.get(f'{BASE_URL}/types/{apt_type.id}/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['name'] == 'Test Type'

    def test_update_appointment_type(self, admin_client, db):
        """Test updating an appointment type."""
        apt_type = AppointmentTypeFactory(name='Old Name')
        data = {'name': 'New Name'}
        response = admin_client.patch(
            f'{BASE_URL}/types/{apt_type.id}/',
            data,
            format='json'
        )
        assert response.status_code == status.HTTP_200_OK
        apt_type.refresh_from_db()
        assert apt_type.name == 'New Name'

    def test_delete_appointment_type(self, admin_client, db):
        """Test deleting an appointment type."""
        apt_type = AppointmentTypeFactory()
        response = admin_client.delete(f'{BASE_URL}/types/{apt_type.id}/')
        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not AppointmentType.objects.filter(id=apt_type.id).exists()

    def test_requires_authentication(self, api_client, db):
        """Test that endpoint requires authentication."""
        response = api_client.get(f'{BASE_URL}/types/')
        assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.tier1
class TestRecurringScheduleViewSet:
    """Tests for RecurringScheduleViewSet API endpoints."""

    def test_list_recurring_schedules(self, admin_client, db):
        """Test listing all recurring schedules."""
        RecurringScheduleFactory.create_batch(3)
        response = admin_client.get(f'{BASE_URL}/recurring-schedules/')
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) >= 3

    def test_create_recurring_schedule(self, admin_client, db):
        """Test creating a new recurring schedule."""
        practitioner = PractitionerProfileFactory()
        data = {
            'name': 'Morning Clinic',
            'practitioner': str(practitioner.id),
            'days_of_week': [0, 1, 2, 3, 4],
            'start_time': '09:00:00',
            'end_time': '12:00:00',
            'slot_duration': 30,
            'active_from': str(date.today()),
            'breaks': []
        }
        response = admin_client.post(
            f'{BASE_URL}/recurring-schedules/',
            data,
            format='json'
        )
        assert response.status_code == status.HTTP_201_CREATED
        assert RecurringSchedule.objects.filter(name='Morning Clinic').exists()

    def test_retrieve_recurring_schedule(self, admin_client, db):
        """Test retrieving a single recurring schedule."""
        schedule = RecurringScheduleFactory(name='Test Schedule')
        response = admin_client.get(
            f'{BASE_URL}/recurring-schedules/{schedule.id}/'
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data['name'] == 'Test Schedule'

    def test_update_recurring_schedule(self, admin_client, db):
        """Test updating a recurring schedule."""
        schedule = RecurringScheduleFactory(slot_duration=30)
        data = {'slot_duration': 45}
        response = admin_client.patch(
            f'{BASE_URL}/recurring-schedules/{schedule.id}/',
            data,
            format='json'
        )
        assert response.status_code == status.HTTP_200_OK
        schedule.refresh_from_db()
        assert schedule.slot_duration == 45

    def test_delete_recurring_schedule(self, admin_client, db):
        """Test deleting a recurring schedule."""
        schedule = RecurringScheduleFactory()
        response = admin_client.delete(
            f'{BASE_URL}/recurring-schedules/{schedule.id}/'
        )
        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not RecurringSchedule.objects.filter(id=schedule.id).exists()

    def test_preview_slots_action(self, admin_client, db):
        """Test preview_slots action for recurring schedule."""
        data = {
            'start_time': '09:00',
            'end_time': '17:00',
            'slot_duration': 30,
            'breaks': [{'start': '12:00', 'end': '13:00'}]
        }
        response = admin_client.post(
            f'{BASE_URL}/recurring-schedules/preview_slots/',
            data,
            format='json'
        )
        assert response.status_code == status.HTTP_200_OK
        assert 'slots' in response.data
        # 9-12 (6 slots) + 13-17 (8 slots) = 14 slots
        assert len(response.data['slots']) == 14

    def test_preview_slots_no_breaks(self, admin_client, db):
        """Test preview_slots without breaks."""
        data = {
            'start_time': '09:00',
            'end_time': '12:00',
            'slot_duration': 30,
            'breaks': []
        }
        response = admin_client.post(
            f'{BASE_URL}/recurring-schedules/preview_slots/',
            data,
            format='json'
        )
        assert response.status_code == status.HTTP_200_OK
        # 9-12 = 3 hours = 6 slots at 30 min each
        assert len(response.data['slots']) == 6


@pytest.mark.tier1
class TestBlockedTimeViewSet:
    """Tests for BlockedTimeViewSet API endpoints."""

    def test_list_blocked_times(self, admin_client, db):
        """Test listing all blocked times."""
        BlockedTimeFactory.create_batch(3)
        response = admin_client.get(f'{BASE_URL}/blocked-times/')
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) >= 3

    def test_create_blocked_time(self, admin_client, db):
        """Test creating a new blocked time."""
        practitioner = PractitionerProfileFactory()
        data = {
            'practitioner': str(practitioner.id),
            'date': str(date.today() + timedelta(days=7)),
            'start_time': '10:00:00',
            'end_time': '12:00:00',
            'reason': 'Meeting',
            'is_all_day': False
        }
        response = admin_client.post(
            f'{BASE_URL}/blocked-times/',
            data,
            format='json'
        )
        assert response.status_code == status.HTTP_201_CREATED
        assert BlockedTime.objects.filter(reason='Meeting').exists()

    def test_create_all_day_blocked_time(self, admin_client, db):
        """Test creating an all-day blocked time."""
        practitioner = PractitionerProfileFactory()
        data = {
            'practitioner': str(practitioner.id),
            'date': str(date.today() + timedelta(days=14)),
            'start_time': '00:00:00',
            'end_time': '23:59:00',
            'reason': 'Vacation',
            'is_all_day': True
        }
        response = admin_client.post(
            f'{BASE_URL}/blocked-times/',
            data,
            format='json'
        )
        assert response.status_code == status.HTTP_201_CREATED
        blocked = BlockedTime.objects.get(reason='Vacation')
        assert blocked.is_all_day is True

    def test_retrieve_blocked_time(self, admin_client, db):
        """Test retrieving a single blocked time."""
        blocked = BlockedTimeFactory(reason='Test Block')
        response = admin_client.get(f'{BASE_URL}/blocked-times/{blocked.id}/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['reason'] == 'Test Block'

    def test_update_blocked_time(self, admin_client, db):
        """Test updating a blocked time."""
        blocked = BlockedTimeFactory(reason='Old Reason')
        data = {'reason': 'New Reason'}
        response = admin_client.patch(
            f'{BASE_URL}/blocked-times/{blocked.id}/',
            data,
            format='json'
        )
        assert response.status_code == status.HTTP_200_OK
        blocked.refresh_from_db()
        assert blocked.reason == 'New Reason'

    def test_delete_blocked_time(self, admin_client, db):
        """Test deleting a blocked time."""
        blocked = BlockedTimeFactory()
        response = admin_client.delete(f'{BASE_URL}/blocked-times/{blocked.id}/')
        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not BlockedTime.objects.filter(id=blocked.id).exists()

    def test_filter_by_practitioner(self, admin_client, db):
        """Test filtering blocked times by practitioner."""
        practitioner = PractitionerProfileFactory()
        BlockedTimeFactory(practitioner=practitioner)
        BlockedTimeFactory(practitioner=practitioner)
        BlockedTimeFactory()  # Different practitioner

        response = admin_client.get(
            f'{BASE_URL}/blocked-times/',
            {'practitioner': str(practitioner.id)}
        )
        assert response.status_code == status.HTTP_200_OK
        # Should return the 2 for our practitioner
        assert len(response.data) >= 2


@pytest.mark.tier2
class TestAppointmentViewSetWithMocks:
    """Tests for AppointmentViewSet with FHIR mocks."""

    @patch('apps.appointments.views.AppointmentProxy')
    def test_list_appointments(self, mock_proxy, admin_client, db):
        """Test listing appointments with mocked FHIR proxy."""
        mock_proxy.search.return_value = [
            {'id': 'apt-1', 'status': 'booked'},
            {'id': 'apt-2', 'status': 'booked'}
        ]

        response = admin_client.get(f'{BASE_URL}/appointments/')
        assert response.status_code == status.HTTP_200_OK
        mock_proxy.search.assert_called_once()

    @patch('apps.appointments.views.AppointmentProxy')
    def test_retrieve_appointment(self, mock_proxy, admin_client, db):
        """Test retrieving a single appointment with mocked FHIR proxy."""
        facility = DefaultFacilityFactory()
        PatientProfileFactory(facility=facility, fhir_patient_id='patient-123')
        mock_proxy.get.return_value = {
            'id': 'apt-123',
            'status': 'booked',
            'start': '2024-06-15T10:00:00Z',
            'participant': [
                {'actor': {'reference': 'Patient/patient-123'}}
            ]
        }

        response = admin_client.get(f'{BASE_URL}/appointments/apt-123/')
        assert response.status_code == status.HTTP_200_OK
        mock_proxy.get.assert_called_once_with('apt-123')

    @patch('apps.appointments.views.ConflictPreventionService')
    def test_create_appointment(self, mock_service, admin_client, db):
        """Test creating an appointment with mocked conflict service."""
        mock_service.book_appointment.return_value = (
            True,
            {'id': 'new-apt', 'status': 'booked'}
        )

        facility = DefaultFacilityFactory()
        PatientProfileFactory(facility=facility, fhir_patient_id='patient-123')
        apt_type = AppointmentTypeFactory()
        data = {
            'patient_id': 'patient-123',
            'practitioner_id': 'practitioner-456',
            'start_time': '2024-06-15T10:00:00Z',
            'end_time': '2024-06-15T10:30:00Z',
            'appointment_type_id': str(apt_type.id)
        }

        response = admin_client.post(
            f'{BASE_URL}/appointments/',
            data,
            format='json'
        )
        assert response.status_code == status.HTTP_201_CREATED

    @patch('apps.appointments.views.ConflictPreventionService')
    def test_create_appointment_conflict(self, mock_service, admin_client, db):
        """Test appointment creation with conflict."""
        mock_service.book_appointment.return_value = (
            False,
            {'error': 'Time slot already booked'}
        )

        facility = DefaultFacilityFactory()
        PatientProfileFactory(facility=facility, fhir_patient_id='patient-123')
        apt_type = AppointmentTypeFactory()
        data = {
            'patient_id': 'patient-123',
            'practitioner_id': 'practitioner-456',
            'start_time': '2024-06-15T10:00:00Z',
            'end_time': '2024-06-15T10:30:00Z',
            'appointment_type_id': str(apt_type.id)
        }

        response = admin_client.post(
            f'{BASE_URL}/appointments/',
            data,
            format='json'
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_create_appointment_missing_fields(self, admin_client, db):
        """Test appointment creation with missing required fields."""
        data = {
            'patient_id': 'patient-123',
            # Missing practitioner_id, times, and appointment_type_id
        }

        response = admin_client.post(
            f'{BASE_URL}/appointments/',
            data,
            format='json'
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'error' in response.data


@pytest.mark.tier2
class TestSlotViewSetWithMocks:
    """Tests for SlotViewSet with FHIR mocks."""

    @patch('apps.appointments.views.SlotProxy')
    def test_list_slots(self, mock_proxy, admin_client, db):
        """Test listing slots with mocked FHIR proxy."""
        mock_proxy.search.return_value = [
            {'id': 'slot-1', 'status': 'free', 'start': '2024-06-15T09:00:00Z'},
            {'id': 'slot-2', 'status': 'free', 'start': '2024-06-15T09:30:00Z'}
        ]

        response = admin_client.get(f'{BASE_URL}/slots/')
        assert response.status_code == status.HTTP_200_OK

    @patch('apps.appointments.views.SlotProxy')
    def test_retrieve_slot(self, mock_proxy, admin_client, db):
        """Test retrieving a single slot with mocked FHIR proxy."""
        mock_proxy.get.return_value = {
            'id': 'slot-123',
            'status': 'free',
            'start': '2024-06-15T10:00:00Z',
            'end': '2024-06-15T10:30:00Z'
        }

        response = admin_client.get(f'{BASE_URL}/slots/slot-123/')
        assert response.status_code == status.HTTP_200_OK
