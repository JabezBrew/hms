"""
Draft invoice auto-sync from clinical events.

This module implements the "draft invoice that updates" behavior:
- Create/maintain a draft Invoice with auto_update_enabled=True during care.
- Upsert/remove auto-generated InvoiceItems keyed by (source_type, source_id).
- Finalize the draft into a normal invoice (auto_update_enabled=False) when care completes.

SECURITY:
- Never log PHI. Log only opaque IDs.
- Enforce facility scoping when resolving Services and clinical sources.

PERF:
- Avoid N+1 by using select_related on source objects.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal
from django.db import transaction
from django.utils import timezone

from apps.billing.models import (
    FacilityBillingSettings,
    Invoice,
    InvoiceItem,
    PatientInsurance,
)
from apps.billing.services.pricing import PricingService
from apps.billing.services.rules_engine import BillingContext, BillingRulesEngine, PatientContext

logger = logging.getLogger(__name__)


def _to_decimal(value) -> Decimal:
    if value is None:
        return Decimal("0.00")
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def _safe_days_inclusive(start_dt, end_dt) -> int:
    """
    Inclusive day count for per-day ward billing.

    Example:
    - admitted on 2026-02-07 and discharged on 2026-02-07 => 1 day
    """
    if not start_dt or not end_dt:
        return 0
    start = start_dt.date()
    end = end_dt.date()
    if end < start:
        return 0
    return (end - start).days + 1


@dataclass(frozen=True)
class AutoItemKey:
    source_type: str
    source_id: str

    def as_tuple(self) -> tuple[str, str]:
        return (self.source_type, self.source_id)


class DraftInvoiceSyncService:
    """
    Create/sync/finalize draft invoices for encounters/admissions.
    """

    def __init__(self):
        self.pricing_service = PricingService
        self.rules_engine = BillingRulesEngine()

    def _get_billing_settings(self, facility):
        try:
            return facility.billing_settings
        except FacilityBillingSettings.DoesNotExist:
            return None

    def _resolve_active_insurance(self, patient, facility) -> PatientInsurance | None:
        """
        Best-effort selection of an active insurance for this facility.
        """
        if not patient:
            return None
        qs = (
            PatientInsurance.objects.select_related('plan__provider')
            .filter(patient=patient, is_active=True, plan__facility=facility)
            .order_by('-valid_from')
        )
        for ins in qs:
            if ins.is_valid:
                return ins
        return None

    def _generate_invoice_number(self, facility, billing_settings) -> str:
        # Use the per-facility sequence on FacilityBillingSettings (thread-safe).
        if billing_settings:
            return billing_settings.generate_invoice_number()
        # Fallback: use a reasonable prefix if settings absent.
        prefix = "INV"
        return f"{prefix}-{timezone.now().strftime('%Y%m%d%H%M%S')}"

    def _lab_trigger_for_invoice(self, invoice, billing_settings) -> str:
        """
        Self-pay uses facility-configured trigger; NHIS overrides to completed.
        """
        try:
            provider = invoice.patient_insurance.plan.provider if invoice.patient_insurance else None
            if provider and getattr(provider, "payer_type", None) == "nhis":
                return "completed"
        except Exception:
            # Never fail sync because of optional insurance metadata.
            pass
        return (getattr(billing_settings, "lab_charge_trigger", None) or "collected")

    def _lab_billable_statuses(self, trigger: str) -> set[str]:
        if trigger == "ordered":
            return {"ordered", "collected", "received", "processing", "completed"}
        if trigger == "collected":
            return {"collected", "received", "processing", "completed"}
        # completed
        return {"completed"}

    def _compute_due_date(self, billing_settings):
        due_days = getattr(billing_settings, "invoice_due_days", None) or 30
        return timezone.now().date() + timedelta(days=int(due_days))

    def _resolve_admission_end_dt(self, admission, end_dt=None):
        if end_dt is not None:
            return end_dt

        if getattr(admission, 'actual_discharge_date', None):
            return admission.actual_discharge_date

        try:
            discharge_case = admission.discharge_case
        except Exception:
            discharge_case = None
        if discharge_case and getattr(discharge_case, 'billing_cutoff_at', None):
            return discharge_case.billing_cutoff_at

        return timezone.now()

    def _build_patient_context(self, patient, insurance: PatientInsurance | None) -> PatientContext:
        """
        PatientContext is intentionally small; use only non-PHI identifiers and coarse attributes.
        """
        dob = getattr(patient, "date_of_birth", None)
        if not dob:
            dob = getattr(getattr(patient, "user", None), "date_of_birth", None)

        provider_code = None
        try:
            provider_code = insurance.plan.provider.code if insurance and insurance.plan and insurance.plan.provider else None
        except Exception:
            provider_code = None

        return PatientContext(
            patient_id=str(getattr(patient, "id", "") or ""),
            date_of_birth=dob,
            has_insurance=bool(insurance and insurance.is_valid),
            insurance_provider_code=provider_code,
        )

    def _apply_rules_and_split(self, invoice: Invoice, facility, billing_settings) -> None:
        """
        Deterministic recompute of subtotal/tax/discount/total + insurance split.
        """
        items = list(invoice.items.all())
        subtotal = sum((_to_decimal(i.unit_price) * _to_decimal(i.quantity)) for i in items) if items else Decimal("0.00")
        tax_total = sum(_to_decimal(getattr(i, "tax_amount", 0) or 0) for i in items) if items else Decimal("0.00")

        patient_context = self._build_patient_context(invoice.patient, invoice.patient_insurance)
        price_context = getattr(invoice, "price_context", None) or "regular"
        billing_context = BillingContext(
            facility_id=str(facility.id),
            department_id=str(getattr(invoice.department, "id", "") or "") or None,
            encounter_type="inpatient" if invoice.admission_id else "outpatient",
            timestamp=timezone.now(),
            is_emergency=False,
            price_context=price_context,
        )

        rules_result = self.rules_engine.evaluate(
            amount=subtotal,
            patient_context=patient_context,
            billing_context=billing_context,
            services=[i.service for i in items if getattr(i, "service_id", None)],
            quantity=sum(int(getattr(i, "quantity", 0) or 0) for i in items),
        )

        invoice.subtotal = subtotal
        invoice.tax_amount = tax_total
        invoice.discount_amount = rules_result.total_discount
        invoice.applied_rules = [adj.rule_id for adj in (rules_result.applied_adjustments or [])]

        total_amount = rules_result.adjusted_amount + tax_total + rules_result.total_surcharge
        invoice.total_amount = max(Decimal("0.00"), _to_decimal(total_amount))

        if invoice.patient_insurance and invoice.patient_insurance.is_valid:
            coverage_pct = _to_decimal(invoice.patient_insurance.plan.coverage_percentage) / Decimal("100")
            invoice.insurance_amount = invoice.total_amount * coverage_pct
            invoice.patient_responsibility = invoice.total_amount - invoice.insurance_amount
        else:
            invoice.insurance_amount = Decimal("0.00")
            invoice.patient_responsibility = invoice.total_amount

    def _upsert_auto_item(
        self,
        *,
        invoice: Invoice,
        facility,
        service,
        quantity: int,
        source_type: str,
        source_id,
        actor,
        description: str | None = None,
        unit_price_override: Decimal | None = None,
    ) -> AutoItemKey:
        if not service:
            raise ValueError("service is required")
        if getattr(service, "facility_id", None) != facility.id:
            raise ValueError("service facility mismatch")
        if not getattr(service, "is_active", True):
            raise ValueError("service is inactive")

        resolved = None
        if unit_price_override is None:
            resolved = self.pricing_service.get_price(service=service, facility=facility, department=invoice.department, context=invoice.price_context)
            unit_price = resolved.price
            tax_rate = resolved.tax_rate
        else:
            unit_price = unit_price_override
            tax_rate = getattr(service, "tax_rate", Decimal("0.00"))

        existing = InvoiceItem.objects.filter(
            invoice=invoice,
            source_type=source_type,
            source_id=source_id,
        ).first()
        if existing:
            InvoiceItem.objects.filter(id=existing.id).update(
                service=service,
                quantity=int(quantity),
                unit_price=_to_decimal(unit_price),
                tax_rate=_to_decimal(tax_rate),
                description=description or getattr(service, "name", "Service"),
                is_auto_generated=True,
                updated_by=actor,
                updated_at=timezone.now(),
            )
        else:
            InvoiceItem.objects.create(
                invoice=invoice,
                source_type=source_type,
                source_id=source_id,
                service=service,
                quantity=int(quantity),
                unit_price=_to_decimal(unit_price),
                tax_rate=_to_decimal(tax_rate),
                description=description or getattr(service, "name", "Service"),
                is_auto_generated=True,
                created_by=actor,
                updated_by=actor,
            )
        return AutoItemKey(source_type=source_type, source_id=str(source_id))

    def _prune_stale_auto_items(self, invoice: Invoice, keep_keys: set[tuple[str, str]]) -> None:
        ids_to_delete: list[str] = []
        for item in InvoiceItem.objects.filter(invoice=invoice, is_auto_generated=True).only("id", "source_type", "source_id"):
            if (item.source_type, str(item.source_id)) not in keep_keys:
                ids_to_delete.append(str(item.id))
        if ids_to_delete:
            InvoiceItem.objects.filter(id__in=ids_to_delete).delete()

    @transaction.atomic
    def ensure_and_sync_for_encounter(self, *, encounter, actor=None) -> Invoice:
        facility = encounter.facility
        billing_settings = self._get_billing_settings(facility)

        invoice = (
            Invoice.objects.select_for_update()
            .filter(facility=facility, encounter=encounter)
            .order_by("-created_at")
            .first()
        )
        if invoice and not invoice.auto_update_enabled:
            # Already finalized; do not mutate.
            return invoice

        if not invoice:
            insurance = self._resolve_active_insurance(encounter.patient, facility)
            invoice = Invoice.objects.create(
                invoice_number=self._generate_invoice_number(facility, billing_settings),
                patient=encounter.patient,
                facility=facility,
                department=None,
                encounter=encounter,
                invoice_date=timezone.now().date(),
                due_date=self._compute_due_date(billing_settings),
                patient_insurance=insurance,
                status="draft",
                auto_update_enabled=True,
                created_by=actor,
                updated_by=actor,
            )
        else:
            Invoice.objects.filter(id=invoice.id).update(auto_update_enabled=True, status="draft", updated_at=timezone.now())
            invoice.refresh_from_db()

        keep: set[tuple[str, str]] = set()

        # Consultation line (facility-configured default).
        consult_service = getattr(billing_settings, "default_consultation_service", None) if billing_settings else None
        if consult_service:
            key = self._upsert_auto_item(
                invoice=invoice,
                facility=facility,
                service=consult_service,
                quantity=1,
                source_type="encounter_consult",
                source_id=encounter.id,
                actor=actor,
                description="Consultation",
            )
            keep.add(key.as_tuple())

        # Lab tests (via mapping LabTestCatalog.billing_service).
        from apps.laboratory.models import LabOrderTest

        trigger = self._lab_trigger_for_invoice(invoice, billing_settings)
        billable_statuses = self._lab_billable_statuses(trigger)

        lab_tests = (
            LabOrderTest.objects.select_related("order", "test", "test__billing_service")
            .filter(order__encounter=encounter, facility=facility)
            .exclude(order__status="cancelled")
        )
        for lot in lab_tests:
            if lot.status not in billable_statuses:
                continue
            svc = getattr(lot.test, "billing_service", None)
            if not svc:
                continue
            key = self._upsert_auto_item(
                invoice=invoice,
                facility=facility,
                service=svc,
                quantity=1,
                source_type="lab_order_test",
                source_id=lot.id,
                actor=actor,
                description=getattr(lot.test, "name", None) or "Lab Test",
            )
            keep.add(key.as_tuple())

        # Only prune when unpaid (payments are also blocked for auto-updating invoices, but be defensive).
        if not invoice.payments.filter(status="posted").exists():
            self._prune_stale_auto_items(invoice, keep)

        # Recompute totals and insurance split.
        invoice.refresh_from_db()
        self._apply_rules_and_split(invoice, facility, billing_settings)
        invoice.save(update_fields=[
            "subtotal",
            "tax_amount",
            "discount_amount",
            "total_amount",
            "insurance_amount",
            "patient_responsibility",
            "applied_rules",
            "updated_at",
        ])
        return invoice

    @transaction.atomic
    def ensure_and_sync_for_admission(self, *, admission, actor=None, allow_reopen=False, end_dt=None) -> Invoice:
        facility = admission.facility
        billing_settings = self._get_billing_settings(facility)

        invoice = (
            Invoice.objects.select_for_update()
            .filter(facility=facility, admission=admission)
            .order_by("-created_at")
            .first()
        )
        if invoice and not invoice.auto_update_enabled and not allow_reopen:
            return invoice

        if not invoice:
            insurance = self._resolve_active_insurance(admission.patient, facility)
            invoice = Invoice.objects.create(
                invoice_number=self._generate_invoice_number(facility, billing_settings),
                patient=admission.patient,
                facility=facility,
                department=None,
                admission=admission,
                invoice_date=timezone.now().date(),
                due_date=self._compute_due_date(billing_settings),
                patient_insurance=insurance,
                status="draft",
                auto_update_enabled=True,
                created_by=actor,
                updated_by=actor,
            )
        else:
            Invoice.objects.filter(id=invoice.id).update(auto_update_enabled=True, status="draft", updated_at=timezone.now())
            invoice.refresh_from_db()

        keep: set[tuple[str, str]] = set()

        # Ward stay line (facility-configured service; unit price from Admission.daily_rate snapshot).
        ward_service = getattr(billing_settings, "ward_stay_service", None) if billing_settings else None
        if ward_service:
            resolved_end_dt = self._resolve_admission_end_dt(admission, end_dt=end_dt)
            qty = _safe_days_inclusive(admission.admission_date, resolved_end_dt)
            if qty <= 0:
                qty = 1
            key = self._upsert_auto_item(
                invoice=invoice,
                facility=facility,
                service=ward_service,
                quantity=qty,
                source_type="ward_stay",
                source_id=admission.id,
                actor=actor,
                description="Ward stay",
                unit_price_override=_to_decimal(admission.daily_rate),
            )
            keep.add(key.as_tuple())

        if not invoice.payments.filter(status="posted").exists():
            self._prune_stale_auto_items(invoice, keep)

        invoice.refresh_from_db()
        self._apply_rules_and_split(invoice, facility, billing_settings)
        invoice.save(update_fields=[
            "subtotal",
            "tax_amount",
            "discount_amount",
            "total_amount",
            "insurance_amount",
            "patient_responsibility",
            "applied_rules",
            "updated_at",
        ])
        return invoice

    @transaction.atomic
    def freeze_admission_invoice(self, *, admission, cutoff_at, actor=None) -> Invoice:
        invoice = self.ensure_and_sync_for_admission(
            admission=admission,
            actor=actor,
            allow_reopen=True,
            end_dt=cutoff_at,
        )
        return self.finalize_invoice(invoice=invoice, actor=actor)

    @transaction.atomic
    def reopen_admission_invoice(self, *, admission, actor=None) -> Invoice:
        return self.ensure_and_sync_for_admission(
            admission=admission,
            actor=actor,
            allow_reopen=True,
        )

    @transaction.atomic
    def finalize_invoice(self, *, invoice: Invoice, actor=None) -> Invoice:
        """
        Stop auto-updates and mark invoice as ready for payment/claims.
        """
        locked = Invoice.objects.select_for_update().get(id=invoice.id)
        if locked.status == "cancelled":
            return locked
        locked.auto_update_enabled = False
        if locked.status == "draft":
            locked.status = "pending"
        locked.updated_by = actor or locked.updated_by
        locked.save(update_fields=["auto_update_enabled", "status", "updated_by", "updated_at"])
        return locked
