import pytest
from rest_framework import status
from rest_framework.test import APIClient
from django.test import override_settings

from apps.core.tests.factories import FacilityFactory
from apps.core.models import FeatureEntitlementOverride
from hms_backend.deployment import build_deployment_config


def _deployment_override(profile, feature_overrides=None):
    deployment = build_deployment_config(profile, feature_overrides=feature_overrides)
    return {
        'DEPLOYMENT': deployment,
        'DEPLOYMENT_PROFILE': deployment['deployment_profile'],
        'DEPLOYMENT_FEATURES': deployment['features'],
        'DEPLOYMENT_CAPABILITIES': deployment['capabilities'],
        'FACILITY_CONTEXT_REQUIRED': deployment['features']['facility_context_required'],
        'MULTI_FACILITY_MODE': deployment['features']['multi_facility'],
        'ALLOW_CROSS_FACILITY_ACCESS': deployment['features']['cross_facility_access'],
        'PRACTITIONER_SCHEDULING_MODE': deployment['capabilities'][
            'practitioner_scheduling_mode'
        ],
        'REQUIRE_OUTPATIENT_ACTIVE_CLINIC': deployment['features'][
            'outpatient_active_clinic_required'
        ],
    }


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
    assert 'feature_sources' in response.data
    assert 'feature_manifest' in response.data
    assert response.data['facility_code'] == 'CORE'


@pytest.mark.django_db
@override_settings(**_deployment_override('small_clinic'))
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
    assert response.data['deployment_profile'] == 'clinic'
    assert response.data['facility_scope'] == 'single'
    assert response.data['features']['inpatient_admissions'] is False
    assert response.data['features']['wards'] is False
    assert response.data['capabilities']['practitioner_scheduling_mode'] == 'simple'
    assert response.data['capabilities']['supports_department_rosters'] is False
    assert response.data['capabilities']['outpatient_requires_active_clinic_schedule'] is False


@pytest.mark.django_db
@override_settings(**_deployment_override('hospital_network'))
def test_deployment_capabilities_endpoint_reflects_network_profile(django_user_model):
    facility = FacilityFactory(code='NET', name='Network Headquarters')
    user = django_user_model.objects.create_user(
        username='admin-net',
        email='admin-net@example.com',
        password='pass1234',
        user_type='admin',
        primary_facility=facility,
    )
    user.facilities.add(facility)

    client = APIClient()
    client.force_authenticate(user=user)

    response = client.get('/api/settings/deployment-capabilities/')
    assert response.status_code == status.HTTP_200_OK
    assert response.data['deployment_profile'] == 'hospital_network'
    assert response.data['facility_scope'] == 'network'
    assert response.data['features']['multi_facility'] is True
    assert response.data['features']['facility_switcher'] is True
    assert response.data['features']['cross_facility_referrals'] is True
    assert response.data['features']['cross_facility_record_exchange'] is True


@pytest.mark.django_db
def test_feature_entitlements_admin_api_crud(django_user_model):
    facility = FacilityFactory(code='ENT', name='Entitlement Facility')
    admin = django_user_model.objects.create_user(
        username='ent-admin',
        email='ent-admin@example.com',
        password='pass1234',
        user_type='admin',
        primary_facility=facility,
    )
    admin.facilities.add(facility)

    client = APIClient()
    client.force_authenticate(user=admin)

    create_response = client.post(
        '/api/settings/feature-entitlements/',
        {
            'scope': 'global',
            'facility': None,
            'feature_key': 'laboratory',
            'is_enabled': False,
            'reason': 'Clinic package',
        },
        format='json',
        HTTP_X_FACILITY_CODE=facility.code,
    )

    assert create_response.status_code == status.HTTP_201_CREATED
    override_id = create_response.data['id']
    assert FeatureEntitlementOverride.objects.filter(feature_key='laboratory').exists()

    list_response = client.get(
        '/api/settings/feature-entitlements/',
        HTTP_X_FACILITY_CODE=facility.code,
    )
    assert list_response.status_code == status.HTTP_200_OK
    assert list_response.data['results'][0]['feature_key'] == 'laboratory'

    delete_response = client.delete(
        f'/api/settings/feature-entitlements/{override_id}/',
        HTTP_X_FACILITY_CODE=facility.code,
    )
    assert delete_response.status_code == status.HTTP_204_NO_CONTENT
    assert not FeatureEntitlementOverride.objects.filter(feature_key='laboratory').exists()


@pytest.mark.django_db
def test_feature_entitlements_api_is_admin_only(django_user_model):
    facility = FacilityFactory(code='NOPE', name='Nope Facility')
    user = django_user_model.objects.create_user(
        username='not-admin',
        email='not-admin@example.com',
        password='pass1234',
        user_type='nurse',
        primary_facility=facility,
    )
    user.facilities.add(facility)

    client = APIClient()
    client.force_authenticate(user=user)

    response = client.get(
        '/api/settings/feature-entitlements/',
        HTTP_X_FACILITY_CODE=facility.code,
    )
    assert response.status_code == status.HTTP_403_FORBIDDEN
