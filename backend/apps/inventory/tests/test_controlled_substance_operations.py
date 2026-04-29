from decimal import Decimal

import pytest
from rest_framework import status

from apps.clinical_notes.tests.factories import ActivePrescriptionFactory
from apps.core.tests.factories import FacilityFactory
from apps.inventory.models import (
    ControlledSubstanceEntry,
    ControlledSubstanceRegister,
    InventoryItem,
    LocationStock,
    StorageLocation,
)
from apps.users.tests.factories import PatientProfileFactory, PharmacistUserFactory


pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def enable_inventory_feature(settings):
    settings.DEPLOYMENT_FEATURES = {
        **getattr(settings, 'DEPLOYMENT_FEATURES', {}),
        'inventory': True,
    }


@pytest.fixture
def controlled_inventory(default_facility):
    location = StorageLocation.objects.create(
        facility=default_facility,
        code='CS-PHARM',
        name='Controlled Cabinet',
        location_type='pharmacy',
        can_dispense_to_patients=True,
        allows_controlled_substances=True,
    )
    item = InventoryItem.objects.create(
        facility=default_facility,
        name='Morphine 10mg ampule',
        sku='MORPH-10',
        item_type='medication',
        is_controlled_substance=True,
        controlled_schedule='II',
        unit_of_measure='ampule',
        minimum_stock=0,
        reorder_level=0,
        reorder_quantity=0,
        unit_cost=Decimal('4.00'),
        selling_price=Decimal('6.00'),
    )
    register = ControlledSubstanceRegister.objects.create(
        facility=default_facility,
        location=location,
        item=item,
        running_balance=10,
    )
    LocationStock.objects.create(
        item=item,
        location=location,
        quantity=10,
        reserved_quantity=0,
    )
    return {
        'location': location,
        'item': item,
        'register': register,
    }


@pytest.fixture
def pharmacist(default_facility):
    return PharmacistUserFactory(primary_facility=default_facility)


@pytest.fixture
def witness(default_facility):
    return PharmacistUserFactory(primary_facility=default_facility)


@pytest.fixture
def patient_with_prescription(default_facility):
    patient = PatientProfileFactory(facility=default_facility)
    prescription = ActivePrescriptionFactory(patient=patient, facility=default_facility)
    return patient, prescription


def _facility_post(api_client, facility, path, payload):
    return api_client.post(
        path,
        payload,
        format='json',
        HTTP_X_FACILITY_CODE=facility.code,
    )


def _dispense_payload(controlled_inventory, patient, prescription, witness):
    return {
        'location': str(controlled_inventory['location'].id),
        'item': str(controlled_inventory['item'].id),
        'quantity': 3,
        'patient': str(patient.id),
        'prescription': str(prescription.id),
        'witness': str(witness.id),
    }


def test_pharmacist_can_dispense_only_after_patient_and_inventory_checks(
    api_client,
    default_facility,
    controlled_inventory,
    pharmacist,
    witness,
    patient_with_prescription,
):
    patient, prescription = patient_with_prescription
    api_client.force_authenticate(user=pharmacist)

    response = _facility_post(
        api_client,
        default_facility,
        '/api/inventory/controlled/dispense/',
        _dispense_payload(controlled_inventory, patient, prescription, witness),
    )

    assert response.status_code == status.HTTP_201_CREATED
    entry = ControlledSubstanceEntry.objects.get(id=response.data['id'])
    assert entry.entry_type == 'dispense'
    assert entry.patient == patient
    assert entry.prescription == prescription

    controlled_inventory['register'].refresh_from_db()
    assert controlled_inventory['register'].running_balance == 7
    stock = LocationStock.objects.get(
        item=controlled_inventory['item'],
        location=controlled_inventory['location'],
    )
    assert stock.quantity == 7


def test_doctor_cannot_perform_controlled_substance_dispense(
    api_client,
    doctor_user,
    default_facility,
    controlled_inventory,
    witness,
    patient_with_prescription,
):
    patient, prescription = patient_with_prescription
    api_client.force_authenticate(user=doctor_user)

    response = _facility_post(
        api_client,
        default_facility,
        '/api/inventory/controlled/dispense/',
        _dispense_payload(controlled_inventory, patient, prescription, witness),
    )

    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert ControlledSubstanceEntry.objects.count() == 0


