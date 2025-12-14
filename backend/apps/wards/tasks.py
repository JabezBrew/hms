"""
Celery tasks for the wards app.

Includes background FHIR synchronization for encounters and
automatic encounter lifecycle management.
"""
from celery import shared_task
import logging
from datetime import timedelta
from django.utils import timezone

from apps.core.retry import EXTERNAL_API_CONFIG
from apps.core.circuit_breaker import CircuitOpenError

logger = logging.getLogger(__name__)


@shared_task(
    name='apps.wards.tasks.sync_encounter_to_fhir',
    bind=True,
    max_retries=EXTERNAL_API_CONFIG.max_retries,
)
def sync_encounter_to_fhir(self, encounter_id: str):
    """
    Sync a local Encounter to FHIR server in the background.

    This task is queued whenever an encounter is created or updated.
    It converts the local encounter to FHIR format and pushes it to
    the Google Cloud Healthcare API.

    Uses:
    - Exponential backoff for retries
    - Circuit breaker to handle FHIR service outages gracefully

    Args:
        encounter_id: UUID of the local Encounter to sync

    Returns:
        dict: Result of the sync operation
    """
    from .models import Encounter
    from .proxies import EncounterProxy
    from ..fhir_client.client import fhir_client

    logger.info(f"Starting FHIR sync for encounter {encounter_id}")

    try:
        encounter = Encounter.objects.select_related(
            'patient',
            'patient__user',
            'practitioner',
            'practitioner__staff',
            'practitioner__staff__user',
        ).get(id=encounter_id)
    except Encounter.DoesNotExist:
        logger.error(f"Encounter {encounter_id} not found")
        return {'status': 'error', 'message': 'Encounter not found'}

    try:
        # Build FHIR Encounter resource
        fhir_resource = _build_fhir_encounter(encounter)

        if encounter.fhir_id:
            # Update existing FHIR resource
            fhir_client.update_resource('Encounter', encounter.fhir_id, fhir_resource)
            logger.info(f"Updated FHIR Encounter {encounter.fhir_id}")
        else:
            # Create new FHIR resource
            result = fhir_client.create_resource('Encounter', fhir_resource)
            encounter.fhir_id = result.get('id')
            logger.info(f"Created FHIR Encounter {encounter.fhir_id}")

        # Mark as synced
        encounter.fhir_synced = True
        encounter.fhir_last_synced = timezone.now()
        encounter.fhir_sync_error = None
        encounter.save(update_fields=['fhir_id', 'fhir_synced', 'fhir_last_synced', 'fhir_sync_error'])

        return {
            'status': 'success',
            'encounter_id': str(encounter_id),
            'fhir_id': encounter.fhir_id,
        }

    except CircuitOpenError as e:
        # Circuit breaker is open - FHIR service is unavailable
        # Don't retry immediately, let the circuit breaker handle recovery
        error_msg = f"FHIR service unavailable (circuit open): {str(e)}"
        logger.warning(f"FHIR sync deferred for encounter {encounter_id}: {error_msg}")

        encounter.fhir_sync_error = error_msg
        encounter.save(update_fields=['fhir_sync_error'])

        # Retry after circuit breaker reset timeout (60s)
        raise self.retry(exc=e, countdown=60)

    except Exception as e:
        error_msg = str(e)
        logger.error(f"FHIR sync failed for encounter {encounter_id}: {error_msg}")

        # Save the error
        encounter.fhir_sync_error = error_msg
        encounter.save(update_fields=['fhir_sync_error'])

        # Retry with exponential backoff
        raise self.retry(
            exc=e,
            countdown=EXTERNAL_API_CONFIG.get_countdown(self.request.retries)
        )


