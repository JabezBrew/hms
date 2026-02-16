from rest_framework import serializers
from .models import (
    ClinicalWorkflow, ConsultationWorkflow, ClinicalNoteWorkflow,
    WardRoundWorkflow, AdmissionWorkflow, DischargeWorkflow,
    WorkflowTemplate, ClinicalNoteType
)
from apps.users.models import PatientProfile
from apps.wards.models import Admission


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


# ============================================
# Clinical Note Workflow Serializers
# ============================================

class ClinicalNoteWorkflowSerializer(serializers.ModelSerializer):
    """
    Serializer for ClinicalNoteWorkflow model
    """
    workflow = ClinicalWorkflowSerializer(read_only=True)
    note_type_display = serializers.CharField(source='get_note_type_display', read_only=True)

    class Meta:
        model = ClinicalNoteWorkflow
        fields = [
            'id',
            'workflow',
            'note_type',
            'note_type_display',
            # Common fields
            'chief_complaint',
            'assessment',
            'plan',
            # SOAP fields
            'subjective',
            'objective',
            'hpi',
            'ros',
            'physical_exam',
            'vitals',
            # Procedure fields
            'procedure_name',
            'indication',
            'consent',
            'pre_assessment',
            'anesthesia',
            'technique',
            'specimens',
            'ebl',
            'complications',
            'complication_details',
            'patient_condition',
            'disposition',
            'post_instructions',
            # Phone fields
            'caller_name',
            'caller_relationship',
            'callback_number',
            'reason_for_call',
            'symptoms_discussed',
            'advice_given',
            'urgency',
            'actions_taken',
            'pending_actions',
            'callback_needed',
            # Common
            'follow_up',
            'patient_education',
        ]


class ClinicalNoteWorkflowCreateSerializer(serializers.Serializer):
    """
    Serializer for creating a new clinical note workflow
    """
    patient_id = serializers.UUIDField(required=True)
    note_type = serializers.ChoiceField(
        choices=ClinicalNoteType.choices,
        required=True
    )
    template_id = serializers.UUIDField(required=False, allow_null=True)
    template_revision_id = serializers.UUIDField(required=False, allow_null=True)
    initial_data = serializers.JSONField(required=False, default=dict)

    def validate_patient_id(self, value):
        """Validate patient exists"""
        try:
            PatientProfile.objects.get(id=value)
        except PatientProfile.DoesNotExist:
            raise serializers.ValidationError("Patient not found")
        return value


class ClinicalNoteWorkflowUpdateSerializer(serializers.Serializer):
    """
    Serializer for updating clinical note workflow step data
    """
    step_data = serializers.JSONField(required=True)
    next_step = serializers.IntegerField(required=False)

    # Common fields
    chief_complaint = serializers.CharField(required=False, allow_blank=True)
    assessment = serializers.CharField(required=False, allow_blank=True)
    plan = serializers.CharField(required=False, allow_blank=True)
    follow_up = serializers.CharField(required=False, allow_blank=True)
    patient_education = serializers.CharField(required=False, allow_blank=True)

    # SOAP fields
    subjective = serializers.CharField(required=False, allow_blank=True)
    objective = serializers.CharField(required=False, allow_blank=True)
    hpi = serializers.CharField(required=False, allow_blank=True)
    ros = serializers.CharField(required=False, allow_blank=True)
    physical_exam = serializers.CharField(required=False, allow_blank=True)
    vitals = serializers.JSONField(required=False)

    # Procedure fields
    procedure_name = serializers.CharField(required=False, allow_blank=True)
    indication = serializers.CharField(required=False, allow_blank=True)
    consent = serializers.CharField(required=False, allow_blank=True)
    pre_assessment = serializers.CharField(required=False, allow_blank=True)
    anesthesia = serializers.CharField(required=False, allow_blank=True)
    technique = serializers.CharField(required=False, allow_blank=True)
    specimens = serializers.CharField(required=False, allow_blank=True)
    ebl = serializers.CharField(required=False, allow_blank=True)
    complications = serializers.CharField(required=False, allow_blank=True)
    complication_details = serializers.CharField(required=False, allow_blank=True)
    patient_condition = serializers.CharField(required=False, allow_blank=True)
    disposition = serializers.CharField(required=False, allow_blank=True)
    post_instructions = serializers.CharField(required=False, allow_blank=True)

    # Phone fields
    caller_name = serializers.CharField(required=False, allow_blank=True)
    caller_relationship = serializers.CharField(required=False, allow_blank=True)
    callback_number = serializers.CharField(required=False, allow_blank=True)
    reason_for_call = serializers.CharField(required=False, allow_blank=True)
    symptoms_discussed = serializers.CharField(required=False, allow_blank=True)
    advice_given = serializers.CharField(required=False, allow_blank=True)
    urgency = serializers.CharField(required=False, allow_blank=True)
    actions_taken = serializers.CharField(required=False, allow_blank=True)
    pending_actions = serializers.CharField(required=False, allow_blank=True)
    callback_needed = serializers.CharField(required=False, allow_blank=True)


