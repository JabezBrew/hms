from celery import shared_task
from django.core.cache import cache
from apps.fhir_client.client import fhir_client
from apps.core.cache_utils import facility_cache_key
from hms_backend.tenancy import facility_task
from .models import PatientFHIRMapping
import logging

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=3)
@facility_task
def sync_patient_with_fhir(self, mapping_id, facility_code=None):
    """
    Background task to sync patient data with FHIR server.
    """
    try:
        mapping = PatientFHIRMapping.objects.select_related('patient_profile__user').get(id=mapping_id)

        # Get the FHIR resource
        fhir_patient = fhir_client.get_resource("Patient", mapping.fhir_patient_id)

        # Update the mapping with the latest version
        mapping.fhir_resource_version = fhir_patient.get("meta", {}).get("versionId")
        mapping.is_synced = True
        mapping.last_synced = fhir_patient.get("meta", {}).get("lastUpdated")
        mapping.save()

        # Invalidate cache
        cache_key = facility_cache_key(f'patient_fhir_{mapping.patient_profile.id}')
        cache.delete(cache_key)

        logger.info(f"Successfully synced patient {mapping.patient_profile.id} with FHIR")
        return {"status": "success", "patient_id": str(mapping.patient_profile.id)}

    except PatientFHIRMapping.DoesNotExist:
        logger.error(f"Patient FHIR mapping {mapping_id} not found")
        return {"status": "error", "message": "Mapping not found"}

    except Exception as e:
        logger.error(f"Error syncing patient with FHIR: {str(e)}")
        # Retry the task
        raise self.retry(exc=e, countdown=60)


@shared_task
@facility_task
def bulk_sync_patients_with_fhir(patient_ids, facility_code=None):
    """
    Background task to sync multiple patients with FHIR server.
    """
    results = []
    for patient_id in patient_ids:
        try:
            mapping = PatientFHIRMapping.objects.get(patient_profile_id=patient_id)
            result = sync_patient_with_fhir.delay(str(mapping.id), facility_code=facility_code)
            results.append({"patient_id": patient_id, "task_id": result.id})
        except PatientFHIRMapping.DoesNotExist:
            results.append({"patient_id": patient_id, "status": "no_mapping"})

    return results


@shared_task
@facility_task
def log_patient_search(user_id, search_query, facility_code=None):
    """
    Background task to log patient search queries.
    Moved to background to avoid blocking the search response.
    """
    from .models import PatientSearch
    from apps.users.models import User
    from apps.core.models import Facility

    try:
        user = User.objects.get(id=user_id)
        facility = None
        if facility_code:
            facility = Facility.objects.filter(code=str(facility_code).strip().upper()).first()
        if not facility:
            facility = getattr(user, 'primary_facility', None)
        if not facility:
            logger.warning(f"Facility {facility_code} not found when logging search")
            return
        PatientSearch.objects.create(user=user, search_query=search_query, facility=facility)
        logger.debug(f"Search logged for user {user_id}: {search_query[:50]}")
    except User.DoesNotExist:
        logger.warning(f"User {user_id} not found when logging search")
    except Exception as e:
        logger.error(f"Error logging patient search: {str(e)}")
