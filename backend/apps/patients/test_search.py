from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase
from django.contrib.auth import get_user_model
from apps.users.models import PatientProfile
from apps.wards.models import Ward, Bed, Admission
from django.utils import timezone
from datetime import timedelta

User = get_user_model()

class PatientSearchTests(APITestCase):
    def setUp(self):
        # Create user
        self.user = User.objects.create_user(
            username='testuser',
            email='testuser@example.com',
            password='testpassword',
            first_name='Test',
            last_name='User'
        )
        self.client.force_authenticate(user=self.user)

        # Create patients
        self.patient1_user = User.objects.create_user(
            username='patient1',
            email='patient1@example.com',
            password='testpassword',
            first_name='John',
            last_name='Doe',
            date_of_birth='1980-01-01'
        )
        self.patient1 = PatientProfile.objects.create(
            user=self.patient1_user,
            medical_record_number='MRN001',
            nhis_id='NHIS001'
        )

        self.patient2_user = User.objects.create_user(
            username='patient2',
            email='patient2@example.com',
            password='testpassword',
            first_name='Jane',
            last_name='Smith',
            date_of_birth='1990-01-01'
        )
        self.patient2 = PatientProfile.objects.create(
            user=self.patient2_user,
            medical_record_number='MRN002',
            nhis_id='NHIS002'
        )

        # Create Ward and Bed
        self.ward = Ward.objects.create(
            name="General Ward",
            ward_type="general",
            total_beds=10,
            base_rate_per_night=100.00
        )
        self.bed = Bed.objects.create(
            ward=self.ward,
            bed_number="101",
            status="available"
        )

        # Admit Patient 1
        self.admission_date = timezone.now().date()
        self.admission = Admission.objects.create(
            patient=self.patient1,
            bed=self.bed,
            admission_date=timezone.now(),
            status='admitted',
            admission_type='emergency'
        )
        self.bed.status = 'occupied'
        self.bed.save()

    def test_search_by_name(self):
        url = reverse('patient-search')
        response = self.client.get(url, {'query': 'John'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['total'], 1)
        self.assertEqual(response.data['patients'][0]['local_data']['id'], str(self.patient1.id))
        # Verify current_ward is returned
        self.assertEqual(response.data['patients'][0]['local_data']['current_ward'], "General Ward")

    def test_search_by_mrn(self):
        url = reverse('patient-search')
        response = self.client.get(url, {'query': 'MRN002'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['total'], 1)
        self.assertEqual(response.data['patients'][0]['local_data']['id'], str(self.patient2.id))
        # Verify current_ward for non-admitted patient
        self.assertEqual(response.data['patients'][0]['local_data']['current_ward'], "Not Admitted")

    def test_search_by_ward(self):
        url = reverse('patient-search')
        # Search for patients in General Ward
        response = self.client.get(url, {'ward': str(self.ward.id)})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['total'], 1)
        self.assertEqual(response.data['patients'][0]['local_data']['id'], str(self.patient1.id))

        # Search for patients in a non-existent ward (or just different ID)
        response = self.client.get(url, {'ward': '00000000-0000-0000-0000-000000000000'}) # Assuming UUID
        self.assertEqual(response.data['total'], 0)

    def test_search_by_admission_date(self):
        url = reverse('patient-search')
        # Search for patients admitted today
        response = self.client.get(url, {'admission_date': self.admission_date.strftime('%Y-%m-%d')})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['total'], 1)
        self.assertEqual(response.data['patients'][0]['local_data']['id'], str(self.patient1.id))

        # Search for patients admitted yesterday
        yesterday = self.admission_date - timedelta(days=1)
        response = self.client.get(url, {'admission_date': yesterday.strftime('%Y-%m-%d')})
        self.assertEqual(response.data['total'], 0)

    def test_combined_search(self):
        url = reverse('patient-search')
        # Search by name AND ward
        response = self.client.get(url, {'query': 'John', 'ward': str(self.ward.id)})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['total'], 1)

        # Search by name AND wrong ward
        response = self.client.get(url, {'query': 'John', 'ward': '00000000-0000-0000-0000-000000000000'})
        self.assertEqual(response.data['total'], 0)
