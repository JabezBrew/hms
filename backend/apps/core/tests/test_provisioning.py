import csv

import pytest
from django.core.cache import cache
from django.core.management import call_command

from apps.core.models import Facility
from apps.organization.models import ClinicalUnit, UnitTypeConfig


def _facility_root(code):
    return ClinicalUnit.objects.get(parent__isnull=True, code=code)


@pytest.mark.django_db
def test_provision_default_facility_creates_missing_facility_and_root(settings, monkeypatch):
    Facility.objects.all().delete()
    ClinicalUnit.objects.all().delete()
    UnitTypeConfig.objects.all().delete()
    cache.clear()

    settings.DEFAULT_FACILITY_CODE = "ACM"
    monkeypatch.setenv("DEFAULT_FACILITY_NAME", "Acme Memorial Hospital")
    monkeypatch.setenv("DEFAULT_FACILITY_TYPE", "hospital")
    monkeypatch.setenv("DEFAULT_FACILITY_ADDRESS", "1 Wellness Way")
    monkeypatch.setenv("DEFAULT_FACILITY_CITY", "Accra")
    monkeypatch.setenv("DEFAULT_FACILITY_PHONE", "+233111111111")
    monkeypatch.setenv("DEFAULT_FACILITY_EMAIL", "admin@acm.example")

    call_command("provision_default_facility")

    facility = Facility.objects.get(code="ACM")
    root = _facility_root("ACM")

    assert facility.name == "Acme Memorial Hospital"
    assert facility.address == "1 Wellness Way"
    assert facility.city == "Accra"
    assert facility.phone == "+233111111111"
    assert facility.email == "admin@acm.example"
    assert root.name == facility.name
    assert root.unit_type.code == "facility"
    assert root.root_unit_id == root.id


@pytest.mark.django_db
def test_provision_default_facility_is_idempotent_and_updates_explicit_metadata(
    settings,
    monkeypatch,
    default_facility,
):
    ClinicalUnit.objects.all().delete()
    UnitTypeConfig.objects.all().delete()
    cache.clear()

    settings.DEFAULT_FACILITY_CODE = default_facility.code
    monkeypatch.setenv("DEFAULT_FACILITY_NAME", "Provisioned Test Facility")

    call_command("provision_default_facility")
    call_command("provision_default_facility")

    default_facility.refresh_from_db()
    root = _facility_root(default_facility.code)

    assert Facility.objects.filter(code=default_facility.code).count() == 1
    assert ClinicalUnit.objects.filter(parent__isnull=True, code=default_facility.code).count() == 1
    assert default_facility.name == "Provisioned Test Facility"
    assert root.name == "Provisioned Test Facility"


@pytest.mark.django_db
def test_create_facility_command_also_creates_root_organization_unit():
    call_command(
        "create_facility",
        code="SUN",
        name="Sunrise Clinic",
        facility_type="clinic",
        address="22 Ridge Road",
        city="Kumasi",
        phone="+233222222222",
        email="admin@sunrise.example",
    )

    facility = Facility.objects.get(code="SUN")
    root = _facility_root("SUN")

    assert facility.facility_type == "clinic"
    assert root.name == "Sunrise Clinic"
    assert root.unit_type.code == "facility"


@pytest.mark.django_db
def test_import_facilities_command_creates_root_organization_units(tmp_path):
    csv_path = tmp_path / "facilities.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=["code", "name", "address", "city", "phone", "email", "facility_type"],
        )
        writer.writeheader()
        writer.writerow(
            {
                "code": "BR1",
                "name": "Branch One Hospital",
                "address": "44 Care Street",
                "city": "Tamale",
                "phone": "+233333333333",
                "email": "admin@branch-one.example",
                "facility_type": "hospital",
            }
        )

    call_command("import_facilities", str(csv_path))

    facility = Facility.objects.get(code="BR1")
    root = _facility_root("BR1")

    assert facility.name == "Branch One Hospital"
    assert root.name == "Branch One Hospital"
    assert root.unit_type.code == "facility"
