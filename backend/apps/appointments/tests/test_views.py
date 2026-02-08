"""
Tests for appointments app API views.

Tests cover:
- AppointmentTypeViewSet (CRUD)
- RecurringScheduleViewSet (CRUD, preview_slots)
- BlockedTimeViewSet (CRUD)

Note: FHIR-dependent endpoints are mocked.
"""
import datetime
import pytest
from datetime import time, date, timedelta
from django.utils import timezone
from unittest.mock import patch, MagicMock
from rest_framework import status

from apps.appointments.models import (
    Appointment, AppointmentType, RecurringSchedule, BlockedTime
)
from .factories import (
    AppointmentTypeFactory, RecurringScheduleFactory, BlockedTimeFactory
)
from apps.users.tests.factories import PractitionerProfileFactory, PatientProfileFactory
from apps.core.tests.factories import DefaultFacilityFactory
from apps.organization.models import (
    Clinic,
    ClinicalUnit,
    UnitTypeConfig,
    DepartmentDutyType,
    RosterEntry,
)
from apps.referrals.models import ClinicWaitlistEntry


# Base URL prefix for appointments app
BASE_URL = '/api/appointments'


def create_clinic(
    facility,
    booking_mode=Clinic.BookingMode.PRACTITIONER_DIRECT,
    assignment_timing=Clinic.AssignmentTiming.BOOKING,
):
    facility_type = UnitTypeConfig.objects.create(
        code=f"facility-{facility.id}",
        name='Facility',
        can_be_root=True,
        depth_level=0,
    )
    department_type = UnitTypeConfig.objects.create(
        code=f"department-{facility.id}",
        name='Department',
        depth_level=1,
    )
    department_type.allowed_parent_types.add(facility_type)
    root_unit = ClinicalUnit.objects.create(
        unit_type=facility_type,
        code=facility.code,
        name=facility.name,
        is_active=True,
    )
    department = ClinicalUnit.objects.create(
        unit_type=department_type,
        parent=root_unit,
        code='OPD',
        name='Outpatient Department',
        is_active=True,
    )
    return Clinic.objects.create(
        facility=facility,
        department=department,
        code='OPD-GEN',
        name='General OPD',
        booking_mode=booking_mode,
        assignment_timing=assignment_timing,
        is_active=True,
    )


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
class TestAppointmentViewSet:
    """Tests for local AppointmentViewSet."""

    def test_list_appointments(self, admin_client, db):
        facility = DefaultFacilityFactory()
        clinic = create_clinic(facility)
        patient = PatientProfileFactory(facility=facility)
        practitioner = PractitionerProfileFactory()
        apt_type = AppointmentTypeFactory()
        now = timezone.now()
        appointment = Appointment.objects.create(
            facility=facility,
            patient=patient,
            practitioner=practitioner,
            clinic=clinic,
            appointment_type=apt_type,
            status='booked',
            start_time=now,
            end_time=now + timedelta(minutes=30),
        )

        response = admin_client.get(f'{BASE_URL}/appointments/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['count'] >= 1
        assert any(str(appointment.id) == item['id'] for item in response.data['results'])

    def test_create_appointment(self, admin_client, db):
        facility = DefaultFacilityFactory()
        clinic = create_clinic(facility)
        patient = PatientProfileFactory(facility=facility)
        practitioner = PractitionerProfileFactory()
        apt_type = AppointmentTypeFactory()

        RecurringScheduleFactory(
            practitioner=practitioner,
            facility=facility,
            days_of_week=[date.today().weekday()],
            start_time=time(9, 0),
            end_time=time(17, 0),
            slot_duration=30,
            active_from=date.today(),
        )

        start_time = timezone.make_aware(datetime.datetime.combine(date.today(), time(10, 0)))
        end_time = timezone.make_aware(datetime.datetime.combine(date.today(), time(10, 30)))

        data = {
            'patient': str(patient.id),
            'practitioner': str(practitioner.id),
            'clinic': str(clinic.id),
            'appointment_type': str(apt_type.id),
            'status': 'booked',
            'source': 'scheduled',
            'start_time': start_time.isoformat(),
            'end_time': end_time.isoformat(),
        }

        response = admin_client.post(f'{BASE_URL}/appointments/', data, format='json')
        assert response.status_code == status.HTTP_201_CREATED
        assert Appointment.objects.filter(id=response.data['id']).exists()

    def test_start_visit_creates_encounter(self, admin_client, db):
        facility = DefaultFacilityFactory()
        clinic = create_clinic(facility)
        patient = PatientProfileFactory(facility=facility)
        practitioner = PractitionerProfileFactory()
        apt_type = AppointmentTypeFactory()

        RecurringScheduleFactory(
            practitioner=practitioner,
            facility=facility,
            days_of_week=[date.today().weekday()],
            start_time=time(9, 0),
            end_time=time(17, 0),
            slot_duration=30,
            active_from=date.today(),
        )

        appointment = Appointment.objects.create(
            facility=facility,
            patient=patient,
            practitioner=practitioner,
            clinic=clinic,
            appointment_type=apt_type,
            status='booked',
            start_time=timezone.make_aware(datetime.datetime.combine(date.today(), time(11, 0))),
            end_time=timezone.make_aware(datetime.datetime.combine(date.today(), time(11, 30))),
        )

        response = admin_client.post(f'{BASE_URL}/appointments/{appointment.id}/start_visit/')
        assert response.status_code == status.HTTP_201_CREATED
        appointment.refresh_from_db()
        assert appointment.status == 'arrived'

    def test_create_appointment_missing_fields(self, admin_client, db):
        data = {
            'patient': 'missing',
        }

        response = admin_client.post(
            f'{BASE_URL}/appointments/',
            data,
            format='json'
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_direct_clinic_requires_practitioner(self, admin_client, db):
        facility = DefaultFacilityFactory()
        clinic = create_clinic(
            facility,
            booking_mode=Clinic.BookingMode.PRACTITIONER_DIRECT,
            assignment_timing=Clinic.AssignmentTiming.BOOKING,
        )
        patient = PatientProfileFactory(facility=facility)
        apt_type = AppointmentTypeFactory()

        start_time = timezone.now() + timedelta(days=1)
        end_time = start_time + timedelta(minutes=30)

        payload = {
            'patient': str(patient.id),
            'clinic': str(clinic.id),
            'appointment_type': str(apt_type.id),
            'status': 'booked',
            'source': 'scheduled',
            'start_time': start_time.isoformat(),
            'end_time': end_time.isoformat(),
        }

        response = admin_client.post(f'{BASE_URL}/appointments/', payload, format='json')
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'practitioner' in response.data

    def test_pool_clinic_allows_booking_without_practitioner_when_roster_slot_exists(self, admin_client, db):
        facility = DefaultFacilityFactory()
        clinic = create_clinic(
            facility,
            booking_mode=Clinic.BookingMode.CLINIC_POOL,
            assignment_timing=Clinic.AssignmentTiming.CHECK_IN,
        )
        patient = PatientProfileFactory(facility=facility)
        practitioner = PractitionerProfileFactory()
        apt_type = AppointmentTypeFactory(duration_minutes=30)

        tomorrow = timezone.now().date() + timedelta(days=1)
        slot_start = time(10, 0)
        slot_end = time(10, 30)

        duty_type = DepartmentDutyType.objects.create(
            department=clinic.department,
            name='Clinic Duty',
            code='CLINIC-DUTY',
            category='clinic',
            rotation_type='none',
            applicable_days=[tomorrow.weekday()],
            is_24_hour=False,
            start_time=slot_start,
            end_time=time(14, 0),
            slot_duration_minutes=30,
            max_patients_per_slot=1,
            clinic=clinic,
            is_active=True,
        )
        RosterEntry.objects.create(
            department=clinic.department,
            duty_type=duty_type,
            date=tomorrow,
            practitioner=practitioner,
            start_time=slot_start,
            end_time=time(14, 0),
            source='manual',
            status='published',
        )

        start_time = timezone.make_aware(datetime.datetime.combine(tomorrow, slot_start))
        end_time = timezone.make_aware(datetime.datetime.combine(tomorrow, slot_end))
        payload = {
            'patient': str(patient.id),
            'clinic': str(clinic.id),
            'appointment_type': str(apt_type.id),
            'status': 'booked',
            'source': 'scheduled',
            'start_time': start_time.isoformat(),
            'end_time': end_time.isoformat(),
        }

        response = admin_client.post(f'{BASE_URL}/appointments/', payload, format='json')
        assert response.status_code == status.HTTP_201_CREATED
        appointment = Appointment.objects.get(id=response.data['id'])
        assert appointment.practitioner_id is None
        assert appointment.assignment_status == Appointment.AssignmentStatus.PENDING

    def test_start_visit_assigns_pool_clinic_practitioner_at_check_in(self, admin_client, db):
        facility = DefaultFacilityFactory()
        clinic = create_clinic(
            facility,
            booking_mode=Clinic.BookingMode.CLINIC_POOL,
            assignment_timing=Clinic.AssignmentTiming.CHECK_IN,
        )
        patient = PatientProfileFactory(facility=facility)
        practitioner = PractitionerProfileFactory()
        apt_type = AppointmentTypeFactory(duration_minutes=30)

        tomorrow = timezone.now().date() + timedelta(days=1)
        slot_start = time(11, 0)
        slot_end = time(11, 30)

        duty_type = DepartmentDutyType.objects.create(
            department=clinic.department,
            name='Pool Check-In Duty',
            code='POOL-CHECK-IN',
            category='clinic',
            rotation_type='none',
            applicable_days=[tomorrow.weekday()],
            is_24_hour=False,
            start_time=slot_start,
            end_time=time(14, 0),
            slot_duration_minutes=30,
            max_patients_per_slot=1,
            clinic=clinic,
            is_active=True,
        )
        RosterEntry.objects.create(
            department=clinic.department,
            duty_type=duty_type,
            date=tomorrow,
            practitioner=practitioner,
            start_time=slot_start,
            end_time=time(14, 0),
            source='manual',
            status='published',
        )

        appointment = Appointment.objects.create(
            facility=facility,
            patient=patient,
            practitioner=None,
            clinic=clinic,
            appointment_type=apt_type,
            status='booked',
            source='scheduled',
            start_time=timezone.make_aware(datetime.datetime.combine(tomorrow, slot_start)),
            end_time=timezone.make_aware(datetime.datetime.combine(tomorrow, slot_end)),
        )

        response = admin_client.post(f'{BASE_URL}/appointments/{appointment.id}/start_visit/')
        assert response.status_code == status.HTTP_201_CREATED
        appointment.refresh_from_db()
        assert appointment.practitioner_id == practitioner.id
        assert appointment.assignment_source == Appointment.AssignmentSource.CHECK_IN

    def test_pool_clinic_full_slot_with_auto_waitlist_creates_waitlist_entry(self, admin_client, db):
        facility = DefaultFacilityFactory()
        clinic = create_clinic(
            facility,
            booking_mode=Clinic.BookingMode.CLINIC_POOL,
            assignment_timing=Clinic.AssignmentTiming.CHECK_IN,
        )
        booked_patient = PatientProfileFactory(facility=facility)
        waitlist_patient = PatientProfileFactory(facility=facility)
        practitioner = PractitionerProfileFactory()
        apt_type = AppointmentTypeFactory(duration_minutes=30)

        tomorrow = timezone.now().date() + timedelta(days=1)
        slot_start = time(12, 0)
        slot_end = time(12, 30)

        duty_type = DepartmentDutyType.objects.create(
            department=clinic.department,
            name='Waitlist Duty',
            code='WAITLIST-DUTY',
            category='clinic',
            rotation_type='none',
            applicable_days=[tomorrow.weekday()],
            is_24_hour=False,
            start_time=slot_start,
            end_time=time(14, 0),
            slot_duration_minutes=30,
            max_patients_per_slot=1,
            clinic=clinic,
            is_active=True,
        )
        RosterEntry.objects.create(
            department=clinic.department,
            duty_type=duty_type,
            date=tomorrow,
            practitioner=practitioner,
            start_time=slot_start,
            end_time=time(14, 0),
            source='manual',
            status='published',
        )

        Appointment.objects.create(
            facility=facility,
            patient=booked_patient,
            practitioner=practitioner,
            clinic=clinic,
            appointment_type=apt_type,
            status='booked',
            source='scheduled',
            start_time=timezone.make_aware(datetime.datetime.combine(tomorrow, slot_start)),
            end_time=timezone.make_aware(datetime.datetime.combine(tomorrow, slot_end)),
        )

        payload = {
            'patient': str(waitlist_patient.id),
            'clinic': str(clinic.id),
            'appointment_type': str(apt_type.id),
            'status': 'booked',
            'source': 'scheduled',
            'start_time': timezone.make_aware(datetime.datetime.combine(tomorrow, slot_start)).isoformat(),
            'end_time': timezone.make_aware(datetime.datetime.combine(tomorrow, slot_end)).isoformat(),
            'auto_waitlist': True,
        }
        response = admin_client.post(f'{BASE_URL}/appointments/', payload, format='json')
        assert response.status_code == status.HTTP_202_ACCEPTED
        assert response.data.get('waitlisted') is True
        assert ClinicWaitlistEntry.objects.filter(
            clinic=clinic,
            patient=waitlist_patient,
            status='waiting',
        ).exists()

    def test_available_slots_supports_pool_clinic_query(self, admin_client, db):
        facility = DefaultFacilityFactory()
        clinic = create_clinic(
            facility,
            booking_mode=Clinic.BookingMode.CLINIC_POOL,
            assignment_timing=Clinic.AssignmentTiming.CHECK_IN,
        )
        practitioner = PractitionerProfileFactory()

        tomorrow = timezone.now().date() + timedelta(days=1)
        duty_type = DepartmentDutyType.objects.create(
            department=clinic.department,
            name='Pool Slots Duty',
            code='POOL-SLOTS',
            category='clinic',
            rotation_type='none',
            applicable_days=[tomorrow.weekday()],
            is_24_hour=False,
            start_time=time(9, 0),
            end_time=time(10, 0),
            slot_duration_minutes=30,
            max_patients_per_slot=1,
            clinic=clinic,
            is_active=True,
        )
        RosterEntry.objects.create(
            department=clinic.department,
            duty_type=duty_type,
            date=tomorrow,
            practitioner=practitioner,
            start_time=time(9, 0),
            end_time=time(10, 0),
            source='manual',
            status='published',
        )

        response = admin_client.get(
            f'{BASE_URL}/appointments/available_slots/',
            {
                'clinic_id': str(clinic.id),
                'start_date': tomorrow.isoformat(),
                'end_date': tomorrow.isoformat(),
                'status': 'free',
            }
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data.get('clinic_mode') == Clinic.BookingMode.CLINIC_POOL
        assert response.data.get('total', 0) > 0


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
