"""
Tests for the simplified roster management system.
"""
from datetime import date, datetime, time

import pytest
from django.utils import timezone
from rest_framework import status
from rest_framework_simplejwt.tokens import AccessToken

from apps.appointments.models import RecurringSchedule
from apps.organization.models import (
    ClinicalUnit,
    Clinic,
    DepartmentDutyType,
    RotationRule,
    RosterEntry,
    StaffAssignmentTypeConfig,
    StaffUnitAssignment,
)
from apps.users.tests.factories import PractitionerProfileFactory


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
def duty_type(department):
    return DepartmentDutyType.objects.create(
        department=department,
        name='Obs Clinic',
        code='OBS',
        rotation_type='fixed_weekly',
        applicable_days=[0, 1, 2, 3, 4],
        is_24_hour=False,
        start_time=time(8, 0),
        end_time=time(17, 0),
        display_order=1,
        is_active=True,
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
def test_create_department_duty_type(admin_api_client, department):
    response = admin_api_client.post('/api/organization/department-duty-types/', {
        'department': str(department.id),
        'name': 'Theatre',
        'code': 'THEATRE',
        'rotation_type': 'fixed_weekly',
        'applicable_days': [0, 1, 2, 3, 4],
        'is_24_hour': False,
        'start_time': '08:00',
        'end_time': '17:00',
        'display_order': 2,
        'is_active': True,
    }, format='json')
    assert response.status_code == status.HTTP_201_CREATED


@pytest.mark.django_db
def test_create_rotation_rule(admin_api_client, department, duty_type, team):
    response = admin_api_client.post(
        f'/api/organization/departments/{department.id}/rotation-rules/',
        {
            'department': str(department.id),
            'duty_type': str(duty_type.id),
            'name': 'Weekday Rotation',
            'rule_type': 'fixed_weekly',
            'day_assignments': {
                '0': str(team.id),
                '1': str(team.id),
            },
            'applicable_days': [0, 1, 2, 3, 4],
            'is_active': True,
        },
        format='json'
    )
    assert response.status_code == status.HTTP_201_CREATED


@pytest.mark.django_db
def test_generate_roster(admin_api_client, department, duty_type, team):
    RotationRule.objects.create(
        department=department,
        duty_type=duty_type,
        name='Sequential Weekdays',
        rule_type='sequential',
        team_sequence=[str(team.id)],
        applicable_days=[0, 1, 2, 3, 4],
        is_active=True,
    )
    response = admin_api_client.post(
        f'/api/organization/departments/{department.id}/roster/generate/',
        {'period': '2026-01'}
    )
    assert response.status_code == status.HTTP_200_OK
    assert response.data['entries_created'] > 0


@pytest.mark.django_db
def test_roster_csv_import(admin_api_client, department, duty_type, team, default_facility):
    csv_payload = """date,duty_type_code,team_code,start_time,end_time
2026-02-01,OBS,TEAM-A,08:00,17:00
"""
    response = admin_api_client.post(
        f'/api/organization/departments/{department.id}/roster/import/',
        {'csv': csv_payload, 'conflict_strategy': 'skip'}
    )
    assert response.status_code == status.HTTP_200_OK
    assert response.data['created'] == 1


@pytest.mark.django_db
def test_on_duty_endpoint(admin_api_client, department, duty_type, team):
    entry = RosterEntry.objects.create(
        department=department,
        duty_type=duty_type,
        date=date(2026, 1, 6),
        team=team,
        start_time=time(8, 0),
        end_time=time(17, 0),
        source='manual',
        status='published',
    )
    at_datetime = datetime(2026, 1, 6, 9, 0, tzinfo=timezone.get_current_timezone())
    response = admin_api_client.get(
        f'/api/organization/departments/{department.id}/on-duty/',
        {'at_datetime': at_datetime.isoformat()}
    )
    assert response.status_code == status.HTTP_200_OK
    assert response.data['count'] == 1
    assert response.data['results'][0]['id'] == str(entry.id)


@pytest.mark.django_db
def test_on_duty_endpoint_factors_time_of_day(admin_api_client, department, team):
    """
    On-duty must be determined by datetime (not just day/date).
    """
    day_shift = DepartmentDutyType.objects.create(
        department=department,
        name='Day Shift',
        code='DAY',
        rotation_type='fixed_weekly',
        applicable_days=[0, 1, 2, 3, 4, 5, 6],
        is_24_hour=False,
        start_time=time(8, 0),
        end_time=time(17, 0),
        display_order=1,
        is_active=True,
    )
    entry = RosterEntry.objects.create(
        department=department,
        duty_type=day_shift,
        date=date(2026, 2, 9),
        team=team,
        start_time=time(8, 0),
        end_time=time(17, 0),
        source='manual',
        status='published',
    )

    before_start = datetime(2026, 2, 9, 0, 54, tzinfo=timezone.get_current_timezone())
    response = admin_api_client.get(
        f'/api/organization/departments/{department.id}/on-duty/',
        {'at_datetime': before_start.isoformat()}
    )
    assert response.status_code == status.HTTP_200_OK
    assert response.data['count'] == 0

    during_shift = datetime(2026, 2, 9, 9, 0, tzinfo=timezone.get_current_timezone())
    response = admin_api_client.get(
        f'/api/organization/departments/{department.id}/on-duty/',
        {'at_datetime': during_shift.isoformat()}
    )
    assert response.status_code == status.HTTP_200_OK
    assert response.data['count'] == 1
    assert response.data['results'][0]['id'] == str(entry.id)


@pytest.mark.django_db
def test_on_duty_endpoint_supports_overnight_shift(admin_api_client, department, team):
    """
    Overnight shifts (end <= start) must be considered active into the next day.
    """
    night_shift = DepartmentDutyType.objects.create(
        department=department,
        name='Night Shift',
        code='NIGHT',
        rotation_type='fixed_weekly',
        applicable_days=[0, 1, 2, 3, 4, 5, 6],
        is_24_hour=False,
        start_time=time(20, 0),
        end_time=time(8, 0),
        display_order=1,
        is_active=True,
    )
    entry = RosterEntry.objects.create(
        department=department,
        duty_type=night_shift,
        date=date(2026, 2, 8),
        team=team,
        start_time=time(20, 0),
        end_time=time(8, 0),
        source='manual',
        status='published',
    )

    after_midnight = datetime(2026, 2, 9, 0, 54, tzinfo=timezone.get_current_timezone())
    response = admin_api_client.get(
        f'/api/organization/departments/{department.id}/on-duty/',
        {'at_datetime': after_midnight.isoformat()}
    )
    assert response.status_code == status.HTTP_200_OK
    assert response.data['count'] == 1
    assert response.data['results'][0]['id'] == str(entry.id)


@pytest.mark.django_db
def test_clear_roster_drafts(admin_api_client, department, duty_type, team):
    """Clear endpoint should delete draft entries only."""
    # Create a draft entry
    draft_entry = RosterEntry.objects.create(
        department=department,
        duty_type=duty_type,
        date=date(2026, 3, 1),
        team=team,
        start_time=time(8, 0),
        end_time=time(17, 0),
        source='generated',
        status='draft',
    )
    # Create a published entry
    published_entry = RosterEntry.objects.create(
        department=department,
        duty_type=duty_type,
        date=date(2026, 3, 2),
        team=team,
        start_time=time(8, 0),
        end_time=time(17, 0),
        source='generated',
        status='published',
    )

    response = admin_api_client.post(
        f'/api/organization/departments/{department.id}/roster/clear/',
        {'date_from': '2026-03-01', 'date_to': '2026-03-31'}
    )

    assert response.status_code == 200
    assert response.data['deleted'] == 1

    # Draft entry should be deleted
    assert not RosterEntry.objects.filter(id=draft_entry.id).exists()
    # Published entry should still exist
    assert RosterEntry.objects.filter(id=published_entry.id).exists()


@pytest.mark.django_db
def test_bulk_roster_supports_practitioner_entries(admin_api_client, department, duty_type, default_facility):
    """Bulk roster endpoint must accept practitioner assignments (not only teams)."""
    practitioner = PractitionerProfileFactory(
        staff__primary_facility=default_facility,
        staff__user__primary_facility=default_facility,
    )

    response = admin_api_client.post(
        f'/api/organization/departments/{department.id}/roster/bulk/',
        {
            'entries': [
                {
                    'date': '2026-03-05',
                    'duty_type': str(duty_type.id),
                    'practitioner': str(practitioner.id),
                    'source': 'manual',
                    'status': 'draft',
                }
            ]
        },
        format='json'
    )
    assert response.status_code == status.HTTP_200_OK
    assert response.data['created'] == 1

    entry = RosterEntry.objects.filter(department=department, duty_type=duty_type, date=date(2026, 3, 5)).first()
    assert entry is not None
    assert entry.practitioner_id == practitioner.id
    assert entry.team_id is None


@pytest.mark.django_db
def test_roster_create_rejects_conflict_with_recurring_schedule(
    admin_api_client, department, default_facility
):
    """A clinic roster entry cannot overlap an active recurring schedule for the same practitioner."""
    practitioner = PractitionerProfileFactory(
        staff__primary_facility=default_facility,
        staff__user__primary_facility=default_facility,
    )
    clinic = Clinic.objects.create(
        facility=default_facility,
        department=department,
        code='DOC-CLASH',
        name='Doctor Clash Clinic',
        booking_mode=Clinic.BookingMode.CLINIC_POOL,
        assignment_timing=Clinic.AssignmentTiming.CHECK_IN,
        is_active=True,
    )

    target_date = date(2026, 3, 7)
    RecurringSchedule.objects.create(
        facility=default_facility,
        name='Direct Clinic Schedule',
        practitioner=practitioner,
        days_of_week=[target_date.weekday()],
        start_time=time(10, 0),
        end_time=time(12, 0),
        slot_duration=30,
        active_from=target_date,
        active_to=target_date,
        breaks=[],
        is_active=True,
    )

    clinic_duty = DepartmentDutyType.objects.create(
        department=department,
        name='Pool Duty',
        code='POOL-DUTY-CLASH',
        category='clinic',
        rotation_type='none',
        applicable_days=[target_date.weekday()],
        is_24_hour=False,
        start_time=time(9, 0),
        end_time=time(13, 0),
        slot_duration_minutes=30,
        max_patients_per_slot=1,
        clinic=clinic,
        is_active=True,
    )

    response = admin_api_client.post(
        f'/api/organization/departments/{department.id}/roster/',
        {
            'department': str(department.id),
            'duty_type': str(clinic_duty.id),
            'date': target_date.isoformat(),
            'practitioner': str(practitioner.id),
            'start_time': '10:30:00',
            'end_time': '11:30:00',
            'source': 'manual',
            'status': 'draft',
        },
        format='json',
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert 'conflicts with recurring schedule' in str(response.data).lower()


@pytest.mark.django_db
def test_roster_bulk_rejects_team_conflict_with_recurring_schedule(
    admin_api_client, department, team, default_facility
):
    """Bulk roster creation should block team entries that overlap assigned doctors' recurring schedules."""
    practitioner = PractitionerProfileFactory(
        staff__primary_facility=default_facility,
        staff__user__primary_facility=default_facility,
    )
    assignment_type = StaffAssignmentTypeConfig.objects.filter(is_active=True).first()
    assert assignment_type is not None
    StaffUnitAssignment.objects.create(
        unit=team,
        practitioner=practitioner,
        assignment_type=assignment_type,
        is_active=True,
        effective_from=date(2026, 3, 1),
        effective_until=date(2026, 3, 31),
    )

    target_date = date(2026, 3, 8)
    RecurringSchedule.objects.create(
        facility=default_facility,
        name='Recurring Team Member Slot',
        practitioner=practitioner,
        days_of_week=[target_date.weekday()],
        start_time=time(14, 0),
        end_time=time(16, 0),
        slot_duration=30,
        active_from=target_date,
        active_to=target_date,
        breaks=[],
        is_active=True,
    )

    clinic = Clinic.objects.create(
        facility=default_facility,
        department=department,
        code='TEAM-CLASH',
        name='Team Clash Clinic',
        booking_mode=Clinic.BookingMode.CLINIC_POOL,
        assignment_timing=Clinic.AssignmentTiming.CHECK_IN,
        is_active=True,
    )
    duty_type = DepartmentDutyType.objects.create(
        department=department,
        name='Team Pool Duty',
        code='TEAM-POOL-CLASH',
        category='clinic',
        rotation_type='none',
        applicable_days=[target_date.weekday()],
        is_24_hour=False,
        start_time=time(13, 0),
        end_time=time(17, 0),
        slot_duration_minutes=30,
        max_patients_per_slot=1,
        clinic=clinic,
        is_active=True,
    )

    response = admin_api_client.post(
        f'/api/organization/departments/{department.id}/roster/bulk/',
        {
            'entries': [
                {
                    'date': target_date.isoformat(),
                    'duty_type': str(duty_type.id),
                    'team': str(team.id),
                    'start_time': '14:30:00',
                    'end_time': '15:30:00',
                    'source': 'manual',
                    'status': 'draft',
                }
            ]
        },
        format='json',
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert 'conflicts with recurring schedule' in str(response.data).lower()


@pytest.mark.django_db
def test_roster_update_rejects_conflict_with_recurring_schedule(
    admin_api_client, department, default_facility
):
    """Updating an existing clinic roster entry must also enforce recurring schedule conflicts."""
    practitioner = PractitionerProfileFactory(
        staff__primary_facility=default_facility,
        staff__user__primary_facility=default_facility,
    )
    clinic = Clinic.objects.create(
        facility=default_facility,
        department=department,
        code='UPDATE-CLASH',
        name='Update Clash Clinic',
        booking_mode=Clinic.BookingMode.CLINIC_POOL,
        assignment_timing=Clinic.AssignmentTiming.CHECK_IN,
        is_active=True,
    )
    target_date = date(2026, 3, 9)
    RecurringSchedule.objects.create(
        facility=default_facility,
        name='Update Conflict Schedule',
        practitioner=practitioner,
        days_of_week=[target_date.weekday()],
        start_time=time(10, 0),
        end_time=time(12, 0),
        slot_duration=30,
        active_from=target_date,
        active_to=target_date,
        breaks=[],
        is_active=True,
    )

    clinic_duty = DepartmentDutyType.objects.create(
        department=department,
        name='Update Pool Duty',
        code='UPDATE-POOL',
        category='clinic',
        rotation_type='none',
        applicable_days=[target_date.weekday()],
        is_24_hour=False,
        start_time=time(8, 0),
        end_time=time(13, 0),
        slot_duration_minutes=30,
        max_patients_per_slot=1,
        clinic=clinic,
        is_active=True,
    )

    entry = RosterEntry.objects.create(
        department=department,
        duty_type=clinic_duty,
        date=target_date,
        practitioner=practitioner,
        start_time=time(8, 0),
        end_time=time(9, 0),
        source='manual',
        status='draft',
    )

    response = admin_api_client.patch(
        f'/api/organization/roster/{entry.id}/',
        {
            'start_time': '10:30:00',
            'end_time': '11:30:00',
        },
        format='json',
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert 'conflicts with recurring schedule' in str(response.data).lower()


@pytest.mark.django_db
def test_sequential_roster_continues_across_months(department, duty_type, unit_types):
    """Sequential roster generation should continue from the last team of the previous period."""
    from apps.organization.services import RosterGenerationService

    # Create 4 teams
    teams = []
    for i in range(1, 5):
        team = ClinicalUnit.objects.create(
            code=f'PS-{i}',
            name=f'Physician Specialists Team {i}',
            unit_type=unit_types['team'],
            parent=department,
        )
        teams.append(team)

    # Update duty type for sequential rotation
    duty_type.rotation_type = 'sequential'
    duty_type.applicable_days = [0, 1, 2, 3, 4, 5, 6]  # All days
    duty_type.save()

    # Create sequential rotation rule
    RotationRule.objects.create(
        department=department,
        duty_type=duty_type,
        name='Sequential Rotation',
        rule_type='sequential',
        team_sequence=[str(t.id) for t in teams],
        applicable_days=[0, 1, 2, 3, 4, 5, 6],
        is_active=True,
    )

    # Generate roster for January (last few days)
    jan_start = date(2026, 1, 28)
    jan_end = date(2026, 1, 31)
    RosterGenerationService.generate_roster(department, jan_start, jan_end)

    # Get the last entry from January
    last_jan_entry = RosterEntry.objects.filter(
        department=department,
        duty_type=duty_type,
        date=jan_end
    ).first()
    assert last_jan_entry is not None

    # Find the position of the last team in the sequence
    team_ids = [str(t.id) for t in teams]
    last_team_position = team_ids.index(str(last_jan_entry.team_id))
    expected_next_team_id = teams[(last_team_position + 1) % len(teams)].id

    # Generate roster for February
    feb_start = date(2026, 2, 1)
    feb_end = date(2026, 2, 7)
    RosterGenerationService.generate_roster(department, feb_start, feb_end)

    # Get the first entry from February
    first_feb_entry = RosterEntry.objects.filter(
        department=department,
        duty_type=duty_type,
        date=feb_start
    ).first()
    assert first_feb_entry is not None

    # Verify continuity: Feb 1 should have the next team in sequence after Jan 31
    assert first_feb_entry.team_id == expected_next_team_id, (
        f"Expected team {expected_next_team_id} but got {first_feb_entry.team_id}. "
        f"Jan 31 had team at position {last_team_position}, Feb 1 should have position {(last_team_position + 1) % len(teams)}"
    )
