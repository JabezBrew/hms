"""Security regressions for remaining patient-domain queryset scoping."""

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.encounters.tests.factories import EncounterFactory
from apps.nursing.tests.factories import ShiftHandoffFactory, SupplyRequestFactory, TreatmentSheetEntryFactory, VitalSignsFactory
from apps.referrals.tests.factories import ReferralFactory
from apps.users.tests.factories import PatientProfileFactory, PractitionerProfileFactory, ReceptionistUserFactory


pytestmark = [
    pytest.mark.django_db,
    pytest.mark.tier1,
    pytest.mark.rbac,
    pytest.mark.critical,
]


def get_authenticated_client(user, facility):
    client = APIClient()
    refresh = RefreshToken.for_user(user)
    client.credentials(
        HTTP_AUTHORIZATION=f"Bearer {refresh.access_token}",
        HTTP_X_FACILITY_CODE=facility.code,
    )
    return client


def test_doctor_cannot_list_unrelated_referrals(settings):
    settings.TEAM_ACCESS_STRICT = True
    facility = PatientProfileFactory().facility
    doctor_practitioner = PractitionerProfileFactory(
        staff__user__user_type="doctor",
        staff__primary_facility=facility,
        staff__user__primary_facility=facility,
    )
    doctor_user = doctor_practitioner.staff.user

    accessible_patient = PatientProfileFactory(facility=facility)
    inaccessible_patient = PatientProfileFactory(facility=facility)
    accessible_encounter = EncounterFactory(
        patient=accessible_patient,
        facility=facility,
        practitioner=doctor_practitioner,
        status="in-progress",
    )
    other_practitioner = PractitionerProfileFactory(
        staff__primary_facility=facility,
        staff__user__primary_facility=facility,
    )
    inaccessible_encounter = EncounterFactory(
        patient=inaccessible_patient,
        facility=facility,
        practitioner=other_practitioner,
        status="in-progress",
    )
    accessible_referral = ReferralFactory(
        patient=accessible_patient,
        facility=facility,
        encounter=accessible_encounter,
        referring_provider=doctor_practitioner,
        status="pending",
    )
    ReferralFactory(
        patient=inaccessible_patient,
        facility=facility,
        encounter=inaccessible_encounter,
        referring_provider=other_practitioner,
        status="pending",
    )

    client = get_authenticated_client(doctor_user, facility)
    response = client.get("/api/referrals/")

    assert response.status_code == 200
    returned_ids = {item["id"] for item in response.data["results"]}
    assert returned_ids == {str(accessible_referral.id)}


def test_nurse_cannot_list_unrelated_vital_signs(settings):
    settings.TEAM_ACCESS_STRICT = True
    facility = PatientProfileFactory().facility
    nurse_practitioner = PractitionerProfileFactory(
        staff__user__user_type="nurse",
        staff__primary_facility=facility,
        staff__user__primary_facility=facility,
    )
    nurse_user = nurse_practitioner.staff.user

    accessible_patient = PatientProfileFactory(facility=facility)
    inaccessible_patient = PatientProfileFactory(facility=facility)
    EncounterFactory(
        patient=accessible_patient,
        facility=facility,
        practitioner=nurse_practitioner,
        status="in-progress",
    )
    VitalSignsFactory(patient=accessible_patient, facility=facility, recorded_by=nurse_practitioner)
    VitalSignsFactory(patient=inaccessible_patient, facility=facility)

    client = get_authenticated_client(nurse_user, facility)
    response = client.get("/api/nursing/vital-signs/")

    assert response.status_code == 200
    returned_patient_ids = {str(item["patient"]) for item in response.data["results"]}
    assert returned_patient_ids == {str(accessible_patient.id)}


def test_nurse_only_sees_own_supply_requests(settings):
    settings.TEAM_ACCESS_STRICT = True
    facility = PatientProfileFactory().facility
    nurse_a = PractitionerProfileFactory(
        staff__user__user_type="nurse",
        staff__primary_facility=facility,
        staff__user__primary_facility=facility,
    )
    nurse_b = PractitionerProfileFactory(
        staff__user__user_type="nurse",
        staff__primary_facility=facility,
        staff__user__primary_facility=facility,
    )

    patient = PatientProfileFactory(facility=facility)
    EncounterFactory(
        patient=patient,
        facility=facility,
        practitioner=nurse_a,
        status="in-progress",
    )
    entry = TreatmentSheetEntryFactory(
        patient=patient,
        facility=facility,
        ordered_by=nurse_a,
    )
    own_request = SupplyRequestFactory(
        treatment_entry=entry,
        facility=facility,
        requested_by=nurse_a,
    )
    SupplyRequestFactory(
        treatment_entry=entry,
        facility=facility,
        requested_by=nurse_b,
    )

    client = get_authenticated_client(nurse_a.staff.user, facility)
    response = client.get("/api/nursing/supply-requests/")

    assert response.status_code == 200
    returned_ids = {item["id"] for item in response.data["results"]}
    assert returned_ids == {str(own_request.id)}


def test_receptionist_cannot_list_supply_requests():
    facility = PatientProfileFactory().facility
    receptionist = ReceptionistUserFactory(primary_facility=facility)
    patient = PatientProfileFactory(facility=facility)
    entry = TreatmentSheetEntryFactory(patient=patient, facility=facility)
    SupplyRequestFactory(treatment_entry=entry, facility=facility)

    client = get_authenticated_client(receptionist, facility)
    response = client.get("/api/nursing/supply-requests/")

    assert response.status_code == 403


def test_nurse_cannot_retrieve_unrelated_shift_handoff(settings):
    settings.TEAM_ACCESS_STRICT = True
    facility = PatientProfileFactory().facility
    nurse_practitioner = PractitionerProfileFactory(
        staff__user__user_type="nurse",
        staff__primary_facility=facility,
        staff__user__primary_facility=facility,
    )
    nurse_user = nurse_practitioner.staff.user
    accessible_patient = PatientProfileFactory(facility=facility)
    inaccessible_patient = PatientProfileFactory(facility=facility)
    EncounterFactory(
        patient=accessible_patient,
        facility=facility,
        practitioner=nurse_practitioner,
        status="in-progress",
    )
    inaccessible_handoff = ShiftHandoffFactory(
        patient=inaccessible_patient,
        facility=facility,
    )

    client = get_authenticated_client(nurse_user, facility)
    response = client.get(f"/api/nursing/handoffs/{inaccessible_handoff.id}/")

    assert response.status_code in {403, 404}