@shared_task(name='apps.wards.tasks.sync_pending_encounters')
def sync_pending_encounters(batch_size: int = 50):
    """
    Sync all pending (un-synced) encounters to FHIR.

    This task can be scheduled to run periodically to ensure all
    encounters eventually get synced, even if the initial sync failed.

    Args:
        batch_size: Maximum number of encounters to sync in one batch

    Returns:
        dict: Summary of sync results
    """
    from .models import Encounter

    pending = Encounter.objects.filter(fhir_synced=False).order_by('created_at')[:batch_size]

    results = {
        'total': pending.count(),
        'success': 0,
        'failed': 0,
    }

    for encounter in pending:
        try:
            sync_encounter_to_fhir(str(encounter.id))
            results['success'] += 1
        except Exception as e:
            logger.error(f"Failed to sync encounter {encounter.id}: {e}")
            results['failed'] += 1

    logger.info(f"Pending encounter sync complete: {results}")
    return results


def _build_fhir_encounter(encounter):
    """
    Convert a local Encounter model to FHIR Encounter resource format.

    Args:
        encounter: Local Encounter model instance

    Returns:
        dict: FHIR Encounter resource
    """
    # Map encounter type to FHIR class code
    class_map = {
        'inpatient': {'code': 'IMP', 'display': 'inpatient encounter'},
        'outpatient': {'code': 'AMB', 'display': 'ambulatory'},
        'emergency': {'code': 'EMER', 'display': 'emergency'},
    }
    class_code = class_map.get(encounter.encounter_type, class_map['outpatient'])

    # Get patient FHIR ID
    patient_fhir_id = getattr(encounter.patient, 'fhir_patient_id', None) or str(encounter.patient.id)
    patient_name = encounter.patient_name

    # Build the resource
    fhir_resource = {
        'resourceType': 'Encounter',
        'status': encounter.status,
        'class': {
            'system': 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
            'code': class_code['code'],
            'display': class_code['display'],
        },
        'subject': {
            'reference': f'Patient/{patient_fhir_id}',
            'display': patient_name,
        },
        'period': {
            'start': encounter.start_time.isoformat(),
        },
    }

    # Add end time if present
    if encounter.end_time:
        fhir_resource['period']['end'] = encounter.end_time.isoformat()

    # Add practitioner if present
    if encounter.practitioner:
        practitioner_fhir_id = getattr(encounter.practitioner, 'fhir_practitioner_id', None) or str(encounter.practitioner.id)
        fhir_resource['participant'] = [{
            'type': [{
                'coding': [{
                    'system': 'http://terminology.hl7.org/CodeSystem/v3-ParticipationType',
                    'code': 'ATND',
                    'display': 'attender',
                }]
            }],
            'individual': {
                'reference': f'Practitioner/{practitioner_fhir_id}',
                'display': encounter.practitioner_name,
            }
        }]

    # Add reason if present
    if encounter.reason:
        fhir_resource['reasonCode'] = [{'text': encounter.reason}]

    # Add service type if present
    if encounter.service_type:
        fhir_resource['serviceType'] = {
            'coding': [{
                'system': 'http://terminology.hl7.org/CodeSystem/service-type',
                'code': '124',
                'display': encounter.service_type,
            }],
            'text': encounter.service_type,
        }

    # Add location if present
    if encounter.location:
        fhir_resource['location'] = [{
            'status': 'active',
            'location': {'display': encounter.location},
        }]

    # Add hospitalization details for inpatient
    if encounter.encounter_type == 'inpatient':
        hospitalization = {}
        if encounter.admission_source:
            hospitalization['admitSource'] = {
                'coding': [{
                    'system': 'http://terminology.hl7.org/CodeSystem/admit-source',
                    'code': encounter.admission_source,
                }]
            }
        if encounter.discharge_disposition:
            hospitalization['dischargeDisposition'] = {
                'coding': [{
                    'system': 'http://terminology.hl7.org/CodeSystem/discharge-disposition',
                    'code': encounter.discharge_disposition,
                }]
            }
        if encounter.destination:
            hospitalization['destination'] = {'display': encounter.destination}

        if hospitalization:
            fhir_resource['hospitalization'] = hospitalization

    # Use existing FHIR ID if present
    if encounter.fhir_id:
        fhir_resource['id'] = encounter.fhir_id

    return fhir_resource


