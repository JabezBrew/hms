"""
Golden query tests for the omni-search endpoint.

Each test asserts a specific ranking or filtering guarantee: typo tolerance,
reversed names, ID priority, hyphenated names, Ghanaian compound names, etc.

The PatientSearchIndex is populated explicitly via sync_patient_search_index
(bypassing Celery) so tier selection is exercised end-to-end.
"""
import pytest
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from apps.patients.search_index import sync_patient_search_index
from apps.users.tests.factories import (
    AdminUserFactory,
    PatientProfileFactory,
    StaffFactory,
)
from apps.wards.tests.factories import WardFactory, AdmissionFactory


def _auth_client(user, *, facility):
    client = APIClient()
    token = AccessToken.for_user(user)
    client.credentials(
        HTTP_AUTHORIZATION=f"Bearer {token}",
        HTTP_X_FACILITY_CODE=facility.code,
    )
    return client


def _make_patient(facility, first_name, last_name, *, mrn=None, nhis=None):
    kwargs = {
        "facility": facility,
        "user__first_name": first_name,
        "user__last_name": last_name,
        "user__primary_facility": facility,
    }
    if mrn is not None:
        kwargs["medical_record_number"] = mrn
    if nhis is not None:
        kwargs["nhis_id"] = nhis
    patient = PatientProfileFactory(**kwargs)
    sync_patient_search_index(patient)
    return patient


def _ids(response, group="patients"):
    return [item["id"] for item in response.data["groups"][group]]


def _top_id(response, group="patients"):
    items = response.data["groups"][group]
    return items[0]["id"] if items else None


# ---------------------------------------------------------------------------
# Typo tolerance
# ---------------------------------------------------------------------------

@pytest.mark.django_db
def test_typo_finds_patient_via_trigram(default_facility):
    admin = AdminUserFactory(primary_facility=default_facility)
    patient = _make_patient(default_facility, "Jonathan", "Smith")

    client = _auth_client(admin, facility=default_facility)
    response = client.get("/api/search/omni/", {"q": "Jonathen", "types": "patients"})

    assert response.status_code == status.HTTP_200_OK
    assert str(patient.id) in _ids(response)


# ---------------------------------------------------------------------------
# Reversed names
# ---------------------------------------------------------------------------

@pytest.mark.django_db
def test_reversed_name_finds_patient(default_facility):
    admin = AdminUserFactory(primary_facility=default_facility)
    patient = _make_patient(default_facility, "John", "Smith")

    client = _auth_client(admin, facility=default_facility)
    response = client.get("/api/search/omni/", {"q": "Smith John", "types": "patients"})

    assert response.status_code == status.HTTP_200_OK
    assert str(patient.id) in _ids(response)


# ---------------------------------------------------------------------------
# Initials / partial name
# ---------------------------------------------------------------------------

@pytest.mark.django_db
def test_partial_last_name_finds_patient(default_facility):
    admin = AdminUserFactory(primary_facility=default_facility)
    patient = _make_patient(default_facility, "John", "Smith")

    client = _auth_client(admin, facility=default_facility)
    response = client.get("/api/search/omni/", {"q": "J Smith", "types": "patients"})

    assert response.status_code == status.HTTP_200_OK
    assert str(patient.id) in _ids(response)


# ---------------------------------------------------------------------------
# MRN exact outranks fuzzy name match
# ---------------------------------------------------------------------------

@pytest.mark.django_db
def test_exact_mrn_ranks_first_over_fuzzy_name(default_facility):
    admin = AdminUserFactory(primary_facility=default_facility)
    mrn_patient = _make_patient(default_facility, "Zeta", "Zulu", mrn="A1042")
    fuzzy_patient = _make_patient(default_facility, "Alona", "Fortywo", mrn="X9999")

    client = _auth_client(admin, facility=default_facility)
    response = client.get("/api/search/omni/", {"q": "A1042", "types": "patients"})

    assert response.status_code == status.HTTP_200_OK
    ids = _ids(response)
    assert str(mrn_patient.id) in ids
    assert ids.index(str(mrn_patient.id)) == 0
    result = response.data["groups"]["patients"][0]
    assert result.get("match_reason") == "id_exact"


# ---------------------------------------------------------------------------
# NHIS exact outranks fuzzy name match
# ---------------------------------------------------------------------------

@pytest.mark.django_db
def test_exact_nhis_ranks_first(default_facility):
    admin = AdminUserFactory(primary_facility=default_facility)
    nhis_patient = _make_patient(default_facility, "Omega", "Patient", nhis="GHA-12345")

    client = _auth_client(admin, facility=default_facility)
    response = client.get("/api/search/omni/", {"q": "GHA-12345", "types": "patients"})

    assert response.status_code == status.HTTP_200_OK
    assert _top_id(response) == str(nhis_patient.id)
    assert response.data["groups"]["patients"][0]["match_reason"] == "id_exact"


# ---------------------------------------------------------------------------
# Hyphenated surname — token match on each segment
# ---------------------------------------------------------------------------

@pytest.mark.django_db
def test_hyphenated_surname_first_segment(default_facility):
    admin = AdminUserFactory(primary_facility=default_facility)
    patient = _make_patient(default_facility, "Ama", "Owusu-Ansah")

    client = _auth_client(admin, facility=default_facility)
    response = client.get("/api/search/omni/", {"q": "owusu", "types": "patients"})

    assert response.status_code == status.HTTP_200_OK
    assert str(patient.id) in _ids(response)


