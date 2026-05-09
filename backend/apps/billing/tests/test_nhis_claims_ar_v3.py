import io
import zipfile
from datetime import date
from decimal import Decimal

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from apps.billing.models import (
    NHISClaimBatch,
    NHISClaimExportJob,
    PayerServiceCode,
    RemittanceImportJob,
    Payment,
    Claim,
)
from apps.billing.tests.factories import (
    InsuranceProviderFactory,
    InsurancePlanFactory,
    PatientInsuranceFactory,
    InvoiceFactory,
    InvoiceItemFactory,
    ServiceCategoryFactory,
    ServiceFactory,
    FacilityBillingSettingsFactory,
)
from apps.core.tests.factories import DefaultFacilityFactory
from apps.users.tests.factories import PatientProfileFactory, UserFactory


pytestmark = pytest.mark.django_db


@pytest.fixture
def facility():
    return DefaultFacilityFactory()


@pytest.fixture
def billing_user(facility):
    return UserFactory(user_type='billing', primary_facility=facility)


@pytest.fixture
def client(billing_user, facility):
    client = APIClient()
    client.force_authenticate(user=billing_user)
    client.credentials(HTTP_X_FACILITY_CODE=facility.code)
    return client


def test_nhis_batch_lint_export_and_download(client, facility, billing_user):
    # NHIS payer setup
    nhis_provider = InsuranceProviderFactory(facility=facility, payer_type='nhis')
    nhis_plan = InsurancePlanFactory(provider=nhis_provider, facility=facility)

    patient = PatientProfileFactory(facility=facility, nhis_id='NHIS-123')
    patient_insurance = PatientInsuranceFactory(patient=patient, plan=nhis_plan)

    # Invoice with insurance + items
    category = ServiceCategoryFactory(facility=facility)
    service = ServiceFactory(facility=facility, category=category, base_price=Decimal('100.00'), tax_rate=Decimal('0.00'))
    invoice = InvoiceFactory(
        patient=patient,
        facility=facility,
        patient_insurance=patient_insurance,
        invoice_date=date(2026, 2, 1),
        total_amount=Decimal('100.00'),
        insurance_amount=Decimal('80.00'),
        patient_responsibility=Decimal('20.00'),
        status='pending',
        created_by=billing_user,
        updated_by=billing_user,
    )
    InvoiceItemFactory(invoice=invoice, service=service, quantity=1, unit_price=Decimal('100.00'), tax_rate=Decimal('0.00'))

    # Mapping for NHIS export
    PayerServiceCode.objects.create(
        facility=facility,
        payer=nhis_provider,
        service=service,
        external_code='NHIS-SVC-001',
        effective_from=date(2025, 1, 1),
        effective_until=None,
        is_active=True,
        created_by=billing_user,
        updated_by=billing_user,
    )

    r_batch = client.post(
        "/api/billing/nhis/batches/",
        {"period_start": "2026-02-01", "period_end": "2026-02-01"},
        format="json",
    )
    assert r_batch.status_code == 201, r_batch.data
    batch_id = r_batch.data["id"]

    r_lint = client.post(f"/api/billing/nhis/batches/{batch_id}/lint/", {}, format="json")
    assert r_lint.status_code == 200, r_lint.data
    # No errors expected
    summary = {row["severity"]: row["count"] for row in r_lint.data.get("summary", [])}
    assert summary.get("error", 0) == 0

    r_export = client.post(f"/api/billing/nhis/batches/{batch_id}/export/", {}, format="json")
    assert r_export.status_code == 201, r_export.data
    job_id = r_export.data["id"]

    # Run export generation synchronously for the test.
    from apps.billing.tasks import generate_nhis_claim_export
    generate_nhis_claim_export(str(job_id))

    job = NHISClaimExportJob.objects.get(id=job_id)
    assert job.status == "ready"
    assert job.payload_encrypted

    r_dl = client.get(f"/api/billing/nhis/exports/{job_id}/download/")
    assert r_dl.status_code == 200
    assert r_dl.get("Content-Type") == "application/zip"

    z = zipfile.ZipFile(io.BytesIO(r_dl.content))
    assert set(z.namelist()) == {"claims.csv", "items.csv"}
    claims_csv = z.read("claims.csv").decode("utf-8")
    assert "patient_nhis_id" in claims_csv
    assert "NHIS-123" in claims_csv
    assert "NHIS-SVC-001" in z.read("items.csv").decode("utf-8")


def test_nhis_remittance_import_posts_insurance_payment_and_updates_ar(client, facility, billing_user):
    # NHIS payer setup
    nhis_provider = InsuranceProviderFactory(facility=facility, payer_type='nhis')
    nhis_plan = InsurancePlanFactory(provider=nhis_provider, facility=facility)

    patient = PatientProfileFactory(facility=facility, nhis_id='NHIS-999')
    patient_insurance = PatientInsuranceFactory(patient=patient, plan=nhis_plan)

    invoice = InvoiceFactory(
        patient=patient,
        facility=facility,
        patient_insurance=patient_insurance,
        invoice_date=date(2026, 2, 1),
        total_amount=Decimal('200.00'),
        insurance_amount=Decimal('150.00'),
        patient_responsibility=Decimal('50.00'),
        status='pending',
        created_by=billing_user,
        updated_by=billing_user,
    )
    claim = Claim.objects.create(
        claim_number="CLM-TEST-0001",
        invoice=invoice,
        claimed_amount=Decimal("150.00"),
        created_by=billing_user,
        updated_by=billing_user,
    )

    # Import an underpaid remittance (100 out of 150) to leave AR outstanding.
    csv_bytes = (
        "claim_number,paid_amount,paid_date,status\n"
        "CLM-TEST-0001,100.00,2026-02-05,paid\n"
    ).encode("utf-8")
    upload = SimpleUploadedFile("remit.csv", csv_bytes, content_type="text/csv")

    r_job = client.post(
        "/api/billing/nhis/remittances/import/",
        {"payer": str(nhis_provider.id), "file": upload},
        format="multipart",
    )
    assert r_job.status_code == 201, r_job.data
    job_id = r_job.data["id"]

    from apps.billing.tasks import process_remittance_import_job
    process_remittance_import_job(str(job_id))

    assert Payment.objects.filter(invoice=invoice, payer="insurance", status="posted").count() == 1
    payment = Payment.objects.get(invoice=invoice, payer="insurance", status="posted")
    assert payment.amount == Decimal("100.00")

    invoice.refresh_from_db()
    # Patient still owes 50, insurance still owes 50 => partially_paid
    assert invoice.status == "partially_paid"

    claim.refresh_from_db()
    assert claim.paid_amount_total == Decimal("100.00")
    assert claim.status != "paid"

    # AR aging should include remaining insurance balance due (50.00).
    r_aging = client.get("/api/billing/nhis/ar/insurance_aging/?basis=invoice_date")
    assert r_aging.status_code == 200
    assert Decimal(r_aging.data["total"]) == Decimal("50.00")
