"""
Invoice Generation Service for auto-generating invoices from clinical events.

Supports:
- Outpatient encounter billing
- Inpatient discharge billing
- Integration with PricingService for multi-facility pricing
- Integration with BillingRulesEngine for discounts/surcharges

Security notes:
- All generation is audited with created_by
- Invoices are linked to clinical encounters for traceability
- Insurance coverage is validated before application

Performance notes:
- Batch processing for multiple services
- Efficient prefetching of related data
- Single transaction for invoice creation
"""
import logging
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional, List, Tuple

from django.db import models, transaction
from django.utils import timezone

from apps.billing.models import (
    Invoice, InvoiceItem, Service, PatientInsurance, FacilityBillingSettings, FacilityInvoiceSequence
)
from apps.billing.services.pricing import PricingService
from apps.billing.services.rules_engine import (
    BillingRulesEngine, PatientContext, BillingContext, RuleEvaluationResult
)
from hms_backend.deployment import feature_enabled

logger = logging.getLogger(__name__)


def _billing_enabled(facility=None) -> bool:
    return bool(feature_enabled('billing', facility=facility))


def _insurance_claims_enabled(facility=None) -> bool:
    return _billing_enabled(facility) and bool(
        feature_enabled('insurance_claims', facility=facility)
    )


@dataclass
class ServiceLine:
    """Represents a service to be added to an invoice."""
    service: Service
    quantity: int = 1
    unit_price: Optional[Decimal] = None  # If None, resolved via PricingService
    description: Optional[str] = None


@dataclass
class InvoiceGenerationResult:
    """Result of invoice generation."""
    success: bool
    invoice: Optional[Invoice] = None
    error_message: Optional[str] = None
    warnings: List[str] = None

    def __post_init__(self):
        if self.warnings is None:
            self.warnings = []