def test_dispense_rejects_patient_outside_active_facility(
    api_client,
    default_facility,
    controlled_inventory,
    pharmacist,
    witness,
):
    other_facility = FacilityFactory()
    patient = PatientProfileFactory(facility=other_facility)
    prescription = ActivePrescriptionFactory(patient=patient, facility=other_facility)
    api_client.force_authenticate(user=pharmacist)

    response = _facility_post(
        api_client,
        default_facility,
        '/api/inventory/controlled/dispense/',
        _dispense_payload(controlled_inventory, patient, prescription, witness),
    )

    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert ControlledSubstanceEntry.objects.count() == 0


def test_dispense_rejects_prescription_for_different_patient(
    api_client,
    default_facility,
    controlled_inventory,
    pharmacist,
    witness,
    patient_with_prescription,
):
    patient, _ = patient_with_prescription
    other_patient = PatientProfileFactory(facility=default_facility)
    other_prescription = ActivePrescriptionFactory(
        patient=other_patient,
        facility=default_facility,
    )
    api_client.force_authenticate(user=pharmacist)

    response = _facility_post(
        api_client,
        default_facility,
        '/api/inventory/controlled/dispense/',
        _dispense_payload(controlled_inventory, patient, other_prescription, witness),
    )

    assert response.status_code == status.HTTP_404_NOT_FOUND
    assert ControlledSubstanceEntry.objects.count() == 0


def test_dispense_requires_location_authorized_for_patient_dispensing(
    api_client,
    default_facility,
    controlled_inventory,
    pharmacist,
    witness,
    patient_with_prescription,
):
    location = StorageLocation.objects.create(
        facility=default_facility,
        code='CS-STORE',
        name='Controlled Store',
        location_type='warehouse',
        can_dispense_to_patients=False,
        allows_controlled_substances=True,
    )
    patient, prescription = patient_with_prescription
    api_client.force_authenticate(user=pharmacist)

    payload = _dispense_payload(controlled_inventory, patient, prescription, witness)
    payload['location'] = str(location.id)

    response = _facility_post(
        api_client,
        default_facility,
        '/api/inventory/controlled/dispense/',
        payload,
    )

    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert ControlledSubstanceEntry.objects.count() == 0


def test_dispense_rejects_witness_without_active_facility_access(
    api_client,
    default_facility,
    controlled_inventory,
    pharmacist,
    patient_with_prescription,
):
    other_facility = FacilityFactory()
    outside_witness = PharmacistUserFactory(primary_facility=other_facility)
    patient, prescription = patient_with_prescription
    api_client.force_authenticate(user=pharmacist)

    response = _facility_post(
        api_client,
        default_facility,
        '/api/inventory/controlled/dispense/',
        _dispense_payload(controlled_inventory, patient, prescription, outside_witness),
    )

    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert ControlledSubstanceEntry.objects.count() == 0


def test_wastage_requires_controlled_substance_privileges(
    api_client,
    nurse_user,
    default_facility,
    controlled_inventory,
    witness,
):
    api_client.force_authenticate(user=nurse_user)

    response = _facility_post(
        api_client,
        default_facility,
        '/api/inventory/controlled/wastage/',
        {
            'location': str(controlled_inventory['location'].id),
            'item': str(controlled_inventory['item'].id),
            'quantity': 1,
            'wastage_reason': 'Dropped during preparation',
            'witness': str(witness.id),
        },
    )

    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert ControlledSubstanceEntry.objects.count() == 0


def test_count_requires_controlled_substance_privileges(
    api_client,
    receptionist_user,
    default_facility,
    controlled_inventory,
    witness,
):
    api_client.force_authenticate(user=receptionist_user)

    response = _facility_post(
        api_client,
        default_facility,
        '/api/inventory/controlled/count/',
        {
            'location': str(controlled_inventory['location'].id),
            'item': str(controlled_inventory['item'].id),
            'actual_count': 10,
            'witness': str(witness.id),
        },
    )

    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert ControlledSubstanceEntry.objects.count() == 0
