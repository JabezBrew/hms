from django.test import TestCase
from django.utils import timezone
from datetime import datetime, timedelta, date, time
from apps.appointments.services import AvailabilityService
from apps.appointments.models import RecurringSchedule, ScheduleFHIRMapping
from apps.users.models import PractitionerProfile, User
from apps.core.models import Facility
from rest_framework.test import APIClient

from unittest.mock import patch, MagicMock

class AvailabilityServiceTest(TestCase):
    def setUp(self):
        self.facility, _ = Facility.objects.get_or_create(
            code='TEST',
            defaults={
                'name': 'Test Facility',
                'facility_type': 'hospital',
                'address': '123 Test St',
                'city': 'Testville',
                'region': 'Test Region',
                'country': 'Ghana',
                'postal_code': '00000',
                'phone': '+233000000000',
                'email': 'test@example.com',
            }
        )
        self.user = User.objects.create_user(
            username='testdoctor',
            email='doctor@example.com',
            password='password123',
            user_type='doctor'
        )
        self.user.primary_facility = self.facility
        self.user.save(update_fields=['primary_facility'])
        from apps.users.models import Staff
        
        self.staff = Staff.objects.create(
            user=self.user,
            employee_id='EMP-001',
            department='Cardiology',
            position='Senior Doctor',
            hire_date=date.today(),
            primary_facility=self.facility,
        )
        self.practitioner = PractitionerProfile.objects.create(
            staff=self.staff,
            license_number='LIC-12345',
            specialization='Cardiology',
            qualification='MD',
            fhir_practitioner_id='practitioner-123'
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.client.credentials(HTTP_X_FACILITY_CODE=self.facility.code)

    @patch('apps.appointments.services.SlotProxy')
    @patch('apps.appointments.services.ScheduleProxy')
    def test_generate_slots_with_breaks(self, mock_schedule_proxy, mock_slot_proxy):
        # Mock ScheduleProxy.create
        mock_schedule_proxy.create.return_value = {"id": "schedule-123"}
        
        # Create a recurring schedule with a break
        schedule = RecurringSchedule.objects.create(
            name="Test Schedule",
            practitioner=self.practitioner,
            facility=self.facility,
            days_of_week=[0, 1, 2, 3, 4, 5, 6],  # All days
            start_time=time(9, 0),
            end_time=time(17, 0),
            slot_duration=30,
            active_from=date.today(),
            breaks=[{"start": "12:00", "end": "13:00"}]
        )

        # Generate slots for today
        target_date = date.today()
        result = AvailabilityService.generate_slots_for_date(
            practitioner_id=str(self.practitioner.id),
            target_date=target_date,
            user=self.user
        )

        # Verify slots count
        # 9-12 (3 hours = 6 slots) + 13-17 (4 hours = 8 slots) = 14 slots
        self.assertEqual(result['slots_created'], 14)
        
        # Verify SlotProxy.create was called 14 times
        self.assertEqual(mock_slot_proxy.create.call_count, 14)

    def test_preview_slots_endpoint(self):
        url = '/api/appointments/recurring-schedules/preview_slots/'
        data = {
            'start_time': '09:00',
            'end_time': '17:00',
            'slot_duration': 30,
            'breaks': [{'start': '12:00', 'end': '13:00'}]
        }
        
        response = self.client.post(url, data, format='json')
        self.assertEqual(response.status_code, 200)
        
        slots = response.data['slots']
        # 9-12 (6 slots) + 13-17 (8 slots) = 14 slots
        self.assertEqual(len(slots), 14)
        
        # Check specific slots
        start_times = [s['start'] for s in slots]
        self.assertIn('09:00', start_times)
        self.assertIn('11:30', start_times)
        self.assertNotIn('12:00', start_times)
        self.assertNotIn('12:30', start_times)
        self.assertIn('13:00', start_times)

    @patch('apps.appointments.services.SlotProxy')
    @patch('apps.appointments.services.ScheduleProxy')
    def test_generate_slots_overlapping_break(self, mock_schedule_proxy, mock_slot_proxy):
        # Mock ScheduleProxy.create
        mock_schedule_proxy.create.return_value = {"id": "schedule-123"}

        # Test where a slot would partially overlap a break
        # 9:00 - 10:00, 30 min slots. Break 9:15 - 9:45.
        
        schedule = RecurringSchedule.objects.create(
            name="Overlap Test",
            practitioner=self.practitioner,
            facility=self.facility,
            days_of_week=[0, 1, 2, 3, 4, 5, 6],
            start_time=time(9, 0),
            end_time=time(10, 0),
            slot_duration=30,
            active_from=date.today(),
            breaks=[{"start": "09:15", "end": "09:45"}]
        )

        target_date = date.today()
        result = AvailabilityService.generate_slots_for_date(
            practitioner_id=str(self.practitioner.id),
            target_date=target_date,
            user=self.user
        )

        # Slot 1: 9:00-9:30. Overlaps break. Skip.
        # Next attempt: 9:45 (end of break).
        # Slot 2: 9:45-10:15. Ends after schedule end (10:00). Skip.
        
        self.assertEqual(result['slots_created'], 0)
        self.assertEqual(mock_slot_proxy.create.call_count, 0)
