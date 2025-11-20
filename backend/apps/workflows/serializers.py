from rest_framework import serializers
from .models import ClinicalWorkflow, ConsultationWorkflow, WorkflowTemplate
from apps.users.models import PatientProfile


class ClinicalWorkflowSerializer(serializers.ModelSerializer):
    """
    Serializer for ClinicalWorkflow model
    """
    patient_name = serializers.SerializerMethodField()
    user_name = serializers.SerializerMethodField()
    workflow_type_display = serializers.CharField(source='get_workflow_type_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    is_complete = serializers.BooleanField(read_only=True)
    can_proceed = serializers.SerializerMethodField()

    class Meta:
        model = ClinicalWorkflow
        fields = [
            'id',
            'workflow_type',
            'workflow_type_display',
            'status',
            'status_display',
            'user',
            'user_name',
            'patient',
            'patient_name',
            'encounter_id',
            'current_step',
            'total_steps',
            'steps_completed',
            'context_data',
            'created_at',
            'updated_at',
            'completed_at',
            'last_autosave',
            'is_complete',
            'can_proceed',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'last_autosave']

    def get_patient_name(self, obj):
        """Get patient's full name"""
        if obj.patient and obj.patient.user:
            return obj.patient.user.get_full_name()
        return "Unknown Patient"

    def get_user_name(self, obj):
        """Get user's full name"""
        if obj.user:
            return obj.user.get_full_name()
        return "Unknown User"

    def get_can_proceed(self, obj):
        """Check if can proceed to next step"""
        return obj.can_proceed_to_next_step()


class ConsultationWorkflowSerializer(serializers.ModelSerializer):
    """
    Serializer for ConsultationWorkflow model
    """
    workflow = ClinicalWorkflowSerializer(read_only=True)

    class Meta:
        model = ConsultationWorkflow
        fields = [
            'id',
            'workflow',
            'appointment_id',
            'chief_complaint',
            'hpi',
            'ros',
            'physical_exam',
            'assessment',
            'plan',
            'template_used',
        ]


class ConsultationWorkflowCreateSerializer(serializers.Serializer):
    """
    Serializer for creating a new consultation workflow
    """
    patient_id = serializers.UUIDField(required=True)
    appointment_id = serializers.CharField(required=False, allow_blank=True)
    initial_data = serializers.JSONField(required=False, default=dict)

    def validate_patient_id(self, value):
        """Validate patient exists"""
        try:
            PatientProfile.objects.get(id=value)
        except PatientProfile.DoesNotExist:
            raise serializers.ValidationError("Patient not found")
        return value


class ConsultationWorkflowUpdateSerializer(serializers.Serializer):
    """
    Serializer for updating consultation workflow step data
    """
    step_data = serializers.JSONField(required=True)
    next_step = serializers.IntegerField(required=False)

    # Optional consultation-specific fields
    chief_complaint = serializers.CharField(required=False, allow_blank=True)
    hpi = serializers.CharField(required=False, allow_blank=True)
    ros = serializers.CharField(required=False, allow_blank=True)
    physical_exam = serializers.CharField(required=False, allow_blank=True)
    assessment = serializers.CharField(required=False, allow_blank=True)
    plan = serializers.CharField(required=False, allow_blank=True)
    template_used = serializers.CharField(required=False, allow_blank=True)


class ConsultationWorkflowCompleteSerializer(serializers.Serializer):
    """
    Serializer for completing consultation workflow
    """
    final_data = serializers.JSONField(required=False, default=dict)

    # Required fields for encounter creation
    encounter_type = serializers.ChoiceField(
        choices=['inpatient', 'outpatient', 'emergency'],
        default='outpatient'
    )
    encounter_status = serializers.ChoiceField(
        choices=['planned', 'in-progress', 'finished'],
        default='finished'
    )


class WorkflowTemplateSerializer(serializers.ModelSerializer):
    """
    Serializer for WorkflowTemplate model
    """
    workflow_type_display = serializers.CharField(source='get_workflow_type_display', read_only=True)
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = WorkflowTemplate
        fields = [
            'id',
            'name',
            'workflow_type',
            'workflow_type_display',
            'description',
            'template_data',
            'specialty',
            'is_public',
            'created_by',
            'created_by_name',
            'usage_count',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'usage_count', 'created_at', 'updated_at']

    def get_created_by_name(self, obj):
        """Get creator's full name"""
        if obj.created_by:
            return obj.created_by.get_full_name()
        return "System"


class WorkflowDraftSerializer(serializers.Serializer):
    """
    Serializer for saving workflow draft
    """
    context_data = serializers.JSONField(required=True)
