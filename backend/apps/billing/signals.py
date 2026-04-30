"""
Billing signals for the financial layer.

Draft invoice auto-sync:
- Encounter status transitions drive draft sync (in-progress) and finalization (finished).
- Admission status transitions drive draft sync while the stay is active (`admitted`).
- Pending discharge invoice freezing is handled explicitly by the discharge workflow.
- LabOrderTest updates trigger draft invoice resync for the linked encounter.

Signals respect facility billing settings:
- auto_generate_invoice_on_encounter_complete
- auto_generate_invoice_on_discharge

SECURITY:
- Never log PHI.
PERF:
- Enqueue async tasks and use transaction.on_commit to avoid blocking request paths.
"""
import logging

from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver
from hms_backend.deployment import feature_enabled

logger = logging.getLogger(__name__)


def _billing_enabled(facility=None):
    return bool(feature_enabled('billing', facility=facility))


@receiver(
    post_save,
    sender='encounters.Encounter',
    dispatch_uid='billing_encounter_completion',
)
def handle_encounter_completion(sender, instance, **kwargs):
    """
    Maintain a draft invoice during the encounter, then finalize on completion.

    - status == 'in-progress': ensure draft invoice exists and is synced (async)
    - status == 'finished': finalize the draft invoice (async)
    """
    status = getattr(instance, 'status', None)
    if status not in ('in-progress', 'finished'):
        return

    try:
        facility = getattr(instance, 'facility', None)

        if not facility:
            logger.warning(
                f"Cannot generate invoice for encounter {instance.id}: "
                "No facility found"
            )
            return
        if not _billing_enabled(facility):
            return

        from apps.billing.models import FacilityBillingSettings

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

        from apps.billing.tasks import (
            sync_draft_invoice_for_encounter,
            finalize_draft_invoice_for_encounter,
        )

        def _enqueue():
            if status == 'in-progress':
                sync_draft_invoice_for_encounter.delay(str(instance.id))
            elif status == 'finished':
                finalize_draft_invoice_for_encounter.delay(str(instance.id))

        # Avoid enqueuing work before the transaction commits.
        try:
            transaction.on_commit(_enqueue)
        except Exception:
            _enqueue()

    except Exception as e:
        logger.exception(
            f"Error in encounter completion handler for {instance.id}: {e}"
        )


@receiver(
    post_save,
    sender='wards.Admission',
    dispatch_uid='billing_discharge',
)
def handle_discharge(sender, instance, **kwargs):
    """
    Maintain a draft invoice while the admission is actively admitted.

    Billing freeze/finalization for pending discharge is explicit in the discharge
    workflow and should not be retriggered by the final ward discharge transition.
    """
    status = getattr(instance, 'status', None)
    if status != 'admitted':
        return

    try:
        # Get facility from admission
        facility = getattr(instance, 'facility', None)

        if not facility:
            logger.warning(
                f"Cannot generate discharge bill for admission {instance.id}: "
                "No facility found"
            )
            return
        if not _billing_enabled(facility):
            return

        from apps.billing.models import FacilityBillingSettings
        from apps.billing.tasks import sync_draft_invoice_for_admission

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

        def _enqueue():
            sync_draft_invoice_for_admission.delay(str(instance.id))

        try:
            transaction.on_commit(_enqueue)
        except Exception:
            _enqueue()

    except Exception as e:
        logger.exception(
            f"Error in discharge handler for {instance.id}: {e}"
        )


@receiver(
    post_save,
    sender='laboratory.LabOrderTest',
    dispatch_uid='billing_lab_order_test_update',
)
def handle_lab_order_test_update(sender, instance, **kwargs):
    """
    Sync the encounter draft invoice when a lab test status changes.
    """
    order = getattr(instance, 'order', None)
    encounter = getattr(order, 'encounter', None) if order else None
    if not encounter:
        return
    facility = getattr(encounter, 'facility', None) or getattr(order, 'facility', None)
    if not _billing_enabled(facility):
        return
    if not feature_enabled('laboratory', facility=facility):
        return

    from apps.billing.tasks import sync_draft_invoice_for_encounter

    def _enqueue():
        sync_draft_invoice_for_encounter.delay(str(encounter.id))

    try:
        transaction.on_commit(_enqueue)
    except Exception:
        _enqueue()
