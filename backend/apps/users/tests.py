"""
Unit tests for the users app.
"""
from django.test import TestCase
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient
from rest_framework import status
from .models import Staff, PractitionerProfile, PatientProfile

User = get_user_model()


class UserModelTests(TestCase):
    """
    Test cases for the User model.
    """
    def setUp(self):
        self.user_data = {
            'email': 'test@example.com',
            'username': 'testuser',
            'password': 'testpassword',
            'first_name': 'Test',
            'last_name': 'User',
            'phone_number': '1234567890',
            'user_type': 'doctor'
        }
        self.user = User.objects.create_user(**self.user_data)

    def test_user_creation(self):
        """
        Test that a user can be created with the expected attributes.
        """
        self.assertEqual(self.user.email, self.user_data['email'])
        self.assertEqual(self.user.username, self.user_data['username'])
        self.assertEqual(self.user.first_name, self.user_data['first_name'])
        self.assertEqual(self.user.last_name, self.user_data['last_name'])
        self.assertEqual(self.user.phone_number, self.user_data['phone_number'])
        self.assertEqual(self.user.user_type, self.user_data['user_type'])
        self.assertTrue(self.user.check_password(self.user_data['password']))

    def test_user_string_representation(self):
        """
        Test the string representation of a user.
        """
        self.assertEqual(str(self.user), self.user_data['email'])


class StaffModelTests(TestCase):
    """
    Test cases for the Staff model.
    """
    def setUp(self):
        self.user = User.objects.create_user(
            email='staff@example.com',
            username='staffuser',
            password='staffpassword',
            first_name='Staff',
            last_name='User',
            user_type='doctor'
        )
        self.staff_data = {
            'user': self.user,
            'employee_id': 'EMP001',
            'department': 'Cardiology',
            'position': 'Senior Doctor',
            'hire_date': '2023-01-01'
        }
        self.staff = Staff.objects.create(**self.staff_data)

    def test_staff_creation(self):
        """
        Test that a staff profile can be created with the expected attributes.
        """
        self.assertEqual(self.staff.user, self.user)
        self.assertEqual(self.staff.employee_id, self.staff_data['employee_id'])
        self.assertEqual(self.staff.department, self.staff_data['department'])
        self.assertEqual(self.staff.position, self.staff_data['position'])
        self.assertEqual(str(self.staff.hire_date), self.staff_data['hire_date'])

    def test_staff_string_representation(self):
        """
        Test the string representation of a staff profile.
        """
        expected = f"{self.staff_data['employee_id']} - {self.user.get_full_name()}"
        self.assertEqual(str(self.staff), expected)


class PractitionerProfileModelTests(TestCase):
    """
    Test cases for the PractitionerProfile model.
    """
    def setUp(self):
        self.user = User.objects.create_user(
            email='practitioner@example.com',
            username='practitioneruser',
            password='practitionerpassword',
            first_name='Practitioner',
            last_name='User',
            user_type='doctor'
        )
        self.staff = Staff.objects.create(
            user=self.user,
            employee_id='EMP002',
            department='Cardiology',
            position='Senior Doctor',
            hire_date='2023-01-01'
        )
        self.practitioner_data = {
            'staff': self.staff,
            'license_number': 'LIC001',
            'specialization': 'Cardiology',
            'qualification': 'MD, PhD'
        }
        self.practitioner = PractitionerProfile.objects.create(**self.practitioner_data)

    def test_practitioner_creation(self):
        """
        Test that a practitioner profile can be created with the expected attributes.
        """
        self.assertEqual(self.practitioner.staff, self.staff)
        self.assertEqual(self.practitioner.license_number, self.practitioner_data['license_number'])
        self.assertEqual(self.practitioner.specialization, self.practitioner_data['specialization'])
        self.assertEqual(self.practitioner.qualification, self.practitioner_data['qualification'])

    def test_practitioner_string_representation(self):
        """
        Test the string representation of a practitioner profile.
        """
        expected = f"Dr. {self.user.get_full_name()} - {self.practitioner_data['specialization']}"
        self.assertEqual(str(self.practitioner), expected)


class PatientProfileModelTests(TestCase):
    """
    Test cases for the PatientProfile model.
    """
    def setUp(self):
        self.user = User.objects.create_user(
            email='patient@example.com',
            username='patientuser',
            password='patientpassword',
            first_name='Patient',
            last_name='User',
            user_type='patient'
        )
        self.patient_data = {
            'user': self.user,
            'medical_record_number': 'MRN001',
            'nhis_id': 'NHIS001',
            'blood_group': 'A+',
            'allergies': 'None',
            'emergency_contact_name': 'Emergency Contact',
            'emergency_contact_phone': '9876543210',
            'emergency_contact_relationship': 'Spouse'
        }
        self.patient = PatientProfile.objects.create(**self.patient_data)

    def test_patient_creation(self):
        """
        Test that a patient profile can be created with the expected attributes.
        """
        self.assertEqual(self.patient.user, self.user)
        self.assertEqual(self.patient.medical_record_number, self.patient_data['medical_record_number'])
        self.assertEqual(self.patient.nhis_id, self.patient_data['nhis_id'])
        self.assertEqual(self.patient.blood_group, self.patient_data['blood_group'])
        self.assertEqual(self.patient.allergies, self.patient_data['allergies'])
        self.assertEqual(self.patient.emergency_contact_name, self.patient_data['emergency_contact_name'])
        self.assertEqual(self.patient.emergency_contact_phone, self.patient_data['emergency_contact_phone'])
        self.assertEqual(self.patient.emergency_contact_relationship, self.patient_data['emergency_contact_relationship'])

    def test_patient_string_representation(self):
        """
        Test the string representation of a patient profile.
        """
        expected = f"{self.patient_data['medical_record_number']} - {self.user.get_full_name()}"
        self.assertEqual(str(self.patient), expected)


class UserAPITests(TestCase):
    """
    Test cases for the User API endpoints.
    """
    def setUp(self):
        self.client = APIClient()
        self.admin_user = User.objects.create_superuser(
            email='admin@example.com',
            username='adminuser',
            password='adminpassword'
        )
        self.client.force_authenticate(user=self.admin_user)
        self.user_data = {
            'email': 'newuser@example.com',
            'username': 'newuser',
            'password': 'newuserpassword',
            'first_name': 'New',
            'last_name': 'User',
            'phone_number': '1234567890',
            'user_type': 'patient'
        }

    def test_create_user(self):
        """
        Test creating a new user via the API.
        """
        url = reverse('user-list')
        response = self.client.post(url, self.user_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(User.objects.count(), 2)
        self.assertEqual(User.objects.get(email=self.user_data['email']).username, self.user_data['username'])

    def test_get_user_list(self):
        """
        Test retrieving a list of users via the API.
        """
        url = reverse('user-list')
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['results']), 1)  # Only the admin user

    def test_get_user_detail(self):
        """
        Test retrieving a specific user via the API.
        """
        url = reverse('user-detail', args=[self.admin_user.id])
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['email'], self.admin_user.email)