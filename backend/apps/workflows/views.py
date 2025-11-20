from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.shortcuts import get_object_or_404
from django.db import models
import logging

from .models import ClinicalWorkflow, ConsultationWorkflow, WorkflowTemplate, WorkflowType
from .serializers import (
    ClinicalWorkflowSerializer,
    ConsultationWorkflowSerializer,
    ConsultationWorkflowCreateSerializer,
    ConsultationWorkflowUpdateSerializer,
    ConsultationWorkflowCompleteSerializer,
    WorkflowTemplateSerializer,
    WorkflowDraftSerializer,
)
from .engines import ConsultationEngine
from apps.users.permissions import IsAdminOrOwner

logger = logging.getLogger(__name__)


class WorkflowViewSet(viewsets.ModelViewSet):
    """
    API endpoints for clinical workflows
    """
    serializer_class = ClinicalWorkflowSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        """
        Filter workflows by current user
        """
        user = self.request.user
        queryset = ClinicalWorkflow.objects.filter(user=user).select_related('patient', 'patient__user')

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
                {'error': f'Failed to complete consultation: {str(e)}'},
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
        queryset = ClinicalWorkflow.objects.filter(
            user=user,
            status__in=['draft', 'in_progress']
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


class ConsultationWorkflowViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Read-only API endpoints for consultation workflow data
    """
    serializer_class = ConsultationWorkflowSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        """
        Filter consultation workflows by current user
        """
        user = self.request.user
        return ConsultationWorkflow.objects.filter(
            workflow__user=user
        ).select_related('workflow', 'workflow__patient', 'workflow__patient__user')


class WorkflowTemplateViewSet(viewsets.ModelViewSet):
    """
    API endpoints for workflow templates
    """
    serializer_class = WorkflowTemplateSerializer
    permission_classes = [IsAuthenticated]

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
