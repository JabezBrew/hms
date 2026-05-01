import pytest
from datetime import timedelta

from django.db import connection
from django.test.utils import CaptureQueriesContext, override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from hms_backend.tenancy import clear_current_facility_code

from apps.patients.models import PatientSearch
from apps.users.tests.factories import (
    AdminUserFactory,
    ReceptionistUserFactory,
    UserFactory,
    PatientProfileFactory,
    PractitionerProfileFactory,
    StaffFactory,
)
from apps.wards.tests.factories import WardFactory, AdmissionFactory
from apps.encounters.tests.factories import EncounterFactory
from apps.billing.tests.factories import InvoiceFactory


def _auth_client(user, *, facility=None, include_facility_header=True):
    client = APIClient()
    token = AccessToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    resolved_facility = facility or getattr(user, "primary_facility", None)
    if include_facility_header and resolved_facility:
        client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {token}",
            HTTP_X_FACILITY_CODE=resolved_facility.code,
        )
    return client


@pytest.mark.django_db
def test_omni_search_requires_authentication(api_client):
    response = api_client.get("/api/search/omni/")
    assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
@override_settings(DEFAULT_FACILITY_CODE=None)
def test_omni_search_requires_facility_context(django_user_model):
    clear_current_facility_code()

    user = django_user_model.objects.create_user(
        username="nofacility",
        email="nofacility@example.com",
        password="pass1234",
        user_type="admin",
        primary_facility=None,
    )
    client = _auth_client(user, include_facility_header=False)

    response = client.get("/api/search/omni/", {"q": "Al"})
    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert response.json().get("detail") == "Facility context is required."


@pytest.mark.django_db
def test_admin_can_search_staff_group(default_facility):
    admin = AdminUserFactory(primary_facility=default_facility)
    StaffFactory(
        primary_facility=default_facility,
        user__first_name="Alice",
        user__last_name="Alpha",
    )

    client = _auth_client(admin, facility=default_facility)
    response = client.get("/api/search/omni/", {"q": "Alpha"})

    assert response.status_code == status.HTTP_200_OK
    assert len(response.data["groups"]["staff"]) >= 1


@pytest.mark.django_db
def test_receptionist_does_not_receive_disallowed_groups(default_facility):
    receptionist = ReceptionistUserFactory(primary_facility=default_facility)

    # Create matches for disallowed groups to ensure they would be found if queried.
    StaffFactory(primary_facility=default_facility, user__last_name="Alpha")
    WardFactory(department__facility=default_facility, name="Alpha Ward")
    patient = PatientProfileFactory(
        facility=default_facility,
        user__first_name="Alpha",
        user__primary_facility=default_facility,
    )
    EncounterFactory(patient=patient, reason="Alpha")

    client = _auth_client(receptionist, facility=default_facility)
    response = client.get(
        "/api/search/omni/",
        {"q": "Alpha", "types": "patients,staff,wards,encounters"},
    )

    assert response.status_code == status.HTTP_200_OK
    assert "staff" not in response.data["types"]
    assert "wards" not in response.data["types"]
    assert "encounters" not in response.data["types"]
    assert response.data["groups"]["staff"] == []
    assert response.data["groups"]["wards"] == []
    assert response.data["groups"]["encounters"] == []


@pytest.mark.django_db
def test_billing_patient_scope_requires_invoice(default_facility):
    billing_user = UserFactory(user_type="billing", primary_facility=default_facility)

    billed_patient = PatientProfileFactory(
        facility=default_facility,
        user__first_name="Alpha",
        user__last_name="Billed",
        user__primary_facility=default_facility,
    )
    unbilled_patient = PatientProfileFactory(
        facility=default_facility,
        user__first_name="Alpha",
        user__last_name="Unbilled",
        user__primary_facility=default_facility,
    )
    InvoiceFactory(patient=billed_patient, facility=default_facility)

    client = _auth_client(billing_user, facility=default_facility)
    response = client.get("/api/search/omni/", {"q": "Alpha", "types": "patients"})

    assert response.status_code == status.HTTP_200_OK
    ids = {item["id"] for item in response.data["groups"]["patients"]}
    assert str(billed_patient.id) in ids
    assert str(unbilled_patient.id) not in ids