class ClinicalNoteWorkflowCompleteSerializer(serializers.Serializer):
    """
    Serializer for completing clinical note workflow
    """
    final_data = serializers.JSONField(required=False, default=dict)
    template_id = serializers.UUIDField(required=False, allow_null=True)
    template_revision_id = serializers.UUIDField(required=False, allow_null=True)
    encounter_type = serializers.ChoiceField(
        choices=['inpatient', 'outpatient', 'emergency'],
        default='outpatient'
    )
    encounter_status = serializers.ChoiceField(
        choices=['planned', 'in-progress', 'finished'],
        default='finished'
    )


# ============================================
# Ward Round Workflow Serializers
# ============================================

class WardRoundWorkflowSerializer(serializers.ModelSerializer):
    """
    Serializer for WardRoundWorkflow model
    """
    workflow = ClinicalWorkflowSerializer(read_only=True)

    class Meta:
        model = WardRoundWorkflow
        fields = [
            'id',
            'workflow',
            'overnight_events',
            'nursing_concerns',
            'examination_findings',
            'vitals_reviewed',
            'assessment',
            'plan_notes',
            'orders_placed',
            'progress_note',
            'estimated_discharge',
            'discharge_planning_needed',
        ]


class WardRoundWorkflowCreateSerializer(serializers.Serializer):
    """
    Serializer for creating a new ward round workflow
    """
    patient_id = serializers.UUIDField(required=True)
    admission_id = serializers.UUIDField(required=True)
    initial_data = serializers.JSONField(required=False, default=dict)

    def validate_patient_id(self, value):
        """Validate patient exists"""
        try:
            PatientProfile.objects.get(id=value)
        except PatientProfile.DoesNotExist:
            raise serializers.ValidationError("Patient not found")
        return value

    def validate_admission_id(self, value):
        """Validate admission exists and is active"""
        try:
            admission = Admission.objects.get(id=value, status='admitted')
        except Admission.DoesNotExist:
            raise serializers.ValidationError("Active admission not found")
        return value


class WardRoundWorkflowUpdateSerializer(serializers.Serializer):
    """
    Serializer for updating ward round workflow step data
    """
    step_data = serializers.JSONField(required=True)
    next_step = serializers.IntegerField(required=False)

    # Optional ward round-specific fields
    overnight_events = serializers.CharField(required=False, allow_blank=True)
    nursing_concerns = serializers.CharField(required=False, allow_blank=True)
    examination_findings = serializers.CharField(required=False, allow_blank=True)
    vitals_reviewed = serializers.BooleanField(required=False)
    assessment = serializers.CharField(required=False, allow_blank=True)
    plan_notes = serializers.CharField(required=False, allow_blank=True)
    orders_placed = serializers.JSONField(required=False)
    progress_note = serializers.CharField(required=False, allow_blank=True)
    estimated_discharge = serializers.DateField(required=False, allow_null=True)
    discharge_planning_needed = serializers.BooleanField(required=False)


class WardRoundWorkflowCompleteSerializer(serializers.Serializer):
    """
    Serializer for completing ward round workflow
    """
    final_data = serializers.JSONField(required=False, default=dict)


# ============================================
# Admission Workflow Serializers
# ============================================

class AdmissionWorkflowSerializer(serializers.ModelSerializer):
    """
    Serializer for AdmissionWorkflow model
    """
    workflow = ClinicalWorkflowSerializer(read_only=True)

    class Meta:
        model = AdmissionWorkflow
        fields = [
            'id',
            'workflow',
            'patient_verified',
            'emergency_contact_name',
            'emergency_contact_relationship',
            'emergency_contact_phone',
            'ward_id',
            'bed_id',
            'admission_type',
            'admission_source',
            'admission_reason',
            'chief_complaint',
            'initial_diagnosis',
            'relevant_history',
            'diet',
            'activity',
            'vitals_frequency',
            'medications',
            'labs',
            'nursing_instructions',
            'admission_note',
            'expected_los',
            'attending_physician',
        ]


class AdmissionWorkflowCreateSerializer(serializers.Serializer):
    """
    Serializer for creating a new admission workflow
    """
    patient_id = serializers.UUIDField(required=True)
    initial_data = serializers.JSONField(required=False, default=dict)

    def validate_patient_id(self, value):
        """Validate patient exists"""
        try:
            PatientProfile.objects.get(id=value)
        except PatientProfile.DoesNotExist:
            raise serializers.ValidationError("Patient not found")
        return value


