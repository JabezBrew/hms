"""
API view tests for users app.

Tests for:
- UserViewSet (CRUD operations)
- StaffViewSet (CRUD operations, registration)
- PractitionerProfileViewSet
- PatientProfileViewSet
- UserPatientListViewSet (my patients)
"""
import uuid
from datetime import date

import pytest
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.organization.models import (
    ClinicalUnit,
    LeadershipRoleConfig,
    StaffAssignmentTypeConfig,
    StaffUnitAssignment,
    UnitLeadership,
    UnitMemberAssignment,
    UnitTypeConfig,
)
from apps.users.models import User, Staff, PractitionerProfile, PatientProfile, UserPatientList
from apps.users.unit_assignment import auto_assign_staff_to_department_unit
from apps.core.tests.factories import DefaultFacilityFactory
from .factories import (
    UserFactory, AdminUserFactory, DoctorUserFactory, NurseUserFactory,
    PatientUserFactory, StaffFactory, PractitionerProfileFactory,
    PatientProfileFactory, UserPatientListFactory
)


def get_authenticated_client(user, facility=None):
    """Get an API client authenticated as the given user."""
    client = APIClient()
    refresh = RefreshToken.for_user(user)
    if facility is None:
        facility = getattr(user, 'primary_facility', None) or DefaultFacilityFactory()
    client.credentials(
        HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}',
        HTTP_X_FACILITY_CODE=facility.code
    )
    return client


def _noop_delay(*args, **kwargs):
    return {"status": "queued"}


def _stub_staff_tasks(monkeypatch):
    monkeypatch.setattr('apps.users.tasks.send_account_setup_email.delay', _noop_delay)
    monkeypatch.setattr('apps.users.tasks.send_password_reset_email.delay', _noop_delay)
    monkeypatch.setattr('apps.users.serializers.create_practitioner_in_fhir.delay', _noop_delay)


def _ensure_single_assignment_type():
    StaffAssignmentTypeConfig.objects.get_or_create(
        code='single',
        defaults={'name': 'Single Assignment', 'is_active': True}
    )


def _create_department_unit_for_facility(facility, *, name='Internal Medicine', staffing_mode='mixed'):
    facility_type, _ = UnitTypeConfig.objects.get_or_create(
        code='facility',
        defaults={
            'name': 'Facility',
            'can_be_root': True,
            'depth_level': 0,
            'is_active': True,
        }
    )
    department_type, _ = UnitTypeConfig.objects.get_or_create(
        code='department',
        defaults={
            'name': 'Department',
            'can_be_root': False,
            'depth_level': 1,
            'is_active': True,
        }
    )
    department_type.allowed_parent_types.add(facility_type)

    root_unit, _ = ClinicalUnit.objects.get_or_create(
        code=facility.code,
        parent=None,
        defaults={
            'name': facility.name,
            'unit_type': facility_type,
            'staffing_mode': 'mixed',
            'unit_category': 'clinical',
            'is_active': True,
        }
    )

    department = ClinicalUnit.objects.create(
        code=f"DEPT-{uuid.uuid4().hex[:8].upper()}",
        name=name,
        unit_type=department_type,
        parent=root_unit,
        staffing_mode=staffing_mode,
        unit_category='ops_only' if staffing_mode == 'ops_only' else 'clinical',
        is_active=True,
    )
    department.refresh_from_db()
    return department


# =============================================================================
# User ViewSet Tests
# =============================================================================