class InvoiceGenerationService:
    """
    Service for auto-generating invoices from clinical events.

    Usage:
        service = InvoiceGenerationService()

        # Generate from encounter
        result = service.generate_from_encounter(encounter, created_by=user)

        # Generate from admission (discharge billing)
        result = service.generate_from_admission(admission, created_by=user)

        # Manual invoice creation
        result = service.create_invoice(
            patient=patient,
            facility=facility,
            services=[ServiceLine(service=consultation, quantity=1)],
            created_by=user
        )
    """

    def __init__(self):
        self.pricing_service = PricingService
        self.rules_engine = BillingRulesEngine()

    @transaction.atomic
    def generate_from_encounter(
        self,
        encounter,
        created_by,
        include_labs: bool = True,
        include_prescriptions: bool = True,
        include_procedures: bool = True
    ) -> InvoiceGenerationResult:
        """
        Auto-generate invoice when an outpatient encounter completes.

        Args:
            encounter: Encounter model instance
            created_by: User creating the invoice
            include_labs: Include lab orders in billing
            include_prescriptions: Include prescription charges
            include_procedures: Include procedure charges

        Returns:
            InvoiceGenerationResult with generated invoice or error
        """
        try:
            # Validate encounter
            if not encounter.patient:
                return InvoiceGenerationResult(
                    success=False,
                    error_message="Encounter has no patient"
                )

            # Get facility from encounter (via ward/department)
            facility = self._get_facility_from_encounter(encounter)
            if not facility:
                return InvoiceGenerationResult(
                    success=False,
                    error_message="Cannot determine facility from encounter"
                )
            if not _billing_enabled(facility):
                return InvoiceGenerationResult(
                    success=False,
                    error_message="Billing feature is disabled"
                )

            # Collect services from encounter
            service_lines = self._collect_encounter_services(
                encounter,
                include_labs=include_labs,
                include_prescriptions=include_prescriptions,
                include_procedures=include_procedures
            )

            if not service_lines:
                return InvoiceGenerationResult(
                    success=False,
                    error_message="No billable services found for encounter"
                )

            # Get department if available
            department = self._get_department_from_encounter(encounter)

            # Create invoice
            result = self.create_invoice(
                patient=encounter.patient,
                facility=facility,
                department=department,
                services=service_lines,
                encounter=encounter,
                created_by=created_by
            )

            if result.success:
                logger.info(
                    f"Generated invoice {result.invoice.invoice_number} "
                    f"from encounter {encounter.id}"
                )

            return result

        except Exception as e:
            logger.exception(f"Error generating invoice from encounter: {e}")
            return InvoiceGenerationResult(
                success=False,
                error_message=str(e)
            )

    @transaction.atomic
    def generate_from_admission(
        self,
        admission,
        created_by,
        include_daily_rate: bool = True,
        include_services: bool = True,
        include_amenities: bool = True
    ) -> InvoiceGenerationResult:
        """
        Auto-generate discharge bill when patient is discharged.

        Args:
            admission: Admission model instance
            created_by: User creating the invoice
            include_daily_rate: Include bed/ward charges
            include_services: Include services rendered during stay
            include_amenities: Include amenity charges

        Returns:
            InvoiceGenerationResult with generated invoice or error
        """
        try:
            # Validate admission
            if not admission.patient:
                return InvoiceGenerationResult(
                    success=False,
                    error_message="Admission has no patient"
                )

            # Get facility from admission (via bed/ward)
            facility = self._get_facility_from_admission(admission)
            if not facility:
                return InvoiceGenerationResult(
                    success=False,
                    error_message="Cannot determine facility from admission"
                )
            if not _billing_enabled(facility):
                return InvoiceGenerationResult(
                    success=False,
                    error_message="Billing feature is disabled"
                )

            # Collect services from admission
            service_lines = self._collect_admission_services(
                admission,
                include_daily_rate=include_daily_rate,
                include_services=include_services,
                include_amenities=include_amenities
            )

            if not service_lines:
                return InvoiceGenerationResult(
                    success=False,
                    error_message="No billable services found for admission"
                )

            # Get department from ward
            department = None
            if admission.bed and admission.bed.ward:
                department = admission.bed.ward.department

            # Create invoice
            result = self.create_invoice(
                patient=admission.patient,
                facility=facility,
                department=department,
                services=service_lines,
                admission=admission,
                created_by=created_by
            )

            if result.success:
                logger.info(
                    f"Generated discharge invoice {result.invoice.invoice_number} "
                    f"from admission {admission.id}"
                )

            return result

        except Exception as e:
            logger.exception(f"Error generating invoice from admission: {e}")
            return InvoiceGenerationResult(
                success=False,
                error_message=str(e)
            )

    @transaction.atomic
    def create_invoice(
        self,
        patient,
        facility,
        services: List[ServiceLine],
        created_by,
        department=None,
        encounter=None,
        admission=None,
        patient_insurance: Optional[PatientInsurance] = None,
        notes: Optional[str] = None
    ) -> InvoiceGenerationResult:
        """
        Create an invoice with line items.

        Args:
            patient: PatientProfile instance
            facility: Facility instance
            services: List of ServiceLine objects
            created_by: User creating the invoice
            department: Optional Department for department-specific pricing
            encounter: Optional Encounter for linking
            admission: Optional Admission for linking
            patient_insurance: Optional PatientInsurance for coverage
            notes: Optional invoice notes

        Returns:
            InvoiceGenerationResult with generated invoice or error
        """
        try:
            warnings = []
            if not _billing_enabled(facility):
                return InvoiceGenerationResult(
                    success=False,
                    error_message="Billing feature is disabled"
                )

            # Get facility billing settings
            billing_settings = self._get_billing_settings(facility)

            # Determine price context
            price_context = 'regular'
            is_emergency = False
            if encounter:
                is_emergency = getattr(encounter, 'is_emergency', False)
            if billing_settings:
                price_context = billing_settings.get_price_context(
                    is_emergency=is_emergency
                )

            # Get patient's active insurance if not specified
            if patient_insurance is None and _insurance_claims_enabled(facility):
                patient_insurance = self._get_active_insurance(patient)
            elif not _insurance_claims_enabled(facility):
                patient_insurance = None

            # Build patient context for rules engine
            patient_context = self._build_patient_context(patient, patient_insurance)

            # Build billing context
            billing_context = BillingContext(
                facility_id=str(facility.id),
                department_id=str(department.id) if department else None,
                encounter_type='inpatient' if admission else 'outpatient',
                timestamp=timezone.now(),
                is_emergency=is_emergency,
                price_context=price_context
            )

            # Generate invoice number
            invoice_number = self._generate_invoice_number(facility, billing_settings)

            # Calculate due date
            due_days = billing_settings.invoice_due_days if billing_settings else 30
            due_date = timezone.now().date() + timedelta(days=due_days)

            # Create invoice
            invoice = Invoice(
                invoice_number=invoice_number,
                patient=patient,
                facility=facility,
                department=department,
                encounter=encounter,
                admission=admission,
                invoice_date=timezone.now().date(),
                due_date=due_date,
                patient_insurance=patient_insurance,
                status='draft',
                price_context=price_context,
                notes=notes,
                created_by=created_by,
                updated_by=created_by
            )
            invoice.save()

            # Create line items with resolved prices
            subtotal = Decimal('0.00')
            tax_total = Decimal('0.00')

            for line in services:
                # Resolve price
                if line.unit_price is not None:
                    unit_price = line.unit_price
                    tax_rate = line.service.tax_rate
                else:
                    resolved = self.pricing_service.get_price(
                        service=line.service,
                        facility=facility,
                        department=department,
                        context=price_context
                    )
                    unit_price = resolved.price
                    tax_rate = resolved.tax_rate

                # Create line item
                item = InvoiceItem(
                    invoice=invoice,
                    service=line.service,
                    quantity=line.quantity,
                    unit_price=unit_price,
                    tax_rate=tax_rate,
                    description=line.description or line.service.name,
                    created_by=created_by,
                    updated_by=created_by
                )
                item.save()

                # Accumulate totals
                line_subtotal = unit_price * line.quantity
                line_tax = line_subtotal * (tax_rate / Decimal('100'))
                subtotal += line_subtotal
                tax_total += line_tax

            # Apply billing rules
            rules_result = self.rules_engine.evaluate(
                amount=subtotal,
                patient_context=patient_context,
                billing_context=billing_context,
                services=[line.service for line in services],
                quantity=sum(line.quantity for line in services)
            )

            # Update invoice with totals and adjustments
            invoice.subtotal = subtotal
            invoice.tax_amount = tax_total
            invoice.discount_amount = rules_result.total_discount

            # Calculate total
            total_amount = (
                rules_result.adjusted_amount + tax_total +
                rules_result.total_surcharge
            )
            invoice.total_amount = max(Decimal('0.00'), total_amount)

            # Store applied rules
            invoice.applied_rules = [
                adj.rule_id for adj in rules_result.applied_adjustments
            ]

            # Calculate insurance coverage
            if (
                _insurance_claims_enabled(facility)
                and patient_insurance
                and patient_insurance.is_valid
            ):
                coverage_pct = patient_insurance.plan.coverage_percentage / Decimal('100')
                invoice.insurance_amount = invoice.total_amount * coverage_pct
                invoice.patient_responsibility = (
                    invoice.total_amount - invoice.insurance_amount
                )
            else:
                invoice.insurance_amount = Decimal('0.00')
                invoice.patient_responsibility = invoice.total_amount

            # Finalize
            invoice.status = 'pending'
            invoice.save()

            # Add warnings for applied rules
            for adj in rules_result.applied_adjustments:
                warnings.append(
                    f"Applied {adj.rule_name}: {adj.description}"
                )

            return InvoiceGenerationResult(
                success=True,
                invoice=invoice,
                warnings=warnings
            )

        except Exception as e:
            logger.exception(f"Error creating invoice: {e}")
            return InvoiceGenerationResult(
                success=False,
                error_message=str(e)
            )

    # =========================================================================
    # Private Helper Methods
    # =========================================================================

    def _get_facility_from_encounter(self, encounter):
        """Get facility from encounter's ward/department."""
        # Try via admission
        if hasattr(encounter, 'admission') and encounter.admission:
            facility = self._get_facility_from_admission(encounter.admission)
            if facility:
                return facility

        # Try via ward
        if hasattr(encounter, 'ward') and encounter.ward:
            facility = getattr(encounter.ward, 'facility', None)
            if facility:
                return facility

        # Try via department
        if hasattr(encounter, 'department') and encounter.department:
            facility = getattr(encounter.department, 'facility', None)
            if facility:
                return facility

        # Try via practitioner -> primary_facility
        if hasattr(encounter, 'practitioner') and encounter.practitioner:
            if hasattr(encounter.practitioner, 'primary_facility'):
                facility = encounter.practitioner.primary_facility
                if facility:
                    return facility

        # Fallback to default facility (for single-facility setups)
        from apps.core.models import Facility
        return Facility.objects.filter(is_active=True).first()

    def _get_facility_from_admission(self, admission):
        """Get facility from admission's bed/ward."""
        if admission.bed and admission.bed.ward:
            return admission.bed.ward.facility
        return None

    def _get_department_from_encounter(self, encounter):
        """Get department from encounter if available."""
        if hasattr(encounter, 'department') and encounter.department:
            return encounter.department
        if hasattr(encounter, 'ward') and encounter.ward:
            return encounter.ward.department
        return None

    def _get_billing_settings(self, facility) -> Optional[FacilityBillingSettings]:
        """Get billing settings for facility."""
        try:
            return facility.billing_settings
        except FacilityBillingSettings.DoesNotExist:
            return None

    def _get_active_insurance(self, patient) -> Optional[PatientInsurance]:
        """Get patient's active insurance."""
        facility = getattr(patient, 'facility', None)
        if not _insurance_claims_enabled(facility):
            return None
        return patient.insurances.filter(
            is_active=True,
            valid_from__lte=timezone.now().date()
        ).filter(
            models.Q(valid_until__isnull=True) |
            models.Q(valid_until__gte=timezone.now().date())
        ).first() if hasattr(patient, 'insurances') else None

    def _build_patient_context(
        self, patient, patient_insurance
    ) -> PatientContext:
        """Build patient context for rules engine."""
        # Get date of birth
        dob = None
        if hasattr(patient, 'date_of_birth'):
            dob = patient.date_of_birth
        elif hasattr(patient, 'user') and hasattr(patient.user, 'date_of_birth'):
            dob = patient.user.date_of_birth

        # Check if staff member
        is_staff = False
        if hasattr(patient, 'user'):
            is_staff = getattr(patient.user, 'is_staff', False)

        # Check returning patient (previous invoices)
        visit_count = 0
        if hasattr(patient, 'invoices'):
            visit_count = patient.invoices.count()

        return PatientContext(
            patient_id=str(patient.id),
            date_of_birth=dob,
            is_staff_member=is_staff,
            is_returning_patient=visit_count > 0,
            has_insurance=patient_insurance is not None and patient_insurance.is_valid,
            insurance_provider_code=(
                patient_insurance.plan.provider.code
                if patient_insurance else None
            ),
            visit_count=visit_count
        )

    def _generate_invoice_number(
        self, facility, billing_settings
    ) -> str:
        """Generate a unique invoice number."""
        prefix = billing_settings.invoice_prefix if billing_settings else 'INV'
        number_length = billing_settings.invoice_number_length if billing_settings else 8

        # If settings exist, use its generator (backed by FacilityInvoiceSequence).
        if billing_settings:
            return billing_settings.generate_invoice_number()

        # Otherwise, use the facility sequence directly.
        from django.db import transaction
        with transaction.atomic():
            seq, _ = FacilityInvoiceSequence.objects.select_for_update().get_or_create(
                facility=facility,
                defaults={'next_number': 1}
            )
            next_number = int(seq.next_number)
            seq.next_number = next_number + 1
            seq.save(update_fields=['next_number', 'updated_at'])

        return f"{prefix}-{str(next_number).zfill(number_length)}"

    def _collect_encounter_services(
        self,
        encounter,
        include_labs: bool = True,
        include_prescriptions: bool = True,
        include_procedures: bool = True
    ) -> List[ServiceLine]:
        """Collect billable services from an encounter."""
        services = []

        # Add consultation fee if encounter has appointment type
        if hasattr(encounter, 'appointment_type') and encounter.appointment_type:
            if hasattr(encounter.appointment_type, 'service') and encounter.appointment_type.service:
                services.append(ServiceLine(
                    service=encounter.appointment_type.service,
                    quantity=1,
                    description="Consultation"
                ))

        # Fallback: Add default consultation fee based on encounter type
        if not services:
            consultation_service = self._get_default_consultation_service(encounter)
            if consultation_service:
                services.append(ServiceLine(
                    service=consultation_service,
                    quantity=1,
                    description=f"Consultation - {encounter.encounter_type or 'General'}"
                ))

        # Add lab orders
        if include_labs and hasattr(encounter, 'lab_orders'):
            for lab_order in encounter.lab_orders.all():
                if hasattr(lab_order, 'test') and hasattr(lab_order.test, 'service'):
                    services.append(ServiceLine(
                        service=lab_order.test.service,
                        quantity=1,
                        description=f"Lab: {lab_order.test.name}"
                    ))

        # Add prescriptions
        if include_prescriptions and hasattr(encounter, 'prescriptions'):
            for prescription in encounter.prescriptions.all():
                if hasattr(prescription, 'medication') and hasattr(prescription.medication, 'service'):
                    qty = getattr(prescription, 'quantity', 1) or 1
                    services.append(ServiceLine(
                        service=prescription.medication.service,
                        quantity=qty,
                        description=f"Rx: {prescription.medication.name}"
                    ))

        # Add procedures
        if include_procedures and hasattr(encounter, 'procedures'):
            for procedure in encounter.procedures.all():
                if hasattr(procedure, 'service'):
                    services.append(ServiceLine(
                        service=procedure.service,
                        quantity=1,
                        description=f"Procedure: {procedure.name}"
                    ))

        return services

    def _get_default_consultation_service(self, encounter) -> Optional[Service]:
        """
        Get a default consultation service based on encounter type.

        Falls back to generic consultation if no specific service found.
        """
        encounter_type = getattr(encounter, 'encounter_type', None)

        # Map encounter types to service codes
        service_code_map = {
            'ambulatory': 'CONSULT-GEN',
            'outpatient': 'CONSULT-GEN',
            'inpatient': 'CONSULT-GEN',
            'emergency': 'CONSULT-GEN',
            'specialist': 'CONSULT-SPEC',
        }

        # Try to find specific service
        if encounter_type:
            code = service_code_map.get(encounter_type.lower())
            if code:
                service = Service.objects.filter(code=code, is_active=True).first()
                if service:
                    return service

        # Fallback to any consultation service
        service = Service.objects.filter(
            code__icontains='CONSULT',
            is_active=True
        ).first()

        if service:
            return service

        # Last resort: any active service
        return Service.objects.filter(is_active=True).first()

    def _collect_admission_services(
        self,
        admission,
        include_daily_rate: bool = True,
        include_services: bool = True,
        include_amenities: bool = True
    ) -> List[ServiceLine]:
        """Collect billable services from an admission."""
        services = []

        # Calculate length of stay
        admission_date = admission.admission_date if hasattr(admission, 'admission_date') else None
        discharge_date = admission.discharge_date if hasattr(admission, 'discharge_date') else timezone.now().date()

        if admission_date and discharge_date:
            los = (discharge_date - admission_date).days
            los = max(1, los)  # Minimum 1 day
        else:
            los = 1

        # Add daily bed rate
        if include_daily_rate:
            if admission.bed and admission.bed.ward:
                ward = admission.bed.ward
                if hasattr(ward, 'daily_rate_service') and ward.daily_rate_service:
                    services.append(ServiceLine(
                        service=ward.daily_rate_service,
                        quantity=los,
                        description=f"Ward stay: {ward.name} ({los} days)"
                    ))

        # Add services rendered during stay
        if include_services:
            # Get services from any encounters during admission
            if hasattr(admission, 'encounters'):
                for encounter in admission.encounters.all():
                    encounter_services = self._collect_encounter_services(
                        encounter,
                        include_labs=True,
                        include_prescriptions=True,
                        include_procedures=True
                    )
                    services.extend(encounter_services)

        # Add amenity charges
        if include_amenities:
            if admission.bed and hasattr(admission.bed, 'amenity_service'):
                if admission.bed.amenity_service:
                    services.append(ServiceLine(
                        service=admission.bed.amenity_service,
                        quantity=los,
                        description=f"Amenities ({los} days)"
                    ))

        return services
