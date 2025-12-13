"""
FHIR Synchronization for Drug Safety Models
Maps drug safety data to FHIR AllergyIntolerance resources
"""
import logging
from datetime import datetime
from typing import Dict, Optional
from apps.fhir_client.client import fhir_client
from .models import PatientAllergy

logger = logging.getLogger(__name__)


def map_allergy_to_fhir(allergy: PatientAllergy) -> Dict:
    """
    Map PatientAllergy model to FHIR AllergyIntolerance resource.

    FHIR Resource: http://hl7.org/fhir/allergyintolerance.html

    Args:
        allergy: PatientAllergy instance

    Returns:
        Dict representing FHIR AllergyIntolerance resource
    """
    # Map severity
    severity_map = {
        'mild': 'mild',
        'moderate': 'moderate',
        'severe': 'severe',
        'life_threatening': 'severe',  # FHIR doesn't have life-threatening
    }

    # Map category
    category_map = {
        'medication': 'medication',
        'food': 'food',
        'environment': 'environment',
        'biologic': 'biologic',
    }

    # Build FHIR resource
    resource = {
        'resourceType': 'AllergyIntolerance',
        'id': str(allergy.id),
        'clinicalStatus': {
            'coding': [{
                'system': 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical',
                'code': 'active' if allergy.is_active else 'inactive',
                'display': 'Active' if allergy.is_active else 'Inactive',
            }]
        },
        'verificationStatus': {
            'coding': [{
                'system': 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification',
                'code': 'confirmed' if allergy.verified else 'unconfirmed',
                'display': 'Confirmed' if allergy.verified else 'Unconfirmed',
            }]
        },
        'type': 'allergy',  # Can be 'allergy' or 'intolerance'
        'category': [category_map.get(allergy.allergen_type, 'medication')],
        'criticality': severity_map.get(allergy.severity, 'low'),
        'code': {
            'coding': [{
                'system': 'http://www.nlm.nih.gov/research/umls/rxnorm',
                'code': allergy.rxcui_code or 'unknown',
                'display': allergy.allergen_name,
            }],
            'text': allergy.allergen_name,
        },
        'patient': {
            'reference': f'Patient/{allergy.patient.fhir_patient_id}' if hasattr(allergy.patient, 'fhir_patient_id') else None,
            'display': f'{allergy.patient.first_name} {allergy.patient.last_name}',
        },
        'recordedDate': allergy.created_at.isoformat(),
    }

    # Add onset date if available
    if allergy.onset_date:
        resource['onsetDateTime'] = allergy.onset_date.isoformat()

    # Add reaction details
    if allergy.reaction:
        resource['reaction'] = [{
            'manifestation': [{
                'coding': [{
                    'system': 'http://snomed.info/sct',
                    'display': allergy.reaction,
                }],
                'text': allergy.reaction,
            }],
            'severity': severity_map.get(allergy.severity, 'mild'),
        }]

    # Add notes
    if allergy.notes:
        resource['note'] = [{
            'text': allergy.notes,
        }]

    # Add verification details
    if allergy.verified and allergy.verified_by:
        resource['asserter'] = {
            'reference': f'Practitioner/{allergy.verified_by.id}',
            'display': f'Dr. {allergy.verified_by.first_name} {allergy.verified_by.last_name}',
        }
        if allergy.verified_at:
            resource['recordedDate'] = allergy.verified_at.isoformat()

    return resource


def sync_allergy_to_fhir(allergy_id: str) -> Dict:
    """
    Sync a PatientAllergy to FHIR server.

    Args:
        allergy_id: UUID of PatientAllergy

    Returns:
        Dict with sync result
    """
    try:
        allergy = PatientAllergy.objects.select_related('patient', 'verified_by').get(id=allergy_id)

        # Map to FHIR resource
        fhir_resource = map_allergy_to_fhir(allergy)

        # Create or update on FHIR server
        if allergy.fhir_allergy_id:
            # Update existing resource
            response = fhir_client.update_resource(
                'AllergyIntolerance',
                allergy.fhir_allergy_id,
                fhir_resource
            )
            logger.info(f'Updated AllergyIntolerance {allergy.fhir_allergy_id} in FHIR')
        else:
            # Create new resource
            response = fhir_client.create_resource('AllergyIntolerance', fhir_resource)

            # Save FHIR ID back to model
            if 'id' in response:
                allergy.fhir_allergy_id = response['id']
                allergy.save(update_fields=['fhir_allergy_id'])
                logger.info(f'Created AllergyIntolerance {response["id"]} in FHIR')

        return {
            'status': 'success',
            'allergy_id': str(allergy_id),
            'fhir_id': response.get('id'),
        }

    except PatientAllergy.DoesNotExist:
        logger.error(f'PatientAllergy {allergy_id} not found')
        return {'status': 'error', 'message': 'Allergy not found'}

    except Exception as e:
        logger.error(f'Error syncing allergy to FHIR: {str(e)}')
        return {'status': 'error', 'message': str(e)}


def delete_allergy_from_fhir(allergy_id: str) -> Dict:
    """
    Delete an AllergyIntolerance from FHIR server (mark as inactive).

    Args:
        allergy_id: UUID of PatientAllergy

    Returns:
        Dict with deletion result
    """
    try:
        allergy = PatientAllergy.objects.get(id=allergy_id)

        if not allergy.fhir_allergy_id:
            return {'status': 'skipped', 'message': 'No FHIR ID found'}

        # Update resource to mark as inactive
        fhir_resource = map_allergy_to_fhir(allergy)
        fhir_resource['clinicalStatus']['coding'][0]['code'] = 'inactive'

        response = fhir_client.update_resource(
            'AllergyIntolerance',
            allergy.fhir_allergy_id,
            fhir_resource
        )

        logger.info(f'Marked AllergyIntolerance {allergy.fhir_allergy_id} as inactive in FHIR')

        return {
            'status': 'success',
            'allergy_id': str(allergy_id),
            'fhir_id': allergy.fhir_allergy_id,
        }

    except PatientAllergy.DoesNotExist:
        logger.error(f'PatientAllergy {allergy_id} not found')
        return {'status': 'error', 'message': 'Allergy not found'}

    except Exception as e:
        logger.error(f'Error marking allergy as inactive in FHIR: {str(e)}')
        return {'status': 'error', 'message': str(e)}
