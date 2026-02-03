"""
Serializer tests for patients app.

Tests for:
- PatientFHIRMappingSerializer
- PatientSearchSerializer
- RecentPatientSerializer
- PatientRegistrationValidationSerializer
- PatientNoteSerializer
- PatientRegistrationSerializer
"""
import pytest
from datetime import date, time
from unittest.mock import patch, MagicMock

from django.utils import timezone
from rest_framework.test import APIRequestFactory
from rest_framework.request import Request

from apps.patients.serializers import (
    PatientFHIRMappingSerializer, PatientSearchSerializer,
    RecentPatientSerializer, PatientRegistrationValidationSerializer,
    PatientNoteSerializer, PatientRegistrationSerializer,
    generate_unique_mrn
)
from apps.patients.models import PatientRegistrationValidation
from apps.users.models import User
from apps.users.tests.factories import (
    UserFactory, AdminUserFactory, PatientProfileFactory
)
from .factories import (
    PatientFHIRMappingFactory, PatientSearchFactory,
    RecentPatientFactory, PatientRegistrationValidationFactory,
    PatientNoteFactory
)
from apps.organization.models import Clinic, ClinicalUnit, UnitTypeConfig, ClinicSchedule
from apps.core.tests.factories import DefaultFacilityFactory, DepartmentFactory


def create_clinic(facility):
    core_department = DepartmentFactory(facility=facility)
    facility_type, _ = UnitTypeConfig.objects.get_or_create(
        code='facility',
        defaults={
            'name': 'Facility',
            'can_be_root': True,
            'depth_level': 0,
        },
    )
    if not facility_type.can_be_root or facility_type.depth_level != 0:
        facility_type.can_be_root = True
        facility_type.depth_level = 0
        facility_type.save(update_fields=['can_be_root', 'depth_level'])
    department_type, _ = UnitTypeConfig.objects.get_or_create(
        code='department',
        defaults={
            'name': 'Department',
            'depth_level': 1,
        },
    )
    if department_type.depth_level != 1:
        department_type.depth_level = 1
        department_type.save(update_fields=['depth_level'])
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
        core_department=core_department,
    )
    clinic = Clinic.objects.create(
        facility=facility,
        department=department,
        code='OPD-GEN',
        name='General OPD',
        is_active=True,
    )
    today = timezone.localtime(timezone.now()).weekday()
    ClinicSchedule.objects.create(
        facility=facility,
        department=department,
        clinic=clinic,
        day_of_week=today,
        start_time=time(0, 0),
        end_time=time(23, 59),
        is_active=True,
    )
    return clinic


# =============================================================================
# PatientFHIRMappingSerializer Tests
# =============================================================================

@pytest.mark.tier1
class TestPatientFHIRMappingSerializer:
    """Tests for PatientFHIRMappingSerializer."""

    def test_serializer_contains_expected_fields(self, db):
        """Test serializer includes all expected fields."""
        mapping = PatientFHIRMappingFactory()
        serializer = PatientFHIRMappingSerializer(mapping)

        expected_fields = [
            'id', 'patient_profile', 'patient_profile_details',
            'fhir_patient_id', 'fhir_resource_version', 'last_synced',
            'is_synced', 'created_at', 'updated_at', 'created_by', 'updated_by'
        ]

        for field in expected_fields:
            assert field in serializer.data

    def test_patient_profile_details_nested(self, db):
        """Test that patient_profile_details is properly nested."""
        mapping = PatientFHIRMappingFactory()
        serializer = PatientFHIRMappingSerializer(mapping)

        assert 'patient_profile_details' in serializer.data
        assert 'medical_record_number' in serializer.data['patient_profile_details']

    def test_read_only_fields(self, db):
        """Test that read-only fields cannot be set."""
        mapping = PatientFHIRMappingFactory()
        serializer = PatientFHIRMappingSerializer(mapping)

        read_only = serializer.Meta.read_only_fields
        assert 'id' in read_only
        assert 'last_synced' in read_only
        assert 'created_at' in read_only


