from django.test import TestCase
from django.utils import timezone
from datetime import datetime, timedelta, date, time
from apps.appointments.services import AvailabilityService
from apps.appointments.models import PractitionerAvailabilityRule
from apps.users.models import PractitionerProfile, User
from apps.core.models import Facility
from rest_framework.test import APIClient


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

    def test_compute_personal_calendar_slots_with_breaks(self):
        PractitionerAvailabilityRule.objects.create(
            name="Test Schedule",
            practitioner=self.practitioner,
            facility=self.facility,
            days_of_week=[0, 1, 2, 3, 4, 5, 6],
            start_time=time(9, 0),
            end_time=time(17, 0),
            slot_duration=30,
            active_from=date.today(),
            breaks=[{"start": "12:00", "end": "13:00"}]
        )

        target_date = date.today()
        result = AvailabilityService.compute_available_slots(
            practitioner_id=str(self.practitioner.id),
            start_date=target_date.isoformat(),
            end_date=target_date.isoformat(),
            facility=self.facility,
        )

        free_slots = [slot for slot in result if slot['status'] == 'free']
        start_times = [datetime.fromisoformat(slot['start']).time() for slot in free_slots]
        self.assertEqual(len(free_slots), 14)
        self.assertIn(time(9, 0), start_times)
        self.assertIn(time(11, 30), start_times)
        self.assertNotIn(time(12, 0), start_times)
        self.assertNotIn(time(12, 30), start_times)
        self.assertIn(time(13, 0), start_times)

    def test_preview_slots_endpoint(self):
        url = '/api/appointments/availability-rules/preview_slots/'
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

    def test_compute_personal_calendar_slots_skip_overlapping_break(self):
        PractitionerAvailabilityRule.objects.create(
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
        result = AvailabilityService.compute_available_slots(
            practitioner_id=str(self.practitioner.id),
            start_date=target_date.isoformat(),
            end_date=target_date.isoformat(),
            facility=self.facility,
        )

        self.assertEqual([slot for slot in result if slot['status'] == 'free'], [])
