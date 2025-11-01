from rest_framework import serializers
from .models import VitalSigns, NursingTask, NursingAlert, MedicationAdministration, ShiftHandoff
from ..users.serializers import PatientProfileSerializer, PractitionerProfileSerializer, UserSerializer


class VitalSignsSerializer(serializers.ModelSerializer):
    """
    Serializer for VitalSigns model.
    """
    patient_details = PatientProfileSerializer(source='patient', read_only=True)
    recorded_by_details = PractitionerProfileSerializer(source='recorded_by', read_only=True)
    blood_pressure = serializers.ReadOnlyField()

    class Meta:
        model = VitalSigns
        fields = [
            'id', 'patient', 'patient_details', 'recorded_by', 'recorded_by_details',
            'temperature', 'heart_rate', 'blood_pressure_systolic', 'blood_pressure_diastolic',
            'blood_pressure', 'respiratory_rate', 'oxygen_saturation', 'pain_level',
            'recorded_at', 'notes', 'is_critical', 'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'is_critical', 'created_at', 'updated_at']


class VitalSignsCreateSerializer(serializers.ModelSerializer):
    """
    Serializer for creating vital signs.
    """
    class Meta:
        model = VitalSigns
        fields = [
            'patient', 'recorded_by', 'temperature', 'heart_rate',
            'blood_pressure_systolic', 'blood_pressure_diastolic',
            'respiratory_rate', 'oxygen_saturation', 'pain_level',
            'recorded_at', 'notes'
        ]

    def validate(self, data):
        """Validate vital signs values."""
        # Ensure at least one vital sign is recorded
        vital_fields = ['temperature', 'heart_rate', 'blood_pressure_systolic',
                       'respiratory_rate', 'oxygen_saturation']

        if not any(data.get(field) for field in vital_fields):
            raise serializers.ValidationError("At least one vital sign must be recorded.")

        # Validate blood pressure pair
        if data.get('blood_pressure_systolic') and not data.get('blood_pressure_diastolic'):
            raise serializers.ValidationError("Both systolic and diastolic values required for blood pressure.")

        if data.get('blood_pressure_diastolic') and not data.get('blood_pressure_systolic'):
            raise serializers.ValidationError("Both systolic and diastolic values required for blood pressure.")

        return data


class NursingTaskSerializer(serializers.ModelSerializer):
    """
    Serializer for NursingTask model.
    """
    patient_details = PatientProfileSerializer(source='patient', read_only=True)
    assigned_to_details = PractitionerProfileSerializer(source='assigned_to', read_only=True)
    completed_by_details = PractitionerProfileSerializer(source='completed_by', read_only=True)
    created_by_details = UserSerializer(source='created_by', read_only=True)

    class Meta:
        model = NursingTask
        fields = [
            'id', 'patient', 'patient_details', 'task_type', 'description',
            'scheduled_time', 'completed_time', 'assigned_to', 'assigned_to_details',
            'priority', 'status', 'completed_by', 'completed_by_details',
            'completion_notes', 'created_at', 'updated_at', 'created_by', 'created_by_details'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class NursingTaskCreateSerializer(serializers.ModelSerializer):
    """
    Serializer for creating nursing tasks.
    """
    class Meta:
        model = NursingTask
        fields = [
            'patient', 'task_type', 'description', 'scheduled_time',
            'assigned_to', 'priority'
        ]


class NursingTaskUpdateSerializer(serializers.ModelSerializer):
    """
    Serializer for updating nursing task status.
    """
    class Meta:
        model = NursingTask
        fields = ['status', 'completed_by', 'completed_time', 'completion_notes']


class NursingAlertSerializer(serializers.ModelSerializer):
    """
    Serializer for NursingAlert model.
    """
    patient_details = PatientProfileSerializer(source='patient', read_only=True)
    acknowledged_by_details = PractitionerProfileSerializer(source='acknowledged_by', read_only=True)
    related_vital_signs_details = VitalSignsSerializer(source='related_vital_signs', read_only=True)

    class Meta:
        model = NursingAlert
        fields = [
            'id', 'patient', 'patient_details', 'alert_type', 'severity', 'message',
            'related_vital_signs', 'related_vital_signs_details', 'related_task',
            'is_acknowledged', 'acknowledged_by', 'acknowledged_by_details',
            'acknowledged_at', 'resolution_notes', 'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class NursingAlertAcknowledgeSerializer(serializers.Serializer):
    """
    Serializer for acknowledging alerts.
    """
    resolution_notes = serializers.CharField(required=False, allow_blank=True)


class MedicationAdministrationSerializer(serializers.ModelSerializer):
    """
    Serializer for MedicationAdministration model.
    """
    patient_details = PatientProfileSerializer(source='patient', read_only=True)
    administered_by_details = PractitionerProfileSerializer(source='administered_by', read_only=True)
    prescribed_by_details = PractitionerProfileSerializer(source='prescribed_by', read_only=True)
    created_by_details = UserSerializer(source='created_by', read_only=True)

    class Meta:
        model = MedicationAdministration
        fields = [
            'id', 'patient', 'patient_details', 'medication_name', 'dosage', 'route',
            'frequency', 'scheduled_time', 'administered_time', 'status',
            'administered_by', 'administered_by_details', 'administration_notes',
            'reason_not_given', 'prescribed_by', 'prescribed_by_details',
            'created_at', 'updated_at', 'created_by', 'created_by_details'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class MedicationAdministrationCreateSerializer(serializers.ModelSerializer):
    """
    Serializer for creating medication administrations.
    """
    class Meta:
        model = MedicationAdministration
        fields = [
            'patient', 'medication_name', 'dosage', 'route', 'frequency',
            'scheduled_time', 'prescribed_by'
        ]


class MedicationAdministrationUpdateSerializer(serializers.ModelSerializer):
    """
    Serializer for updating medication administration.
    """
    class Meta:
        model = MedicationAdministration
        fields = [
            'status', 'administered_by', 'administered_time',
            'administration_notes', 'reason_not_given'
        ]

    def validate(self, data):
        """Validate medication administration update."""
        status = data.get('status')

        if status in ['missed', 'refused', 'held'] and not data.get('reason_not_given'):
            raise serializers.ValidationError({
                'reason_not_given': 'Reason is required when medication is not administered.'
            })

        if status == 'administered' and not data.get('administered_by'):
            raise serializers.ValidationError({
                'administered_by': 'Nurse information required when administering medication.'
            })

        return data


class ShiftHandoffSerializer(serializers.ModelSerializer):
    """
    Serializer for ShiftHandoff model.
    """
    patient_details = PatientProfileSerializer(source='patient', read_only=True)
    from_nurse_details = PractitionerProfileSerializer(source='from_nurse', read_only=True)
    to_nurse_details = PractitionerProfileSerializer(source='to_nurse', read_only=True)
    created_by_details = UserSerializer(source='created_by', read_only=True)

    class Meta:
        model = ShiftHandoff
        fields = [
            'id', 'patient', 'patient_details', 'shift_date', 'shift_type',
            'from_nurse', 'from_nurse_details', 'to_nurse', 'to_nurse_details',
            'patient_condition', 'ongoing_issues', 'pending_tasks',
            'medication_changes', 'key_events', 'care_plan_updates',
            'family_updates', 'created_at', 'updated_at', 'created_by',
            'created_by_details'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class PatientMonitoringSerializer(serializers.Serializer):
    """
    Serializer for patient monitoring dashboard data.
    """
    patient = PatientProfileSerializer()
    admission = serializers.SerializerMethodField()
    latest_vitals = VitalSignsSerializer()
    active_alerts = NursingAlertSerializer(many=True)
    pending_tasks = NursingTaskSerializer(many=True)
    medications_due = MedicationAdministrationSerializer(many=True)

    def get_admission(self, obj):
        """Get current admission details."""
        from ..wards.serializers import AdmissionSerializer
        admission = obj.get('admission')
        if admission:
            return AdmissionSerializer(admission).data
        return None
