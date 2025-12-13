"""
Model tests for users app.

Tests for:
- User model (creation, validation, email as username)
- Staff model (employee_id uniqueness, audit fields)
- PractitionerProfile model (license uniqueness, FHIR mapping)
- PatientProfile model (MRN uniqueness, allergies, emergency contacts)
- PasswordResetToken model (token generation, validation, expiration)
- UserPatientList model (unique constraint, pinning)
"""
import pytest
from datetime import timedelta
from django.utils import timezone
from django.core.exceptions import ValidationError
from django.db import IntegrityError

from apps.users.models import (
    User, Staff, PractitionerProfile, PatientProfile,
    PasswordResetToken, UserPatientList
)
from .factories import (
    UserFactory, AdminUserFactory, DoctorUserFactory, NurseUserFactory,
    PatientUserFactory, StaffFactory, PractitionerProfileFactory,
    PatientProfileFactory, PasswordResetTokenFactory, UserPatientListFactory
)


# =============================================================================
# User Model Tests
# =============================================================================

@pytest.mark.tier1
class TestUserModel:
    """Tests for the User model."""

    def test_user_creation(self, db):
        """Test creating a user with all required fields."""
        user = UserFactory(
            email='test@example.com',
            first_name='John',
            last_name='Doe',
            user_type='doctor'
        )

        assert user.email == 'test@example.com'
        assert user.first_name == 'John'
        assert user.last_name == 'Doe'
        assert user.user_type == 'doctor'
        assert user.is_active is True
        assert user.check_password('testpass123')

    def test_user_string_representation(self, db):
        """Test __str__ returns email."""
        user = UserFactory(email='string_test@example.com')
        assert str(user) == 'string_test@example.com'

    def test_email_as_username_field(self, db):
        """Test that email is the USERNAME_FIELD."""
        assert User.USERNAME_FIELD == 'email'

    def test_email_uniqueness(self, db):
        """Test that email must be unique."""
        UserFactory(email='unique@example.com')

        with pytest.raises(IntegrityError):
            UserFactory(email='unique@example.com')

    def test_user_types(self, db):
        """Test all valid user types can be created."""
        user_types = [
            'admin', 'doctor', 'nurse', 'receptionist',
            'lab_technician', 'pharmacist', 'billing', 'patient'
        ]

        for user_type in user_types:
            user = UserFactory(user_type=user_type)
            assert user.user_type == user_type

    def test_user_full_name(self, db):
        """Test get_full_name returns correct value."""
        user = UserFactory(first_name='Jane', last_name='Smith')
        assert user.get_full_name() == 'Jane Smith'

    def test_superuser_creation(self, db):
        """Test creating a superuser."""
        admin = AdminUserFactory()
        assert admin.is_staff is True
        assert admin.is_superuser is True
        assert admin.user_type == 'admin'

    def test_password_hashing(self, db):
        """Test password is properly hashed."""
        user = UserFactory(password='secretpassword')
        assert user.password != 'secretpassword'
        assert user.check_password('secretpassword')

    def test_uuid_primary_key(self, db):
        """Test that user ID is a UUID."""
        user = UserFactory()
        assert len(str(user.id)) == 36  # UUID format


# =============================================================================
# Staff Model Tests
# =============================================================================

@pytest.mark.tier1
class TestStaffModel:
    """Tests for the Staff model."""

    def test_staff_creation(self, db):
        """Test creating a staff profile."""
        staff = StaffFactory(
            employee_id='EMP99999',
            department='Cardiology',
            position='Senior Doctor'
        )

        assert staff.employee_id == 'EMP99999'
        assert staff.department == 'Cardiology'
        assert staff.position == 'Senior Doctor'
        assert staff.user is not None

    def test_staff_string_representation(self, db):
        """Test __str__ returns employee_id and full name."""
        user = DoctorUserFactory(first_name='John', last_name='Doe')
        staff = StaffFactory(user=user, employee_id='EMP12345')

        expected = f"EMP12345 - John Doe"
        assert str(staff) == expected

    def test_employee_id_uniqueness(self, db):
        """Test that employee_id must be unique."""
        StaffFactory(employee_id='UNIQUE001')

        with pytest.raises(IntegrityError):
            StaffFactory(employee_id='UNIQUE001')

    def test_one_to_one_user_relationship(self, db):
        """Test that user can only have one staff profile."""
        user = DoctorUserFactory()
        StaffFactory(user=user)

        with pytest.raises(IntegrityError):
            StaffFactory(user=user)

    def test_audit_fields(self, db):
        """Test that audit fields are set correctly."""
        staff = StaffFactory()

        assert staff.created_at is not None
        assert staff.updated_at is not None
        assert staff.created_by is not None


# =============================================================================
# PractitionerProfile Model Tests
# =============================================================================