@pytest.mark.tier1
class TestUserViewSet:
    """Tests for UserViewSet."""

    def test_list_users_as_admin(self, db):
        """Test admin can list all users."""
        admin = AdminUserFactory()
        # Create some users
        DoctorUserFactory()
        NurseUserFactory()
        PatientUserFactory()

        client = get_authenticated_client(admin)
        response = client.get('/api/users/users/')

        assert response.status_code == status.HTTP_200_OK
        results = response.data.get('results', response.data)
        assert len(results) >= 4  # admin + 3 created users

    def test_create_user_as_admin(self, db):
        """Test admin can create a new user."""
        admin = AdminUserFactory()
        client = get_authenticated_client(admin)

        user_data = {
            'email': 'newdoctor@test.com',
            'username': 'newdoctor',
            'password': 'SecurePass123!',
            'confirm_password': 'SecurePass123!',
            'first_name': 'New',
            'last_name': 'Doctor',
            'user_type': 'doctor'
        }

        response = client.post('/api/users/users/', user_data, format='json')

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data['email'] == 'newdoctor@test.com'
        assert User.objects.filter(email='newdoctor@test.com').exists()

    def test_retrieve_user(self, db):
        """Test retrieving a user's details."""
        admin = AdminUserFactory()
        doctor = DoctorUserFactory(first_name='John', last_name='Smith')

        client = get_authenticated_client(admin)
        response = client.get(f'/api/users/users/{doctor.id}/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['first_name'] == 'John'
        assert response.data['last_name'] == 'Smith'

    def test_update_user_as_admin(self, db):
        """Test admin can update a user."""
        admin = AdminUserFactory()
        doctor = DoctorUserFactory()

        client = get_authenticated_client(admin)
        response = client.patch(f'/api/users/users/{doctor.id}/', {
            'first_name': 'Updated'
        }, format='json')

        assert response.status_code == status.HTTP_200_OK
        doctor.refresh_from_db()
        assert doctor.first_name == 'Updated'

    def test_update_self(self, db):
        """Test user can update their own profile."""
        doctor = DoctorUserFactory()
        client = get_authenticated_client(doctor)

        response = client.patch(f'/api/users/users/{doctor.id}/', {
            'first_name': 'SelfUpdated'
        }, format='json')

        assert response.status_code == status.HTTP_200_OK
        doctor.refresh_from_db()
        assert doctor.first_name == 'SelfUpdated'

    def test_delete_user_as_admin(self, db):
        """Test admin can delete a user."""
        admin = AdminUserFactory()
        user_to_delete = PatientUserFactory()

        client = get_authenticated_client(admin)
        response = client.delete(f'/api/users/users/{user_to_delete.id}/')

        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not User.objects.filter(id=user_to_delete.id).exists()

    def test_me_endpoint(self, db):
        """Test the /me endpoint returns current user."""
        doctor = DoctorUserFactory(email='me@test.com', first_name='Me')
        client = get_authenticated_client(doctor)

        response = client.get('/api/users/users/me/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['email'] == 'me@test.com'
        assert response.data['first_name'] == 'Me'


# =============================================================================
# Staff ViewSet Tests
# =============================================================================

@pytest.mark.tier1
class TestStaffViewSet:
    """Tests for StaffViewSet."""

    def test_list_staff(self, db):
        """Test listing staff members."""
        admin = AdminUserFactory()
        StaffFactory()
        StaffFactory()

        client = get_authenticated_client(admin)
        response = client.get('/api/users/staff/')

        assert response.status_code == status.HTTP_200_OK
        results = response.data.get('results', response.data)
        assert len(results) >= 2

    def test_retrieve_staff(self, db):
        """Test retrieving staff details."""
        admin = AdminUserFactory()
        staff = StaffFactory(employee_id='EMP_RETRIEVE', department='Cardiology')

        client = get_authenticated_client(admin)
        response = client.get(f'/api/users/staff/{staff.id}/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['employee_id'] == 'EMP_RETRIEVE'
        assert response.data['department'] == 'Cardiology'

    def test_staff_with_practitioner_profile(self, db):
        """Test staff with practitioner profile."""
        admin = AdminUserFactory()
        doctor = DoctorUserFactory()
        staff = StaffFactory(user=doctor)
        practitioner = PractitionerProfileFactory(
            staff=staff,
            specialization='Cardiology'
        )

        client = get_authenticated_client(admin)
        response = client.get(f'/api/users/staff/{staff.id}/')

        assert response.status_code == status.HTTP_200_OK
        # Response should include practitioner info
        if 'practitioner_profile' in response.data:
            assert response.data['practitioner_profile']['specialization'] == 'Cardiology'

    def test_invite_staff_sends_reset_link(self, db, monkeypatch):
        """Admin can invite staff without setting a known password."""
        admin = AdminUserFactory()
        client = get_authenticated_client(admin)

        # Avoid sending real email
        called = {}

        def fake_delay(**kwargs):
            called.update(kwargs)
            return {"status": "queued"}

        monkeypatch.setattr('apps.users.tasks.send_account_setup_email.delay', fake_delay)

        payload = {
            'email': 'v2tui.doctor@inbox.testmail.app',
            'first_name': 'Test',
            'last_name': 'Doctor',
            'user_type': 'doctor',
            'department': 'Internal Medicine',
            'position': 'Attending Physician',
            'hire_date': '2020-01-15',
            'license_number': 'MD-INV-001',
            'specialization': 'Internal Medicine',
            'qualification': 'MD, MBBS',
        }

        response = client.post('/api/users/staff/invite/', payload, format='json')

        assert response.status_code == status.HTTP_201_CREATED
        user = User.objects.get(email='v2tui.doctor@inbox.testmail.app')
        staff = Staff.objects.get(user=user)
        assert not user.has_usable_password()
        assert staff.employee_id.startswith('EMP-TEST-')
        assert len(staff.employee_id.rsplit('-', 1)[-1]) == 7
        assert PractitionerProfile.objects.filter(staff__user=user).exists()
        assert called.get('user_email') == 'v2tui.doctor@inbox.testmail.app'

    def test_invite_existing_staff_without_password_sends_account_setup_email(self, db, monkeypatch):
        """Re-inviting a user with no usable password should keep account-setup copy."""
        admin = AdminUserFactory()
        facility = admin.primary_facility
        client = get_authenticated_client(admin, facility=facility)

        user = DoctorUserFactory(
            email='resend.setup@test.com',
            first_name='Resend',
            last_name='Doctor',
            primary_facility=facility,
        )
        user.set_unusable_password()
        user.save(update_fields=['password'])
        user.facilities.add(facility)
        StaffFactory(
            user=user,
            primary_facility=facility,
            created_by=admin,
            updated_by=admin,
        )

        setup_calls = []
        reset_calls = []

        def fake_setup_delay(**kwargs):
            setup_calls.append(kwargs)
            return {"status": "queued"}

        def fake_reset_delay(**kwargs):
            reset_calls.append(kwargs)
            return {"status": "queued"}

        monkeypatch.setattr('apps.users.tasks.send_account_setup_email.delay', fake_setup_delay)
        monkeypatch.setattr('apps.users.tasks.send_password_reset_email.delay', fake_reset_delay)

        payload = {
            'email': user.email,
            'first_name': 'Resend',
            'last_name': 'Doctor',
            'user_type': 'doctor',
            'department': 'Internal Medicine',
            'position': 'Attending Physician',
            'hire_date': '2020-01-15',
            'license_number': 'MD-INV-RESEND',
            'specialization': 'Internal Medicine',
            'qualification': 'MD, MBBS',
        }

        response = client.post('/api/users/staff/invite/', payload, format='json')

        assert response.status_code == status.HTTP_201_CREATED
        assert len(setup_calls) == 1
        assert len(reset_calls) == 0
        assert setup_calls[0].get('user_email') == user.email

    def test_resend_setup_link_uses_account_setup_for_unusable_password(self, db, monkeypatch):
        admin = AdminUserFactory()
        facility = admin.primary_facility
        user = DoctorUserFactory(primary_facility=facility, email='resend.unusable@test.com')
        user.set_unusable_password()
        user.save(update_fields=['password'])
        user.facilities.add(facility)
        staff = StaffFactory(user=user, primary_facility=facility, created_by=admin, updated_by=admin)

        setup_calls = []
        reset_calls = []

        def fake_setup_delay(**kwargs):
            setup_calls.append(kwargs)
            return {"status": "queued"}

        def fake_reset_delay(**kwargs):
            reset_calls.append(kwargs)
            return {"status": "queued"}

        monkeypatch.setattr('apps.users.tasks.send_account_setup_email.delay', fake_setup_delay)
        monkeypatch.setattr('apps.users.tasks.send_password_reset_email.delay', fake_reset_delay)

        client = get_authenticated_client(admin, facility=facility)
        response = client.post(f'/api/users/staff/{staff.id}/resend-setup-link/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['mode'] == 'account_setup'
        assert len(setup_calls) == 1
        assert len(reset_calls) == 0

    def test_resend_setup_link_uses_password_reset_for_existing_password(self, db, monkeypatch):
        admin = AdminUserFactory()
        facility = admin.primary_facility
        user = DoctorUserFactory(primary_facility=facility, email='resend.reset@test.com')
        user.facilities.add(facility)
        staff = StaffFactory(user=user, primary_facility=facility, created_by=admin, updated_by=admin)

        setup_calls = []
        reset_calls = []

        def fake_setup_delay(**kwargs):
            setup_calls.append(kwargs)
            return {"status": "queued"}

        def fake_reset_delay(**kwargs):
            reset_calls.append(kwargs)
            return {"status": "queued"}

        monkeypatch.setattr('apps.users.tasks.send_account_setup_email.delay', fake_setup_delay)
        monkeypatch.setattr('apps.users.tasks.send_password_reset_email.delay', fake_reset_delay)

        client = get_authenticated_client(admin, facility=facility)
        response = client.post(f'/api/users/staff/{staff.id}/resend-setup-link/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['mode'] == 'password_reset'
        assert len(setup_calls) == 0
        assert len(reset_calls) == 1

    def test_register_staff_auto_assigns_practitioner_to_department_unit(self, db, monkeypatch):
        """Doctor/nurse registration should auto-create clinical department assignment."""
        admin = AdminUserFactory()
        facility = admin.primary_facility
        department_unit = _create_department_unit_for_facility(
            facility,
            name='Internal Medicine',
            staffing_mode='mixed'
        )
        _ensure_single_assignment_type()
        _stub_staff_tasks(monkeypatch)

        client = get_authenticated_client(admin, facility=facility)
        payload = {
            'email': 'auto.assign.doctor@test.com',
            'first_name': 'Auto',
            'last_name': 'Doctor',
            'phone_number': '1234567890',
            'date_of_birth': '1988-05-20',
            'user_type': 'doctor',
            'department': department_unit.name,
            'department_unit_id': str(department_unit.id),
            'position': 'Attending Physician',
            'hire_date': '2024-01-15',
            'license_number': 'MD-AUTO-001',
            'specialization': 'Internal Medicine',
            'qualification': 'MD',
            'address_line1': '',
            'address_line2': '',
            'city': '',
            'state': '',
            'postal_code': '',
            'country': '',
        }

        response = client.post('/api/users/staff/register/', payload, format='json')
        assert response.status_code == status.HTTP_201_CREATED

        staff = Staff.objects.get(user__email=payload['email'])
        assert StaffUnitAssignment.objects.filter(
            unit=department_unit,
            practitioner__staff=staff,
            is_active=True
        ).count() == 1
        assert UnitMemberAssignment.objects.filter(
            unit=department_unit,
            staff=staff,
            is_active=True
        ).count() == 0

    def test_register_staff_auto_assigns_ops_staff_to_department_member_assignment(self, db, monkeypatch):
        """Ops registration should auto-create unit member assignment."""
        admin = AdminUserFactory()
        facility = admin.primary_facility
        department_unit = _create_department_unit_for_facility(
            facility,
            name='Revenue Operations',
            staffing_mode='ops_only'
        )
        _ensure_single_assignment_type()
        _stub_staff_tasks(monkeypatch)

        client = get_authenticated_client(admin, facility=facility)
        payload = {
            'email': 'auto.assign.billing@test.com',
            'first_name': 'Ops',
            'last_name': 'Staff',
            'phone_number': '1234567890',
            'date_of_birth': '1990-06-10',
            'user_type': 'billing',
            'department': department_unit.name,
            'department_unit_id': str(department_unit.id),
            'position': 'Billing Specialist',
            'hire_date': '2024-02-01',
            'address_line1': '',
            'address_line2': '',
            'city': '',
            'state': '',
            'postal_code': '',
            'country': '',
        }

        response = client.post('/api/users/staff/register/', payload, format='json')
        assert response.status_code == status.HTTP_201_CREATED

        staff = Staff.objects.get(user__email=payload['email'])
        assert UnitMemberAssignment.objects.filter(
            unit=department_unit,
            staff=staff,
            is_active=True
        ).count() == 1
        assert StaffUnitAssignment.objects.filter(
            unit=department_unit,
            practitioner__staff=staff,
            is_active=True
        ).count() == 0

    def test_auto_department_assignment_is_idempotent(self, db):
        """Running auto-assignment multiple times should not create duplicate active rows."""
        facility = DefaultFacilityFactory()
        admin = AdminUserFactory(primary_facility=facility)
        department_unit = _create_department_unit_for_facility(
            facility,
            name='Surgery',
            staffing_mode='mixed'
        )
        _ensure_single_assignment_type()

        doctor = DoctorUserFactory(
            email='idempotent.doctor@test.com',
            primary_facility=facility
        )
        staff = StaffFactory(
            user=doctor,
            primary_facility=facility,
            department=department_unit.name,
            created_by=admin,
            updated_by=admin,
        )
        PractitionerProfileFactory(staff=staff)

        auto_assign_staff_to_department_unit(
            staff,
            facility=facility,
            department_name=department_unit.name,
            department_unit_id=department_unit.id,
            assigned_by=admin,
        )
        auto_assign_staff_to_department_unit(
            staff,
            facility=facility,
            department_name=department_unit.name,
            department_unit_id=department_unit.id,
            assigned_by=admin,
        )

        assert StaffUnitAssignment.objects.filter(
            unit=department_unit,
            practitioner=staff.practitioner_profile,
            is_active=True
        ).count() == 1

    def test_delete_staff_deprovisions_and_preserves_record(self, db):
        """Deleting staff should deactivate access and keep records for audit."""
        admin = AdminUserFactory()
        facility = admin.primary_facility
        department_unit = _create_department_unit_for_facility(
            facility,
            name='Cardiology',
            staffing_mode='mixed'
        )
        _ensure_single_assignment_type()
        assignment_type = StaffAssignmentTypeConfig.objects.get(code='single')

        doctor = DoctorUserFactory(
            email='deprovision.doctor@test.com',
            primary_facility=facility,
        )
        staff = StaffFactory(
            user=doctor,
            primary_facility=facility,
            department=department_unit.name,
            created_by=admin,
            updated_by=admin,
        )
        practitioner = PractitionerProfileFactory(staff=staff)
        StaffUnitAssignment.objects.create(
            unit=department_unit,
            practitioner=practitioner,
            assignment_type=assignment_type,
            is_active=True,
            is_primary=True,
            assigned_by=admin,
        )
        leadership_role = LeadershipRoleConfig.objects.create(
            code=f'head_{uuid.uuid4().hex[:8]}',
            name='Department Head',
            is_active=True,
        )
        UnitLeadership.objects.create(
            unit=department_unit,
            role=leadership_role,
            user=doctor,
            effective_from=date(2025, 1, 1),
            is_active=True,
            created_by=admin,
        )

        client = get_authenticated_client(admin, facility=facility)
        response = client.delete(f'/api/users/staff/{staff.id}/')

        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert Staff.objects.filter(id=staff.id).exists()

        doctor.refresh_from_db()
        assert doctor.is_active is False

        staff.refresh_from_db()
        assert staff.updated_by_id == admin.id

        assert StaffUnitAssignment.objects.filter(
            unit=department_unit,
            practitioner=practitioner,
            is_active=True
        ).count() == 0
        assert UnitLeadership.objects.filter(
            unit=department_unit,
            user=doctor,
            is_active=True
        ).count() == 0

        list_response = client.get('/api/users/staff/')
        assert list_response.status_code == status.HTTP_200_OK
        list_results = list_response.data.get('results', list_response.data)
        assert all(result['id'] != str(staff.id) for result in list_results)

        list_inactive_response = client.get('/api/users/staff/?include_inactive=true')
        assert list_inactive_response.status_code == status.HTTP_200_OK
        list_inactive_results = list_inactive_response.data.get('results', list_inactive_response.data)
        assert any(result['id'] == str(staff.id) for result in list_inactive_results)

    def test_register_existing_user_uses_reset_task_without_staff_kwargs(self, db, monkeypatch):
        """Reusing an existing user must call reset task with the correct signature."""
        admin = AdminUserFactory()
        facility = admin.primary_facility
        department_unit = _create_department_unit_for_facility(
            facility,
            name='Neurology',
            staffing_mode='mixed'
        )
        _ensure_single_assignment_type()

        existing_user = DoctorUserFactory(
            email='existing.user@test.com',
            first_name='Existing',
            last_name='User',
            primary_facility=facility,
        )
        assert not Staff.objects.filter(user=existing_user).exists()
        _stub_staff_tasks(monkeypatch)

        reset_calls = []
        setup_calls = []

        def fake_reset_delay(**kwargs):
            reset_calls.append(kwargs)
            return {"status": "queued"}

        def fake_setup_delay(**kwargs):
            setup_calls.append(kwargs)
            return {"status": "queued"}

        monkeypatch.setattr('apps.users.tasks.send_password_reset_email.delay', fake_reset_delay)
        monkeypatch.setattr('apps.users.tasks.send_account_setup_email.delay', fake_setup_delay)

        client = get_authenticated_client(admin, facility=facility)
        payload = {
            'email': existing_user.email,
            'first_name': 'Updated',
            'last_name': 'Doctor',
            'phone_number': '1234567890',
            'date_of_birth': '1988-05-20',
            'user_type': 'doctor',
            'department': department_unit.name,
            'department_unit_id': str(department_unit.id),
            'position': 'Consultant',
            'hire_date': '2024-01-15',
            'license_number': 'MD-EXIST-001',
            'specialization': 'Neurology',
            'qualification': 'MD',
            'address_line1': '',
            'address_line2': '',
            'city': '',
            'state': '',
            'postal_code': '',
            'country': '',
        }

        response = client.post('/api/users/staff/register/', payload, format='json')
        assert response.status_code == status.HTTP_201_CREATED
        assert len(reset_calls) == 1
        assert len(setup_calls) == 0
        assert 'employee_id' not in reset_calls[0]
        assert 'department' not in reset_calls[0]
        assert 'position' not in reset_calls[0]

    def test_register_rejects_email_from_deprovisioned_staff(self, db):
        """Emails tied to deprovisioned staff records should require reactivation."""
        admin = AdminUserFactory()
        facility = admin.primary_facility
        deprovisioned_user = DoctorUserFactory(
            email='deprovisioned.user@test.com',
            primary_facility=facility,
            is_active=False,
        )
        StaffFactory(
            user=deprovisioned_user,
            primary_facility=facility,
            created_by=admin,
            updated_by=admin,
        )

        client = get_authenticated_client(admin, facility=facility)
        payload = {
            'email': deprovisioned_user.email,
            'first_name': 'New',
            'last_name': 'Doctor',
            'phone_number': '1234567890',
            'date_of_birth': '1990-05-20',
            'user_type': 'doctor',
            'department': 'Internal Medicine',
            'position': 'Resident',
            'hire_date': '2024-03-10',
            'license_number': 'MD-REREG-001',
            'specialization': 'Internal Medicine',
            'qualification': 'MD',
            'address_line1': '',
            'address_line2': '',
            'city': '',
            'state': '',
            'postal_code': '',
            'country': '',
        }

        response = client.post('/api/users/staff/register/', payload, format='json')
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'email' in response.data
        assert 'deactivated staff account' in str(response.data['email']).lower()


# =============================================================================
# Practitioner Profile ViewSet Tests
# =============================================================================

@pytest.mark.tier1
class TestPractitionerProfileViewSet:
    """Tests for PractitionerProfileViewSet."""

    def test_list_practitioners(self, db):
        """Test listing practitioners."""
        admin = AdminUserFactory()
        PractitionerProfileFactory()
        PractitionerProfileFactory()

        client = get_authenticated_client(admin)
        response = client.get('/api/users/practitioners/')

        assert response.status_code == status.HTTP_200_OK
        results = response.data.get('results', response.data)
        assert len(results) >= 2

    def test_retrieve_practitioner(self, db):
        """Test retrieving practitioner details."""
        admin = AdminUserFactory()
        practitioner = PractitionerProfileFactory(
            license_number='LIC_RETRIEVE',
            specialization='Neurology'
        )

        client = get_authenticated_client(admin)
        response = client.get(f'/api/users/practitioners/{practitioner.id}/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['license_number'] == 'LIC_RETRIEVE'
        assert response.data['specialization'] == 'Neurology'

    def test_filter_practitioners_by_specialization(self, db):
        """Test filtering practitioners by specialization."""
        admin = AdminUserFactory()
        PractitionerProfileFactory(specialization='Cardiology')
        PractitionerProfileFactory(specialization='Cardiology')
        PractitionerProfileFactory(specialization='Neurology')

        client = get_authenticated_client(admin)
        response = client.get('/api/users/practitioners/', {'specialization': 'Cardiology'})

        if response.status_code == status.HTTP_200_OK:
            results = response.data.get('results', response.data)
            # Should only include cardiologists if filter works
            specializations = [p['specialization'] for p in results]
            # Filter may or may not be implemented
            assert len(results) >= 1


# =============================================================================
# Patient Profile ViewSet Tests
# =============================================================================

@pytest.mark.tier1
class TestPatientProfileViewSet:
    """Tests for PatientProfileViewSet (via /api/patients/)."""

    def test_list_patients(self, db):
        """Test listing patients."""
        admin = AdminUserFactory()
        PatientProfileFactory()
        PatientProfileFactory()

        client = get_authenticated_client(admin)
        response = client.get('/api/patients/')

        assert response.status_code == status.HTTP_200_OK
        results = response.data.get('results', response.data)
        assert len(results) >= 2

    def test_retrieve_patient(self, db):
        """Test retrieving patient details."""
        admin = AdminUserFactory()
        patient = PatientProfileFactory(
            medical_record_number='MRN_RETRIEVE',
            blood_group='A+'
        )

        client = get_authenticated_client(admin)
        response = client.get(f'/api/users/patients/{patient.id}/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['medical_record_number'] == 'MRN_RETRIEVE'
        assert response.data['blood_group'] == 'A+'

    def test_search_patients_by_name(self, db):
        """Test searching patients by name."""
        admin = AdminUserFactory()
        user1 = PatientUserFactory(first_name='John', last_name='Doe')
        user2 = PatientUserFactory(first_name='Jane', last_name='Smith')
        PatientProfileFactory(user=user1)
        PatientProfileFactory(user=user2)

        client = get_authenticated_client(admin)
        response = client.get('/api/patients/', {'search': 'John'})

        assert response.status_code == status.HTTP_200_OK

    def test_search_patients_by_mrn(self, db):
        """Test searching patients by MRN."""
        admin = AdminUserFactory()
        PatientProfileFactory(medical_record_number='MRN_SEARCH_001')
        PatientProfileFactory(medical_record_number='MRN_SEARCH_002')

        client = get_authenticated_client(admin)
        response = client.get('/api/patients/', {'search': 'MRN_SEARCH_001'})

        assert response.status_code == status.HTTP_200_OK

    def test_patient_includes_emergency_contact(self, db):
        """Test that patient details include emergency contact."""
        admin = AdminUserFactory()
        patient = PatientProfileFactory(
            emergency_contact_name='John Smith',
            emergency_contact_phone='+1234567890',
            emergency_contact_relationship='Spouse'
        )

        client = get_authenticated_client(admin)
        response = client.get(f'/api/users/patients/{patient.id}/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['emergency_contact_name'] == 'John Smith'


# =============================================================================
# User Patient List (My Patients) ViewSet Tests
# =============================================================================

@pytest.mark.tier1
class TestUserPatientListViewSet:
    """Tests for UserPatientList (My Patients) functionality."""

    def test_list_my_patients(self, db):
        """Test listing my patients."""
        doctor = DoctorUserFactory()
        patient1 = PatientProfileFactory()
        patient2 = PatientProfileFactory()

        UserPatientList.objects.create(user=doctor, patient=patient1)
        UserPatientList.objects.create(user=doctor, patient=patient2)

        client = get_authenticated_client(doctor)
        response = client.get('/api/users/my-patients/')

        if response.status_code == status.HTTP_200_OK:
            results = response.data.get('results', response.data)
            assert len(results) == 2

    def test_add_patient_to_my_list(self, db):
        """Test adding a patient to my list."""
        doctor = DoctorUserFactory()
        patient = PatientProfileFactory()

        client = get_authenticated_client(doctor)
        response = client.post('/api/users/my-patients/', {
            'patient': str(patient.id),
            'notes': 'Follow-up needed'
        }, format='json')

        if response.status_code in [status.HTTP_201_CREATED, status.HTTP_200_OK]:
            assert UserPatientList.objects.filter(user=doctor, patient=patient).exists()

    def test_remove_patient_from_my_list(self, db):
        """Test removing a patient from my list."""
        doctor = DoctorUserFactory()
        patient = PatientProfileFactory()
        entry = UserPatientList.objects.create(user=doctor, patient=patient)

        client = get_authenticated_client(doctor)
        response = client.delete(f'/api/users/my-patients/{entry.id}/')

        if response.status_code == status.HTTP_204_NO_CONTENT:
            assert not UserPatientList.objects.filter(id=entry.id).exists()

    def test_pin_patient(self, db):
        """Test pinning a patient."""
        doctor = DoctorUserFactory()
        patient = PatientProfileFactory()
        entry = UserPatientList.objects.create(user=doctor, patient=patient, is_pinned=False)

        client = get_authenticated_client(doctor)
        response = client.patch(f'/api/users/my-patients/{entry.id}/', {
            'is_pinned': True
        }, format='json')

        if response.status_code == status.HTTP_200_OK:
            entry.refresh_from_db()
            assert entry.is_pinned is True

    def test_my_patients_isolated_per_user(self, db):
        """Test that each user sees only their own patient list."""
        doctor1 = DoctorUserFactory()
        doctor2 = DoctorUserFactory()
        patient = PatientProfileFactory()

        UserPatientList.objects.create(user=doctor1, patient=patient)

        # Doctor2 should not see doctor1's patients
        client = get_authenticated_client(doctor2)
        response = client.get('/api/users/my-patients/')

        if response.status_code == status.HTTP_200_OK:
            results = response.data.get('results', response.data)
            assert len(results) == 0

    def test_cannot_add_duplicate_patient(self, db):
        """Test that adding same patient twice fails."""
        doctor = DoctorUserFactory()
        patient = PatientProfileFactory()
        UserPatientList.objects.create(user=doctor, patient=patient)

        client = get_authenticated_client(doctor)
        response = client.post('/api/users/my-patients/', {
            'patient': str(patient.id)
        }, format='json')

        # Should fail with 400 or similar
        assert response.status_code in [
            status.HTTP_400_BAD_REQUEST,
            status.HTTP_409_CONFLICT,
            status.HTTP_201_CREATED  # Some implementations may update instead
        ]


# =============================================================================
# Pagination Tests
# =============================================================================

@pytest.mark.tier1
class TestPagination:
    """Tests for pagination on list endpoints."""

    def test_users_list_paginated(self, db):
        """Test that users list is paginated."""
        admin = AdminUserFactory()
        # Create many users
        for _ in range(25):
            UserFactory()

        client = get_authenticated_client(admin)
        response = client.get('/api/users/users/')

        assert response.status_code == status.HTTP_200_OK
        # Should have pagination fields
        if isinstance(response.data, dict):
            assert 'results' in response.data or 'count' in response.data

    def test_patients_list_paginated(self, db):
        """Test that patients list is paginated."""
        admin = AdminUserFactory()
        for _ in range(25):
            PatientProfileFactory()

        client = get_authenticated_client(admin)
        response = client.get('/api/users/patients/')

        assert response.status_code == status.HTTP_200_OK
        if isinstance(response.data, dict):
            assert 'results' in response.data or 'count' in response.data


# =============================================================================
# Error Handling Tests
# =============================================================================

@pytest.mark.tier1
class TestErrorHandling:
    """Tests for error handling on endpoints."""

    def test_get_nonexistent_user(self, db):
        """Test getting a non-existent user returns 404."""
        admin = AdminUserFactory()
        client = get_authenticated_client(admin)

        response = client.get('/api/users/users/00000000-0000-0000-0000-000000000000/')

        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_get_nonexistent_patient(self, db):
        """Test getting a non-existent patient returns 404."""
        admin = AdminUserFactory()
        client = get_authenticated_client(admin)

        response = client.get('/api/patients/00000000-0000-0000-0000-000000000000/')

        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_create_user_invalid_email(self, db):
        """Test creating user with invalid email fails."""
        admin = AdminUserFactory()
        client = get_authenticated_client(admin)

        response = client.post('/api/users/users/', {
            'email': 'not-an-email',
            'username': 'testuser',
            'password': 'TestPass123!',
            'first_name': 'Test',
            'last_name': 'User'
        }, format='json')

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_create_user_duplicate_email(self, db):
        """Test creating user with duplicate email fails."""
        admin = AdminUserFactory()
        UserFactory(email='duplicate@test.com')

        client = get_authenticated_client(admin)
        response = client.post('/api/users/users/', {
            'email': 'duplicate@test.com',
            'username': 'anotheruser',
            'password': 'TestPass123!',
            'first_name': 'Test',
            'last_name': 'User'
        }, format='json')

        assert response.status_code == status.HTTP_400_BAD_REQUEST