@pytest.mark.django_db
def test_hyphenated_surname_second_segment(default_facility):
    admin = AdminUserFactory(primary_facility=default_facility)
    patient = _make_patient(default_facility, "Ama", "Owusu-Ansah")

    client = _auth_client(admin, facility=default_facility)
    response = client.get("/api/search/omni/", {"q": "ansah", "types": "patients"})

    assert response.status_code == status.HTTP_200_OK
    assert str(patient.id) in _ids(response)


# ---------------------------------------------------------------------------
# Common Ghanaian compound names
# ---------------------------------------------------------------------------

@pytest.mark.django_db
def test_ghanaian_compound_name_mensah_bonsu(default_facility):
    admin = AdminUserFactory(primary_facility=default_facility)
    patient = _make_patient(default_facility, "Kwame", "Mensah-Bonsu")

    client = _auth_client(admin, facility=default_facility)
    response = client.get("/api/search/omni/", {"q": "mensah", "types": "patients"})

    assert response.status_code == status.HTTP_200_OK
    assert str(patient.id) in _ids(response)


@pytest.mark.django_db
def test_ghanaian_name_ama_serwaa(default_facility):
    admin = AdminUserFactory(primary_facility=default_facility)
    patient = _make_patient(default_facility, "Ama", "Serwaa")

    client = _auth_client(admin, facility=default_facility)
    response = client.get("/api/search/omni/", {"q": "serwaa", "types": "patients"})

    assert response.status_code == status.HTTP_200_OK
    assert str(patient.id) in _ids(response)


# ---------------------------------------------------------------------------
# Employee ID routes to staff, not patient names
# ---------------------------------------------------------------------------

@pytest.mark.django_db
def test_employee_id_routes_to_staff(default_facility):
    admin = AdminUserFactory(primary_facility=default_facility)
    staff = StaffFactory(
        primary_facility=default_facility,
        employee_id="EMP001",
        user__first_name="Beta",
        user__last_name="Staff",
    )
    _make_patient(default_facility, "Emp", "Zeroone")

    from apps.core.search_projections import sync_staff_search_index
    sync_staff_search_index(staff)

    client = _auth_client(admin, facility=default_facility)
    response = client.get("/api/search/omni/", {"q": "EMP001", "types": "staff,patients"})

    assert response.status_code == status.HTTP_200_OK
    staff_ids = [item["id"] for item in response.data["groups"]["staff"]]
    assert str(staff.id) in staff_ids
    staff_result = next(r for r in response.data["groups"]["staff"] if r["id"] == str(staff.id))
    assert staff_result.get("match_reason") == "employee_id"


# ---------------------------------------------------------------------------
# Ward name search
# ---------------------------------------------------------------------------

@pytest.mark.django_db
def test_ward_name_routes_to_wards(default_facility):
    admin = AdminUserFactory(primary_facility=default_facility)
    ward = WardFactory(department__facility=default_facility, name="Maternity Ward")

    from apps.core.search_projections import sync_ward_search_index
    sync_ward_search_index(ward)

    client = _auth_client(admin, facility=default_facility)
    response = client.get("/api/search/omni/", {"q": "Maternity", "types": "wards"})

    assert response.status_code == status.HTTP_200_OK
    ward_ids = [item["id"] for item in response.data["groups"]["wards"]]
    assert str(ward.id) in ward_ids


# ---------------------------------------------------------------------------
# Short query (1 char) returns recents only, no DB scan
# ---------------------------------------------------------------------------

@pytest.mark.django_db
def test_single_char_query_returns_recents_only(default_facility):
    admin = AdminUserFactory(primary_facility=default_facility)
    _make_patient(default_facility, "Alpha", "Patient")

    client = _auth_client(admin, facility=default_facility)
    response = client.get("/api/search/omni/", {"q": "A", "types": "patients"})

    assert response.status_code == status.HTTP_200_OK
    assert response.data["groups"]["patients"] == []
    assert response.data["types"] == []


# ---------------------------------------------------------------------------
# match_reason field present on all patient results
# ---------------------------------------------------------------------------

@pytest.mark.django_db
def test_match_reason_present_on_patient_results(default_facility):
    admin = AdminUserFactory(primary_facility=default_facility)
    _make_patient(default_facility, "Charlie", "Brown")

    client = _auth_client(admin, facility=default_facility)
    response = client.get("/api/search/omni/", {"q": "Charlie", "types": "patients"})

    assert response.status_code == status.HTTP_200_OK
    for item in response.data["groups"]["patients"]:
        assert "match_reason" in item
        assert item["match_reason"] in {"id_exact", "id_prefix", "name_exact", "name_token", "name_fuzzy", "text_match"}


# ---------------------------------------------------------------------------
# MRR@3: expected patient is in top 3 for each golden query
# ---------------------------------------------------------------------------

@pytest.mark.django_db
@pytest.mark.parametrize("first,last,query", [
    ("Jonathan", "Smith", "Jonathen"),
    ("Kwabena", "Asante", "kwabena asante"),
    ("Ama", "Owusu-Ansah", "owusu"),
    ("Yaa", "Mensah", "mensah"),
])
def test_mrr_at_3(default_facility, first, last, query):
    admin = AdminUserFactory(primary_facility=default_facility)
    target = _make_patient(default_facility, first, last)
    for i in range(5):
        _make_patient(default_facility, f"Decoy{i}", f"Name{i}")

    client = _auth_client(admin, facility=default_facility)
    response = client.get("/api/search/omni/", {"q": query, "types": "patients", "limit": "3"})

    assert response.status_code == status.HTTP_200_OK
    assert str(target.id) in _ids(response), (
        f"Expected '{first} {last}' in top 3 for query '{query}', got: {_ids(response)}"
    )
