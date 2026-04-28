import json
import uuid
from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.billing.models import PaymentIntent, PSPWebhookEvent, Payment, Receipt
from apps.billing.tests.factories import InvoiceFactory
from apps.core.tests.factories import DefaultFacilityFactory
from apps.users.tests.factories import PatientProfileFactory, UserFactory
from apps.interop.crypto import encrypt_payload


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


class _StubAdapter:
    def create_intent(self, **kwargs):
        class _R:
            provider_reference = "PAYLINK-123"
            checkout_url = "https://pay.hubtel.com/PAYLINK-123"
            expires_at = None
        return _R()

    def verify_webhook(self, request):
        return True

    def parse_webhook(self, *, body_bytes, headers):
        payload = json.loads(body_bytes.decode("utf-8"))
        data = payload.get("data") or {}
        return type("Parsed", (), {
            "provider_reference": data.get("paylinkId"),
            "client_reference": data.get("clientReference"),
            "status": "succeeded",
            "paid_amount": Decimal(str(data.get("amount") or "0")),
            "fee_amount": None,
            "paid_at": None,
            "event_type": None,
        })()


def test_payment_intent_create_is_idempotent(client, facility, monkeypatch):
    patient = PatientProfileFactory(facility=facility)
    invoice = InvoiceFactory(
        patient=patient,
        facility=facility,
        status="pending",
        patient_responsibility=Decimal("50.00"),
        insurance_amount=Decimal("0.00"),
    )

    monkeypatch.setattr("apps.billing.views.get_psp_adapter", lambda provider: _StubAdapter())

    payload = {
        "invoice_id": str(invoice.id),
        "payment_method": "mobile_money",
        "mobile_number": "233200000000",
        "amount": "10.00",
    }
    key = str(uuid.uuid4())

    r1 = client.post("/api/billing/payment-intents/", payload, format="json", HTTP_IDEMPOTENCY_KEY=key)
    assert r1.status_code == 201, r1.data
    assert PaymentIntent.objects.count() == 1

    r2 = client.post("/api/billing/payment-intents/", payload, format="json", HTTP_IDEMPOTENCY_KEY=key)
    assert r2.status_code == 201, r2.data
    assert PaymentIntent.objects.count() == 1

    intent = PaymentIntent.objects.first()
    assert intent.facility_id == facility.id
    assert intent.provider == "hubtel"
    assert intent.status == "pending"
    assert intent.provider_reference == "PAYLINK-123"


def test_hubtel_webhook_processing_posts_payment_exactly_once(client, facility, monkeypatch):
    patient = PatientProfileFactory(facility=facility)
    invoice = InvoiceFactory(
        patient=patient,
        facility=facility,
        status="pending",
        patient_responsibility=Decimal("25.00"),
        insurance_amount=Decimal("0.00"),
        total_amount=Decimal("25.00"),
    )

    intent = PaymentIntent.objects.create(
        facility=facility,
        invoice=invoice,
        payer="patient",
        amount=Decimal("25.00"),
        currency="GHS",
        payment_method="mobile_money",
        status="pending",
        provider="hubtel",
        client_reference="HMS-MAIN-ABC",
        provider_reference="PAYLINK-ABC",
    )

    payload = {
        "message": "ok",
        "responseCode": "0000",
        "data": {
            "paymentType": "momo",
            "status": "Successful",
            "amount": 25,
            "paylinkId": "PAYLINK-ABC",
            "phoneNumber": "233200000000",
            "clientReference": "HMS-MAIN-ABC",
        },
    }
    body = json.dumps(payload).encode("utf-8")
    event = PSPWebhookEvent.objects.create(
        provider="hubtel",
        payload_hash="x" * 64,
        payload_encrypted=encrypt_payload(body),
        processing_status="pending",
    )

    # Use real Hubtel adapter parsing, but stub out get_psp_adapter for determinism.
    monkeypatch.setattr("apps.billing.tasks.get_psp_adapter", lambda provider: _StubAdapter())

    from apps.billing.tasks import process_psp_webhook_event
    process_psp_webhook_event(str(event.id))

    assert Payment.objects.filter(invoice=invoice, payer="patient", status="posted").count() == 1
    payment = Payment.objects.get(invoice=invoice, payer="patient", status="posted")
    assert payment.reference_number == "PAYLINK-ABC"
    assert payment.payment_method == "mobile_money"

    assert Receipt.objects.filter(payment=payment).count() == 1

    intent.refresh_from_db()
    assert intent.payment_id == payment.id

    # Re-process same event: must not create another payment.
    process_psp_webhook_event(str(event.id))
    assert Payment.objects.filter(invoice=invoice, payer="patient", status="posted").count() == 1


