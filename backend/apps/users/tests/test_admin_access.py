import pytest
from django.core.management import call_command
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from apps.core.tests.factories import DefaultFacilityFactory
from apps.organization.models import (
    ClinicalUnit,
    LeadershipRoleConfig,
    StaffAssignmentTypeConfig,
    StaffUnitAssignment,
    UnitLeadership,
    UnitTypeConfig,
)
from apps.users.admin_access import (
    AdminCapabilities,
    build_admin_access_payload,
    get_admin_accessible_unit_ids,
    user_has_unit_admin_capability,
)
from apps.users.models import PractitionerProfile, Staff


@pytest.mark.django_db
def test_facility_admin_gets_facility_admin_capabilities(django_user_model):
    facility = DefaultFacilityFactory()
    admin = django_user_model.objects.create_user(
        username='hospital-admin',
        email='hospital-admin@example.com',
        password='pass1234',
        user_type='admin',
        primary_facility=facility,
    )

    payload = build_admin_access_payload(admin, facility_code=facility.code)

    assert payload['is_facility_admin'] is True
    assert AdminCapabilities.ORGANIZATION_MANAGE in payload['capabilities']
    assert AdminCapabilities.STAFF_MANAGE in payload['capabilities']
    assert AdminCapabilities.ROSTER_MANAGE in payload['capabilities']


@pytest.mark.django_db
def test_unit_leadership_grants_scoped_admin_capabilities(django_user_model):
    facility = DefaultFacilityFactory()
    call_command('seed_organization')

    facility_unit_type = UnitTypeConfig.objects.get(code='facility')
    department_unit_type = UnitTypeConfig.objects.get(code='department')
    facility_unit = ClinicalUnit.objects.create(
        code=facility.code,
        name=facility.name,
        unit_type=facility_unit_type,
    )
    department = ClinicalUnit.objects.create(
        code='SURG',
        name='Surgery',
        unit_type=department_unit_type,
        parent=facility_unit,
    )
    department.refresh_from_db()

    user = django_user_model.objects.create_user(
        username='surgery-hod',
        email='surgery-hod@example.com',
        password='pass1234',
        user_type='doctor',
        primary_facility=facility,
    )
    UnitLeadership.objects.create(
        unit=department,
        role=LeadershipRoleConfig.objects.get(code='head'),
        user=user,
        effective_from=timezone.now().date(),
    )

    payload = build_admin_access_payload(user, facility_code=facility.code)

    assert payload['is_facility_admin'] is False
    assert AdminCapabilities.STAFF_MANAGE in payload['capabilities']
    assert AdminCapabilities.ROSTER_MANAGE in payload['capabilities']
    assert AdminCapabilities.ORGANIZATION_MANAGE not in payload['capabilities']
    assert payload['scopes'][0]['unit_id'] == str(department.id)
    assert payload['scopes'][0]['role_code'] == 'head'


@pytest.mark.django_db
def test_unit_leadership_admin_scope_includes_descendants(django_user_model):
    facility = DefaultFacilityFactory()
    call_command('seed_organization')

    facility_unit_type = UnitTypeConfig.objects.get(code='facility')
    department_unit_type = UnitTypeConfig.objects.get(code='department')
    team_unit_type = UnitTypeConfig.objects.get(code='team')
    facility_unit = ClinicalUnit.objects.create(
        code=facility.code,
        name=facility.name,
        unit_type=facility_unit_type,
    )
    department = ClinicalUnit.objects.create(
        code='MED',
        name='Medicine',
        unit_type=department_unit_type,
        parent=facility_unit,
    )
    team = ClinicalUnit.objects.create(
        code='MED-A',
        name='Medicine Team A',
        unit_type=team_unit_type,
        parent=department,
    )
    department.refresh_from_db()
    team.refresh_from_db()

    user = django_user_model.objects.create_user(
        username='medicine-hod',
        email='medicine-hod@example.com',
        password='pass1234',
        user_type='doctor',
        primary_facility=facility,
    )
    UnitLeadership.objects.create(
        unit=department,
        role=LeadershipRoleConfig.objects.get(code='head'),
        user=user,
        effective_from=timezone.now().date(),
    )

    unit_ids = get_admin_accessible_unit_ids(
        user,
        AdminCapabilities.STAFF_MANAGE,
        facility_code=facility.code,
    )

    assert department.id in unit_ids
    assert team.id in unit_ids
    assert user_has_unit_admin_capability(
        user,
        AdminCapabilities.STAFF_MANAGE,
        team,
        facility_code=facility.code,
    )


@pytest.mark.django_db
def test_scoped_staff_admin_can_view_only_assigned_unit_staff(django_user_model):
    facility = DefaultFacilityFactory()
    call_command('seed_organization')

    facility_unit_type = UnitTypeConfig.objects.get(code='facility')
    department_unit_type = UnitTypeConfig.objects.get(code='department')
    facility_unit = ClinicalUnit.objects.create(
        code=facility.code,
        name=facility.name,
        unit_type=facility_unit_type,
    )
    surgery = ClinicalUnit.objects.create(
        code='SURG',
        name='Surgery',
        unit_type=department_unit_type,
        parent=facility_unit,
    )
    pharmacy = ClinicalUnit.objects.create(
        code='PHARM',
        name='Pharmacy',
        unit_type=department_unit_type,
        parent=facility_unit,
    )
    surgery.refresh_from_db()
    pharmacy.refresh_from_db()

    scoped_user = django_user_model.objects.create_user(
        username='accounts-head',
        email='accounts-head@example.com',
        password='pass1234',
        user_type='billing',
        primary_facility=facility,
    )
    UnitLeadership.objects.create(
        unit=surgery,
        role=LeadershipRoleConfig.objects.get(code='head'),
        user=scoped_user,
        effective_from=timezone.now().date(),
    )

    assignment_type = StaffAssignmentTypeConfig.objects.get(code='single')
    today = timezone.now().date()

    def create_practitioner(username, email, employee_id, unit):
        user = django_user_model.objects.create_user(
            username=username,
            email=email,
            password='pass1234',
            user_type='doctor',
            primary_facility=facility,
        )
        staff = Staff.objects.create(
            user=user,
            employee_id=employee_id,
            department=unit.name,
            position='Consultant',
            hire_date=today,
            primary_facility=facility,
        )
        practitioner = PractitionerProfile.objects.create(
            staff=staff,
            license_number=f'LIC-{employee_id}',
            specialization=unit.name,
            qualification='MBChB',
        )
        StaffUnitAssignment.objects.create(
            unit=unit,
            practitioner=practitioner,
            assignment_type=assignment_type,
            is_primary=True,
            is_active=True,
            effective_from=today,
        )
        return staff

    surgery_staff = create_practitioner('surgery-doc', 'surgery@example.com', 'EMP-SURG', surgery)
    pharmacy_staff = create_practitioner('pharmacy-doc', 'pharmacy@example.com', 'EMP-PHARM', pharmacy)

    client = APIClient()
    client.force_authenticate(user=scoped_user)
    client.credentials(HTTP_X_FACILITY_CODE=facility.code)

    response = client.get('/api/users/staff/')

    assert response.status_code == status.HTTP_200_OK
    result_ids = {str(item['id']) for item in response.data['results']}
    assert str(surgery_staff.id) in result_ids
    assert str(pharmacy_staff.id) not in result_ids
