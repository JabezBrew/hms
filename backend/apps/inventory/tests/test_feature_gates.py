from decimal import Decimal

import pytest
from rest_framework import status

from apps.inventory.models import (
    InventoryItem,
    LocationStock,
    StockMovement,
    StorageLocation,
)
from apps.inventory.services import FeatureDisabledError, StockService


@pytest.mark.django_db
def test_inventory_api_fails_closed_when_feature_disabled(
    settings,
    api_client,
    admin_user,
    default_facility,
):
    settings.DEPLOYMENT_FEATURES = {
        **getattr(settings, 'DEPLOYMENT_FEATURES', {}),
        'inventory': False,
    }
    api_client.force_authenticate(user=admin_user)

    response = api_client.get(
        '/api/inventory/items/',
        HTTP_X_FACILITY_CODE=default_facility.code,
    )

    assert response.status_code == status.HTTP_404_NOT_FOUND
    assert response.json()['code'] == 'feature_disabled'


@pytest.mark.django_db
def test_stock_service_does_not_mutate_when_inventory_disabled(
    settings,
    default_facility,
    admin_user,
):
    settings.DEPLOYMENT_FEATURES = {
        **getattr(settings, 'DEPLOYMENT_FEATURES', {}),
        'inventory': False,
    }
    location = StorageLocation.objects.create(
        facility=default_facility,
        code='MAIN',
        name='Main Store',
        location_type='warehouse',
    )
    item = InventoryItem.objects.create(
        facility=default_facility,
        name='Syringe',
        sku='SYR-001',
        item_type='consumable',
        unit_of_measure='piece',
        unit_cost=Decimal('1.00'),
        selling_price=Decimal('1.50'),
        reorder_level=10,
        reorder_quantity=100,
    )

    with pytest.raises(FeatureDisabledError):
        StockService.adjust_stock(
            item=item,
            location=location,
            quantity_change=10,
            movement_type='purchase',
            user=admin_user,
        )

    assert not LocationStock.objects.filter(item=item, location=location).exists()
    assert not StockMovement.objects.filter(item=item).exists()
