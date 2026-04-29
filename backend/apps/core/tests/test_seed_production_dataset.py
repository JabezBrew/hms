from datetime import date

import pytest
from django.contrib.auth import get_user_model
from django.core.management.base import CommandError
from django.db import transaction

from apps.core.management.commands import seed_production_dataset as seed_module
from apps.core.management.commands.seed_production_dataset import Command, SeedManifest
from apps.patients.models import PatientSearchIndex
from apps.users.identifiers import generate_unique_mrn
from apps.users.models import PatientProfile, Staff
from apps.wards.models import Admission, BedAllocationLog

User = get_user_model()


def _facility_cfg(code: str) -> dict:
    return {
        "code": code,
        "name": f"{code} Test Hospital",
        "address": "1 Test Way",
        "city": "Accra",
        "region": "Greater Accra",
    }


def _seed_facility(tmp_path, code: str):
    command = Command()
    manifest = SeedManifest(str(tmp_path / f"{code.lower()}-manifest.json"))
    seed_user, created = command._get_or_create_seed_user()
    if created:
        manifest.add("User", seed_user.pk)
    with transaction.atomic():
        ctx = command._seed_facility(_facility_cfg(code), seed_user, manifest)
    manifest.save()
    return command, manifest, seed_user, ctx


def _create_patient(facility, seed_user, *, email: str, username: str) -> PatientProfile:
    user = User.objects.create_user(
        email=email,
        username=username,
        password="testpass123",
        first_name="Seeded",
        last_name="Patient",
        user_type="patient",
        primary_facility=facility,
        is_active=True,
    )
    user.facilities.add(facility)
    patient = PatientProfile.objects.create(
        user=user,
        facility=facility,
        medical_record_number=generate_unique_mrn(facility),
        created_by=seed_user,
        updated_by=seed_user,
    )
    PatientSearchIndex.objects.create(
        patient_profile=patient,
        facility=facility,
        first_name=user.first_name,
        last_name=user.last_name,
        full_name=user.get_full_name(),
        medical_record_number=patient.medical_record_number,
        search_document=f"{user.get_full_name()} {patient.medical_record_number}",
    )
    return patient


@pytest.mark.django_db
def test_get_or_create_seed_user_is_non_login_service_account():
    command = Command()

    user, _ = command._get_or_create_seed_user()

    assert user.email == "seed_engine@hms.local"
    assert user.is_active is False
    assert user.is_staff is False
    assert user.is_superuser is False
    assert user.has_usable_password() is False


@pytest.mark.django_db
def test_seed_facility_rerun_does_not_record_existing_objects(tmp_path):
    _, _, _, _ = _seed_facility(tmp_path, "TSPD1")
    command = Command()
    seed_user, _ = command._get_or_create_seed_user()

    fresh_manifest = SeedManifest(str(tmp_path / "rerun-manifest.json"))
    with transaction.atomic():
        command._seed_facility(_facility_cfg("TSPD1"), seed_user, fresh_manifest)

    assert fresh_manifest.total() == 0


@pytest.mark.django_db
def test_seed_facility_uses_employee_id_allocator(tmp_path, monkeypatch):
    allocated_ids = []

    def fake_generate_unique_employee_id(_facility):
        value = f"EMP-CUSTOM-{len(allocated_ids) + 1}"
        allocated_ids.append(value)
        return value

    monkeypatch.setattr(seed_module, "generate_unique_employee_id", fake_generate_unique_employee_id)

    _seed_facility(tmp_path, "TSPD2")

    assert allocated_ids
    assert Staff.objects.filter(employee_id__startswith="EMP-CUSTOM-").count() == len(allocated_ids)


@pytest.mark.django_db
def test_seeded_staff_accounts_are_non_login_and_require_password_reset(tmp_path):
    _, _, _, ctx = _seed_facility(tmp_path, "TSPD6")

    staff_user = User.objects.filter(
        primary_facility=ctx.facility,
        email__startswith="seed.staff.",
    ).order_by("id").first()

    assert staff_user is not None
    assert staff_user.is_active is False
    assert staff_user.must_change_password is True
    assert staff_user.has_usable_password() is False


@pytest.mark.django_db
def test_seed_patient_batch_uses_mrn_allocator(tmp_path, monkeypatch):
    command, manifest, seed_user, ctx = _seed_facility(tmp_path, "TSPD3")

    monkeypatch.setattr(seed_module, "generate_unique_mrn", lambda _facility: "MRN-CUSTOM-0001")
    monkeypatch.setattr(command, "_seed_patient_journey", lambda *args, **kwargs: None)

    seed_module._rng.seed(42)
    batch_id = manifest.start_batch(
        facility_code=ctx.facility.code,
        patient_start=1,
        patient_end=1,
    )
    manifest.save()
    with transaction.atomic():
        command._seed_patient_batch(ctx, 0, 1, 1, seed_user, manifest)
    manifest.complete_batch(batch_id)
    manifest.save()

    patient = PatientProfile.objects.get(
        user__email=command._patient_seed_email(ctx.facility.code, 1)
    )
    assert patient.medical_record_number == "MRN-CUSTOM-0001"