@pytest.mark.tier1
class TestPractitionerProfileModel:
    """Tests for the PractitionerProfile model."""

    def test_practitioner_creation(self, db):
        """Test creating a practitioner profile."""
        practitioner = PractitionerProfileFactory(
            license_number='LIC99999999',
            specialization='Internal Medicine',
            qualification='MD, MBBS'
        )

        assert practitioner.license_number == 'LIC99999999'
        assert practitioner.specialization == 'Internal Medicine'
        assert practitioner.qualification == 'MD, MBBS'

    def test_practitioner_string_representation(self, db):
        """Test __str__ returns doctor name and specialization."""
        user = DoctorUserFactory(first_name='Sarah', last_name='Johnson')
        staff = StaffFactory(user=user)
        practitioner = PractitionerProfileFactory(
            staff=staff,
            specialization='Cardiology'
        )

        assert 'Sarah Johnson' in str(practitioner)
        assert 'Cardiology' in str(practitioner)

    def test_license_number_uniqueness(self, db):
        """Test that license_number must be unique."""
        PractitionerProfileFactory(license_number='UNIQUE_LIC')

        with pytest.raises(IntegrityError):
            PractitionerProfileFactory(license_number='UNIQUE_LIC')

    def test_fhir_practitioner_id_optional(self, db):
        """Test that fhir_practitioner_id is optional."""
        practitioner = PractitionerProfileFactory(fhir_practitioner_id=None)
        assert practitioner.fhir_practitioner_id is None

        practitioner_with_fhir = PractitionerProfileFactory(
            fhir_practitioner_id='fhir-123'
        )
        assert practitioner_with_fhir.fhir_practitioner_id == 'fhir-123'


# =============================================================================
# PatientProfile Model Tests
# =============================================================================

@pytest.mark.tier1
class TestPatientProfileModel:
    """Tests for the PatientProfile model."""

    def test_patient_profile_creation(self, db):
        """Test creating a patient profile."""
        patient = PatientProfileFactory(
            medical_record_number='MRN99999999',
            blood_group='A+',
            allergies='Penicillin'
        )

        assert patient.medical_record_number == 'MRN99999999'
        assert patient.blood_group == 'A+'
        assert patient.allergies == 'Penicillin'

    def test_patient_string_representation(self, db):
        """Test __str__ returns MRN and patient name."""
        user = PatientUserFactory(first_name='Bob', last_name='Wilson')
        patient = PatientProfileFactory(
            user=user,
            medical_record_number='MRN123'
        )

        assert 'MRN123' in str(patient)
        assert 'Bob Wilson' in str(patient)

    def test_mrn_uniqueness(self, db):
        """Test that medical_record_number must be unique."""
        PatientProfileFactory(medical_record_number='UNIQUE_MRN')

        with pytest.raises(IntegrityError):
            PatientProfileFactory(medical_record_number='UNIQUE_MRN')

    def test_emergency_contact_fields(self, db):
        """Test emergency contact fields."""
        patient = PatientProfileFactory(
            emergency_contact_name='Jane Doe',
            emergency_contact_phone='+1234567890',
            emergency_contact_relationship='Spouse'
        )

        assert patient.emergency_contact_name == 'Jane Doe'
        assert patient.emergency_contact_phone == '+1234567890'
        assert patient.emergency_contact_relationship == 'Spouse'

    def test_allergies_optional(self, db):
        """Test that allergies field is optional."""
        patient = PatientProfileFactory(allergies=None)
        assert patient.allergies is None

    def test_fhir_patient_id_optional(self, db):
        """Test that fhir_patient_id is optional."""
        patient = PatientProfileFactory(fhir_patient_id=None)
        assert patient.fhir_patient_id is None

    def test_database_indexes(self, db):
        """Test that important fields are indexed."""
        indexes = PatientProfile._meta.indexes
        indexed_fields = [idx.fields for idx in indexes]

        # MRN should be indexed
        assert any('medical_record_number' in fields for fields in indexed_fields)


# =============================================================================
# PasswordResetToken Model Tests
# =============================================================================

