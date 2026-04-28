import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command

from apps.users.models import PatientProfile
from apps.users.tests.factories import AdminUserFactory


@pytest.mark.django_db
def test_seed_e2e_smoke_creates_patient_user_and_profile(settings, facility):
    settings.DEFAULT_FACILITY_CODE = facility.code
    AdminUserFactory(primary_facility=facility)
    User = get_user_model()
    seed_admin = User.objects.filter(is_superuser=True).order_by("date_joined").first()

    call_command("seed_e2e_smoke")

    patient_user = User.objects.get(email="smoke.patient@hms.test")
    patient_profile = PatientProfile.objects.get(user=patient_user)

    assert patient_user.first_name == "Smoke"
    assert patient_user.last_name == "Patient"
    assert patient_user.user_type == "patient"
    assert patient_user.primary_facility_id == facility.id
    assert patient_user.is_active is True
    assert patient_user.facilities.filter(id=facility.id).exists()
    assert patient_profile.facility_id == facility.id
    assert patient_profile.medical_record_number
    assert patient_profile.created_by_id == seed_admin.id
    assert patient_profile.updated_by_id == seed_admin.id


@pytest.mark.django_db
def test_seed_e2e_smoke_updates_existing_patient_and_profile(settings, facility):
    settings.DEFAULT_FACILITY_CODE = facility.code
    AdminUserFactory(primary_facility=facility)
    User = get_user_model()
    seed_admin = User.objects.filter(is_superuser=True).order_by("date_joined").first()
    patient_user = User.objects.create_user(
        email="smoke.patient@hms.test",
        username="wrong-user",
        password="testpass123",
        first_name="Wrong",
        last_name="Name",
        user_type="receptionist",
        is_active=False,
    )
    patient_profile = PatientProfile.objects.create(
        user=patient_user,
        facility=facility,
        medical_record_number="",
        created_by=None,
        updated_by=None,
    )

    call_command("seed_e2e_smoke")

    patient_user.refresh_from_db()
    patient_profile.refresh_from_db()

    assert patient_user.username == "smoke.patient"
    assert patient_user.first_name == "Smoke"
    assert patient_user.last_name == "Patient"
    assert patient_user.user_type == "patient"
    assert patient_user.primary_facility_id == facility.id
    assert patient_user.is_active is True
    assert patient_user.facilities.filter(id=facility.id).exists()
    assert patient_profile.medical_record_number
    assert patient_profile.created_by_id == seed_admin.id
    assert patient_profile.updated_by_id == seed_admin.id