# ============================================================================
# Encounter Lifecycle Management Tasks
# ============================================================================

@shared_task(name='apps.wards.tasks.close_stale_outpatient_encounters')
def close_stale_outpatient_encounters():
    """
    Close outpatient encounters that are still in-progress from previous days.

    Outpatient encounters should typically be completed within the same day.
    This task runs daily to automatically close any encounters that were
    left open, ensuring clean encounter records.

    Schedule: Run daily at midnight or early morning.

    Returns:
        dict: Summary of closed encounters
    """
    from .models import Encounter

    yesterday = timezone.now().date() - timedelta(days=1)

    stale_encounters = Encounter.objects.filter(
        encounter_type='outpatient',
        status='in-progress',
        start_time__date__lte=yesterday
    )

    count = stale_encounters.count()
    closed = 0
    errors = 0

    for encounter in stale_encounters:
        try:
            # Set end_time to end of the day the encounter started
            end_of_day = timezone.make_aware(
                timezone.datetime.combine(
                    encounter.start_time.date(),
                    timezone.datetime.max.time().replace(microsecond=0)
                )
            )

            encounter.status = 'finished'
            encounter.end_time = end_of_day
            encounter.fhir_synced = False  # Mark for re-sync
            encounter.save(update_fields=['status', 'end_time', 'fhir_synced', 'updated_at'])
            closed += 1

            logger.info(f"Auto-closed stale encounter {encounter.id} from {encounter.start_time.date()}")
        except Exception as e:
            errors += 1
            logger.error(f"Failed to close stale encounter {encounter.id}: {e}")

    results = {
        'found': count,
        'closed': closed,
        'errors': errors,
    }

    logger.info(f"Stale outpatient encounter cleanup complete: {results}")
    return results


@shared_task(name='apps.wards.tasks.close_stale_emergency_encounters')
def close_stale_emergency_encounters(hours: int = 24):
    """
    Close emergency encounters that have been in-progress for too long.

    Emergency encounters typically shouldn't last more than 24 hours.
    After that, patients are either discharged or admitted as inpatients.

    Args:
        hours: Maximum hours before an emergency encounter is considered stale

    Returns:
        dict: Summary of closed encounters
    """
    from .models import Encounter

    cutoff_time = timezone.now() - timedelta(hours=hours)

    stale_encounters = Encounter.objects.filter(
        encounter_type='emergency',
        status='in-progress',
        start_time__lte=cutoff_time
    )

    count = stale_encounters.count()
    closed = 0
    errors = 0

    for encounter in stale_encounters:
        try:
            encounter.status = 'finished'
            encounter.end_time = encounter.start_time + timedelta(hours=hours)
            encounter.fhir_synced = False
            encounter.save(update_fields=['status', 'end_time', 'fhir_synced', 'updated_at'])
            closed += 1

            logger.info(f"Auto-closed stale emergency encounter {encounter.id}")
        except Exception as e:
            errors += 1
            logger.error(f"Failed to close stale emergency encounter {encounter.id}: {e}")

    results = {
        'found': count,
        'closed': closed,
        'errors': errors,
    }

    logger.info(f"Stale emergency encounter cleanup complete: {results}")
    return results


@shared_task(name='apps.wards.tasks.cleanup_encounters_daily')
def cleanup_encounters_daily():
    """
    Daily cleanup task that runs all encounter maintenance operations.

    This is a convenience task that runs:
    - close_stale_outpatient_encounters
    - close_stale_emergency_encounters
    - sync_pending_encounters

    Schedule: Run daily at 2 AM local time.

    Returns:
        dict: Combined results from all cleanup operations
    """
    outpatient_results = close_stale_outpatient_encounters()
    emergency_results = close_stale_emergency_encounters()
    sync_results = sync_pending_encounters()

    return {
        'outpatient_cleanup': outpatient_results,
        'emergency_cleanup': emergency_results,
        'fhir_sync': sync_results,
    }
