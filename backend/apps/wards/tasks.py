"""
Celery tasks for the wards app.

Includes background FHIR synchronization for encounters.
"""
from celery import shared_task
import logging
from django.utils import timezone

logger = logging.getLogger(__name__)


@shared_task(
    name='apps.wards.tasks.sync_encounter_to_fhir',
    bind=True,
    max_retries=3,
    default_retry_delay=60,  # 1 minute between retries
)
def sync_encounter_to_fhir(self, encounter_id: str):
    """
    Sync a local Encounter to FHIR server in the background.

    This task is queued whenever an encounter is created or updated.
    It converts the local encounter to FHIR format and pushes it to
    the Google Cloud Healthcare API.

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

    except Exception as e:
        error_msg = str(e)
        logger.error(f"FHIR sync failed for encounter {encounter_id}: {error_msg}")

        # Save the error
        encounter.fhir_sync_error = error_msg
        encounter.save(update_fields=['fhir_sync_error'])

        # Retry the task
        raise self.retry(exc=e)


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
