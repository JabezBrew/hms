import pytest
from django.core.cache import cache
from rest_framework import status
from rest_framework.test import APIClient

from apps.core.models import FeatureEntitlementOverride
from apps.core.tests.factories import DefaultFacilityFactory
from apps.users.tests.factories import (
    AdminUserFactory,
    DoctorUserFactory,
    PatientProfileFactory,
)


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
def test_patient_chronicle_core_override_is_ignored_for_legacy_patient_detail(settings):
    _disable_features(settings, patient_chronicle=False)
    facility = DefaultFacilityFactory()
    user = AdminUserFactory(primary_facility=facility)
    patient = PatientProfileFactory(facility=facility)

    response = _client_for(user, facility).get(f'/api/users/patients/{patient.id}/')

    assert response.status_code == status.HTTP_200_OK


@pytest.mark.django_db
def test_patient_chronicle_core_override_is_ignored_for_my_patients_identifier_action(settings):
    _disable_features(settings, patient_chronicle=False)
    facility = DefaultFacilityFactory()
    user = DoctorUserFactory(primary_facility=facility)
    patient = PatientProfileFactory(facility=facility)

    response = _client_for(user, facility).post(
        '/api/users/my-patients/add_patient/',
        {'patient_id': str(patient.id)},
        format='json',
    )

    assert response.status_code == status.HTTP_201_CREATED
