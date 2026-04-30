import pytest
from django.core.cache import cache

from hms_backend.deployment import (
    DEPLOYMENT_PROFILES,
    api_path_enabled,
    build_deployment_config,
    coerce_feature_value,
    feature_enabled,
    feature_for_api_path,
    normalize_deployment_profile,
)
from hms_backend.feature_manifest import (
    CLINIC_DISABLED_FEATURES,
    HOSPITAL_NETWORK_ENABLED_FEATURES,
    PRODUCT_TIER_PROFILES,
)
from hms_backend import settings as hms_settings
from apps.core.security import FeatureRequiredPermission
from apps.core.features import effective_feature_state, feature_enabled as db_feature_enabled
from apps.core.models import FeatureEntitlementOverride
from apps.core.tests.factories import FacilityFactory


SINGLE_SITE_HOSPITAL_FEATURES = (
    'outpatient_active_clinic_required',
    'department_rosters',
    'inpatient_admissions',
    'wards',
    'bed_management',
    'nursing_workflows',
    'discharge_workflows',
)


@pytest.fixture(autouse=True)
def clear_feature_cache():
    cache.clear()


def test_deployment_profiles_are_loaded_from_feature_manifest():
    assert DEPLOYMENT_PROFILES == PRODUCT_TIER_PROFILES
    assert set(DEPLOYMENT_PROFILES) == {'clinic', 'hospital', 'hospital_network'}


@pytest.mark.parametrize(
    ('profile_alias', 'expected_profile'),
    [
        ('clinic', 'clinic'),
        ('small_clinic', 'clinic'),
        ('hospital', 'hospital'),
        ('single_hospital', 'hospital'),
        ('hospital_network', 'hospital_network'),
        ('network', 'hospital_network'),
        ('unknown', 'hospital'),
        (None, 'hospital'),
        (' HOSPITAL ', 'hospital'),
    ],
)
def test_deployment_profile_aliases(profile_alias, expected_profile):
    config = build_deployment_config(profile_alias)

    assert normalize_deployment_profile(profile_alias) == expected_profile
    assert config['deployment_profile'] == expected_profile


def test_clinic_profile_disables_inpatient_and_network_workflows():
    config = build_deployment_config('clinic')

    assert config['facility_scope'] == 'single'
    assert config['capabilities']['practitioner_scheduling_mode'] == 'simple'
    assert config['features']['outpatient_active_clinic_required'] is False
    for feature_key in CLINIC_DISABLED_FEATURES:
        assert config['features'][feature_key] is False
    assert config['features']['patient_registration'] is True
    assert config['features']['patient_chronicle'] is True
    assert config['features']['outpatient_encounters'] is True


def test_hospital_profile_is_full_single_site():
    config = build_deployment_config('hospital')

    assert config['facility_scope'] == 'single'
    assert config['capabilities']['practitioner_scheduling_mode'] == 'roster'
    for feature_key in SINGLE_SITE_HOSPITAL_FEATURES:
        assert config['features'][feature_key] is True
    for feature_key in HOSPITAL_NETWORK_ENABLED_FEATURES:
        assert config['features'][feature_key] is False


def test_hospital_network_enables_network_capabilities():
    config = build_deployment_config('hospital_network')

    assert config['facility_scope'] == 'network'
    assert config['features']['multi_facility'] is True
    assert config['features']['facility_switcher'] is True
    assert config['features']['cross_facility_access'] is True
    assert config['features']['cross_facility_referrals'] is True
    assert config['features']['cross_facility_record_exchange'] is True
    for feature_key in SINGLE_SITE_HOSPITAL_FEATURES:
        assert config['features'][feature_key] is True


@pytest.mark.parametrize(
    ('raw_value', 'expected'),
    [
        (True, True),
        (False, False),
        (None, None),
        ('1', True),
        ('true', True),
        ('YES', True),
        (' on ', True),
        ('0', False),
        ('false', False),
        ('NO', False),
        (' off ', False),
        ('', None),
        ('maybe', None),
    ],
)
def test_feature_override_value_coercion(raw_value, expected):
    assert coerce_feature_value(raw_value) is expected


def test_feature_flag_override_parser_supports_json_and_key_value_strings():
    parse = hms_settings._parse_feature_flag_overrides

    assert parse('laboratory=false, billing=yes, malformed, nursing_workflows=0') == {
        'laboratory': 'false',
        'billing': 'yes',
        'nursing_workflows': '0',
    }
    assert parse('{"laboratory": false, "billing": "yes", "unknown_feature": true}') == {
        'laboratory': False,
        'billing': 'yes',
        'unknown_feature': True,
    }
    assert parse('{not-json') == {}
    assert parse('["laboratory"]') == {}


def test_feature_overrides_can_customize_profile_and_ignore_unknowns():
    config = build_deployment_config(
        'hospital',
        feature_overrides={
            'laboratory': 'false',
            'department_rosters': '0',
            'billing': 'yes',
            'pharmacy': False,
            'wards': 'not-a-bool',
            'unknown_feature': 'true',
        },
    )

    assert config['features']['laboratory'] is False
    assert config['features']['department_rosters'] is False
    assert config['features']['billing'] is True
    assert config['features']['pharmacy'] is False
    assert config['features']['wards'] is True
    assert config['capabilities']['practitioner_scheduling_mode'] == 'simple'
    assert 'unknown_feature' not in config['features']