class AdmissionWorkflowUpdateSerializer(serializers.Serializer):
    """
    Serializer for updating admission workflow step data
    """
    step_data = serializers.JSONField(required=True)
    next_step = serializers.IntegerField(required=False)

    # Optional admission-specific fields
    patient_verified = serializers.BooleanField(required=False)
    emergency_contact_name = serializers.CharField(required=False, allow_blank=True)
    emergency_contact_relationship = serializers.CharField(required=False, allow_blank=True)
    emergency_contact_phone = serializers.CharField(required=False, allow_blank=True)
    ward_id = serializers.UUIDField(required=False, allow_null=True)
    bed_id = serializers.UUIDField(required=False, allow_null=True)
    admission_type = serializers.CharField(required=False, allow_blank=True)
    admission_source = serializers.CharField(required=False, allow_blank=True)
    admission_reason = serializers.CharField(required=False, allow_blank=True)
    chief_complaint = serializers.CharField(required=False, allow_blank=True)
    initial_diagnosis = serializers.CharField(required=False, allow_blank=True)
    relevant_history = serializers.CharField(required=False, allow_blank=True)
    diet = serializers.CharField(required=False, allow_blank=True)
    activity = serializers.CharField(required=False, allow_blank=True)
    vitals_frequency = serializers.CharField(required=False, allow_blank=True)
    medications = serializers.JSONField(required=False)
    labs = serializers.JSONField(required=False)
    nursing_instructions = serializers.CharField(required=False, allow_blank=True)
    admission_note = serializers.CharField(required=False, allow_blank=True)
    expected_los = serializers.IntegerField(required=False, allow_null=True)
    attending_physician = serializers.CharField(required=False, allow_blank=True)


class AdmissionWorkflowCompleteSerializer(serializers.Serializer):
    """
    Serializer for completing admission workflow
    """
    final_data = serializers.JSONField(required=False, default=dict)


# ============================================
# Discharge Workflow Serializers
# ============================================

class DischargeWorkflowSerializer(serializers.ModelSerializer):
    """
    Serializer for DischargeWorkflow model
    """
    workflow = ClinicalWorkflowSerializer(read_only=True)

    class Meta:
        model = DischargeWorkflow
        fields = [
            'id',
            'workflow',
            'discharge_criteria_met',
            'discharge_disposition',
            'discharge_date',
            'transportation',
            'medications_reconciled',
            'discharge_prescriptions',
            'medication_changes',
            'medication_education_completed',
            'activity_restrictions',
            'diet_instructions',
            'wound_care',
            'warning_signs',
            'follow_up_appointments',
            'discharge_summary',
            'patient_education_complete',
            'discharge_instructions_given',
            'prescriptions_sent',
        ]


class DischargeWorkflowCreateSerializer(serializers.Serializer):
    """
    Serializer for creating a new discharge workflow
    """
    patient_id = serializers.UUIDField(required=True)
    admission_id = serializers.UUIDField(required=True)
    initial_data = serializers.JSONField(required=False, default=dict)

    def validate_patient_id(self, value):
        """Validate patient exists"""
        try:
            PatientProfile.objects.get(id=value)
        except PatientProfile.DoesNotExist:
            raise serializers.ValidationError("Patient not found")
        return value

    def validate_admission_id(self, value):
        """Validate admission exists and is active"""
        try:
            Admission.objects.get(id=value, status='admitted')
        except Admission.DoesNotExist:
            raise serializers.ValidationError("Active admission not found")
        return value

    def validate(self, attrs):
        patient_id = attrs.get('patient_id')
        admission_id = attrs.get('admission_id')
        if not patient_id or not admission_id:
            return attrs

        admission = Admission.objects.filter(
            id=admission_id,
            patient_id=patient_id,
            status='admitted',
        ).first()
        if not admission:
            raise serializers.ValidationError(
                "Admission does not match the provided patient or is not active."
            )
        return attrs


class DischargeWorkflowUpdateSerializer(serializers.Serializer):
    """
    Serializer for updating discharge workflow step data
    """
    step_data = serializers.JSONField(required=True)
    next_step = serializers.IntegerField(required=False)

    # Optional discharge-specific fields
    discharge_criteria_met = serializers.JSONField(required=False)
    discharge_disposition = serializers.CharField(required=False, allow_blank=True)
    discharge_date = serializers.DateTimeField(required=False, allow_null=True)
    transportation = serializers.CharField(required=False, allow_blank=True)
    medications_reconciled = serializers.BooleanField(required=False)
    discharge_prescriptions = serializers.JSONField(required=False)
    medication_changes = serializers.CharField(required=False, allow_blank=True)
    medication_education_completed = serializers.BooleanField(required=False)
    activity_restrictions = serializers.CharField(required=False, allow_blank=True)
    diet_instructions = serializers.CharField(required=False, allow_blank=True)
    wound_care = serializers.CharField(required=False, allow_blank=True)
    warning_signs = serializers.CharField(required=False, allow_blank=True)
    follow_up_appointments = serializers.CharField(required=False, allow_blank=True)
    discharge_summary = serializers.CharField(required=False, allow_blank=True)
    patient_education_complete = serializers.BooleanField(required=False)
    discharge_instructions_given = serializers.BooleanField(required=False)
    prescriptions_sent = serializers.BooleanField(required=False)


class DischargeWorkflowCompleteSerializer(serializers.Serializer):
    """
    Serializer for completing discharge workflow
    """
    final_data = serializers.JSONField(required=False, default=dict)
    idempotency_key = serializers.CharField(required=False, allow_blank=False)
