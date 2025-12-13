"""
FHIR Synchronization for Laboratory Models
Maps laboratory data to FHIR ServiceRequest, DiagnosticReport, and Observation resources
"""
import logging
from typing import Dict, Optional, List
from apps.fhir_client.client import fhir_client
from .models import LabOrder, LabResult

logger = logging.getLogger(__name__)


def map_lab_order_to_service_request(order: LabOrder) -> Dict:
    """
    Map LabOrder model to FHIR ServiceRequest resource.

    FHIR Resource: http://hl7.org/fhir/servicerequest.html

    Args:
        order: LabOrder instance

    Returns:
        Dict representing FHIR ServiceRequest resource
    """
    # Map status
    status_map = {
        'draft': 'draft',
        'submitted': 'active',
        'collected': 'active',
        'received': 'active',
        'processing': 'active',
        'completed': 'completed',
        'cancelled': 'revoked',
    }

    # Map priority
    priority_map = {
        'routine': 'routine',
        'urgent': 'urgent',
        'stat': 'stat',
    }

    # Build FHIR resource
    resource = {
        'resourceType': 'ServiceRequest',
        'id': str(order.id),
        'status': status_map.get(order.status, 'unknown'),
        'intent': 'order',
        'priority': priority_map.get(order.priority, 'routine'),
        'category': [{
            'coding': [{
                'system': 'http://snomed.info/sct',
                'code': '108252007',
                'display': 'Laboratory procedure',
            }]
        }],
        'subject': {
            'reference': f'Patient/{order.patient.fhir_patient_id}' if hasattr(order.patient, 'fhir_patient_id') else None,
            'display': f'{order.patient.first_name} {order.patient.last_name}',
        },
        'authoredOn': order.created_at.isoformat(),
        'requester': {
            'reference': f'Practitioner/{order.ordering_provider.id}',
            'display': f'Dr. {order.ordering_provider.first_name} {order.ordering_provider.last_name}',
        },
    }

    # Add encounter reference if available
    if order.encounter:
        resource['encounter'] = {
            'reference': f'Encounter/{order.encounter.id}',
        }

    # Add order details
    if order.indication:
        resource['reasonCode'] = [{
            'text': order.indication,
        }]

    # Add clinical notes
    if order.clinical_notes:
        resource['note'] = [{
            'text': order.clinical_notes,
        }]

    # Add order codes (tests and panels)
    codes = []
    for order_test in order.order_tests.all():
        if order_test.test:
            test_code = {
                'coding': [],
                'text': order_test.test.name,
            }
            if order_test.test.loinc_code:
                test_code['coding'].append({
                    'system': 'http://loinc.org',
                    'code': order_test.test.loinc_code,
                    'display': order_test.test.name,
                })
            codes.append(test_code)
        elif order_test.panel:
            codes.append({
                'text': order_test.panel.name,
            })

    if codes:
        resource['code'] = codes[0]  # Primary code
        if len(codes) > 1:
            resource['orderDetail'] = codes[1:]  # Additional codes

    return resource


def map_lab_result_to_observation(result: LabResult) -> Dict:
    """
    Map LabResult model to FHIR Observation resource.

    FHIR Resource: http://hl7.org/fhir/observation.html

    Args:
        result: LabResult instance

    Returns:
        Dict representing FHIR Observation resource
    """
    # Map status
    status = 'final' if result.verified else 'preliminary'

    # Build FHIR resource
    resource = {
        'resourceType': 'Observation',
        'id': str(result.id),
        'status': status,
        'category': [{
            'coding': [{
                'system': 'http://terminology.hl7.org/CodeSystem/observation-category',
                'code': 'laboratory',
                'display': 'Laboratory',
            }]
        }],
        'code': {
            'text': result.order_test.test.name if result.order_test.test else 'Unknown Test',
        },
        'subject': {
            'reference': f'Patient/{result.order_test.order.patient.fhir_patient_id}' if hasattr(result.order_test.order.patient, 'fhir_patient_id') else None,
            'display': f'{result.order_test.order.patient.first_name} {result.order_test.order.patient.last_name}',
        },
        'effectiveDateTime': result.result_date.isoformat(),
        'issued': result.created_at.isoformat(),
    }

    # Add LOINC code if available
    if result.order_test.test and result.order_test.test.loinc_code:
        resource['code']['coding'] = [{
            'system': 'http://loinc.org',
            'code': result.order_test.test.loinc_code,
            'display': result.order_test.test.name,
        }]

    # Add value (numeric or text)
    try:
        # Try to parse as numeric
        numeric_value = float(result.value)
        resource['valueQuantity'] = {
            'value': numeric_value,
            'unit': result.unit or '',
            'system': 'http://unitsofmeasure.org',
            'code': result.unit or '',
        }
    except (ValueError, TypeError):
        # Use string value
        resource['valueString'] = result.value

    # Add reference range
    if result.reference_range:
        resource['referenceRange'] = [{
            'low': {
                'value': result.reference_range.get('low'),
                'unit': result.reference_range.get('unit', ''),
            } if result.reference_range.get('low') else None,
            'high': {
                'value': result.reference_range.get('high'),
                'unit': result.reference_range.get('unit', ''),
            } if result.reference_range.get('high') else None,
        }]

    # Add interpretation (abnormal/critical flags)
    interpretation_codes = []
    if result.is_critical:
        interpretation_codes.append({
            'coding': [{
                'system': 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation',
                'code': 'AA',
                'display': 'Critical abnormal',
            }]
        })
    elif result.is_abnormal:
        interpretation_codes.append({
            'coding': [{
                'system': 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation',
                'code': 'A',
                'display': 'Abnormal',
            }]
        })
    else:
        interpretation_codes.append({
            'coding': [{
                'system': 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation',
                'code': 'N',
                'display': 'Normal',
            }]
        })

    if interpretation_codes:
        resource['interpretation'] = interpretation_codes

    # Add notes
    if result.result_notes:
        resource['note'] = [{
            'text': result.result_notes,
        }]

    # Add performer (lab technician)
    if result.performed_by:
        resource['performer'] = [{
            'reference': f'Practitioner/{result.performed_by.id}',
            'display': f'{result.performed_by.first_name} {result.performed_by.last_name}',
        }]

    # Add verifier if verified
    if result.verified and result.verified_by:
        if 'performer' not in resource:
            resource['performer'] = []
        resource['performer'].append({
            'reference': f'Practitioner/{result.verified_by.id}',
            'display': f'{result.verified_by.first_name} {result.verified_by.last_name} (Verifier)',
        })

    # Link to order (ServiceRequest)
    if hasattr(result.order_test.order, 'fhir_service_request_id'):
        resource['basedOn'] = [{
            'reference': f'ServiceRequest/{result.order_test.order.fhir_service_request_id}',
        }]

    return resource