@pytest.mark.tier1
class TestPasswordResetTokenModel:
    """Tests for the PasswordResetToken model."""

    def test_token_generation(self, db):
        """Test generating a secure token."""
        token = PasswordResetToken.generate_token()

        assert token is not None
        assert len(token) > 20  # Should be a long token

    def test_token_hashing(self, db):
        """Test token hashing."""
        plain_token = "test_token_123"
        hashed = PasswordResetToken.hash_token(plain_token)

        assert hashed != plain_token
        assert len(hashed) == 64  # SHA-256 produces 64 hex chars
        assert PasswordResetToken.hash_token(plain_token) == hashed  # Consistent

    def test_create_for_user(self, db):
        """Test creating a token for a user."""
        user = UserFactory()
        plain_token, token_obj = PasswordResetToken.create_for_user(user)

        assert plain_token is not None
        assert token_obj.user == user
        assert token_obj.is_used is False
        assert token_obj.expires_at > timezone.now()

    def test_verify_valid_token(self, db):
        """Test verifying a valid token."""
        user = UserFactory()
        plain_token, token_obj = PasswordResetToken.create_for_user(user)

        verified_user, verified_token = PasswordResetToken.verify_token(plain_token)

        assert verified_user == user
        assert verified_token == token_obj

    def test_verify_invalid_token(self, db):
        """Test verifying an invalid token."""
        verified_user, verified_token = PasswordResetToken.verify_token('invalid_token')

        assert verified_user is None
        assert verified_token is None

    def test_verify_expired_token(self, db):
        """Test that expired tokens are rejected."""
        user = UserFactory()
        plain_token, token_obj = PasswordResetToken.create_for_user(
            user,
            expiry_minutes=-1  # Already expired
        )

        verified_user, verified_token = PasswordResetToken.verify_token(plain_token)

        assert verified_user is None
        assert verified_token is None

    def test_verify_used_token(self, db):
        """Test that used tokens are rejected."""
        user = UserFactory()
        plain_token, token_obj = PasswordResetToken.create_for_user(user)
        token_obj.mark_as_used()

        verified_user, verified_token = PasswordResetToken.verify_token(plain_token)

        assert verified_user is None
        assert verified_token is None

    def test_mark_as_used(self, db):
        """Test marking a token as used."""
        user = UserFactory()
        plain_token, token_obj = PasswordResetToken.create_for_user(user)

        assert token_obj.is_used is False
        assert token_obj.used_at is None

        token_obj.mark_as_used()

        assert token_obj.is_used is True
        assert token_obj.used_at is not None

    def test_old_tokens_invalidated(self, db):
        """Test that creating a new token invalidates old ones."""
        user = UserFactory()
        _, old_token = PasswordResetToken.create_for_user(user)

        # Create a new token
        _, new_token = PasswordResetToken.create_for_user(user)

        old_token.refresh_from_db()
        assert old_token.is_used is True
        assert new_token.is_used is False

    def test_reset_types(self, db):
        """Test different reset types."""
        user = UserFactory()
        admin = AdminUserFactory()

        # Self-service reset
        _, token1 = PasswordResetToken.create_for_user(user, reset_type='self_service')
        assert token1.reset_type == 'self_service'
        assert token1.initiated_by is None

        # Admin-initiated reset
        _, token2 = PasswordResetToken.create_for_user(
            user,
            reset_type='admin_force',
            initiated_by=admin
        )
        assert token2.reset_type == 'admin_force'
        assert token2.initiated_by == admin


# =============================================================================
# UserPatientList Model Tests
# =============================================================================

@pytest.mark.tier1
class TestUserPatientListModel:
    """Tests for the UserPatientList model."""

    def test_add_patient_to_list(self, db):
        """Test adding a patient to a clinician's list."""
        doctor = DoctorUserFactory()
        patient = PatientProfileFactory()

        list_entry = UserPatientList.objects.create(
            user=doctor,
            patient=patient,
            notes='Follow-up needed'
        )

        assert list_entry.user == doctor
        assert list_entry.patient == patient
        assert list_entry.notes == 'Follow-up needed'
        assert list_entry.is_pinned is False

    def test_unique_constraint(self, db):
        """Test that same patient can't be added twice by same user."""
        doctor = DoctorUserFactory()
        patient = PatientProfileFactory()

        UserPatientList.objects.create(user=doctor, patient=patient)

        with pytest.raises(IntegrityError):
            UserPatientList.objects.create(user=doctor, patient=patient)

    def test_same_patient_different_users(self, db):
        """Test that same patient can be in multiple users' lists."""
        doctor1 = DoctorUserFactory()
        doctor2 = DoctorUserFactory()
        patient = PatientProfileFactory()

        list1 = UserPatientList.objects.create(user=doctor1, patient=patient)
        list2 = UserPatientList.objects.create(user=doctor2, patient=patient)

        assert list1.patient == list2.patient
        assert list1.user != list2.user

    def test_pinning(self, db):
        """Test pinning functionality."""
        entry = UserPatientListFactory(is_pinned=False)
        assert entry.is_pinned is False

        entry.is_pinned = True
        entry.save()
        entry.refresh_from_db()

        assert entry.is_pinned is True

    def test_string_representation(self, db):
        """Test __str__ returns user email and patient MRN."""
        doctor = DoctorUserFactory(email='doctor@test.com')
        patient = PatientProfileFactory(medical_record_number='MRN999')
        entry = UserPatientList.objects.create(user=doctor, patient=patient)

        assert 'doctor@test.com' in str(entry)
        assert 'MRN999' in str(entry)

    def test_ordering(self, db):
        """Test default ordering (pinned first, then by added_at)."""
        doctor = DoctorUserFactory()
        patient1 = PatientProfileFactory()
        patient2 = PatientProfileFactory()
        patient3 = PatientProfileFactory()

        # Add in order: patient1 (not pinned), patient2 (pinned), patient3 (not pinned)
        entry1 = UserPatientList.objects.create(user=doctor, patient=patient1, is_pinned=False)
        entry2 = UserPatientList.objects.create(user=doctor, patient=patient2, is_pinned=True)
        entry3 = UserPatientList.objects.create(user=doctor, patient=patient3, is_pinned=False)

        # Get ordered queryset
        entries = list(UserPatientList.objects.filter(user=doctor))

        # Pinned entry should be first
        assert entries[0] == entry2