# =============================================================================
# PatientSearchSerializer Tests
# =============================================================================

@pytest.mark.tier1
class TestPatientSearchSerializer:
    """Tests for PatientSearchSerializer."""

    def test_serializer_contains_expected_fields(self, db):
        """Test serializer includes all expected fields."""
        search = PatientSearchFactory()
        serializer = PatientSearchSerializer(search)

        expected_fields = [
            'id', 'user', 'facility', 'user_details', 'search_query', 'search_date'
        ]

        for field in expected_fields:
            assert field in serializer.data

    def test_user_details_nested(self, db):
        """Test that user_details is properly nested."""
        search = PatientSearchFactory()
        serializer = PatientSearchSerializer(search)

        assert 'user_details' in serializer.data
        assert 'email' in serializer.data['user_details']


# =============================================================================
# RecentPatientSerializer Tests
# =============================================================================

@pytest.mark.tier1
class TestRecentPatientSerializer:
    """Tests for RecentPatientSerializer."""

    def test_serializer_contains_expected_fields(self, db):
        """Test serializer includes all expected fields."""
        recent = RecentPatientFactory()
        serializer = RecentPatientSerializer(recent)

        expected_fields = [
            'id', 'user', 'user_details', 'patient_profile',
            'patient_profile_details', 'access_date'
        ]

        for field in expected_fields:
            assert field in serializer.data

    def test_patient_profile_details_nested(self, db):
        """Test that patient_profile_details is properly nested."""
        recent = RecentPatientFactory()
        serializer = RecentPatientSerializer(recent)

        assert 'patient_profile_details' in serializer.data
        assert 'medical_record_number' in serializer.data['patient_profile_details']


# =============================================================================
# PatientRegistrationValidationSerializer Tests
# =============================================================================

@pytest.mark.tier1
class TestPatientRegistrationValidationSerializer:
    """Tests for PatientRegistrationValidationSerializer."""

    def test_serializer_contains_expected_fields(self, db):
        """Test serializer includes all expected fields."""
        validation = PatientRegistrationValidationFactory()
        serializer = PatientRegistrationValidationSerializer(validation)

        expected_fields = [
            'id', 'field_name', 'validation_regex', 'validation_message',
            'is_required', 'is_active', 'created_at', 'updated_at',
            'created_by', 'updated_by'
        ]

        for field in expected_fields:
            assert field in serializer.data

    def test_serialization_values(self, db):
        """Test serialization produces correct values."""
        validation = PatientRegistrationValidationFactory(
            field_name='phone_number',
            validation_regex=r'^\d{10}$',
            validation_message='Phone must be 10 digits',
            is_required=True,
            is_active=True
        )
        serializer = PatientRegistrationValidationSerializer(validation)

        assert serializer.data['field_name'] == 'phone_number'
        assert serializer.data['validation_regex'] == r'^\d{10}$'
        assert serializer.data['validation_message'] == 'Phone must be 10 digits'
        assert serializer.data['is_required'] is True
        assert serializer.data['is_active'] is True


# =============================================================================
# PatientNoteSerializer Tests
# =============================================================================

@pytest.mark.tier1
class TestPatientNoteSerializer:
    """Tests for PatientNoteSerializer."""

    def test_serializer_contains_expected_fields(self, db):
        """Test serializer includes all expected fields."""
        note = PatientNoteFactory()
        serializer = PatientNoteSerializer(note)

        expected_fields = [
            'id', 'patient_profile', 'patient_profile_details',
            'note_text', 'is_private', 'created_at', 'updated_at',
            'created_by', 'created_by_details', 'updated_by'
        ]

        for field in expected_fields:
            assert field in serializer.data

    def test_nested_details(self, db):
        """Test that nested details are properly serialized."""
        note = PatientNoteFactory()
        serializer = PatientNoteSerializer(note)

        assert 'patient_profile_details' in serializer.data
        assert 'created_by_details' in serializer.data