@pytest.mark.django_db
def test_extended_clinical_roles_can_search_patients_and_encounters(default_facility):
    physician = UserFactory(user_type="physician", primary_facility=default_facility)
    practitioner = UserFactory(user_type="practitioner", primary_facility=default_facility)

    patient = PatientProfileFactory(
        facility=default_facility,
        user__first_name="Alpha",
        user__last_name="Patient",
        user__primary_facility=default_facility,
    )
    physician_staff = StaffFactory(
        user=physician,
        primary_facility=default_facility,
    )
    physician_profile = PractitionerProfileFactory(
        staff=physician_staff,
    )
    practitioner_staff = StaffFactory(
        user=practitioner,
        primary_facility=default_facility,
    )
    practitioner_profile = PractitionerProfileFactory(
        staff=practitioner_staff,
    )
    EncounterFactory(
        patient=patient,
        facility=default_facility,
        practitioner=physician_profile,
        reason="Alpha",
    )
    EncounterFactory(
        patient=patient,
        facility=default_facility,
        practitioner=practitioner_profile,
        reason="Alpha",
    )

    physician_client = _auth_client(physician, facility=default_facility)
    physician_response = physician_client.get(
        "/api/search/omni/",
        {"q": "Al", "types": "patients"},
    )
    assert physician_response.status_code == status.HTTP_200_OK
    assert any(
        item.get("id") == str(patient.id)
        for item in physician_response.data["groups"]["patients"]
    )

    practitioner_client = _auth_client(practitioner, facility=default_facility)
    practitioner_response = practitioner_client.get(
        "/api/search/omni/",
        {"q": "Alpha", "types": "encounters"},
    )
    assert practitioner_response.status_code == status.HTTP_200_OK
    assert len(practitioner_response.data["groups"]["encounters"]) >= 1


@pytest.mark.django_db
def test_omni_patient_search_hides_unassigned_patients_for_clinicians(default_facility):
    doctor = UserFactory(user_type="doctor", primary_facility=default_facility)
    practitioner = PractitionerProfileFactory(
        staff__user=doctor,
        staff__primary_facility=default_facility,
    )
    assigned_patient = PatientProfileFactory(
        facility=default_facility,
        user__first_name="Alpha",
        user__last_name="Assigned",
        user__primary_facility=default_facility,
    )
    unassigned_patient = PatientProfileFactory(
        facility=default_facility,
        user__first_name="Alpha",
        user__last_name="Unassigned",
        user__primary_facility=default_facility,
    )
    EncounterFactory(
        patient=assigned_patient,
        facility=default_facility,
        practitioner=practitioner,
        reason="Alpha",
    )

    client = _auth_client(doctor, facility=default_facility)
    response = client.get("/api/search/omni/", {"q": "Alpha", "types": "patients"})

    assert response.status_code == status.HTTP_200_OK
    ids = {item["id"] for item in response.data["groups"]["patients"]}
    assert str(assigned_patient.id) in ids
    assert str(unassigned_patient.id) not in ids


@pytest.mark.django_db
def test_omni_facility_admin_patient_results_use_directory_projection(default_facility):
    admin = UserFactory(
        user_type="admin",
        is_staff=True,
        is_superuser=False,
        primary_facility=default_facility,
    )
    patient = PatientProfileFactory(
        facility=default_facility,
        user__first_name="Alpha",
        user__last_name="Directory",
        user__primary_facility=default_facility,
    )
    AdmissionFactory(patient=patient, facility=default_facility)

    client = _auth_client(admin, facility=default_facility)
    response = client.get("/api/search/omni/", {"q": "Alpha", "types": "patients"})

    assert response.status_code == status.HTTP_200_OK
    result = response.data["groups"]["patients"][0]
    assert result["id"] == str(patient.id)
    assert "current_ward" not in result
    assert "admission_status" not in result


@pytest.mark.django_db
def test_omni_search_is_o1_queries_and_has_no_side_effects(default_facility):
    from apps.appointments.models import Appointment
    from apps.appointments.tests.factories import AppointmentTypeFactory

    admin = AdminUserFactory(primary_facility=default_facility)

    patient = PatientProfileFactory(
        facility=default_facility,
        user__first_name="Alpha",
        user__last_name="Patient",
        user__primary_facility=default_facility,
    )
    AdmissionFactory(patient=patient, facility=default_facility)
    WardFactory(department__facility=default_facility, name="Alpha Ward")
    EncounterFactory(patient=patient, facility=default_facility, reason="Alpha")
    StaffFactory(primary_facility=default_facility, user__last_name="Alpha")

    practitioner = PractitionerProfileFactory(
        staff__primary_facility=default_facility,
        staff__user__primary_facility=default_facility,
    )
    appointment_type = AppointmentTypeFactory()
    Appointment.objects.create(
        facility=default_facility,
        patient=patient,
        practitioner=practitioner,
        clinic=None,
        appointment_type=appointment_type,
        status="booked",
        source="scheduled",
        start_time=timezone.now(),
        end_time=timezone.now() + timedelta(minutes=30),
    )

    client = _auth_client(admin, facility=default_facility)
    params = {
        "q": "Alpha",
        "types": "patients,wards,encounters,appointments,admissions,staff",
    }
    with CaptureQueriesContext(connection) as ctx:
        response = client.get("/api/search/omni/", params)

    assert response.status_code == status.HTTP_200_OK
    assert len(ctx) <= 26
    assert PatientSearch.objects.count() == 0