@pytest.mark.django_db
def test_feature_enabled_respects_legacy_setting_overrides(settings):
    settings.DEPLOYMENT_FEATURES = {'multi_facility': True}
    settings.MULTI_FACILITY_MODE = False

    assert feature_enabled('multi_facility') is False


@pytest.mark.django_db
def test_feature_required_permission_checks_declared_feature(settings):
    settings.DEPLOYMENT_FEATURES = {'laboratory': False}
    view = type('View', (), {'required_feature': 'laboratory'})()

    with pytest.raises(Exception) as exc:
        FeatureRequiredPermission().has_permission(None, view)

    assert getattr(exc.value, 'status_code', None) == 404


@pytest.mark.django_db
def test_api_path_feature_mapping_supports_module_and_nested_roster_paths(settings):
    settings.DEPLOYMENT_FEATURES = {
        'laboratory': False,
        'department_rosters': False,
        'wards': True,
        'bed_management': False,
        'cross_facility_referrals': False,
        'cross_facility_record_exchange': False,
        'referrals': False,
    }
    settings.PRACTITIONER_SCHEDULING_MODE = 'simple'

    assert feature_for_api_path('/api/laboratory/orders/') == 'laboratory'
    assert api_path_enabled('/api/laboratory/orders/') == (False, 'laboratory')
    assert feature_for_api_path('/api/wards/wards/') == 'wards'
    assert api_path_enabled('/api/wards/wards/') == (True, 'wards')
    assert feature_for_api_path('/api/wards/beds/available/') == 'bed_management'
    assert api_path_enabled('/api/wards/beds/available/') == (
        False,
        'bed_management',
    )
    assert feature_for_api_path('/api/referrals/') == 'referrals'
    assert api_path_enabled('/api/referrals/') == (False, 'referrals')
    assert feature_for_api_path('/api/consent/referrals/') == 'cross_facility_referrals'
    assert api_path_enabled('/api/consent/referrals/') == (
        False,
        'cross_facility_referrals',
    )
    assert feature_for_api_path('/api/interop/exports/') == (
        'cross_facility_record_exchange'
    )
    assert api_path_enabled('/api/interop/exports/') == (
        False,
        'cross_facility_record_exchange',
    )
    assert feature_for_api_path(
        '/api/organization/departments/00000000-0000-0000-0000-000000000000/roster/'
    ) == 'department_rosters'
    assert api_path_enabled(
        '/api/organization/departments/00000000-0000-0000-0000-000000000000/roster/'
    ) == (False, 'department_rosters')


def test_major_tier_controlled_viewsets_declare_required_features():
    from apps.admissions.views import AdmissionCaseViewSet
    from apps.billing.views import InvoiceViewSet
    from apps.laboratory.views import LabOrderViewSet
    from apps.nursing.views import NursingTaskViewSet
    from apps.pharmacy.views import DispensingViewSet
    from apps.wards.views import WardViewSet

    assert AdmissionCaseViewSet.required_feature == 'inpatient_admissions'
    assert InvoiceViewSet.required_feature == 'billing'
    assert LabOrderViewSet.required_feature == 'laboratory'
    assert NursingTaskViewSet.required_feature == 'nursing_workflows'
    assert DispensingViewSet.required_feature == 'pharmacy'
    assert WardViewSet.required_feature == 'wards'


@pytest.mark.django_db
def test_db_entitlement_precedence_facility_then_global_then_profile(settings):
    settings.DEPLOYMENT_FEATURES = {
        **getattr(settings, 'DEPLOYMENT_FEATURES', {}),
        'laboratory': True,
    }
    facility = FacilityFactory(code='LABA', name='Lab A')
    other_facility = FacilityFactory(code='LABB', name='Lab B')
    global_override = FeatureEntitlementOverride.objects.create(
        scope=FeatureEntitlementOverride.SCOPE_GLOBAL,
        feature_key='laboratory',
        is_enabled=False,
    )
    assert db_feature_enabled('laboratory') is False
    assert db_feature_enabled('laboratory', facility=facility) is False
    assert db_feature_enabled('laboratory', facility=other_facility) is False

    FeatureEntitlementOverride.objects.create(
        scope=FeatureEntitlementOverride.SCOPE_FACILITY,
        facility=facility,
        feature_key='laboratory',
        is_enabled=True,
    )

    state = effective_feature_state(facility=facility)
    assert state['features']['laboratory'] is True
    assert state['feature_sources']['laboratory'] == 'facility_override'

    other_state = effective_feature_state(facility=other_facility)
    assert other_state['features']['laboratory'] is False
    assert other_state['feature_sources']['laboratory'] == 'global_override'

    global_override.delete()
    other_state = effective_feature_state(facility=other_facility)
    assert other_state['features']['laboratory'] is True
    assert other_state['feature_sources']['laboratory'] == 'deployment_profile'


@pytest.mark.django_db
def test_entitlement_cache_invalidates_on_override_update(settings):
    settings.DEPLOYMENT_FEATURES = {
        **getattr(settings, 'DEPLOYMENT_FEATURES', {}),
        'pharmacy': True,
    }
    override = FeatureEntitlementOverride.objects.create(
        scope=FeatureEntitlementOverride.SCOPE_GLOBAL,
        feature_key='pharmacy',
        is_enabled=False,
    )

    assert db_feature_enabled('pharmacy') is False
    override.is_enabled = True
    override.save()

    assert db_feature_enabled('pharmacy') is True
