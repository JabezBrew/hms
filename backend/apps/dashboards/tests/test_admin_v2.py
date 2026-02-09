from datetime import time

import pytest
from django.core.management import call_command
from rest_framework import status

from apps.core.tests.factories import BreakGlassEventFactory, DepartmentFactory
from apps.organization.models import ClinicalUnit, DepartmentDutyType, UnitTypeConfig
from apps.users.tests.factories import PatientProfileFactory
from apps.wards.tests.factories import BedFactory, WardFactory


@pytest.mark.django_db
def test_admin_v2_requires_admin_role(nurse_client):
    response = nurse_client.get('/api/dashboards/admin-v2/?window=today')
    assert response.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.django_db
def test_admin_v2_summary_shape_is_compact(admin_client):
    response = admin_client.get('/api/dashboards/admin-v2/?window=today')

    assert response.status_code == status.HTTP_200_OK
    payload = response.data
    assert set(payload.keys()) == {
        'meta',
        'alerts_top',
        'kpis',
        'section_summaries',
        'action_queue_top',
        'links',
    }
    assert 'capacity' not in payload
    assert 'workforce' not in payload
    assert 'compliance' not in payload
    assert 'actions' not in payload


@pytest.mark.django_db
def test_admin_v2_summary_query_budget(admin_client, django_assert_max_num_queries):
    # Keep root payload query cost bounded to avoid regressions in the summary path.
    with django_assert_max_num_queries(16):
        response = admin_client.get('/api/dashboards/admin-v2/?window=today')
    assert response.status_code == status.HTTP_200_OK


@pytest.mark.django_db
def test_admin_v2_expand_returns_requested_sections_only(admin_client):
    response = admin_client.get('/api/dashboards/admin-v2/?window=today&expand=capacity,actions')

    assert response.status_code == status.HTTP_200_OK
    payload = response.data
    assert 'capacity' in payload
    assert 'actions' in payload
    assert 'workforce' not in payload
    assert 'compliance' not in payload
    assert len(payload['actions']) <= 20


@pytest.mark.django_db
def test_admin_v2_invalid_window_returns_400(admin_client):
    response = admin_client.get('/api/dashboards/admin-v2/?window=30d')
    assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_admin_v2_capacity_caps_ward_rows(admin_client, default_facility):
    department = DepartmentFactory(facility=default_facility)
    for index in range(25):
        ward = WardFactory(
            department=department,
            name=f'Overflow Ward {index}',
            total_beds=1,
            is_active=True,
        )
        BedFactory(ward=ward, facility=default_facility, status='available')

    response = admin_client.get('/api/dashboards/admin-v2/capacity/?window=today')

    assert response.status_code == status.HTTP_200_OK
    assert len(response.data['wards']) == 20


@pytest.mark.django_db
def test_admin_v2_workforce_caps_uncovered_shifts(admin_client, default_facility):
    call_command('seed_organization')

    facility_type = UnitTypeConfig.objects.get(code='facility')
    department_type = UnitTypeConfig.objects.get(code='department')

    facility_unit = ClinicalUnit.objects.create(
        code=default_facility.code,
        name='Test Facility Unit',
        unit_type=facility_type,
    )
    facility_unit.root_unit = facility_unit
    facility_unit.save(update_fields=['root_unit'])

    department_unit = ClinicalUnit.objects.create(
        code='MED',
        name='Medicine Department',
        unit_type=department_type,
        parent=facility_unit,
    )
    department_unit.root_unit = facility_unit
    department_unit.save(update_fields=['root_unit'])

    for index in range(25):
        DepartmentDutyType.objects.create(
            department=department_unit,
            name=f'Shift {index}',
            code=f'SHIFT_{index}',
            category='ward',
            rotation_type='fixed_weekly',
            applicable_days=[0, 1, 2, 3, 4],
            is_24_hour=False,
            start_time=time(8, 0),
            end_time=time(16, 0),
            display_order=index,
            is_active=True,
        )

    response = admin_client.get('/api/dashboards/admin-v2/workforce/?window=today')

    assert response.status_code == status.HTTP_200_OK
    assert len(response.data['uncovered_shifts']) == 20


@pytest.mark.django_db
def test_admin_v2_compliance_caps_break_glass_rows(admin_client, admin_user, default_facility):
    patient = PatientProfileFactory(facility=default_facility)
    for _ in range(25):
        BreakGlassEventFactory(user=admin_user, patient=patient)

    response = admin_client.get('/api/dashboards/admin-v2/compliance/?window=today')

    assert response.status_code == status.HTTP_200_OK
    assert len(response.data['break_glass_recent']) == 20
