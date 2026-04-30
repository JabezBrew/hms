from types import SimpleNamespace

import pytest
from rest_framework import status

from apps.pharmacy import services
from apps.pharmacy.services import DispensingError


@pytest.mark.django_db
def test_pharmacy_api_fails_closed_when_feature_disabled(
    settings,
    api_client,
    pharmacist_user,
    default_facility,
):
    settings.DEPLOYMENT_FEATURES = {
        **getattr(settings, 'DEPLOYMENT_FEATURES', {}),
        'pharmacy': False,
    }
    api_client.force_authenticate(user=pharmacist_user)

    response = api_client.get(
        '/api/pharmacy/dispensing/pending/',
        HTTP_X_FACILITY_CODE=default_facility.code,
    )

    assert response.status_code == status.HTTP_404_NOT_FOUND
    assert response.json()['code'] == 'feature_disabled'


@pytest.mark.django_db
def test_pharmacy_dispense_service_fails_closed_when_feature_disabled(
    settings,
    default_facility,
):
    settings.DEPLOYMENT_FEATURES = {
        **getattr(settings, 'DEPLOYMENT_FEATURES', {}),
        'pharmacy': False,
    }
    mar_entry = SimpleNamespace(facility=default_facility)

    with pytest.raises(DispensingError, match='Pharmacy feature is not enabled'):
        services.dispense_medication(mar_entry, dispensed_by=None)


@pytest.mark.django_db
def test_pharmacy_stock_endpoint_requires_inventory_feature(
    settings,
    api_client,
    pharmacist_user,
    default_facility,
):
    settings.DEPLOYMENT_FEATURES = {
        **getattr(settings, 'DEPLOYMENT_FEATURES', {}),
        'pharmacy': True,
        'inventory': False,
    }
    api_client.force_authenticate(user=pharmacist_user)

    response = api_client.get(
        '/api/pharmacy/dispensing/check-stock/',
        HTTP_X_FACILITY_CODE=default_facility.code,
    )

    assert response.status_code == status.HTTP_404_NOT_FOUND
    assert response.json()['code'] == 'feature_disabled'