def sync_lab_order_to_fhir(order_id: str) -> Dict:
    """
    Sync a LabOrder to FHIR server as ServiceRequest.

    Args:
        order_id: UUID of LabOrder

    Returns:
        Dict with sync result
    """
    try:
        order = LabOrder.objects.select_related(
            'patient', 'ordering_provider', 'encounter'
        ).prefetch_related('order_tests__test', 'order_tests__panel').get(id=order_id)

        # Map to FHIR resource
        fhir_resource = map_lab_order_to_service_request(order)

        # Create or update on FHIR server
        if hasattr(order, 'fhir_service_request_id') and order.fhir_service_request_id:
            # Update existing resource
            response = fhir_client.update_resource(
                'ServiceRequest',
                order.fhir_service_request_id,
                fhir_resource
            )
            logger.info(f'Updated ServiceRequest {order.fhir_service_request_id} in FHIR')
        else:
            # Create new resource
            response = fhir_client.create_resource('ServiceRequest', fhir_resource)

            # Save FHIR ID back to model (would need to add field to model)
            if 'id' in response:
                logger.info(f'Created ServiceRequest {response["id"]} in FHIR')

        return {
            'status': 'success',
            'order_id': str(order_id),
            'fhir_id': response.get('id'),
        }

    except LabOrder.DoesNotExist:
        logger.error(f'LabOrder {order_id} not found')
        return {'status': 'error', 'message': 'Order not found'}

    except Exception as e:
        logger.error(f'Error syncing lab order to FHIR: {str(e)}')
        return {'status': 'error', 'message': str(e)}


def sync_lab_result_to_fhir(result_id: str) -> Dict:
    """
    Sync a LabResult to FHIR server as Observation.

    Args:
        result_id: UUID of LabResult

    Returns:
        Dict with sync result
    """
    try:
        result = LabResult.objects.select_related(
            'order_test__order__patient',
            'order_test__test',
            'performed_by',
            'verified_by'
        ).get(id=result_id)

        # Map to FHIR resource
        fhir_resource = map_lab_result_to_observation(result)

        # Create or update on FHIR server
        if hasattr(result, 'fhir_observation_id') and result.fhir_observation_id:
            # Update existing resource
            response = fhir_client.update_resource(
                'Observation',
                result.fhir_observation_id,
                fhir_resource
            )
            logger.info(f'Updated Observation {result.fhir_observation_id} in FHIR')
        else:
            # Create new resource
            response = fhir_client.create_resource('Observation', fhir_resource)

            # Save FHIR ID back to model (would need to add field to model)
            if 'id' in response:
                logger.info(f'Created Observation {response["id"]} in FHIR')

        return {
            'status': 'success',
            'result_id': str(result_id),
            'fhir_id': response.get('id'),
        }

    except LabResult.DoesNotExist:
        logger.error(f'LabResult {result_id} not found')
        return {'status': 'error', 'message': 'Result not found'}

    except Exception as e:
        logger.error(f'Error syncing lab result to FHIR: {str(e)}')
        return {'status': 'error', 'message': str(e)}
