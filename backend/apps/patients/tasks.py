from celery import shared_task
import hashlib
from django.core.cache import cache
from apps.fhir_client.client import fhir_client
from apps.fhir_client.utils import project_fhir_patient
from apps.core.cache_utils import facility_cache_key
from hms_backend.tenancy import facility_task
from .models import PatientFHIRMapping
from apps.users.models import PatientProfile, User
from apps.fhir_client.utils import (
    create_human_name,
    create_identifier,
    create_contact_point,
    create_address,
    generate_fhir_id,
)
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

        # Cache a minimal snapshot for safe, fast reads
        snapshot_key = facility_cache_key(f'fhir_patient_snapshot_{mapping.patient_profile.id}')
        cache.set(snapshot_key, project_fhir_patient(fhir_patient), timeout=300)

        logger.info("Successfully synced patient with FHIR")
        return {"status": "success", "patient_id": str(mapping.patient_profile.id)}

    except PatientFHIRMapping.DoesNotExist:
        logger.error("Patient FHIR mapping not found")
        return {"status": "error", "message": "Mapping not found"}

    except Exception as e:
        logger.error("Error syncing patient with FHIR")
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


@shared_task(bind=True, max_retries=3)
@facility_task
def search_patients_in_fhir(self, query, user_id, existing_ids=None, facility_code=None):
    """
    Background task to search FHIR for patients and cache minimal results.
    """
    try:
        existing_ids = set(existing_ids or [])
        search_params = {"name": query, "_sort": "family", "_count": 10}
        fhir_results = fhir_client.search_resources("Patient", search_params, timeout=2)

        if "entry" not in fhir_results or not fhir_results.get("entry"):
            fhir_results = fhir_client.search_resources(
                "Patient",
                {"identifier": query, "_count": 10},
                timeout=2
            )

        fhir_patients = []
        entries = fhir_results.get("entry", []) or []
        for entry in entries:
            resource = entry.get("resource", {})
            fhir_id = resource.get("id")
            local_id = None
            if fhir_id:
                mapping = PatientFHIRMapping.objects.filter(fhir_patient_id=fhir_id).first()
                if mapping:
                    local_id = str(mapping.patient_profile_id)
                    if local_id in existing_ids:
                        continue
            fhir_patients.append({
                "fhir_resource": project_fhir_patient(resource),
                "local_id": local_id
            })

        query_hash = hashlib.md5(query.encode()).hexdigest()
        cache_key = facility_cache_key(f'fhir_patient_search_{user_id}_{query_hash}')
        cache.set(cache_key, fhir_patients, timeout=60)
        return {"status": "success", "count": len(fhir_patients)}
    except Exception as e:
        logger.error("Error searching patients in FHIR")
        raise self.retry(exc=e, countdown=60)


@shared_task(bind=True, max_retries=3)
@facility_task
def update_patient_in_fhir(self, mapping_id, update_payload, facility_code=None):
    """
    Background task to update patient data in FHIR.
    """
    try:
        mapping = PatientFHIRMapping.objects.select_related('patient_profile').get(id=mapping_id)
        fhir_patient = fhir_client.get_resource("Patient", mapping.fhir_patient_id)
        if not fhir_patient:
            raise ValueError("FHIR patient not found")

        # Merge allowed fields into the current resource
        for key, value in (update_payload or {}).items():
            fhir_patient[key] = value

        fhir_patient["id"] = mapping.fhir_patient_id
        fhir_patient["resourceType"] = "Patient"

        updated = fhir_client.update_resource("Patient", mapping.fhir_patient_id, fhir_patient)

        mapping.fhir_resource_version = updated.get("meta", {}).get("versionId")
        mapping.is_synced = True
        mapping.save(update_fields=['fhir_resource_version', 'is_synced', 'updated_at'])

        snapshot_key = facility_cache_key(f'fhir_patient_snapshot_{mapping.patient_profile.id}')
        cache.set(snapshot_key, project_fhir_patient(updated), timeout=300)
        return {"status": "success"}
    except Exception as e:
        logger.error("Error updating patient in FHIR")
        raise self.retry(exc=e, countdown=60)


