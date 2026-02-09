import pytest
from rest_framework import status
from rest_framework.test import APIClient
from django.test import override_settings

from apps.core.tests.factories import FacilityFactory


@pytest.mark.django_db
def test_facility_list_scoped_to_user(django_user_model):
    facility_a = FacilityFactory(code='ALPHA', name='Alpha Facility')
    FacilityFactory(code='BRAVO', name='Bravo Facility')

    user = django_user_model.objects.create_user(
        username='user',
        email='user@example.com',
        password='pass1234',
        user_type='nurse',
        primary_facility=facility_a,
    )
    user.facilities.add(facility_a)

    client = APIClient()
    client.force_authenticate(user=user)

    response = client.get('/api/facilities/')

    assert response.status_code == status.HTTP_200_OK
    codes = {item['code'] for item in response.data['results']}
    assert codes == {'ALPHA'}


@pytest.mark.django_db
def test_facility_list_admin_can_include_inactive(django_user_model):
    active = FacilityFactory(code='READY', name='Ready Facility', is_active=True)
    inactive = FacilityFactory(code='SUSP', name='Suspended Facility', is_active=False)

    admin = django_user_model.objects.create_user(
        username='admin',
        email='admin@example.com',
        password='pass1234',
        user_type='admin',
        primary_facility=active,
    )
    admin.facilities.add(active, inactive)

    client = APIClient()
    client.force_authenticate(user=admin)

    response = client.get('/api/facilities/?include_inactive=1')
    assert response.status_code == status.HTTP_200_OK
    codes = {item['code'] for item in response.data['results']}
    assert 'READY' in codes
    assert 'SUSP' in codes


@pytest.mark.django_db
def test_deployment_capabilities_endpoint_returns_defaults(django_user_model):
    facility = FacilityFactory(code='CORE', name='Core Facility')
    user = django_user_model.objects.create_user(
        username='nurse',
        email='nurse@example.com',
        password='pass1234',
        user_type='nurse',
        primary_facility=facility,
    )
    user.facilities.add(facility)

    client = APIClient()
    client.force_authenticate(user=user)

    response = client.get('/api/settings/deployment-capabilities/')
    assert response.status_code == status.HTTP_200_OK
    assert response.data['deployment_profile'] == 'hospital'
    assert response.data['capabilities']['practitioner_scheduling_mode'] == 'roster'
    assert response.data['capabilities']['supports_department_rosters'] is True
    assert response.data['capabilities']['outpatient_requires_active_clinic_schedule'] is True


@pytest.mark.django_db
@override_settings(
    DEPLOYMENT_PROFILE='small_clinic',
    PRACTITIONER_SCHEDULING_MODE='simple',
    REQUIRE_OUTPATIENT_ACTIVE_CLINIC=False,
)
def test_deployment_capabilities_endpoint_reflects_profile_overrides(django_user_model):
    facility = FacilityFactory(code='SMALL', name='Small Clinic')
    user = django_user_model.objects.create_user(
        username='reception',
        email='reception@example.com',
        password='pass1234',
        user_type='receptionist',
        primary_facility=facility,
    )
    user.facilities.add(facility)

    client = APIClient()
    client.force_authenticate(user=user)

    response = client.get('/api/settings/deployment-capabilities/')
    assert response.status_code == status.HTTP_200_OK
    assert response.data['deployment_profile'] == 'small_clinic'
    assert response.data['capabilities']['practitioner_scheduling_mode'] == 'simple'
    assert response.data['capabilities']['supports_department_rosters'] is False
    assert response.data['capabilities']['outpatient_requires_active_clinic_schedule'] is False
