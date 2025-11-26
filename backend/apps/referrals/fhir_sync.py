"""
FHIR Synchronization for Referral Models
Maps referral data to FHIR ServiceRequest resources
"""
import logging
from typing import Dict, Optional
from apps.fhir_client.client import fhir_client
from .models import Referral

logger = logging.getLogger(__name__)


def map_referral_to_service_request(referral: Referral) -> Dict:
    """
    Map Referral model to FHIR ServiceRequest resource.

    FHIR Resource: http://hl7.org/fhir/servicerequest.html

    Args:
        referral: Referral instance

    Returns:
        Dict representing FHIR ServiceRequest resource
    """
    # Map status
    status_map = {
        'draft': 'draft',
        'submitted': 'active',
        'accepted': 'active',
        'declined': 'revoked',
        'scheduled': 'active',
        'completed': 'completed',
    }

    # Map priority based on urgency
    priority_map = {
        'routine': 'routine',
        'urgent': 'urgent',
        'emergency': 'stat',
    }

    # Build FHIR resource
    resource = {
        'resourceType': 'ServiceRequest',
        'id': str(referral.id),
        'status': status_map.get(referral.status, 'unknown'),
        'intent': 'order',
        'priority': priority_map.get(referral.urgency, 'routine'),
        'category': [{
            'coding': [{
                'system': 'http://snomed.info/sct',
                'code': '3457005',
                'display': 'Patient referral',
            }]
        }],
        'code': {
            'text': f'{referral.department.replace("_", " ").title()} Consultation',
        },
        'subject': {
            'reference': f'Patient/{referral.patient.fhir_patient_id}' if hasattr(referral.patient, 'fhir_patient_id') else None,
            'display': f'{referral.patient.first_name} {referral.patient.last_name}',
        },
        'authoredOn': referral.created_at.isoformat(),
        'requester': {
            'reference': f'Practitioner/{referral.referring_provider.id}',
            'display': f'Dr. {referral.referring_provider.first_name} {referral.referring_provider.last_name}',
        },
    }

    # Add encounter reference if available
    if referral.encounter:
        resource['encounter'] = {
            'reference': f'Encounter/{referral.encounter.id}',
        }

    # Add specialty if provided
    if referral.specialty:
        resource['code']['text'] = f'{referral.specialty} - {referral.department.replace("_", " ").title()}'

    # Add reason for referral
    if referral.reason:
        resource['reasonCode'] = [{
            'text': referral.reason,
        }]

    # Add clinical summary and history as notes
    notes = []

    if referral.clinical_summary:
        notes.append({
            'text': f'Clinical Summary: {referral.clinical_summary}',
        })

    if referral.relevant_history:
        notes.append({
            'text': f'Relevant History: {referral.relevant_history}',
        })

    # Add acceptance/decline notes
    if referral.acceptance_notes:
        notes.append({
            'text': f'Acceptance Notes: {referral.acceptance_notes}',
            'authorReference': {
                'reference': f'Practitioner/{referral.responding_specialist.id}',
                'display': f'Dr. {referral.responding_specialist.first_name} {referral.responding_specialist.last_name}',
            } if referral.responding_specialist else None,
        })

    if referral.decline_reason:
        notes.append({
            'text': f'Decline Reason: {referral.decline_reason}',
            'authorReference': {
                'reference': f'Practitioner/{referral.responding_specialist.id}',
                'display': f'Dr. {referral.responding_specialist.first_name} {referral.responding_specialist.last_name}',
            } if referral.responding_specialist else None,
        })

    # Add specialist notes and recommendations
    if referral.specialist_notes:
        notes.append({
            'text': f'Specialist Notes: {referral.specialist_notes}',
            'authorReference': {
                'reference': f'Practitioner/{referral.responding_specialist.id}',
                'display': f'Dr. {referral.responding_specialist.first_name} {referral.responding_specialist.last_name}',
            } if referral.responding_specialist else None,
        })

    if referral.recommendations:
        notes.append({
            'text': f'Recommendations: {referral.recommendations}',
        })

    if notes:
        resource['note'] = notes

    # Add responding specialist as performer
    if referral.responding_specialist:
        resource['performer'] = [{
            'reference': f'Practitioner/{referral.responding_specialist.id}',
            'display': f'Dr. {referral.responding_specialist.first_name} {referral.responding_specialist.last_name}',
        }]

    # Add scheduled appointment reference if available
    if referral.scheduled_appointment:
        resource['occurrence'] = {
            'reference': f'Appointment/{referral.scheduled_appointment}',
        }

    return resource


def sync_referral_to_fhir(referral_id: str) -> Dict:
    """
    Sync a Referral to FHIR server as ServiceRequest.

    Args:
        referral_id: UUID of Referral

    Returns:
        Dict with sync result
    """
    try:
        referral = Referral.objects.select_related(
            'patient',
            'referring_provider',
            'responding_specialist',
            'encounter'
        ).get(id=referral_id)

        # Map to FHIR resource
        fhir_resource = map_referral_to_service_request(referral)

        # Create or update on FHIR server
        if hasattr(referral, 'fhir_service_request_id') and referral.fhir_service_request_id:
            # Update existing resource
            response = fhir_client.update_resource(
                'ServiceRequest',
                referral.fhir_service_request_id,
                fhir_resource
            )
            logger.info(f'Updated ServiceRequest {referral.fhir_service_request_id} in FHIR')
        else:
            # Create new resource
            response = fhir_client.create_resource('ServiceRequest', fhir_resource)

            # Save FHIR ID back to model (would need to add field to model)
            if 'id' in response:
                logger.info(f'Created ServiceRequest {response["id"]} in FHIR')

        return {
            'status': 'success',
            'referral_id': str(referral_id),
            'fhir_id': response.get('id'),
        }

    except Referral.DoesNotExist:
        logger.error(f'Referral {referral_id} not found')
        return {'status': 'error', 'message': 'Referral not found'}

    except Exception as e:
        logger.error(f'Error syncing referral to FHIR: {str(e)}')
        return {'status': 'error', 'message': str(e)}


def delete_referral_from_fhir(referral_id: str) -> Dict:
    """
    Mark a referral as revoked in FHIR (for declined referrals).

    Args:
        referral_id: UUID of Referral

    Returns:
        Dict with result
    """
    try:
        referral = Referral.objects.select_related(
            'patient',
            'referring_provider',
            'responding_specialist'
        ).get(id=referral_id)

        if not hasattr(referral, 'fhir_service_request_id') or not referral.fhir_service_request_id:
            return {'status': 'skipped', 'message': 'No FHIR ID found'}

        # Update resource to mark as revoked
        fhir_resource = map_referral_to_service_request(referral)
        fhir_resource['status'] = 'revoked'

        response = fhir_client.update_resource(
            'ServiceRequest',
            referral.fhir_service_request_id,
            fhir_resource
        )

        logger.info(f'Marked ServiceRequest {referral.fhir_service_request_id} as revoked in FHIR')

        return {
            'status': 'success',
            'referral_id': str(referral_id),
            'fhir_id': referral.fhir_service_request_id,
        }

    except Referral.DoesNotExist:
        logger.error(f'Referral {referral_id} not found')
        return {'status': 'error', 'message': 'Referral not found'}

    except Exception as e:
        logger.error(f'Error marking referral as revoked in FHIR: {str(e)}')
        return {'status': 'error', 'message': str(e)}