@shared_task(bind=True, max_retries=3)
@facility_task
def delete_patient_in_fhir(self, fhir_patient_id, facility_code=None):
    """
    Background task to delete a patient in FHIR.
    """
    try:
        if not fhir_patient_id:
            return {"status": "skipped"}
        fhir_client.delete_resource("Patient", fhir_patient_id)
        return {"status": "success"}
    except Exception as e:
        logger.error("Error deleting patient in FHIR")
        raise self.retry(exc=e, countdown=60)


@shared_task(bind=True, max_retries=3)
@facility_task
def create_patient_in_fhir(self, patient_profile_id, address_fields=None, requested_by_user_id=None, facility_code=None):
    """
    Background task to create a patient in FHIR and establish mapping.
    """
    try:
        patient_profile = PatientProfile.objects.select_related('user').get(id=patient_profile_id)
        user = patient_profile.user
        if not user:
            raise ValueError("Patient user missing")

        address_fields = address_fields or {}

        fhir_patient_data = {
            "resourceType": "Patient",
            "id": generate_fhir_id(),
            "active": True,
            "name": [
                create_human_name(
                    family=user.last_name,
                    given=[user.first_name]
                )
            ],
            "identifier": [
                create_identifier(
                    system="http://hospital.example.org/fhir/identifier/mrn",
                    value=patient_profile.medical_record_number
                )
            ],
            "birthDate": user.date_of_birth.isoformat() if user.date_of_birth else None
        }

        if user.phone_number:
            fhir_patient_data["telecom"] = [
                create_contact_point(
                    system="phone",
                    value=user.phone_number,
                    use="home"
                )
            ]

        if any(address_fields.values()):
            lines = [address_fields.get('address_line1')] if address_fields.get('address_line1') else []
            if address_fields.get('address_line2'):
                lines.append(address_fields.get('address_line2'))

            fhir_patient_data["address"] = [
                create_address(
                    line=lines,
                    city=address_fields.get('city', ''),
                    state=address_fields.get('state', ''),
                    postalCode=address_fields.get('postal_code', ''),
                    country=address_fields.get('country', '')
                )
            ]

        fhir_patient = fhir_client.create_resource("Patient", fhir_patient_data)

        created_by = None
        if requested_by_user_id:
            created_by = User.objects.filter(id=requested_by_user_id).first()

        mapping, _ = PatientFHIRMapping.objects.get_or_create(
            patient_profile=patient_profile,
            defaults={
                'fhir_patient_id': fhir_patient["id"],
                'fhir_resource_version': fhir_patient.get("meta", {}).get("versionId"),
                'created_by': created_by,
                'updated_by': created_by,
            }
        )
        if mapping.fhir_patient_id != fhir_patient["id"]:
            mapping.fhir_patient_id = fhir_patient["id"]
            mapping.fhir_resource_version = fhir_patient.get("meta", {}).get("versionId")
            mapping.is_synced = True
            mapping.updated_by = created_by
            mapping.save(update_fields=['fhir_patient_id', 'fhir_resource_version', 'is_synced', 'updated_by', 'updated_at'])

        patient_profile.fhir_patient_id = fhir_patient["id"]
        patient_profile.save(update_fields=['fhir_patient_id'])

        snapshot_key = facility_cache_key(f'fhir_patient_snapshot_{patient_profile.id}')
        cache.set(snapshot_key, project_fhir_patient(fhir_patient), timeout=300)
        return {"status": "success"}
    except Exception as e:
        logger.error("Error creating patient in FHIR")
        raise self.retry(exc=e, countdown=60)


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

    normalized_search_query = " ".join(str(search_query or "").split())[:255]
    if not normalized_search_query:
        normalized_search_query = "patient-search filters=none"
    if not normalized_search_query.startswith(("patient-search ", "patient-registration ")):
        normalized_search_query = "patient-search filters=legacy-input"

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
        PatientSearch.objects.create(
            user=user,
            search_query=normalized_search_query,
            facility=facility,
        )
        logger.debug("Search history logged for user %s", user_id)
    except User.DoesNotExist:
        logger.warning(f"User {user_id} not found when logging search")
    except Exception as e:
        logger.error(f"Error logging patient search: {str(e)}")
