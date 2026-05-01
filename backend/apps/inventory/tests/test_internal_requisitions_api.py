from decimal import Decimal

import pytest
from rest_framework import status

from apps.inventory.models import (
    InternalRequisition,
    InternalRequisitionItem,
    InventoryItem,
    StorageLocation,
)


@pytest.fixture
def inventory_item(default_facility):
    return InventoryItem.objects.create(
        facility=default_facility,
        name='Paracetamol 500mg',
        sku='PCM-500',
        item_type='medication',
        unit_of_measure='tablet',
        unit_cost=Decimal('0.50'),
        selling_price=Decimal('1.00'),
        reorder_level=50,
        reorder_quantity=200,
    )


@pytest.fixture
def main_store(default_facility):
    return StorageLocation.objects.create(
        facility=default_facility,
        code='MAIN',
        name='Main Store',
        location_type='warehouse',
        is_active=True,
    )


@pytest.fixture
def ward_store(default_facility):
    return StorageLocation.objects.create(
        facility=default_facility,
        code='WARD-A',
        name='Ward A Store',
        location_type='ward_store',
        is_active=True,
    )


def _payload(ward_store, main_store, inventory_item):
    return {
        'requesting_location': str(ward_store.id),
        'fulfilling_location': str(main_store.id),
        'priority': 'normal',
        'justification': 'Routine ward stock replenishment',
        'items': [
            {
                'item': str(inventory_item.id),
                'quantity_requested': 12,
                'notes': 'Top up medication trolley',
            }
        ],
    }


def _create_requisition(default_facility, requested_by, ward_store, main_store, inventory_item, *, status_value):
    requisition = InternalRequisition.objects.create(
        facility=default_facility,
        requisition_number=f'INT-{requested_by.id.hex[:8]}-{status_value}',
        requesting_location=ward_store,
        fulfilling_location=main_store,
        requested_by=requested_by,
        priority='normal',
        status=status_value,
        justification='Ward stock top-up',
    )
    InternalRequisitionItem.objects.create(
        requisition=requisition,
        item=inventory_item,
        quantity_requested=12,
    )
    return requisition


@pytest.mark.django_db
def test_nurse_can_create_and_submit_ward_stock_request(
    api_client,
    nurse_user,
    default_facility,
    ward_store,
    main_store,
    inventory_item,
):
    api_client.force_authenticate(user=nurse_user)

    response = api_client.post(
        '/api/inventory/internal-requisitions/',
        _payload(ward_store, main_store, inventory_item),
        format='json',
        HTTP_X_FACILITY_CODE=default_facility.code,
    )

    assert response.status_code == status.HTTP_201_CREATED
    assert response.data['status'] == 'draft'
    assert response.data['requested_by'] == nurse_user.id

    submit_response = api_client.post(
        f"/api/inventory/internal-requisitions/{response.data['id']}/submit/",
        HTTP_X_FACILITY_CODE=default_facility.code,
    )

    assert submit_response.status_code == status.HTTP_200_OK
    assert submit_response.data['status'] == 'pending_approval'


@pytest.mark.django_db
def test_nurse_request_must_start_from_ward_store(
    api_client,
    nurse_user,
    default_facility,
    main_store,
    inventory_item,
):
    api_client.force_authenticate(user=nurse_user)

    response = api_client.post(
        '/api/inventory/internal-requisitions/',
        _payload(main_store, StorageLocation.objects.create(
            facility=default_facility,
            code='PHARM',
            name='Main Pharmacy',
            location_type='pharmacy',
            is_active=True,
        ), inventory_item),
        format='json',
        HTTP_X_FACILITY_CODE=default_facility.code,
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert 'requesting_location' in response.data


@pytest.mark.django_db
def test_nurse_lists_only_accessible_ward_stock_requests(
    api_client,
    nurse_user,
    user_factory,
    default_facility,
    ward_store,
    main_store,
    inventory_item,
):
    other_nurse = user_factory(user_type='nurse')
    own_request = _create_requisition(
        default_facility,
        nurse_user,
        ward_store,
        main_store,
        inventory_item,
        status_value='pending_approval',
    )
    _create_requisition(
        default_facility,
        other_nurse,
        ward_store,
        main_store,
        inventory_item,
        status_value='pending_approval',
    )

    api_client.force_authenticate(user=nurse_user)
    response = api_client.get(
        '/api/inventory/internal-requisitions/',
        HTTP_X_FACILITY_CODE=default_facility.code,
    )

    assert response.status_code == status.HTTP_200_OK
    assert [row['id'] for row in response.data['results']] == [str(own_request.id)]
    assert response.data['results'][0]['items_count'] == 1


@pytest.mark.django_db
def test_nurse_cannot_approve_ward_stock_request(
    api_client,
    nurse_user,
    default_facility,
    ward_store,
    main_store,
    inventory_item,
):
    requisition = _create_requisition(
        default_facility,
        nurse_user,
        ward_store,
        main_store,
        inventory_item,
        status_value='pending_approval',
    )

    api_client.force_authenticate(user=nurse_user)
    response = api_client.post(
        f'/api/inventory/internal-requisitions/{requisition.id}/approve/',
        HTTP_X_FACILITY_CODE=default_facility.code,
    )

    assert response.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.django_db
def test_pharmacist_can_approve_ward_stock_request(
    api_client,
    pharmacist_user,
    nurse_user,
    default_facility,
    ward_store,
    main_store,
    inventory_item,
):
    requisition = _create_requisition(
        default_facility,
        nurse_user,
        ward_store,
        main_store,
        inventory_item,
        status_value='pending_approval',
    )

    api_client.force_authenticate(user=pharmacist_user)
    response = api_client.post(
        f'/api/inventory/internal-requisitions/{requisition.id}/approve/',
        HTTP_X_FACILITY_CODE=default_facility.code,
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data['status'] == 'approved'
    assert response.data['approved_by'] == pharmacist_user.id
