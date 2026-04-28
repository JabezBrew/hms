import pytest

from hms_backend.deployment import (
    api_path_enabled,
    build_deployment_config,
    feature_enabled,
    feature_for_api_path,
    normalize_deployment_profile,
)
from apps.core.security import FeatureRequiredPermission
from apps.core.features import effective_feature_state, feature_enabled as db_feature_enabled
from apps.core.models import FeatureEntitlementOverride
from apps.core.tests.factories import FacilityFactory


def test_small_clinic_alias_resolves_to_clinic_profile():
    config = build_deployment_config('small_clinic')

    assert normalize_deployment_profile('small_clinic') == 'clinic'
    assert config['deployment_profile'] == 'clinic'
    assert config['features']['department_rosters'] is False
    assert config['features']['outpatient_active_clinic_required'] is False
    assert config['features']['inpatient_admissions'] is False


def test_hospital_network_enables_network_capabilities():
    config = build_deployment_config('hospital_network')

    assert config['facility_scope'] == 'network'
    assert config['features']['multi_facility'] is True
    assert config['features']['facility_switcher'] is True
    assert config['features']['cross_facility_access'] is True
    assert config['features']['cross_facility_referrals'] is True
    assert config['features']['cross_facility_record_exchange'] is True


def test_feature_overrides_can_customize_profile():
    config = build_deployment_config(
        'hospital',
        feature_overrides={
            'laboratory': 'false',
            'department_rosters': 'false',
            'unknown_feature': 'true',
        },
    )

    assert config['features']['laboratory'] is False
    assert config['features']['department_rosters'] is False
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
    }
    settings.PRACTITIONER_SCHEDULING_MODE = 'simple'

    assert feature_for_api_path('/api/laboratory/orders/') == 'laboratory'
    assert api_path_enabled('/api/laboratory/orders/') == (False, 'laboratory')
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
    FeatureEntitlementOverride.objects.create(
        scope=FeatureEntitlementOverride.SCOPE_GLOBAL,
        feature_key='laboratory',
        is_enabled=False,
    )
    assert db_feature_enabled('laboratory') is False
    assert db_feature_enabled('laboratory', facility=facility) is False

    FeatureEntitlementOverride.objects.create(
        scope=FeatureEntitlementOverride.SCOPE_FACILITY,
        facility=facility,
        feature_key='laboratory',
        is_enabled=True,
    )

    state = effective_feature_state(facility=facility)
    assert state['features']['laboratory'] is True
    assert state['feature_sources']['laboratory'] == 'facility_override'


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
