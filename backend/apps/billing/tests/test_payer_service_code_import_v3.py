from decimal import Decimal

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from apps.billing.models import PayerServiceCode, PayerServiceCodeImportJob, Service
from apps.billing.tests.factories import ServiceCategoryFactory, ServiceFactory, InsuranceProviderFactory
from apps.core.tests.factories import DefaultFacilityFactory
from apps.users.tests.factories import UserFactory


pytestmark = pytest.mark.django_db


@pytest.fixture
def facility():
    return DefaultFacilityFactory()


@pytest.fixture
def billing_user(facility):
    return UserFactory(user_type='billing', primary_facility=facility)


@pytest.fixture
def client(billing_user, facility):
    c = APIClient()
    c.force_authenticate(user=billing_user)
    c.credentials(HTTP_X_FACILITY_CODE=facility.code)
    return c


def _upload_csv(client, *, payer_id, seed_services, csv_text):
    f = SimpleUploadedFile(
        "nhis-mapping.csv",
        csv_text.encode("utf-8"),
        content_type="text/csv",
    )
    data = {"payer": str(payer_id), "seed_services": "1" if seed_services else "0", "file": f}
    return client.post("/api/billing/nhis/mapping-imports/import/", data, format="multipart")


def test_mapping_import_preview_and_apply_creates_mapping(client, facility, billing_user):
    payer = InsuranceProviderFactory(facility=facility, payer_type="nhis")
    category = ServiceCategoryFactory(facility=facility)
    service = ServiceFactory(facility=facility, category=category, code="LAB-FBC")

    csv_text = "\n".join(
        [
            "service_code,external_code,effective_from,effective_until",
            "LAB-FBC,NHIS_LAB_001,2026-01-01,",
        ]
    )

    r = _upload_csv(client, payer_id=payer.id, seed_services=False, csv_text=csv_text)
    assert r.status_code == 201, r.data

    job_id = r.data["id"]
    job = PayerServiceCodeImportJob.objects.get(id=job_id)
    assert job.facility_id == facility.id
    assert job.payer_id == payer.id
    assert job.status in {"pending", "running", "preview_ready"}

    from apps.billing.tasks import process_payer_service_code_import_job, apply_payer_service_code_import_job

    if job.status == "pending":
        process_payer_service_code_import_job(str(job.id))
    job.refresh_from_db()
    assert job.status == "preview_ready"
    assert job.summary.get("would_create_mappings") == 1
    assert int(job.summary.get("errors") or 0) == 0

    apply_payer_service_code_import_job(str(job.id))
    job.refresh_from_db()
    assert job.status == "applied"

    assert PayerServiceCode.objects.filter(
        facility=facility,
        payer=payer,
        service=service,
        effective_from="2026-01-01",
        external_code="NHIS_LAB_001",
        is_active=True,
    ).count() == 1


def test_mapping_import_seed_services_creates_inactive_service_then_mapping(client, facility):
    payer = InsuranceProviderFactory(facility=facility, payer_type="nhis")

    csv_text = "\n".join(
        [
            "service_code,service_name,external_code,effective_from,effective_until,category_name,base_price",
            "NHIS_XRAY_001,Chest X-Ray,NHIS_XRAY_001,2026-01-01,,Imaging,0.00",
        ]
    )

    r = _upload_csv(client, payer_id=payer.id, seed_services=True, csv_text=csv_text)
    assert r.status_code == 201, r.data

    job = PayerServiceCodeImportJob.objects.get(id=r.data["id"])

    from apps.billing.tasks import process_payer_service_code_import_job, apply_payer_service_code_import_job

    if job.status == "pending":
        process_payer_service_code_import_job(str(job.id))
    job.refresh_from_db()
    assert job.status == "preview_ready"
    assert job.summary.get("would_create_services") == 1

    apply_payer_service_code_import_job(str(job.id))
    job.refresh_from_db()
    assert job.status == "applied"

    svc = Service.objects.get(facility=facility, code="NHIS_XRAY_001")
    assert svc.is_active is False
    assert svc.base_price == Decimal("0.00")

    assert PayerServiceCode.objects.filter(
        facility=facility,
        payer=payer,
        service=svc,
        effective_from="2026-01-01",
        external_code="NHIS_XRAY_001",
    ).count() == 1


def test_mapping_import_apply_endpoint_blocks_when_preview_has_errors(client, facility):
    payer = InsuranceProviderFactory(facility=facility, payer_type="nhis")

    # Missing service in facility and seed_services=False -> preview errors.
    csv_text = "\n".join(
        [
            "service_code,external_code,effective_from,effective_until",
            "MISSING_SVC,NHIS_001,2026-01-01,",
        ]
    )
    r = _upload_csv(client, payer_id=payer.id, seed_services=False, csv_text=csv_text)
    assert r.status_code == 201, r.data

    job = PayerServiceCodeImportJob.objects.get(id=r.data["id"])
    from apps.billing.tasks import process_payer_service_code_import_job

    if job.status == "pending":
        process_payer_service_code_import_job(str(job.id))
    job.refresh_from_db()
    assert job.status == "preview_ready"
    assert int(job.summary.get("errors") or 0) > 0

    r2 = client.post(f"/api/billing/nhis/mapping-imports/{job.id}/apply/", {"force": False}, format="json")
    assert r2.status_code == 400, r2.data
    assert r2.data.get("error") == "preview_errors"
