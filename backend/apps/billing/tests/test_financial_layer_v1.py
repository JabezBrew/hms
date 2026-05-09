import uuid
from datetime import date
from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.billing.models import CashSession, FacilityBillingSettings, Invoice, Payment
from apps.billing.tests.factories import (
    ClaimFactory,
    InvoiceFactory,
    ServiceCategoryFactory,
    ServiceFactory,
    FacilityBillingSettingsFactory,
)
from apps.core.tests.factories import DefaultFacilityFactory, FacilityFactory
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


def test_invoice_create_is_idempotent_and_sets_facility(client, facility):
    patient = PatientProfileFactory(facility=facility)
    category = ServiceCategoryFactory(facility=facility)
    service = ServiceFactory(facility=facility, category=category)

    payload = {
        "patient": str(patient.id),
        "due_date": "2030-01-01",
        "notes": "test invoice",
        "items": [
            {"service": str(service.id), "quantity": 1, "description": "Consultation"},
        ],
    }

    key = str(uuid.uuid4())
    r1 = client.post("/api/billing/invoices/", payload, format="json", HTTP_IDEMPOTENCY_KEY=key)
    assert r1.status_code == 201, r1.data
    assert Invoice.objects.count() == 1

    r2 = client.post("/api/billing/invoices/", payload, format="json", HTTP_IDEMPOTENCY_KEY=key)
    assert r2.status_code == 201
    assert Invoice.objects.count() == 1

    invoice = Invoice.objects.first()
    assert invoice.facility_id == facility.id
    assert invoice.invoice_number


def test_invoice_create_idempotency_key_mismatch_returns_409(client, facility):
    patient = PatientProfileFactory(facility=facility)
    category = ServiceCategoryFactory(facility=facility)
    service = ServiceFactory(facility=facility, category=category)

    key = str(uuid.uuid4())
    payload1 = {
        "patient": str(patient.id),
        "due_date": "2030-01-01",
        "items": [{"service": str(service.id), "quantity": 1, "description": "A"}],
    }
    payload2 = {
        "patient": str(patient.id),
        "due_date": "2030-01-02",
        "items": [{"service": str(service.id), "quantity": 2, "description": "B"}],
    }

    r1 = client.post("/api/billing/invoices/", payload1, format="json", HTTP_IDEMPOTENCY_KEY=key)
    assert r1.status_code == 201, r1.data
    r2 = client.post("/api/billing/invoices/", payload2, format="json", HTTP_IDEMPOTENCY_KEY=key)
    assert r2.status_code == 409, r2.data


def test_mark_as_paid_requires_open_cash_session_when_enabled(client, facility, billing_user):
    FacilityBillingSettings.objects.filter(facility=facility).delete()
    FacilityBillingSettingsFactory(
        facility=facility,
        cash_control_enabled=True,
        cash_variance_threshold_amount=Decimal("2.00"),
        accepted_payment_methods=["cash", "credit_card", "mobile_money"],
        created_by=billing_user,
        updated_by=billing_user,
    )

    patient = PatientProfileFactory(facility=facility)
    invoice = InvoiceFactory(
        patient=patient,
        facility=facility,
        status="pending",
        patient_responsibility=Decimal("100.00"),
        insurance_amount=Decimal("0.00"),
    )

    r = client.post(
        f"/api/billing/invoices/{invoice.id}/mark_as_paid/",
        {"amount": 100, "payment_method": "cash", "generate_receipt": False},
        format="json",
    )
    assert r.status_code == 400
    assert "cash session" in (r.data.get("error") or "").lower()