@pytest.mark.django_db
def test_reconcile_pending_batches_restores_patient_graph_to_manifest(tmp_path):
    command, manifest, seed_user, ctx = _seed_facility(tmp_path, "TSPD4")
    patient_number = 1
    manifest.start_batch(
        facility_code=ctx.facility.code,
        patient_start=patient_number,
        patient_end=patient_number,
    )
    manifest.save()

    patient = _create_patient(
        ctx.facility,
        seed_user,
        email=command._patient_seed_email(ctx.facility.code, patient_number),
        username=command._patient_seed_username(ctx.facility.code, patient_number),
    )

    command._reconcile_pending_batches(manifest)

    assert manifest.pending_batches() == []
    assert str(patient.user_id) in manifest.data["User"]
    assert str(patient.pk) in manifest.data["PatientProfile"]
    assert str(patient.pk) in manifest.data["PatientSearchIndex"]


def test_resolve_patient_range_uses_next_unseeded_resume_window(tmp_path):
    command = Command()
    manifest = SeedManifest(str(tmp_path / "resume-manifest.json"))
    fac_configs = [{"code": "KBTH"}, {"code": "KATH"}]
    patients_per_fac = [2, 3]

    first = manifest.start_batch(facility_code="KBTH", patient_start=1, patient_end=2)
    manifest.complete_batch(first)
    second = manifest.start_batch(facility_code="KATH", patient_start=1, patient_end=1)
    manifest.complete_batch(second)

    chunk_start, chunk_end = command._resolve_patient_range(
        manifest=manifest,
        fac_configs=fac_configs,
        patients_per_fac=patients_per_fac,
        n_patients=5,
        chunk=None,
        resume=True,
        batch_size=2,
    )

    assert (chunk_start, chunk_end) == (3, 5)


def test_ensure_manifest_run_config_rejects_dataset_mismatch(tmp_path):
    command = Command()
    manifest = SeedManifest(str(tmp_path / "config-manifest.json"))
    fac_configs = [{"code": "KBTH"}]

    command._ensure_manifest_run_config(
        manifest,
        profile_name="small",
        fac_configs=fac_configs,
        n_patients=10,
        n_years=2,
    )

    with pytest.raises(CommandError, match="Manifest dataset shape does not match this run"):
        command._ensure_manifest_run_config(
            manifest,
            profile_name="small",
            fac_configs=fac_configs,
            n_patients=11,
            n_years=2,
        )


def test_resolve_patient_range_rejects_resume_with_chunk(tmp_path):
    command = Command()
    manifest = SeedManifest(str(tmp_path / "range-manifest.json"))

    with pytest.raises(CommandError, match="cannot be used together"):
        command._resolve_patient_range(
            manifest=manifest,
            fac_configs=[{"code": "KBTH"}],
            patients_per_fac=[5],
            n_patients=5,
            chunk="0-2",
            resume=True,
            batch_size=2,
        )


@pytest.mark.django_db
def test_seed_patient_journey_creates_active_admission_and_respects_occupied_beds(tmp_path, monkeypatch):
    command, manifest, seed_user, ctx = _seed_facility(tmp_path, "TSPD5")
    surgical_ward = ctx.wards["Surgical Ward"]
    surgical_beds = sorted(
        [bed for bed in ctx.beds if bed.ward_id == surgical_ward.pk],
        key=lambda bed: bed.bed_number,
    )
    occupied_bed = surgical_beds[0]

    existing_patient = _create_patient(
        ctx.facility,
        seed_user,
        email="existing.seeded.patient@hms.local",
        username="existing_seeded_patient",
    )
    Admission.objects.create(
        patient=existing_patient,
        bed=occupied_bed,
        facility=ctx.facility,
        status="admitted",
        admission_type="elective",
        created_by=seed_user,
    )
    ctx.occupied_bed_ids.add(occupied_bed.pk)

    patient = _create_patient(
        ctx.facility,
        seed_user,
        email="journey.seeded.patient@hms.local",
        username="journey_seeded_patient",
    )

    monkeypatch.setattr(command, "_seed_lab_order", lambda *args, **kwargs: None)
    monkeypatch.setattr(command, "_seed_invoice", lambda *args, **kwargs: None)

    seed_module._rng.seed(7)
    command._seed_patient_journey(ctx, patient, "surgical", 2, seed_user, manifest)

    active_admission = Admission.objects.get(
        patient=patient,
        status__in=["admitted", "pending_discharge"],
    )
    assert active_admission.bed_id != occupied_bed.pk
    assert BedAllocationLog.objects.filter(
        admission=active_admission,
        previous_status="available",
        new_status="occupied",
    ).exists()

    discharged_admissions = Admission.objects.filter(
        patient=patient,
        status="discharged",
        bed__isnull=False,
    )
    assert discharged_admissions.exists()
    for admission in discharged_admissions:
        assert BedAllocationLog.objects.filter(
            admission=admission,
            previous_status="available",
            new_status="occupied",
        ).exists()
        assert BedAllocationLog.objects.filter(
            admission=admission,
            previous_status="occupied",
            new_status="available",
        ).exists()


@pytest.mark.django_db
def test_reserve_lab_order_number_uses_requested_date():
    command = Command()

    first = command._reserve_lab_order_number(date(2024, 1, 5))
    second = command._reserve_lab_order_number(date(2024, 1, 5))

    assert first == "LAB-20240105-0001"
    assert second == "LAB-20240105-0002"
