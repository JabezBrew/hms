"""
Tests for configurable roster management.
"""
from datetime import date, datetime, time

import pytest
from django.utils import timezone
from rest_framework import status
from rest_framework_simplejwt.tokens import AccessToken

from apps.organization.models import (
    ClinicalUnit,
    DepartmentDutyType,
    DepartmentStation,
    DepartmentRosterPlan,
    RosterOverride,
    RosterPatternSlot,
    TeamRosterEntry,
    TeamRosterPlan,
)
from apps.organization.services import DepartmentRosterService, RosterImportService


@pytest.fixture
def seed_organization_data(db):
    from django.core.management import call_command
    call_command('seed_organization')


@pytest.fixture
def unit_types(seed_organization_data):
    from apps.organization.models import UnitTypeConfig
    return {ut.code: ut for ut in UnitTypeConfig.objects.all()}


@pytest.fixture
def facility_unit(unit_types, default_facility):
    return ClinicalUnit.objects.create(
        code=default_facility.code,
        name='Main Facility',
        unit_type=unit_types['facility'],
    )


@pytest.fixture
def department(unit_types, facility_unit):
    return ClinicalUnit.objects.create(
        code='SURG',
        name='Surgery Department',
        unit_type=unit_types['department'],
        parent=facility_unit,
    )


@pytest.fixture
def team(unit_types, department):
    return ClinicalUnit.objects.create(
        code='TEAM-A',
        name='Surgery Team A',
        unit_type=unit_types['team'],
        parent=department,
    )


@pytest.fixture
def practitioner(db, django_user_model, default_facility):
    from apps.users.models import Staff, PractitionerProfile
    staff_user = django_user_model.objects.create_user(
        username='surgeon',
        email='surgeon@test.com',
        password='testpass123',
        user_type='doctor',
    )
    staff = Staff.objects.create(
        user=staff_user,
        employee_id='EMP-SURG',
        department='Surgery',
        position='Attending',
        hire_date=date(2020, 1, 1),
        primary_facility=default_facility,
    )
    return PractitionerProfile.objects.create(
        staff=staff,
        license_number='LIC-SURG',
        specialization='Surgery',
        qualification='MD',
    )


@pytest.fixture
def duty_type(department):
    return DepartmentDutyType.objects.create(
        department=department,
        name='Admitting',
        code='ADM',
        default_context='inpatient',
        default_role='admitting',
        requires_time_range=True,
        display_order=1,
        is_active=True,
    )


@pytest.fixture
def station(department):
    return DepartmentStation.objects.create(
        department=department,
        name='Ward 3',
        code='STN-3',
        is_active=True,
    )


@pytest.fixture
def roster_plan(department):
    return DepartmentRosterPlan.objects.create(
        department=department,
        name='Weekday Coverage',
        cycle_length_days=7,
        effective_from=date.today(),
        status='active',
        version=1,
    )


@pytest.fixture
def admin_api_client(admin_user, default_facility):
    from rest_framework.test import APIClient

    client = APIClient()
    token = AccessToken.for_user(admin_user)
    client.credentials(
        HTTP_AUTHORIZATION=f'Bearer {token}',
        HTTP_X_FACILITY_CODE=default_facility.code,
    )
    return client


@pytest.mark.django_db
class TestRosterCoverageService:
    def test_pattern_slot_coverage(self, roster_plan, duty_type, team):
        slot = RosterPatternSlot.objects.create(
            plan=roster_plan,
            day_offset=0,
            duty_type=duty_type,
            team=team,
            start_time=time(8, 0),
            end_time=time(16, 0),
        )
        check_time = datetime.combine(date.today(), time(9, 0))
        coverage = DepartmentRosterService.get_on_duty_coverage(
            department=roster_plan.department,
            at_datetime=timezone.make_aware(check_time),
        )
        assert len(coverage) == 1
        assert coverage[0]['id'] == slot.id
        assert coverage[0]['team_id'] == team.id

    def test_override_supersedes_pattern(self, roster_plan, duty_type, team, unit_types, facility_unit):
        alternate_team = ClinicalUnit.objects.create(
            code='TEAM-B',
            name='Surgery Team B',
            unit_type=unit_types['team'],
            parent=roster_plan.department,
        )
        RosterPatternSlot.objects.create(
            plan=roster_plan,
            day_offset=0,
            duty_type=duty_type,
            team=team,
        )
        override = RosterOverride.objects.create(
            plan=roster_plan,
            date=date.today(),
            duty_type=duty_type,
            team=alternate_team,
            reason='Coverage swap',
        )
        coverage = DepartmentRosterService.get_on_duty_coverage(
            department=roster_plan.department,
            at_datetime=timezone.now(),
        )
        assert len(coverage) == 1
        assert coverage[0]['id'] == override.id
        assert coverage[0]['team_id'] == alternate_team.id


@pytest.mark.django_db
class TestRosterImportService:
    def test_department_csv_import(self, roster_plan, duty_type, team, default_facility):
        csv_payload = """department_code,plan_name,cycle_day,duty_type_code,team_code,start_time,end_time
SURG,Weekday Coverage,0,ADM,TEAM-A,08:00,16:00
"""
        results = RosterImportService.validate_department_roster_csv(csv_payload, default_facility)
        assert results['errors'] == []
        assert len(results['rows']) == 1
        created = RosterImportService.apply_department_roster_csv(results['rows'], None)
        assert created == 1
        assert RosterPatternSlot.objects.filter(plan=roster_plan).count() == 1

    def test_team_csv_import(self, duty_type, station, team, practitioner, default_facility):
        csv_payload = f"""team_code,date,duty_type_code,practitioner_id,station_code,start_time,end_time
TEAM-A,2026-02-01,ADM,{practitioner.id},STN-3,08:00,16:00
"""
        results = RosterImportService.validate_team_roster_csv(csv_payload, default_facility)
        assert results['errors'] == []
        assert len(results['rows']) == 1
        created = RosterImportService.apply_team_roster_csv(results['rows'], None)
        assert created == 1
        assert TeamRosterEntry.objects.filter(team=team, practitioner=practitioner).count() == 1


