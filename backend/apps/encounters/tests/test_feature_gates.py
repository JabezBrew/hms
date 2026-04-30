import pytest
from django.core.cache import cache
from rest_framework import status
from rest_framework.test import APIClient

from apps.core.models import FeatureEntitlementOverride
from apps.core.tests.factories import DefaultFacilityFactory
from apps.encounters.tests.factories import EncounterFactory
from apps.users.tests.factories import AdminUserFactory, PatientProfileFactory


def _disable_features(settings, **overrides):
    settings.DEPLOYMENT_FEATURES = {
        **getattr(settings, 'DEPLOYMENT_FEATURES', {}),
        **overrides,
    }
    for feature_key, is_enabled in overrides.items():
        FeatureEntitlementOverride.objects.create(
            scope=FeatureEntitlementOverride.SCOPE_GLOBAL,
            feature_key=feature_key,
            is_enabled=is_enabled,
        )
    cache.clear()


def _client_for(user, facility=None):
    facility = facility or getattr(user, 'primary_facility', None) or DefaultFacilityFactory()
    client = APIClient()
    client.force_authenticate(user=user)
    client.credentials(HTTP_X_FACILITY_CODE=facility.code)
    return client


def _assert_feature_disabled(response, feature_key):
    assert response.status_code == status.HTTP_404_NOT_FOUND
    assert response.data['code'] == 'feature_disabled'
    assert response.data['feature'] == feature_key


@pytest.mark.django_db
def test_outpatient_encounters_disabled_blocks_explicit_list_filter(settings):
    _disable_features(settings, outpatient_encounters=False)
    user = AdminUserFactory()

    response = _client_for(user).get('/api/encounters/?encounter_type=outpatient')

    _assert_feature_disabled(response, 'outpatient_encounters')


@pytest.mark.django_db
def test_outpatient_encounters_disabled_hides_outpatient_from_mixed_list(settings):
    _disable_features(settings, outpatient_encounters=False, emergency_encounters=True)
    facility = DefaultFacilityFactory()
    user = AdminUserFactory(primary_facility=facility)
    outpatient_patient = PatientProfileFactory(facility=facility)
    inpatient_patient = PatientProfileFactory(facility=facility)
    EncounterFactory(patient=outpatient_patient, encounter_type='outpatient')
    inpatient = EncounterFactory(patient=inpatient_patient, encounter_type='inpatient')

    response = _client_for(user, facility).get('/api/encounters/')

    assert response.status_code == status.HTTP_200_OK
    returned_ids = {item['id'] for item in response.data['results']}
    assert returned_ids == {str(inpatient.id)}


@pytest.mark.django_db
def test_outpatient_encounters_disabled_blocks_patient_identifier_path(settings):
    _disable_features(settings, outpatient_encounters=False)
    facility = DefaultFacilityFactory()
    user = AdminUserFactory(primary_facility=facility)
    patient = PatientProfileFactory(facility=facility)

    response = _client_for(user, facility).get(
        f'/api/encounters/for_patient/?patient_id={patient.id}&encounter_type=outpatient'
    )

    _assert_feature_disabled(response, 'outpatient_encounters')


@pytest.mark.django_db
def test_outpatient_encounters_disabled_blocks_create_before_patient_lookup(settings):
    _disable_features(settings, outpatient_encounters=False)
    facility = DefaultFacilityFactory()
    user = AdminUserFactory(primary_facility=facility)
    patient = PatientProfileFactory(facility=facility)

    response = _client_for(user, facility).post(
        '/api/encounters/',
        {'patient_id': str(patient.id), 'encounter_type': 'outpatient'},
        format='json',
    )

    _assert_feature_disabled(response, 'outpatient_encounters')


@pytest.mark.django_db
def test_outpatient_visit_routes_require_outpatient_feature(settings):
    _disable_features(settings, outpatient_encounters=False)
    user = AdminUserFactory()

    response = _client_for(user).get('/api/encounters/visits/')

    _assert_feature_disabled(response, 'outpatient_encounters')


@pytest.mark.django_db
def test_emergency_encounters_disabled_blocks_explicit_list_filter(settings):
    _disable_features(settings, emergency_encounters=False)
    user = AdminUserFactory()

    response = _client_for(user).get('/api/encounters/?encounter_type=emergency')

    _assert_feature_disabled(response, 'emergency_encounters')


@pytest.mark.django_db
def test_emergency_encounters_disabled_blocks_triage_patient_identifier_path(settings):
    _disable_features(settings, emergency_encounters=False)
    facility = DefaultFacilityFactory()
    user = AdminUserFactory(primary_facility=facility)
    patient = PatientProfileFactory(facility=facility)

    response = _client_for(user, facility).post(
        '/api/encounters/triage/',
        {'patient': str(patient.id), 'priority': 'emergency'},
        format='json',
    )

    _assert_feature_disabled(response, 'emergency_encounters')