def test_hubtel_webhook_processing_rejects_amount_mismatch(client, facility, monkeypatch):
    patient = PatientProfileFactory(facility=facility)
    invoice = InvoiceFactory(
        patient=patient,
        facility=facility,
        status="pending",
        patient_responsibility=Decimal("25.00"),
        insurance_amount=Decimal("0.00"),
        total_amount=Decimal("25.00"),
    )
    PaymentIntent.objects.create(
        facility=facility,
        invoice=invoice,
        payer="patient",
        amount=Decimal("25.00"),
        currency="GHS",
        payment_method="mobile_money",
        status="pending",
        provider="hubtel",
        client_reference="HMS-MAIN-MISMATCH",
        provider_reference="PAYLINK-MISMATCH",
    )
    payload = {
        "data": {
            "status": "Successful",
            "amount": 1,
            "currency": "GHS",
            "paylinkId": "PAYLINK-MISMATCH",
            "clientReference": "HMS-MAIN-MISMATCH",
        },
    }
    event = PSPWebhookEvent.objects.create(
        provider="hubtel",
        payload_hash="y" * 64,
        payload_encrypted=encrypt_payload(json.dumps(payload).encode("utf-8")),
        processing_status="pending",
    )
    monkeypatch.setattr("apps.billing.tasks.get_psp_adapter", lambda provider: _StubAdapter())

    from apps.billing.tasks import process_psp_webhook_event
    process_psp_webhook_event(str(event.id))

    assert not Payment.objects.filter(invoice=invoice, payer="patient", status="posted").exists()
    event.refresh_from_db()
    assert event.processing_status == "failed"


def test_hubtel_webhook_requires_secret_token_when_configured(client, settings):
    settings.HUBTEL_WEBHOOK_SECRET = "secret-token"

    # Missing token -> 401
    r1 = client.post("/api/billing/psp/webhooks/hubtel/", {"x": 1}, format="json")
    assert r1.status_code == 401

    # With token -> 200
    r2 = client.post("/api/billing/psp/webhooks/hubtel/?token=secret-token", {"x": 1}, format="json")
    assert r2.status_code == 200


def test_hubtel_webhook_rejects_missing_secret_outside_debug(client, settings):
    settings.DEBUG = False
    settings.HUBTEL_WEBHOOK_SECRET = ""

    response = client.post("/api/billing/psp/webhooks/hubtel/", {"x": 1}, format="json")

    assert response.status_code == 401


def test_hubtel_webhook_duplicate_payload_is_acknowledged(client, monkeypatch, settings):
    settings.HUBTEL_WEBHOOK_SECRET = "secret-token"
    monkeypatch.setattr("apps.billing.views.get_psp_adapter", lambda provider: _StubAdapter())

    payload = {
        "data": {
            "paylinkId": "PAYLINK-DUP",
            "clientReference": "REF-DUP",
            "amount": 5,
            "status": "Successful",
        }
    }

    r1 = client.post("/api/billing/psp/webhooks/hubtel/?token=secret-token", payload, format="json")
    r2 = client.post("/api/billing/psp/webhooks/hubtel/?token=secret-token", payload, format="json")

    assert r1.status_code == 200
    assert r2.status_code == 200
    assert PSPWebhookEvent.objects.filter(provider='hubtel').count() == 1


def test_hubtel_webhook_returns_retryable_error_on_non_idempotent_persistence_failure(client, monkeypatch, settings):
    from apps.billing import views as billing_views

    settings.HUBTEL_WEBHOOK_SECRET = "secret-token"
    monkeypatch.setattr("apps.billing.views.get_psp_adapter", lambda provider: _StubAdapter())

    def _raise_failure(*args, **kwargs):
        raise RuntimeError("storage unavailable")

    monkeypatch.setattr(billing_views, "encrypt_payload", lambda body: "encrypted-payload")
    monkeypatch.setattr(billing_views.PSPWebhookEvent.objects, "create", _raise_failure)

    payload = {
        "data": {
            "paylinkId": "PAYLINK-FAIL",
            "clientReference": "REF-FAIL",
            "amount": 5,
            "status": "Successful",
        }
    }
    response = client.post("/api/billing/psp/webhooks/hubtel/?token=secret-token", payload, format="json")

    assert response.status_code == 503
