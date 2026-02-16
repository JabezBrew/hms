from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.exceptions import PermissionDenied
from django.shortcuts import get_object_or_404
from django.db import models
import logging

from .models import (
    ClinicalWorkflow, ConsultationWorkflow, ClinicalNoteWorkflow,
    WardRoundWorkflow, AdmissionWorkflow, DischargeWorkflow,
    WorkflowTemplate, WorkflowType
)
from .serializers import (
    ClinicalWorkflowSerializer,
    ConsultationWorkflowSerializer,
    ConsultationWorkflowCreateSerializer,
    ConsultationWorkflowUpdateSerializer,
    ConsultationWorkflowCompleteSerializer,
    ClinicalNoteWorkflowSerializer,
    ClinicalNoteWorkflowCreateSerializer,
    ClinicalNoteWorkflowUpdateSerializer,
    ClinicalNoteWorkflowCompleteSerializer,
    WardRoundWorkflowSerializer,
    WardRoundWorkflowCreateSerializer,
    WardRoundWorkflowUpdateSerializer,
    WardRoundWorkflowCompleteSerializer,
    AdmissionWorkflowSerializer,
    AdmissionWorkflowCreateSerializer,
    AdmissionWorkflowUpdateSerializer,
    AdmissionWorkflowCompleteSerializer,
    DischargeWorkflowSerializer,
    DischargeWorkflowCreateSerializer,
    DischargeWorkflowUpdateSerializer,
    DischargeWorkflowCompleteSerializer,
    WorkflowTemplateSerializer,
    WorkflowDraftSerializer,
)
from .engines import (
    ConsultationEngine, ClinicalNoteEngine,
    WardRoundEngine, AdmissionEngine, DischargeEngine
)
from apps.users.permissions import IsAdminOrOwner
from apps.core.pagination import StandardResultsSetPagination
from apps.core.security import FacilityScopedPermission, check_clinical_access, get_user_facility
from apps.users.models import PatientProfile

logger = logging.getLogger(__name__)


def _require_patient_access(request, patient_id):
    patient = get_object_or_404(PatientProfile, id=patient_id)
    facility = get_user_facility(request)
    if facility and patient.facility_id != facility.id:
        raise PermissionDenied("Patient does not belong to the active facility.")
    check_clinical_access(request.user, patient)
    return patient