@pytest.mark.django_db
class TestRosterApi:
    def test_create_department_duty_type(self, admin_api_client, department):
        response = admin_api_client.post('/api/organization/department-duty-types/', {
            'department': str(department.id),
            'name': 'Covering',
            'code': 'COV',
            'default_context': 'inpatient',
            'default_role': 'covering',
            'requires_time_range': False,
            'display_order': 2,
            'is_active': True,
        })
        assert response.status_code == status.HTTP_201_CREATED

    def test_create_department_station(self, admin_api_client, department):
        response = admin_api_client.post('/api/organization/department-stations/', {
            'department': str(department.id),
            'name': 'Ward 1',
            'code': 'STN-1',
            'display_order': 1,
            'is_active': True,
        })
        assert response.status_code == status.HTTP_201_CREATED

    def test_create_roster_plan_and_slot(self, admin_api_client, department, duty_type, team):
        plan_response = admin_api_client.post('/api/organization/department-roster-plans/', {
            'department': str(department.id),
            'name': 'Weekday Coverage',
            'cycle_length_days': 7,
            'effective_from': date.today().isoformat(),
            'status': 'active',
            'version': 1,
        })
        assert plan_response.status_code == status.HTTP_201_CREATED

        slot_response = admin_api_client.post('/api/organization/department-roster-slots/', {
            'plan': plan_response.data['id'],
            'day_offset': 0,
            'duty_type': str(duty_type.id),
            'team': str(team.id),
            'start_time': '08:00',
            'end_time': '16:00',
            'is_active': True,
        })
        assert slot_response.status_code == status.HTTP_201_CREATED

    def test_create_roster_override(self, admin_api_client, roster_plan, duty_type, team):
        response = admin_api_client.post('/api/organization/department-roster-overrides/', {
            'plan': str(roster_plan.id),
            'date': date.today().isoformat(),
            'duty_type': str(duty_type.id),
            'team': str(team.id),
            'reason': 'Coverage change',
        })
        assert response.status_code == status.HTTP_201_CREATED

    def test_create_team_plan_and_entry(self, admin_api_client, roster_plan, duty_type, team, practitioner, station):
        plan_response = admin_api_client.post('/api/organization/team-roster-plans/', {
            'team': str(team.id),
            'department_plan': str(roster_plan.id),
            'name': 'Team Coverage',
            'effective_from': date.today().isoformat(),
            'status': 'active',
            'version': 1,
        })
        assert plan_response.status_code == status.HTTP_201_CREATED

        entry_response = admin_api_client.post('/api/organization/team-roster-entries/', {
            'team': str(team.id),
            'date': date.today().isoformat(),
            'duty_type': str(duty_type.id),
            'station': str(station.id),
            'practitioner': str(practitioner.id),
            'start_time': '08:00',
            'end_time': '16:00',
            'notes': 'Assigned to ward 3',
        })
        assert entry_response.status_code == status.HTTP_201_CREATED

    def test_department_import_preview_and_apply(self, admin_api_client, roster_plan, duty_type, team):
        csv_payload = """department_code,plan_name,cycle_day,duty_type_code,team_code,start_time,end_time
SURG,Weekday Coverage,0,ADM,TEAM-A,08:00,16:00
"""
        preview_response = admin_api_client.post('/api/organization/department-roster-plans/import/preview/', {
            'csv': csv_payload,
        })
        assert preview_response.status_code == status.HTTP_200_OK
        assert preview_response.data['errors'] == []
        assert len(preview_response.data['rows']) == 1

        apply_response = admin_api_client.post('/api/organization/department-roster-plans/import/apply/', {
            'rows': preview_response.data['rows'],
        })
        assert apply_response.status_code == status.HTTP_200_OK
        assert apply_response.data['created'] == 1

    def test_team_import_preview_and_apply(self, admin_api_client, duty_type, team, practitioner, station):
        csv_payload = f"""team_code,date,duty_type_code,practitioner_id,station_code,start_time,end_time
TEAM-A,2026-02-01,ADM,{practitioner.id},STN-3,08:00,16:00
"""
        preview_response = admin_api_client.post('/api/organization/team-roster-entries/import/preview/', {
            'csv': csv_payload,
        })
        assert preview_response.status_code == status.HTTP_200_OK
        assert preview_response.data['errors'] == []
        assert len(preview_response.data['rows']) == 1

        apply_response = admin_api_client.post('/api/organization/team-roster-entries/import/apply/', {
            'rows': preview_response.data['rows'],
        })
        assert apply_response.status_code == status.HTTP_200_OK
        assert apply_response.data['created'] == 1

    def test_team_entry_list_endpoint(self, admin_api_client, team, duty_type, practitioner):
        TeamRosterEntry.objects.create(
            team=team,
            date=date.today(),
            duty_type=duty_type,
            practitioner=practitioner,
        )
        response = admin_api_client.get('/api/organization/team-roster-entries/')
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data['results']) == 1
