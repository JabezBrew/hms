"""
Security regression coverage for confirmed broken-access-control issues.

These tests encode the expected secure behavior and are intentionally marked
xfail(strict=True) until the underlying vulnerabilities are remediated. Once a
fix lands, the xfail markers should be removed so the tests become hard gates.
"""

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.clinical_notes.tests.factories import PrescriptionFactory
from apps.core.tests.factories import DefaultFacilityFactory
from apps.drug_safety.models import PatientAllergy
from apps.encounters.tests.factories import EncounterFactory
from apps.laboratory.tests.factories import LabOrderFactory, LabSpecimenFactory
from apps.users.tests.factories import (
    PatientProfileFactory,
    PractitionerProfileFactory,
    ReceptionistUserFactory,
    UserFactory,
)


pytestmark = [
    pytest.mark.django_db,
    pytest.mark.tier1,
    pytest.mark.rbac,
    pytest.mark.critical,
]


def get_authenticated_client(user, facility=None):
    """Return an API client authenticated for the active facility."""
    client = APIClient()
    refresh = RefreshToken.for_user(user)
    facility = facility or getattr(user, "primary_facility", None) or DefaultFacilityFactory()
    client.credentials(
        HTTP_AUTHORIZATION=f"Bearer {refresh.access_token}",
        HTTP_X_FACILITY_CODE=facility.code,
    )
    return client


@pytest.mark.xfail(
    strict=True,
    raises=AssertionError,
    reason="Known vulnerability: billing users can retrieve full patient profile detail.",
)
def test_billing_user_cannot_retrieve_unrelated_patient_profile_detail():
    facility = DefaultFacilityFactory()
    billing_user = UserFactory(user_type="billing", primary_facility=facility)
    patient = PatientProfileFactory(facility=facility)

    client = get_authenticated_client(billing_user, facility=facility)
    response = client.get(f"/api/users/patients/{patient.id}/")

    assert response.status_code in {403, 404}


@pytest.mark.xfail(
    strict=True,
    raises=AssertionError,
    reason="Known vulnerability: receptionist users can modify prescriptions.",
)
def test_receptionist_cannot_modify_prescription():
    facility = DefaultFacilityFactory()
    receptionist = ReceptionistUserFactory(primary_facility=facility)
    patient = PatientProfileFactory(facility=facility)
    prescriber = PractitionerProfileFactory(
        staff__primary_facility=facility,
        staff__user__primary_facility=facility,
    )
    encounter = EncounterFactory(
        patient=patient,
        facility=facility,
        practitioner=prescriber,
    )
    prescription = PrescriptionFactory(
        patient=patient,
        facility=facility,
        prescribed_by=prescriber,
        encounter=encounter,
        dosage="500mg",
        status="active",
    )

    client = get_authenticated_client(receptionist, facility=facility)
    response = client.patch(
        f"/api/clinical-notes/prescriptions/{prescription.id}/",
        {"dosage": "999mg", "status": "completed"},
        format="json",
    )

    prescription.refresh_from_db()

    assert response.status_code in {403, 404}
    assert prescription.dosage == "500mg"
    assert prescription.status == "active"


@pytest.mark.xfail(
    strict=True,
    raises=AssertionError,
    reason="Known vulnerability: billing users can advance lab order workflow.",
)
def test_billing_user_cannot_collect_lab_order():
    facility = DefaultFacilityFactory()
    billing_user = UserFactory(user_type="billing", primary_facility=facility)
    patient = PatientProfileFactory(facility=facility)
    prescriber = PractitionerProfileFactory(
        staff__primary_facility=facility,
        staff__user__primary_facility=facility,
    )
    encounter = EncounterFactory(
        patient=patient,
        facility=facility,
        practitioner=prescriber,
    )
    order = LabOrderFactory(
        patient=patient,
        facility=facility,
        encounter=encounter,
        ordering_provider=prescriber,
        status="ordered",
    )
    LabSpecimenFactory(order=order, facility=facility, status="collected")

    client = get_authenticated_client(billing_user, facility=facility)
    response = client.post(
        f"/api/laboratory/orders/{order.id}/collect/",
        {},
        format="json",
    )

    order.refresh_from_db()

    assert response.status_code in {403, 404}
    assert order.status == "ordered"


@pytest.mark.xfail(
    strict=True,
    raises=AssertionError,
    reason="Known vulnerability: receptionist users can deactivate allergy records.",
)
def test_receptionist_cannot_deactivate_patient_allergy():
    facility = DefaultFacilityFactory()
    receptionist = ReceptionistUserFactory(primary_facility=facility)
    patient = PatientProfileFactory(facility=facility)
    allergy = PatientAllergy.objects.create(
        patient=patient,
        facility=facility,
        allergen_name="Penicillin",
        severity="severe",
        allergy_type="drug",
        reaction="Anaphylaxis",
        created_by=receptionist,
    )

    client = get_authenticated_client(receptionist, facility=facility)
    response = client.post(
        f"/api/drug-safety/allergies/{allergy.id}/deactivate/",
        {},
        format="json",
    )

    allergy.refresh_from_db()

    assert response.status_code in {403, 404}
    assert allergy.is_active is True