class WorkflowViewSet(viewsets.ModelViewSet):
    """
    API endpoints for clinical workflows
    """
    serializer_class = ClinicalWorkflowSerializer
    permission_classes = [IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        """
        Filter workflows by current user
        """
        user = self.request.user
        facility = get_user_facility(self.request)
        if not facility:
            return ClinicalWorkflow.objects.none()
        queryset = ClinicalWorkflow.objects.filter(
            user=user,
            patient__facility=facility
        ).select_related('patient', 'patient__user')

        # Filter by workflow type
        workflow_type = self.request.query_params.get('workflow_type')
        if workflow_type:
            queryset = queryset.filter(workflow_type=workflow_type)

        # Filter by status
        workflow_status = self.request.query_params.get('status')
        if workflow_status:
            queryset = queryset.filter(status=workflow_status)

        # Filter by patient
        patient_id = self.request.query_params.get('patient_id')
        if patient_id:
            queryset = queryset.filter(patient_id=patient_id)

        return queryset.order_by('-created_at')

    @action(detail=False, methods=['post'], url_path='consultation/start')
    def start_consultation(self, request):
        """
        Start a new consultation workflow

        POST /api/workflows/consultation/start/
        Body: {
            "patient_id": 123,
            "appointment_id": "fhir-appointment-id",  // optional
            "initial_data": {}  // optional
        }
        """
        serializer = ConsultationWorkflowCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            _require_patient_access(request, serializer.validated_data['patient_id'])
            result = ConsultationEngine.start(
                user=request.user,
                patient_id=serializer.validated_data['patient_id'],
                appointment_id=serializer.validated_data.get('appointment_id'),
                initial_data=serializer.validated_data.get('initial_data', {}),
            )

            workflow = result['workflow']
            workflow_serializer = ClinicalWorkflowSerializer(workflow)

            return Response(workflow_serializer.data, status=status.HTTP_201_CREATED)

        except ValueError as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )
        except Exception as e:
            logger.error(f"Error starting consultation workflow: {str(e)}")
            return Response(
                {'error': 'Failed to start consultation workflow'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=True, methods=['patch'], url_path='consultation/step')
    def update_consultation_step(self, request, pk=None):
        """
        Update consultation workflow step

        PATCH /api/workflows/{id}/consultation/step/
        Body: {
            "step_data": {
                // workflow context data
            },
            "next_step": 2,  // optional
            "chief_complaint": "...",  // optional consultation field
            "hpi": "...",  // optional
            "assessment": "...",  // optional
            // ... other consultation fields
        }
        """
        workflow = self.get_object()

        # Verify workflow type
        if workflow.workflow_type != WorkflowType.CONSULTATION:
            return Response(
                {'error': 'This endpoint is only for consultation workflows'},
                status=status.HTTP_400_BAD_REQUEST
            )

        serializer = ConsultationWorkflowUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # Extract consultation-specific fields
        consultation_fields = {}
        for field in ['chief_complaint', 'hpi', 'ros', 'physical_exam', 'assessment', 'plan', 'template_used']:
            if field in serializer.validated_data:
                consultation_fields[field] = serializer.validated_data[field]

        try:
            result = ConsultationEngine.update_step(
                workflow=workflow,
                step_data=serializer.validated_data['step_data'],
                next_step=serializer.validated_data.get('next_step'),
                consultation_fields=consultation_fields if consultation_fields else None,
            )

            updated_workflow = result['workflow']
            workflow_serializer = ClinicalWorkflowSerializer(updated_workflow)

            return Response(workflow_serializer.data)

        except Exception as e:
            logger.error(f"Error updating consultation step: {str(e)}")
            return Response(
                {'error': 'Failed to update consultation step'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=True, methods=['post'], url_path='consultation/complete')
    def complete_consultation(self, request, pk=None):
        """
        Complete consultation workflow

        POST /api/workflows/{id}/consultation/complete/
        Body: {
            "final_data": {},  // optional
            "encounter_type": "outpatient",  // optional
            "encounter_status": "finished"  // optional
        }
        """
        workflow = self.get_object()

        # Verify workflow type
        if workflow.workflow_type != WorkflowType.CONSULTATION:
            return Response(
                {'error': 'This endpoint is only for consultation workflows'},
                status=status.HTTP_400_BAD_REQUEST
            )

        serializer = ConsultationWorkflowCompleteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            result = ConsultationEngine.complete(
                workflow=workflow,
                final_data=serializer.validated_data.get('final_data', {}),
                encounter_type=serializer.validated_data.get('encounter_type', 'outpatient'),
                encounter_status=serializer.validated_data.get('encounter_status', 'finished'),
            )

            return Response(result)

        except Exception as e:
            logger.error(f"Error completing consultation: {str(e)}")
            return Response(
                {'error': 'Failed to complete consultation. Please try again.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=True, methods=['post'], url_path='save-draft')
    def save_draft(self, request, pk=None):
        """
        Save workflow draft (auto-save)

        POST /api/workflows/{id}/save-draft/
        Body: {
            "context_data": {
                // data to merge into context
            }
        }
        """
        workflow = self.get_object()

        serializer = WorkflowDraftSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            from .engines import BaseWorkflowEngine
            updated_workflow = BaseWorkflowEngine.save_draft(
                workflow=workflow,
                context_data=serializer.validated_data['context_data'],
            )

            return Response({
                'success': True,
                'last_autosave': updated_workflow.last_autosave,
            })

        except Exception as e:
            logger.error(f"Error saving draft: {str(e)}")
            return Response(
                {'error': 'Failed to save draft'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=False, methods=['get'], url_path='resume')
    def resume(self, request):
        """
        Get draft workflows for resuming

        GET /api/workflows/resume/
        Query params:
            - patient_id: Filter by patient
            - workflow_type: Filter by workflow type
        """
        user = request.user
        facility = get_user_facility(request)
        if not facility:
            return Response({'workflows': []})

        queryset = ClinicalWorkflow.objects.filter(
            user=user,
            status__in=['draft', 'in_progress'],
            patient__facility=facility,
        ).select_related('patient', 'patient__user')

        # Filter by patient
        patient_id = request.query_params.get('patient_id')
        if patient_id:
            queryset = queryset.filter(patient_id=patient_id)

        # Filter by workflow type
        workflow_type = request.query_params.get('workflow_type')
        if workflow_type:
            queryset = queryset.filter(workflow_type=workflow_type)

        queryset = queryset.order_by('-updated_at')[:10]  # Last 10 drafts

        serializer = ClinicalWorkflowSerializer(queryset, many=True)
        return Response({
            'workflows': serializer.data
        })

    @action(detail=True, methods=['post'], url_path='cancel')
    def cancel_workflow(self, request, pk=None):
        """
        Cancel a workflow

        POST /api/workflows/{id}/cancel/
        """
        workflow = self.get_object()

        try:
            from .engines import BaseWorkflowEngine
            cancelled_workflow = BaseWorkflowEngine.cancel_workflow(workflow)

            serializer = ClinicalWorkflowSerializer(cancelled_workflow)
            return Response(serializer.data)

        except Exception as e:
            logger.error(f"Error cancelling workflow: {str(e)}")
            return Response(
                {'error': 'Failed to cancel workflow'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    # ============================================
    # Clinical Note Workflow Endpoints
    # ============================================

    @action(detail=False, methods=['post'], url_path='clinical-note/start')
    def start_clinical_note(self, request):
        """
        Start a new clinical note workflow

        POST /api/workflows/clinical-note/start/
        Body: {
            "patient_id": "uuid",
            "note_type": "progress|soap|procedure|phone",
            "initial_data": {}  // optional
        }
        """
        serializer = ClinicalNoteWorkflowCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            _require_patient_access(request, serializer.validated_data['patient_id'])
            # Include template_id in initial_data so it's stored in context
            initial_data = serializer.validated_data.get('initial_data', {})
            if serializer.validated_data.get('template_id'):
                initial_data['template_id'] = str(serializer.validated_data['template_id'])
            if serializer.validated_data.get('template_revision_id'):
                initial_data['template_revision_id'] = str(serializer.validated_data['template_revision_id'])

            result = ClinicalNoteEngine.start(
                user=request.user,
                patient_id=serializer.validated_data['patient_id'],
                note_type=serializer.validated_data['note_type'],
                initial_data=initial_data,
            )

            workflow = result['workflow']
            workflow_serializer = ClinicalWorkflowSerializer(workflow)

            return Response(workflow_serializer.data, status=status.HTTP_201_CREATED)

        except ValueError as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )
        except Exception as e:
            logger.error(f"Error starting clinical note workflow: {str(e)}")
            return Response(
                {'error': 'Failed to start clinical note workflow'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=True, methods=['patch'], url_path='clinical-note/step')
    def update_clinical_note_step(self, request, pk=None):
        """
        Update clinical note workflow step

        PATCH /api/workflows/{id}/clinical-note/step/
        Body: {
            "step_data": {},
            "next_step": 2,  // optional
            "chief_complaint": "...",  // optional note field
            // ... other note fields
        }
        """
        workflow = self.get_object()

        # Verify workflow type
        if workflow.workflow_type != WorkflowType.CLINICAL_NOTE:
            return Response(
                {'error': 'This endpoint is only for clinical note workflows'},
                status=status.HTTP_400_BAD_REQUEST
            )

        serializer = ClinicalNoteWorkflowUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # Extract note-specific fields
        note_fields = {}
        note_field_names = [
            'chief_complaint', 'assessment', 'plan', 'follow_up', 'patient_education',
            'subjective', 'objective', 'hpi', 'ros', 'physical_exam', 'vitals',
            'procedure_name', 'indication', 'consent', 'pre_assessment', 'anesthesia',
            'technique', 'specimens', 'ebl', 'complications', 'complication_details',
            'patient_condition', 'disposition', 'post_instructions',
            'caller_name', 'caller_relationship', 'callback_number', 'reason_for_call',
            'symptoms_discussed', 'advice_given', 'urgency', 'actions_taken',
            'pending_actions', 'callback_needed'
        ]
        for field in note_field_names:
            if field in serializer.validated_data:
                note_fields[field] = serializer.validated_data[field]

        try:
            result = ClinicalNoteEngine.update_step(
                workflow=workflow,
                step_data=serializer.validated_data['step_data'],
                next_step=serializer.validated_data.get('next_step'),
                note_fields=note_fields if note_fields else None,
            )

            updated_workflow = result['workflow']
            workflow_serializer = ClinicalWorkflowSerializer(updated_workflow)

            return Response(workflow_serializer.data)

        except Exception as e:
            logger.error(f"Error updating clinical note step: {str(e)}")
            return Response(
                {'error': 'Failed to update clinical note step'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=True, methods=['post'], url_path='clinical-note/complete')
    def complete_clinical_note(self, request, pk=None):
        """
        Complete clinical note workflow

        POST /api/workflows/{id}/clinical-note/complete/
        Body: {
            "final_data": {},  // optional
            "encounter_type": "outpatient",  // optional
            "encounter_status": "finished"  // optional
        }
        """
        workflow = self.get_object()

        # Verify workflow type
        if workflow.workflow_type != WorkflowType.CLINICAL_NOTE:
            return Response(
                {'error': 'This endpoint is only for clinical note workflows'},
                status=status.HTTP_400_BAD_REQUEST
            )

        serializer = ClinicalNoteWorkflowCompleteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            # Get template_id from request or workflow context
            template_id = serializer.validated_data.get('template_id')
            if not template_id:
                template_id = workflow.context_data.get('template_id')
            template_revision_id = serializer.validated_data.get('template_revision_id')
            if not template_revision_id:
                template_revision_id = workflow.context_data.get('template_revision_id')

            result = ClinicalNoteEngine.complete(
                workflow=workflow,
                final_data=serializer.validated_data.get('final_data', {}),
                encounter_type=serializer.validated_data.get('encounter_type', 'outpatient'),
                encounter_status=serializer.validated_data.get('encounter_status', 'finished'),
                template_id=template_id,
                template_revision_id=template_revision_id,
            )

            return Response(result)

        except Exception as e:
            logger.error(f"Error completing clinical note: {str(e)}")
            return Response(
                {'error': 'Failed to complete clinical note. Please try again.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    # ====================================
    # Ward Round Workflow Actions
    # ====================================

    @action(detail=False, methods=['post'], url_path='ward-round/start')
    def start_ward_round(self, request):
        """
        Start a new ward round workflow

        POST /api/workflows/ward-round/start/
        Body: {
            "patient_id": "uuid",
            "admission_id": "uuid",
            "initial_data": {}  // optional
        }
        """
        serializer = WardRoundWorkflowCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            _require_patient_access(request, serializer.validated_data['patient_id'])
            result = WardRoundEngine.start(
                user=request.user,
                patient_id=serializer.validated_data['patient_id'],
                admission_id=serializer.validated_data['admission_id'],
                initial_data=serializer.validated_data.get('initial_data', {}),
            )

            workflow_serializer = ClinicalWorkflowSerializer(result['workflow'])
            ward_round_serializer = WardRoundWorkflowSerializer(result['ward_round_data'])

            return Response({
                'workflow': workflow_serializer.data,
                'ward_round_data': ward_round_serializer.data,
            }, status=status.HTTP_201_CREATED)

        except ValueError as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )
        except Exception as e:
            logger.error(f"Error starting ward round: {str(e)}")
            return Response(
                {'error': 'Failed to start ward round. Please try again.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=True, methods=['patch'], url_path='ward-round/step')
    def update_ward_round_step(self, request, pk=None):
        """
        Update ward round workflow step

        PATCH /api/workflows/{id}/ward-round/step/
        """
        workflow = self.get_object()

        if workflow.workflow_type != WorkflowType.WARD_ROUND:
            return Response(
                {'error': 'Invalid workflow type'},
                status=status.HTTP_400_BAD_REQUEST
            )

        serializer = WardRoundWorkflowUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            step_data = serializer.validated_data.get('step_data', {})

            # Update workflow
            updated_workflow = WardRoundEngine.update_step(
                workflow=workflow,
                step_number=workflow.current_step,
                step_data=step_data,
            )

            workflow_serializer = ClinicalWorkflowSerializer(updated_workflow)

            return Response({
                'workflow': workflow_serializer.data,
                'message': f'Step {workflow.current_step} updated successfully'
            })

        except Exception as e:
            logger.error(f"Error updating ward round step: {str(e)}")
            return Response(
                {'error': 'Failed to update step. Please try again.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=True, methods=['post'], url_path='ward-round/complete')
    def complete_ward_round(self, request, pk=None):
        """
        Complete ward round workflow

        POST /api/workflows/{id}/ward-round/complete/
        """
        workflow = self.get_object()

        if workflow.workflow_type != WorkflowType.WARD_ROUND:
            return Response(
                {'error': 'Invalid workflow type'},
                status=status.HTTP_400_BAD_REQUEST
            )

        serializer = WardRoundWorkflowCompleteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            result = WardRoundEngine.complete(
                workflow=workflow,
                final_data=serializer.validated_data.get('final_data', {}),
            )

            return Response(result)

        except Exception as e:
            logger.error(f"Error completing ward round: {str(e)}")
            return Response(
                {'error': 'Failed to complete ward round. Please try again.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    # ====================================
    # Admission Workflow Actions
    # ====================================

    @action(detail=False, methods=['post'], url_path='admission/start')
    def start_admission(self, request):
        """
        Start a new admission workflow

        POST /api/workflows/admission/start/
        Body: {
            "patient_id": "uuid",
            "initial_data": {}  // optional
        }
        """
        serializer = AdmissionWorkflowCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            _require_patient_access(request, serializer.validated_data['patient_id'])
            result = AdmissionEngine.start(
                user=request.user,
                patient_id=serializer.validated_data['patient_id'],
                initial_data=serializer.validated_data.get('initial_data', {}),
            )

            workflow_serializer = ClinicalWorkflowSerializer(result['workflow'])
            admission_serializer = AdmissionWorkflowSerializer(result['admission_data'])

            return Response({
                'workflow': workflow_serializer.data,
                'admission_data': admission_serializer.data,
            }, status=status.HTTP_201_CREATED)

        except ValueError as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )
        except Exception as e:
            logger.error(f"Error starting admission: {str(e)}")
            return Response(
                {'error': 'Failed to start admission. Please try again.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=True, methods=['patch'], url_path='admission/step')
    def update_admission_step(self, request, pk=None):
        """
        Update admission workflow step

        PATCH /api/workflows/{id}/admission/step/
        """
        workflow = self.get_object()

        if workflow.workflow_type != WorkflowType.ADMISSION:
            return Response(
                {'error': 'Invalid workflow type'},
                status=status.HTTP_400_BAD_REQUEST
            )

        serializer = AdmissionWorkflowUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            step_data = serializer.validated_data.get('step_data', {})

            # Update workflow
            updated_workflow = AdmissionEngine.update_step(
                workflow=workflow,
                step_number=workflow.current_step,
                step_data=step_data,
            )

            workflow_serializer = ClinicalWorkflowSerializer(updated_workflow)

            return Response({
                'workflow': workflow_serializer.data,
                'message': f'Step {workflow.current_step} updated successfully'
            })

        except Exception as e:
            logger.error(f"Error updating admission step: {str(e)}")
            return Response(
                {'error': 'Failed to update step. Please try again.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=True, methods=['post'], url_path='admission/complete')
    def complete_admission(self, request, pk=None):
        """
        Complete admission workflow

        POST /api/workflows/{id}/admission/complete/
        """
        workflow = self.get_object()

        if workflow.workflow_type != WorkflowType.ADMISSION:
            return Response(
                {'error': 'Invalid workflow type'},
                status=status.HTTP_400_BAD_REQUEST
            )

        serializer = AdmissionWorkflowCompleteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            result = AdmissionEngine.complete(
                workflow=workflow,
                final_data=serializer.validated_data.get('final_data', {}),
            )

            return Response(result)

        except Exception as e:
            logger.error(f"Error completing admission: {str(e)}")
            return Response(
                {'error': 'Failed to complete admission. Please try again.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    # ====================================
    # Discharge Workflow Actions
    # ====================================

    @action(detail=False, methods=['post'], url_path='discharge/start')
    def start_discharge(self, request):
        """
        Start a new discharge workflow

        POST /api/workflows/discharge/start/
        Body: {
            "patient_id": "uuid",
            "admission_id": "uuid",
            "initial_data": {}  // optional
        }
        """
        serializer = DischargeWorkflowCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            _require_patient_access(request, serializer.validated_data['patient_id'])
            result = DischargeEngine.start(
                user=request.user,
                patient_id=serializer.validated_data['patient_id'],
                admission_id=serializer.validated_data['admission_id'],
                initial_data=serializer.validated_data.get('initial_data', {}),
            )

            workflow_serializer = ClinicalWorkflowSerializer(result['workflow'])
            discharge_serializer = DischargeWorkflowSerializer(result['discharge_data'])
            response_status = (
                status.HTTP_200_OK
                if result.get('resumed')
                else status.HTTP_201_CREATED
            )

            return Response({
                'workflow': workflow_serializer.data,
                'discharge_data': discharge_serializer.data,
                'resumed': bool(result.get('resumed', False)),
            }, status=response_status)

        except ValueError as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )
        except Exception as e:
            logger.error(f"Error starting discharge: {str(e)}")
            return Response(
                {'error': 'Failed to start discharge. Please try again.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=True, methods=['patch'], url_path='discharge/step')
    def update_discharge_step(self, request, pk=None):
        """
        Update discharge workflow step

        PATCH /api/workflows/{id}/discharge/step/
        """
        workflow = self.get_object()

        if workflow.workflow_type != WorkflowType.DISCHARGE:
            return Response(
                {'error': 'Invalid workflow type'},
                status=status.HTTP_400_BAD_REQUEST
            )
        _require_patient_access(request, workflow.patient_id)

        serializer = DischargeWorkflowUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            step_data = serializer.validated_data.get('step_data', {})

            # Update workflow
            updated_workflow = DischargeEngine.update_step(
                workflow=workflow,
                step_number=workflow.current_step,
                step_data=step_data,
            )

            workflow_serializer = ClinicalWorkflowSerializer(updated_workflow)

            return Response({
                'workflow': workflow_serializer.data,
                'message': f'Step {workflow.current_step} updated successfully'
            })

        except ValueError as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )
        except Exception as e:
            logger.error(f"Error updating discharge step: {str(e)}")
            return Response(
                {'error': 'Failed to update step. Please try again.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=True, methods=['post'], url_path='discharge/complete')
    def complete_discharge(self, request, pk=None):
        """
        Complete discharge workflow

        POST /api/workflows/{id}/discharge/complete/
        """
        workflow = self.get_object()

        if workflow.workflow_type != WorkflowType.DISCHARGE:
            return Response(
                {'error': 'Invalid workflow type'},
                status=status.HTTP_400_BAD_REQUEST
            )
        _require_patient_access(request, workflow.patient_id)

        serializer = DischargeWorkflowCompleteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            result = DischargeEngine.complete(
                workflow=workflow,
                final_data=serializer.validated_data.get('final_data', {}),
                idempotency_key=serializer.validated_data.get('idempotency_key'),
            )

            return Response(result)

        except ValueError as e:
            error_message = str(e)
            response_status = (
                status.HTTP_409_CONFLICT
                if 'already completed' in error_message.lower()
                else status.HTTP_400_BAD_REQUEST
            )
            return Response(
                {'error': error_message},
                status=response_status
            )
        except Exception as e:
            logger.error(f"Error completing discharge: {str(e)}")
            return Response(
                {'error': 'Failed to complete discharge. Please try again.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class ClinicalNoteWorkflowViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Read-only API endpoints for clinical note workflow data
    """
    serializer_class = ClinicalNoteWorkflowSerializer
    permission_classes = [IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        """
        Filter clinical note workflows by current user
        """
        user = self.request.user
        facility = get_user_facility(self.request)
        if not facility:
            return ClinicalNoteWorkflow.objects.none()
        return ClinicalNoteWorkflow.objects.filter(
            workflow__user=user,
            workflow__patient__facility=facility
        ).select_related('workflow', 'workflow__patient', 'workflow__patient__user')


class ConsultationWorkflowViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Read-only API endpoints for consultation workflow data
    """
    serializer_class = ConsultationWorkflowSerializer
    permission_classes = [IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        """
        Filter consultation workflows by current user
        """
        user = self.request.user
        facility = get_user_facility(self.request)
        if not facility:
            return ConsultationWorkflow.objects.none()
        return ConsultationWorkflow.objects.filter(
            workflow__user=user,
            workflow__patient__facility=facility
        ).select_related('workflow', 'workflow__patient', 'workflow__patient__user')


class WorkflowTemplateViewSet(viewsets.ModelViewSet):
    """
    API endpoints for workflow templates
    """
    serializer_class = WorkflowTemplateSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        """
        Get public templates and user's own templates
        """
        user = self.request.user
        queryset = WorkflowTemplate.objects.filter(
            models.Q(is_public=True) | models.Q(created_by=user)
        )

        # Filter by workflow type
        workflow_type = self.request.query_params.get('workflow_type')
        if workflow_type:
            queryset = queryset.filter(workflow_type=workflow_type)

        # Filter by specialty
        specialty = self.request.query_params.get('specialty')
        if specialty:
            queryset = queryset.filter(specialty=specialty)

        return queryset.order_by('-usage_count', 'name')

    def perform_create(self, serializer):
        """
        Set created_by to current user
        """
        serializer.save(created_by=self.request.user)

    @action(detail=True, methods=['post'], url_path='use')
    def use_template(self, request, pk=None):
        """
        Increment usage count when template is used

        POST /api/workflow-templates/{id}/use/
        """
        template = self.get_object()
        template.increment_usage()

        serializer = self.get_serializer(template)
        return Response(serializer.data)