def test_cash_session_closeout_computes_expected_and_variance(client, facility, billing_user):
    FacilityBillingSettings.objects.filter(facility=facility).delete()
    FacilityBillingSettingsFactory(
        facility=facility,
        cash_control_enabled=True,
        cash_variance_threshold_amount=Decimal("2.00"),
        accepted_payment_methods=["cash", "credit_card", "mobile_money"],
        created_by=billing_user,
        updated_by=billing_user,
    )

    # Open session
    r_open = client.post(
        "/api/billing/cash-sessions/",
        {"opening_float_amount": "10.00"},
        format="json",
        HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()),
    )
    assert r_open.status_code == 201, r_open.data
    session_id = r_open.data["id"]

    patient = PatientProfileFactory(facility=facility)
    invoice = InvoiceFactory(
        patient=patient,
        facility=facility,
        status="pending",
        patient_responsibility=Decimal("100.00"),
        insurance_amount=Decimal("0.00"),
    )

    # Post a cash payment (will attach to session)
    r_pay = client.post(
        f"/api/billing/invoices/{invoice.id}/mark_as_paid/",
        {"amount": "100.00", "payment_method": "cash", "generate_receipt": False},
        format="json",
        HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()),
    )
    assert r_pay.status_code == 201, r_pay.data

    # Movement: expense out 5
    r_move = client.post(
        "/api/billing/cash-movements/",
        {
            "session": session_id,
            "direction": "out",
            "movement_type": "expense",
            "amount": "5.00",
            "reference": "petty-cash",
        },
        format="json",
        HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()),
    )
    assert r_move.status_code == 201, r_move.data

    # Close session counted = 10 + 100 - 5 = 105
    r_close = client.post(
        f"/api/billing/cash-sessions/{session_id}/close/",
        {"counted_cash_amount": "105.00"},
        format="json",
        HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()),
    )
    assert r_close.status_code == 200, r_close.data
    assert r_close.data["status"] == "closed"
    assert str(r_close.data["variance_cash_amount"]) in ("0.00", "0")
    assert r_close.data["is_flagged"] is False
    assert r_close.data["expected_totals"].get("cash") in ("100.00", "100")


def test_void_payment_is_explicit_and_recomputes_invoice_status(client, facility, billing_user):
    FacilityBillingSettings.objects.filter(facility=facility).delete()
    FacilityBillingSettingsFactory(
        facility=facility,
        cash_control_enabled=True,
        cash_variance_threshold_amount=Decimal("0.00"),
        accepted_payment_methods=["cash"],
        created_by=billing_user,
        updated_by=billing_user,
    )

    # Open session
    r_open = client.post(
        "/api/billing/cash-sessions/",
        {"opening_float_amount": "0.00"},
        format="json",
        HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()),
    )
    assert r_open.status_code == 201

    patient = PatientProfileFactory(facility=facility)
    invoice = InvoiceFactory(
        patient=patient,
        facility=facility,
        status="pending",
        patient_responsibility=Decimal("50.00"),
        insurance_amount=Decimal("0.00"),
        due_date=date(2030, 1, 1),
    )

    r_pay = client.post(
        f"/api/billing/invoices/{invoice.id}/mark_as_paid/",
        {"amount": "50.00", "payment_method": "cash", "generate_receipt": False},
        format="json",
        HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()),
    )
    assert r_pay.status_code == 201, r_pay.data
    payment_id = r_pay.data["payment"]["id"]

    invoice.refresh_from_db()
    assert invoice.status == "paid"

    r_void = client.post(
        f"/api/billing/payments/{payment_id}/void/",
        {"reason": "test void"},
        format="json",
    )
    assert r_void.status_code == 200, r_void.data
    assert r_void.data["status"] == "voided"

    invoice.refresh_from_db()
    assert invoice.status == "pending"


def test_insurance_payment_does_not_settle_patient_balance(client, facility, billing_user):
    patient = PatientProfileFactory(facility=facility)
    invoice = InvoiceFactory(
        patient=patient,
        facility=facility,
        status="pending",
        total_amount=Decimal("200.00"),
        insurance_amount=Decimal("150.00"),
        patient_responsibility=Decimal("50.00"),
    )
    # Simulate an insurance remittance posting (payer=insurance) without any patient payment.
    Payment.objects.create(
        invoice=invoice,
        amount=Decimal("150.00"),
        payer="insurance",
        status="posted",
        payment_method="insurance",
        reference_number="INS-TEST",
        created_by=billing_user,
        updated_by=billing_user,
    )

    from apps.billing.views import _recompute_and_persist_invoice_status
    _recompute_and_persist_invoice_status(invoice)

    invoice.refresh_from_db()
    assert invoice.status == "partially_paid"
    assert invoice.patient_balance_due == Decimal("50.00")

    insurance_payments = Payment.objects.filter(invoice=invoice, payer="insurance", status="posted")
    assert insurance_payments.exists()
