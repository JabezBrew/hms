from decimal import Decimal

import pytest

from apps.billing.models import FacilityBillingSettings
from apps.billing.services import DraftInvoiceSyncService
from apps.billing.tests.factories import (
    ConsultationServiceFactory,
    InsurancePlanFactory,
    InsuranceProviderFactory,
    PatientInsuranceFactory,
)
from apps.core.tests.factories import DefaultFacilityFactory
from apps.encounters.tests.factories import EncounterFactory
from apps.laboratory.tests.factories import LabOrderFactory, LabOrderTestFactory, LabTestCatalogFactory
from apps.users.tests.factories import PatientProfileFactory, UserFactory


@pytest.fixture
def facility():
    return DefaultFacilityFactory()


@pytest.fixture
def admin_user(facility):
    return UserFactory(user_type="admin", primary_facility=facility)


def _ensure_settings(facility, admin_user, **kwargs):
    FacilityBillingSettings.objects.filter(facility=facility).delete()
    return FacilityBillingSettings.objects.create(
        facility=facility,
        accepted_payment_methods=["cash", "mobile_money", "bank_transfer", "credit_card"],
        auto_generate_invoice_on_encounter_complete=True,
        auto_generate_invoice_on_discharge=True,
        created_by=admin_user,
        updated_by=admin_user,
        **kwargs,
    )


def test_sync_creates_draft_invoice_and_consult_line(facility, admin_user):
    consult_service = ConsultationServiceFactory(facility=facility)
    _ensure_settings(facility, admin_user, default_consultation_service=consult_service)

    patient = PatientProfileFactory(facility=facility)
    encounter = EncounterFactory(patient=patient, facility=facility, status="in-progress")

    svc = DraftInvoiceSyncService()
    invoice = svc.ensure_and_sync_for_encounter(encounter=encounter, actor=admin_user)

    assert invoice.facility_id == facility.id
    assert invoice.encounter_id == encounter.id
    assert invoice.status == "draft"
    assert invoice.auto_update_enabled is True

    items = list(invoice.items.all())
    assert len(items) == 1
    assert items[0].is_auto_generated is True
    assert items[0].source_type == "encounter_consult"
    assert str(items[0].source_id) == str(encounter.id)


def test_labs_bill_on_collected_for_self_pay(facility, admin_user):
    consult_service = ConsultationServiceFactory(facility=facility)
    lab_service = ConsultationServiceFactory(facility=facility)  # reuse factory; any Service works
    _ensure_settings(
        facility,
        admin_user,
        default_consultation_service=consult_service,
        lab_charge_trigger="collected",
    )

    patient = PatientProfileFactory(facility=facility)
    encounter = EncounterFactory(patient=patient, facility=facility, status="in-progress")

    test = LabTestCatalogFactory(facility=facility)
    test.billing_service = lab_service
    test.save(update_fields=["billing_service"])

    order = LabOrderFactory(patient=patient, facility=facility, encounter=encounter, status="ordered")
    lot = LabOrderTestFactory(order=order, facility=facility, test=test, status="ordered")

    svc = DraftInvoiceSyncService()
    invoice = svc.ensure_and_sync_for_encounter(encounter=encounter, actor=admin_user)
    assert invoice.items.filter(source_type="lab_order_test", source_id=lot.id).count() == 0

    lot.status = "collected"
    lot.save(update_fields=["status"])
    invoice = svc.ensure_and_sync_for_encounter(encounter=encounter, actor=admin_user)
    assert invoice.items.filter(source_type="lab_order_test", source_id=lot.id).count() == 1


def test_labs_bill_on_completed_for_nhis_override(facility, admin_user):
    consult_service = ConsultationServiceFactory(facility=facility)
    lab_service = ConsultationServiceFactory(facility=facility)
    _ensure_settings(
        facility,
        admin_user,
        default_consultation_service=consult_service,
        lab_charge_trigger="collected",  # should be overridden for NHIS
    )

    nhis_provider = InsuranceProviderFactory(facility=facility, payer_type="nhis")
    nhis_plan = InsurancePlanFactory(provider=nhis_provider, facility=facility, coverage_percentage=Decimal("100.00"))

    patient = PatientProfileFactory(facility=facility)
    patient_insurance = PatientInsuranceFactory(patient=patient, plan=nhis_plan)

    encounter = EncounterFactory(patient=patient, facility=facility, status="in-progress")

    test = LabTestCatalogFactory(facility=facility)
    test.billing_service = lab_service
    test.save(update_fields=["billing_service"])

    order = LabOrderFactory(patient=patient, facility=facility, encounter=encounter, status="ordered")
    lot = LabOrderTestFactory(order=order, facility=facility, test=test, status="collected")

    svc = DraftInvoiceSyncService()
    invoice = svc.ensure_and_sync_for_encounter(encounter=encounter, actor=admin_user)
    invoice.patient_insurance = patient_insurance
    invoice.save(update_fields=["patient_insurance"])

    invoice = svc.ensure_and_sync_for_encounter(encounter=encounter, actor=admin_user)
    assert invoice.items.filter(source_type="lab_order_test", source_id=lot.id).count() == 0

    lot.status = "completed"
    lot.save(update_fields=["status"])
    invoice = svc.ensure_and_sync_for_encounter(encounter=encounter, actor=admin_user)
    assert invoice.items.filter(source_type="lab_order_test", source_id=lot.id).count() == 1


def test_finalize_disables_auto_update(facility, admin_user):
    consult_service = ConsultationServiceFactory(facility=facility)
    _ensure_settings(facility, admin_user, default_consultation_service=consult_service)

    patient = PatientProfileFactory(facility=facility)
    encounter = EncounterFactory(patient=patient, facility=facility, status="in-progress")

    svc = DraftInvoiceSyncService()
    invoice = svc.ensure_and_sync_for_encounter(encounter=encounter, actor=admin_user)
    invoice = svc.finalize_invoice(invoice=invoice, actor=admin_user)

    invoice.refresh_from_db()
    assert invoice.auto_update_enabled is False
    assert invoice.status == "pending"

