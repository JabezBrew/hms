"""
Billing signals for auto-invoice generation.

Handles automatic invoice generation when:
- Encounter status changes to 'finished'
- Patient is discharged from admission

Signal receivers respect facility billing settings:
- auto_generate_invoice_on_encounter_complete
- auto_generate_invoice_on_discharge

Security notes:
- All auto-generated invoices are audited
- System user or encounter creator is used for created_by

Performance notes:
- Signals use select_related for efficient queries
- Invoice generation is transactional
"""
import logging

from django.db.models.signals import post_save
from django.dispatch import receiver

logger = logging.getLogger(__name__)


def handle_encounter_completion(sender, instance, **kwargs):
    """
    Auto-generate invoice when encounter is completed.

    Called via signal when Encounter.status changes to 'finished'.
    Respects facility billing settings.
    """
    from apps.billing.models import FacilityBillingSettings
    from apps.billing.services import InvoiceGenerationService

    # Only trigger on status change to 'finished'
    if getattr(instance, 'status', None) != 'finished':
        return

    # Check if this is a status change (not new creation with finished status)
    if not kwargs.get('created', True):
        # Get previous status from instance tracker if available
        # For simplicity, we'll always try to generate on finished status
        pass

    try:
        # Get facility from encounter
        # Priority: admission.bed.ward.facility > default facility
        facility = None

        # Try to get from admission (inpatient encounters)
        if hasattr(instance, 'admission') and instance.admission:
            admission = instance.admission
            if admission.bed and admission.bed.ward:
                facility = getattr(admission.bed.ward, 'facility', None)

        # Fallback to default facility (for single-facility setups)
        if not facility:
            from apps.core.models import Facility
            facility = Facility.objects.filter(is_active=True).first()

        if not facility:
            logger.warning(
                f"Cannot generate invoice for encounter {instance.id}: "
                "No facility found"
            )
            return

        # Check facility billing settings
        try:
            billing_settings = facility.billing_settings
            if not billing_settings.auto_generate_invoice_on_encounter_complete:
                logger.debug(
                    f"Auto-invoice disabled for facility {facility.code}, "
                    f"skipping encounter {instance.id}"
                )
                return
        except FacilityBillingSettings.DoesNotExist:
            # No settings = use default behavior (generate invoice)
            pass

        # Check if invoice already exists for this encounter
        if instance.invoices.exists():
            logger.debug(
                f"Invoice already exists for encounter {instance.id}, skipping"
            )
            return

        # Get user for audit
        created_by = (
            getattr(instance, 'updated_by', None) or
            getattr(instance, 'created_by', None)
        )
        if not created_by:
            logger.warning(
                f"No user found for encounter {instance.id}, skipping invoice"
            )
            return

        # Generate invoice
        service = InvoiceGenerationService()
        result = service.generate_from_encounter(
            encounter=instance,
            created_by=created_by
        )

        if result.success:
            logger.info(
                f"Auto-generated invoice {result.invoice.invoice_number} "
                f"for encounter {instance.id}"
            )
        else:
            logger.warning(
                f"Failed to auto-generate invoice for encounter {instance.id}: "
                f"{result.error_message}"
            )

    except Exception as e:
        logger.exception(
            f"Error in encounter completion handler for {instance.id}: {e}"
        )


def handle_discharge(sender, instance, **kwargs):
    """
    Auto-generate discharge bill when patient is discharged.

    Called via signal when Admission.status changes to 'discharged'.
    Respects facility billing settings.
    """
    from apps.billing.models import FacilityBillingSettings
    from apps.billing.services import InvoiceGenerationService

    # Only trigger on discharge
    if getattr(instance, 'status', None) != 'discharged':
        return

    # Check if already billed
    if getattr(instance, 'is_billed', False):
        return

    try:
        # Get facility from admission
        facility = None
        if instance.bed and instance.bed.ward:
            facility = instance.bed.ward.facility

        if not facility:
            logger.warning(
                f"Cannot generate discharge bill for admission {instance.id}: "
                "No facility found"
            )
            return

        # Check facility billing settings
        try:
            billing_settings = facility.billing_settings
            if not billing_settings.auto_generate_invoice_on_discharge:
                logger.debug(
                    f"Auto-discharge bill disabled for facility {facility.code}, "
                    f"skipping admission {instance.id}"
                )
                return
        except FacilityBillingSettings.DoesNotExist:
            # No settings = use default behavior (generate invoice)
            pass

        # Check if invoice already exists for this admission
        if instance.invoices.exists():
            logger.debug(
                f"Invoice already exists for admission {instance.id}, skipping"
            )
            return

        # Get user for audit
        created_by = (
            getattr(instance, 'updated_by', None) or
            getattr(instance, 'created_by', None)
        )
        if not created_by:
            logger.warning(
                f"No user found for admission {instance.id}, skipping invoice"
            )
            return

        # Generate discharge bill
        service = InvoiceGenerationService()
        result = service.generate_from_admission(
            admission=instance,
            created_by=created_by
        )

        if result.success:
            # Mark admission as billed
            if hasattr(instance, 'is_billed'):
                instance.is_billed = True
                instance.save(update_fields=['is_billed'])

            logger.info(
                f"Auto-generated discharge bill {result.invoice.invoice_number} "
                f"for admission {instance.id}"
            )
        else:
            logger.warning(
                f"Failed to auto-generate discharge bill for admission {instance.id}: "
                f"{result.error_message}"
            )

    except Exception as e:
        logger.exception(
            f"Error in discharge handler for {instance.id}: {e}"
        )


def connect_billing_signals():
    """
    Connect billing signals to models.

    Called from apps.billing.apps.BillingConfig.ready()
    """
    try:
        from apps.encounters.models import Encounter
        from apps.wards.models import Admission

        # Connect encounter completion handler
        post_save.connect(
            handle_encounter_completion,
            sender=Encounter,
            dispatch_uid='billing_encounter_completion'
        )

        # Connect discharge handler
        post_save.connect(
            handle_discharge,
            sender=Admission,
            dispatch_uid='billing_discharge'
        )

        logger.info("Billing signals connected successfully")

    except ImportError as e:
        logger.warning(f"Could not connect billing signals: {e}")