# =============================================================================
# PatientRegistrationSerializer Tests
# =============================================================================

@pytest.mark.tier1
class TestPatientRegistrationSerializer:
    """Tests for PatientRegistrationSerializer."""

    @pytest.fixture
    def request_context(self, db):
        """Create a mock request context for serializer."""
        from rest_framework.test import force_authenticate
        admin = AdminUserFactory()
        factory = APIRequestFactory()
        request = factory.post('/api/patients/register/')
        force_authenticate(request, user=admin)
        drf_request = Request(request)
        # Manually set user since force_authenticate only works in view context
        drf_request._user = admin
        facility = admin.primary_facility or DefaultFacilityFactory()
        drf_request.facility = facility
        drf_request.facility_code = facility.code
        return {'request': drf_request}

    def test_valid_registration_data(self, db, request_context):
        """Test validation of valid registration data."""
        facility = request_context['request'].facility
        clinic = create_clinic(facility)
        data = {
            'email': 'newpatient@test.com',
            'first_name': 'New',
            'last_name': 'Patient',
            'date_of_birth': '1990-01-15',
            'phone_number': '1234567890',
            'admission_details': {
                'type': 'outpatient',
                'department_id': str(clinic.department_id),
                'clinic_id': str(clinic.id),
            },
        }

        serializer = PatientRegistrationSerializer(
            data=data,
            context=request_context
        )

        assert serializer.is_valid(), serializer.errors

    def test_duplicate_email_rejected(self, db, request_context):
        """Test that duplicate email is rejected."""
        UserFactory(email='existing@test.com')
        facility = request_context['request'].facility
        clinic = create_clinic(facility)

        data = {
            'email': 'existing@test.com',
            'first_name': 'New',
            'last_name': 'Patient',
            'date_of_birth': '1990-01-15',
            'admission_details': {
                'type': 'outpatient',
                'department_id': str(clinic.department_id),
                'clinic_id': str(clinic.id),
            },
        }

        serializer = PatientRegistrationSerializer(
            data=data,
            context=request_context
        )

        assert not serializer.is_valid()
        assert 'email' in serializer.errors

    def test_required_fields(self, db, request_context):
        """Test that required fields are validated."""
        facility = request_context['request'].facility
        clinic = create_clinic(facility)
        data = {
            'email': 'test@test.com',
            # Missing first_name, last_name, date_of_birth
            'admission_details': {
                'type': 'outpatient',
                'department_id': str(clinic.department_id),
                'clinic_id': str(clinic.id),
            },
        }

        serializer = PatientRegistrationSerializer(
            data=data,
            context=request_context
        )

        assert not serializer.is_valid()
        assert 'first_name' in serializer.errors or 'last_name' in serializer.errors or 'date_of_birth' in serializer.errors

    def test_optional_fields(self, db, request_context):
        """Test that optional fields are accepted."""
        facility = request_context['request'].facility
        clinic = create_clinic(facility)
        data = {
            'email': 'optional@test.com',
            'first_name': 'Optional',
            'last_name': 'Patient',
            'date_of_birth': '1990-01-15',
            'phone_number': '1234567890',
            'nhis_id': 'NHIS123',
            'blood_group': 'A+',
            'allergies': 'Penicillin',
            'emergency_contact_name': 'John Doe',
            'emergency_contact_phone': '0987654321',
            'emergency_contact_relationship': 'Spouse',
            'address_line1': '123 Main St',
            'city': 'Test City',
            'state': 'TS',
            'postal_code': '12345',
            'country': 'Testland',
            'admission_details': {
                'type': 'outpatient',
                'department_id': str(clinic.department_id),
                'clinic_id': str(clinic.id),
            },
        }

        serializer = PatientRegistrationSerializer(
            data=data,
            context=request_context
        )

        assert serializer.is_valid(), serializer.errors

    def test_custom_validation_rules_applied(self, db, request_context):
        """Test that custom validation rules are applied."""
        # Create a validation rule
        PatientRegistrationValidation.objects.create(
            field_name='phone_number',
            validation_regex=r'^\d{10}$',
            validation_message='Phone number must be exactly 10 digits',
            is_required=True,
            is_active=True,
            created_by=request_context['request'].user,
            updated_by=request_context['request'].user
        )
        facility = request_context['request'].facility
        clinic = create_clinic(facility)

        # Test with invalid phone number
        data = {
            'email': 'validrule@test.com',
            'first_name': 'Test',
            'last_name': 'Patient',
            'date_of_birth': '1990-01-15',
            'phone_number': '123',  # Too short
            'admission_details': {
                'type': 'outpatient',
                'department_id': str(clinic.department_id),
                'clinic_id': str(clinic.id),
            },
        }

        serializer = PatientRegistrationSerializer(
            data=data,
            context=request_context
        )

        assert not serializer.is_valid()
        assert 'phone_number' in serializer.errors

    @patch('apps.wards.tasks.sync_encounter_to_fhir.delay')
    @patch('apps.patients.tasks.create_patient_in_fhir.delay')
    def test_create_patient_with_fhir(self, mock_create_task, mock_sync_encounter_task, db, request_context, django_capture_on_commit_callbacks):
        """Test creating a patient queues FHIR resource creation."""
        mock_create_task.return_value = MagicMock(id='task-123')
        mock_sync_encounter_task.return_value = MagicMock(id='task-456')
        facility = request_context['request'].facility
        clinic = create_clinic(facility)

        data = {
            'email': 'fhirpatient@test.com',
            'first_name': 'FHIR',
            'last_name': 'Patient',
            'date_of_birth': '1990-01-15',
            'phone_number': '1234567890',
            'admission_details': {
                'type': 'outpatient',
                'department_id': str(clinic.department_id),
                'clinic_id': str(clinic.id),
            },
        }

        serializer = PatientRegistrationSerializer(
            data=data,
            context=request_context
        )

        assert serializer.is_valid(), serializer.errors

        with django_capture_on_commit_callbacks(execute=True):
            patient_profile = serializer.save()
        mock_create_task.assert_called_once()

        assert patient_profile.user.email == 'fhirpatient@test.com'
        assert patient_profile.user.first_name == 'FHIR'
        assert patient_profile.medical_record_number.startswith('HMS-')
        assert patient_profile.patient_identity_id is not None

        from apps.mpi.models import PatientFacilityLink
        link = PatientFacilityLink.objects.filter(
            patient_identity_id=patient_profile.patient_identity_id
        ).first()
        assert link is not None


# =============================================================================
# MRN Generation Tests
# =============================================================================

@pytest.mark.tier1
class TestMRNGeneration:
    """Tests for MRN generation utility."""

    def test_mrn_format(self, db):
        """Test MRN follows expected format."""
        mrn = generate_unique_mrn()

        # Format: HMS-YYYY-NNNNN
        parts = mrn.split('-')
        assert len(parts) == 3
        assert parts[0] == 'HMS'
        assert len(parts[1]) == 4  # Year
        assert len(parts[2]) == 5  # Random digits
        assert parts[1].isdigit()
        assert parts[2].isdigit()

    def test_mrn_uniqueness(self, db):
        """Test generated MRNs are unique."""
        mrns = set()
        for _ in range(100):
            mrn = generate_unique_mrn()
            assert mrn not in mrns
            mrns.add(mrn)

    def test_mrn_includes_current_year(self, db):
        """Test MRN includes current year."""
        from datetime import datetime
        mrn = generate_unique_mrn()
        current_year = str(datetime.now().year)

        assert current_year in mrn
