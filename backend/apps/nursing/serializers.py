from rest_framework import serializers
from .models import (
    VitalSigns, NursingTask, NursingAlert, MedicationAdministration,
    ShiftHandoff, TreatmentSheetEntry, SupplyRequest, FluidBalance
)
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
            'encounter', 'temperature', 'heart_rate', 'blood_pressure_systolic',
            'blood_pressure_diastolic', 'blood_pressure', 'respiratory_rate',
            'oxygen_saturation', 'pain_level', 'recorded_at', 'notes', 'is_critical',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'is_critical', 'created_at', 'updated_at']


class VitalSignsCreateSerializer(serializers.ModelSerializer):
    """
    Serializer for creating vital signs.
    """
    class Meta:
        model = VitalSigns
        fields = [
            'patient', 'recorded_by', 'encounter', 'temperature', 'heart_rate',
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
    dispensed_by_details = UserSerializer(source='dispensed_by', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = MedicationAdministration
        fields = [
            'id', 'patient', 'patient_details', 'medication_name', 'dosage', 'route',
            'frequency', 'scheduled_time', 'administered_time', 'status', 'status_display',
            'administered_by', 'administered_by_details', 'administration_notes',
            'reason_not_given', 'prescribed_by', 'prescribed_by_details',
            'prescription', 'is_dispensed', 'dispensed_at', 'dispensed_by', 'dispensed_by_details',
            'created_at', 'updated_at', 'created_by', 'created_by_details'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'is_dispensed', 'dispensed_at', 'dispensed_by']


class MedicationDispensingListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for pharmacy dispensing queue.
    Only includes essential fields to reduce network payload.
    """
    patient_name = serializers.SerializerMethodField()
    patient_mrn = serializers.CharField(source='patient.medical_record_number', read_only=True)
    patient_ward = serializers.CharField(source='patient.current_ward', read_only=True)
    prescriber_name = serializers.SerializerMethodField()
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    is_overdue = serializers.SerializerMethodField()

    class Meta:
        model = MedicationAdministration
        fields = [
            'id', 'patient', 'patient_name', 'patient_mrn', 'patient_ward',
            'medication_name', 'dosage', 'route', 'frequency',
            'scheduled_time', 'status', 'status_display',
            'prescriber_name', 'prescription', 'is_dispensed', 'is_overdue'
        ]

    def get_patient_name(self, obj):
        """Get patient full name."""
        if obj.patient and obj.patient.user:
            return obj.patient.user.get_full_name()
        return 'Unknown Patient'

    def get_prescriber_name(self, obj):
        """Get prescriber full name."""
        if obj.prescribed_by and obj.prescribed_by.staff and obj.prescribed_by.staff.user:
            return f"Dr. {obj.prescribed_by.staff.user.get_full_name()}"
        return None

    def get_is_overdue(self, obj):
        """Check if medication is past its scheduled time."""
        from django.utils import timezone
        if obj.scheduled_time:
            return obj.scheduled_time < timezone.now()
        return False


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


# =============================================================================
# LIST SERIALIZERS - Lightweight serializers for list views
# These reduce payload sizes by 50-90% compared to full serializers
# =============================================================================

class VitalSignsListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for vital signs lists.
    Removes nested patient/practitioner details.

    Payload reduction: ~70% (12 fields vs full nested details)
    """
    patient_name = serializers.SerializerMethodField()
    patient_mrn = serializers.CharField(source='patient.medical_record_number', read_only=True)
    recorded_by_name = serializers.SerializerMethodField()
    blood_pressure = serializers.ReadOnlyField()

    class Meta:
        model = VitalSigns
        fields = [
            'id', 'patient', 'patient_name', 'patient_mrn',
            'temperature', 'heart_rate', 'blood_pressure',
            'respiratory_rate', 'oxygen_saturation', 'pain_level',
            'is_critical', 'recorded_at', 'recorded_by_name'
        ]

    def get_patient_name(self, obj):
        if obj.patient and obj.patient.user:
            return obj.patient.user.get_full_name()
        return None

    def get_recorded_by_name(self, obj):
        if obj.recorded_by and obj.recorded_by.staff and obj.recorded_by.staff.user:
            return obj.recorded_by.staff.user.get_full_name()
        return None


class NursingTaskListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for nursing task lists.
    Removes nested patient/practitioner details.

    Payload reduction: ~60% (11 fields vs full nested details)
    """
    patient_name = serializers.SerializerMethodField()
    patient_mrn = serializers.CharField(source='patient.medical_record_number', read_only=True)
    assigned_to_name = serializers.SerializerMethodField()

    class Meta:
        model = NursingTask
        fields = [
            'id', 'patient', 'patient_name', 'patient_mrn',
            'task_type', 'description', 'scheduled_time',
            'priority', 'status', 'assigned_to_name',
            'created_at'
        ]

    def get_patient_name(self, obj):
        if obj.patient and obj.patient.user:
            return obj.patient.user.get_full_name()
        return None

    def get_assigned_to_name(self, obj):
        if obj.assigned_to and obj.assigned_to.staff and obj.assigned_to.staff.user:
            return obj.assigned_to.staff.user.get_full_name()
        return None


class NursingAlertListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for nursing alert lists.
    Removes nested vital signs and patient details.

    Payload reduction: ~70% (10 fields vs full nested details)
    """
    patient_name = serializers.SerializerMethodField()
    patient_mrn = serializers.CharField(source='patient.medical_record_number', read_only=True)

    class Meta:
        model = NursingAlert
        fields = [
            'id', 'patient', 'patient_name', 'patient_mrn',
            'alert_type', 'severity', 'message',
            'is_acknowledged', 'acknowledged_at', 'created_at'
        ]

    def get_patient_name(self, obj):
        if obj.patient and obj.patient.user:
            return obj.patient.user.get_full_name()
        return None


class MedicationAdministrationListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for MAR (Medication Administration Record) lists.
    Removes 5 nested serializers, uses names instead.

    Payload reduction: ~81% (~1.5KB vs ~8KB per item)
    """
    patient_name = serializers.SerializerMethodField()
    patient_mrn = serializers.CharField(source='patient.medical_record_number', read_only=True)
    prescriber_name = serializers.SerializerMethodField()
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = MedicationAdministration
        fields = [
            'id', 'patient', 'patient_name', 'patient_mrn',
            'medication_name', 'dosage', 'route', 'frequency',
            'scheduled_time', 'status', 'status_display',
            'prescriber_name', 'prescription', 'is_dispensed'
        ]

    def get_patient_name(self, obj):
        if obj.patient and obj.patient.user:
            return obj.patient.user.get_full_name()
        return 'Unknown Patient'

    def get_prescriber_name(self, obj):
        if obj.prescribed_by and obj.prescribed_by.staff and obj.prescribed_by.staff.user:
            return f"Dr. {obj.prescribed_by.staff.user.get_full_name()}"
        return None


class ShiftHandoffListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for shift handoff lists.
    Removes nested patient/nurse details.

    Payload reduction: ~65% (11 fields vs full nested details)
    """
    patient_name = serializers.SerializerMethodField()
    patient_mrn = serializers.CharField(source='patient.medical_record_number', read_only=True)
    from_nurse_name = serializers.SerializerMethodField()
    to_nurse_name = serializers.SerializerMethodField()

    class Meta:
        model = ShiftHandoff
        fields = [
            'id', 'patient', 'patient_name', 'patient_mrn',
            'shift_date', 'shift_type',
            'from_nurse_name', 'to_nurse_name',
            'patient_condition', 'created_at'
        ]

    def get_patient_name(self, obj):
        if obj.patient and obj.patient.user:
            return obj.patient.user.get_full_name()
        return None

    def get_from_nurse_name(self, obj):
        if obj.from_nurse and obj.from_nurse.staff and obj.from_nurse.staff.user:
            return obj.from_nurse.staff.user.get_full_name()
        return None

    def get_to_nurse_name(self, obj):
        if obj.to_nurse and obj.to_nurse.staff and obj.to_nurse.staff.user:
            return obj.to_nurse.staff.user.get_full_name()
        return None


class PatientMonitoringListSerializer(serializers.Serializer):
    """
    Lightweight serializer for patient monitoring dashboard list.
    Returns summary counts instead of full nested objects.

    Payload reduction: ~97% (~800 bytes vs ~25KB per patient)
    """
    patient_id = serializers.UUIDField(source='patient.id')
    patient_name = serializers.SerializerMethodField()
    patient_mrn = serializers.CharField(source='patient.medical_record_number')

    # Admission summary (flattened)
    ward_id = serializers.SerializerMethodField()
    ward_name = serializers.SerializerMethodField()
    bed_number = serializers.SerializerMethodField()
    admission_date = serializers.SerializerMethodField()

    # Vitals summary (not full object)
    latest_vitals_at = serializers.SerializerMethodField()
    is_critical = serializers.SerializerMethodField()

    # Counts only (not full lists)
    active_alerts_count = serializers.SerializerMethodField()
    pending_tasks_count = serializers.SerializerMethodField()
    medications_due_count = serializers.SerializerMethodField()

    def get_patient_name(self, obj):
        patient = obj.get('patient') if isinstance(obj, dict) else obj.patient
        if patient and patient.user:
            return patient.user.get_full_name()
        return 'Unknown'

    def get_ward_id(self, obj):
        admission = obj.get('admission') if isinstance(obj, dict) else getattr(obj, 'admission', None)
        if admission and admission.bed and admission.bed.ward:
            return str(admission.bed.ward.id)
        return None

    def get_ward_name(self, obj):
        admission = obj.get('admission') if isinstance(obj, dict) else getattr(obj, 'admission', None)
        if admission and admission.bed and admission.bed.ward:
            return admission.bed.ward.name
        return None

    def get_bed_number(self, obj):
        admission = obj.get('admission') if isinstance(obj, dict) else getattr(obj, 'admission', None)
        if admission and admission.bed:
            return admission.bed.bed_number
        return None

    def get_admission_date(self, obj):
        admission = obj.get('admission') if isinstance(obj, dict) else getattr(obj, 'admission', None)
        if admission:
            return admission.admission_date
        return None

    def get_latest_vitals_at(self, obj):
        vitals = obj.get('latest_vitals') if isinstance(obj, dict) else getattr(obj, 'latest_vitals', None)
        if vitals:
            return vitals.recorded_at
        return None

    def get_is_critical(self, obj):
        vitals = obj.get('latest_vitals') if isinstance(obj, dict) else getattr(obj, 'latest_vitals', None)
        if vitals:
            return vitals.is_critical
        return False

    def get_active_alerts_count(self, obj):
        alerts = obj.get('active_alerts') if isinstance(obj, dict) else getattr(obj, 'active_alerts', [])
        return len(alerts) if alerts else 0

    def get_pending_tasks_count(self, obj):
        tasks = obj.get('pending_tasks') if isinstance(obj, dict) else getattr(obj, 'pending_tasks', [])
        return len(tasks) if tasks else 0

    def get_medications_due_count(self, obj):
        meds = obj.get('medications_due') if isinstance(obj, dict) else getattr(obj, 'medications_due', [])
        return len(meds) if meds else 0


# ============================================================================
# Treatment Sheet Serializers
# ============================================================================


class TreatmentSheetEntrySerializer(serializers.ModelSerializer):
    """
    Full serializer for TreatmentSheetEntry with nested relationships.
    """
    patient_details = PatientProfileSerializer(source='patient', read_only=True)
    patient_name = serializers.SerializerMethodField()
    patient_mrn = serializers.SerializerMethodField()

    ordered_by_details = PractitionerProfileSerializer(source='ordered_by', read_only=True)
    ordered_by_name = serializers.SerializerMethodField()

    discontinued_by_details = PractitionerProfileSerializer(source='discontinued_by', read_only=True)

    # Supply tracking computed fields
    supply_remaining = serializers.ReadOnlyField()
    days_of_supply_remaining = serializers.ReadOnlyField()

    # Aggregate counts
    pending_supply_requests_count = serializers.SerializerMethodField()

    class Meta:
        model = TreatmentSheetEntry
        fields = [
            'id', 'patient', 'patient_details', 'patient_name', 'patient_mrn',
            'admission', 'encounter',
            'medication_name', 'dosage', 'route', 'frequency',
            'start_datetime', 'duration_days', 'end_datetime',
            'status', 'ordered_by', 'ordered_by_details', 'ordered_by_name',
            'total_doses_ordered', 'total_doses_dispensed', 'total_doses_administered',
            'supply_remaining', 'days_of_supply_remaining',
            'prescription', 'discontinued_at', 'discontinued_by',
            'discontinued_by_details', 'discontinuation_reason',
            'pending_supply_requests_count',
            'created_at', 'updated_at', 'created_by'
        ]
        read_only_fields = [
            'id', 'total_doses_ordered', 'total_doses_dispensed',
            'total_doses_administered', 'created_at', 'updated_at'
        ]

    def get_patient_name(self, obj):
        if obj.patient and obj.patient.user:
            return obj.patient.user.get_full_name()
        return 'Unknown Patient'

    def get_patient_mrn(self, obj):
        if obj.patient:
            return obj.patient.medical_record_number
        return None

    def get_ordered_by_name(self, obj):
        if obj.ordered_by and obj.ordered_by.staff and obj.ordered_by.staff.user:
            return f"Dr. {obj.ordered_by.staff.user.get_full_name()}"
        return 'Unknown'

    def get_pending_supply_requests_count(self, obj):
        return obj.supply_requests.filter(status='pending').count()


class TreatmentSheetEntryListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for list views (following CLAUDE.md API optimization).
    """
    patient_name = serializers.SerializerMethodField()
    patient_mrn = serializers.SerializerMethodField()
    ordered_by_name = serializers.SerializerMethodField()
    supply_remaining = serializers.ReadOnlyField()
    days_of_supply_remaining = serializers.ReadOnlyField()

    class Meta:
        model = TreatmentSheetEntry
        fields = [
            'id', 'patient', 'patient_name', 'patient_mrn',
            'admission', 'medication_name', 'dosage', 'route', 'frequency',
            'start_datetime', 'status', 'ordered_by_name',
            'total_doses_ordered', 'total_doses_dispensed', 'total_doses_administered',
            'supply_remaining', 'days_of_supply_remaining',
            'created_at'
        ]

    def get_patient_name(self, obj):
        if obj.patient and obj.patient.user:
            return obj.patient.user.get_full_name()
        return 'Unknown Patient'

    def get_patient_mrn(self, obj):
        if obj.patient:
            return obj.patient.medical_record_number
        return None

    def get_ordered_by_name(self, obj):
        if obj.ordered_by and obj.ordered_by.staff and obj.ordered_by.staff.user:
            return f"Dr. {obj.ordered_by.staff.user.get_full_name()}"
        return 'Unknown'


class TreatmentSheetEntryCreateSerializer(serializers.ModelSerializer):
    """
    Serializer for creating treatment sheet entries.
    """
    class Meta:
        model = TreatmentSheetEntry
        fields = [
            'patient', 'admission', 'encounter',
            'medication_name', 'dosage', 'route', 'frequency',
            'start_datetime', 'duration_days', 'end_datetime',
            'ordered_by', 'prescription'
        ]

    def validate(self, data):
        # Ensure admission belongs to patient
        if data['admission'].patient != data['patient']:
            raise serializers.ValidationError("Admission must belong to the specified patient.")

        # Ensure end_datetime is after start_datetime
        if data.get('end_datetime') and data['end_datetime'] <= data['start_datetime']:
            raise serializers.ValidationError("End datetime must be after start datetime.")

        return data


class SupplyRequestSerializer(serializers.ModelSerializer):
    """
    Full serializer for SupplyRequest with nested relationships.
    """
    treatment_entry_details = TreatmentSheetEntrySerializer(source='treatment_entry', read_only=True)
    medication_name = serializers.SerializerMethodField()
    patient_name = serializers.SerializerMethodField()
    patient_mrn = serializers.SerializerMethodField()
    ward_name = serializers.SerializerMethodField()

    requested_by_details = PractitionerProfileSerializer(source='requested_by', read_only=True)
    requested_by_name = serializers.SerializerMethodField()

    dispensed_by_details = UserSerializer(source='dispensed_by', read_only=True)

    class Meta:
        model = SupplyRequest
        fields = [
            'id', 'treatment_entry', 'treatment_entry_details',
            'medication_name', 'patient_name', 'patient_mrn', 'ward_name',
            'quantity_requested', 'quantity_dispensed', 'status',
            'requested_by', 'requested_by_details', 'requested_by_name', 'requested_at',
            'dispensed_by', 'dispensed_by_details', 'dispensed_at',
            'rejection_reason', 'notes'
        ]
        read_only_fields = ['id', 'requested_at', 'dispensed_at']

    def get_medication_name(self, obj):
        return obj.treatment_entry.medication_name

    def get_patient_name(self, obj):
        if obj.treatment_entry.patient and obj.treatment_entry.patient.user:
            return obj.treatment_entry.patient.user.get_full_name()
        return 'Unknown Patient'

    def get_patient_mrn(self, obj):
        if obj.treatment_entry.patient:
            return obj.treatment_entry.patient.medical_record_number
        return None

    def get_ward_name(self, obj):
        if obj.treatment_entry.admission and obj.treatment_entry.admission.bed:
            return obj.treatment_entry.admission.bed.ward.name
        return 'Unknown'

    def get_requested_by_name(self, obj):
        if obj.requested_by and obj.requested_by.staff and obj.requested_by.staff.user:
            return obj.requested_by.staff.user.get_full_name()
        return 'Unknown'


class SupplyRequestListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for supply request lists (API optimization).
    """
    medication_name = serializers.SerializerMethodField()
    patient_name = serializers.SerializerMethodField()
    patient_mrn = serializers.SerializerMethodField()
    ward_name = serializers.SerializerMethodField()
    requested_by_name = serializers.SerializerMethodField()

    class Meta:
        model = SupplyRequest
        fields = [
            'id', 'treatment_entry', 'medication_name',
            'patient_name', 'patient_mrn', 'ward_name',
            'quantity_requested', 'quantity_dispensed', 'status',
            'requested_by_name', 'requested_at'
        ]

    def get_medication_name(self, obj):
        return obj.treatment_entry.medication_name

    def get_patient_name(self, obj):
        if obj.treatment_entry.patient and obj.treatment_entry.patient.user:
            return obj.treatment_entry.patient.user.get_full_name()
        return 'Unknown Patient'

    def get_patient_mrn(self, obj):
        if obj.treatment_entry.patient:
            return obj.treatment_entry.patient.medical_record_number
        return None

    def get_ward_name(self, obj):
        if obj.treatment_entry.admission and obj.treatment_entry.admission.bed:
            return obj.treatment_entry.admission.bed.ward.name
        return 'Unknown'

    def get_requested_by_name(self, obj):
        if obj.requested_by and obj.requested_by.staff and obj.requested_by.staff.user:
            return obj.requested_by.staff.user.get_full_name()
        return 'Unknown'


class SupplyRequestCreateSerializer(serializers.ModelSerializer):
    """
    Serializer for creating supply requests.
    """
    class Meta:
        model = SupplyRequest
        fields = [
            'treatment_entry', 'quantity_requested',
            'requested_by', 'notes'
        ]

    def validate_quantity_requested(self, value):
        if value <= 0:
            raise serializers.ValidationError("Quantity requested must be greater than 0.")
        return value


# =============================================================================
# Fluid Balance Serializers
# =============================================================================

class FluidBalanceSerializer(serializers.ModelSerializer):
    """
    Full serializer for FluidBalance with nested relationships and audit info.
    """
    patient_details = PatientProfileSerializer(source='patient', read_only=True)
    recorded_by_details = PractitionerProfileSerializer(source='recorded_by', read_only=True)
    created_by_details = UserSerializer(source='created_by', read_only=True)
    modified_by_details = UserSerializer(source='modified_by', read_only=True)
    entry_type_display = serializers.CharField(source='get_entry_type_display', read_only=True)

    class Meta:
        model = FluidBalance
        fields = [
            'id', 'patient', 'patient_details', 'admission',
            'entry_type', 'entry_type_display', 'category', 'subcategory',
            'volume_ml', 'recorded_at', 'recorded_by', 'recorded_by_details',
            'notes', 'colour', 'created_at', 'updated_at',
            'created_by', 'created_by_details',
            'modified_by', 'modified_by_details',
            'is_deleted', 'deleted_at', 'deleted_by', 'deletion_reason'
        ]
        read_only_fields = [
            'id', 'created_at', 'updated_at', 'created_by', 'modified_by',
            'is_deleted', 'deleted_at', 'deleted_by', 'deletion_reason'
        ]


class FluidBalanceListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for fluid balance lists.
    Removes nested patient/practitioner details.

    Payload reduction: ~65% (11 fields vs full nested details)
    """
    patient_name = serializers.SerializerMethodField()
    patient_mrn = serializers.CharField(source='patient.medical_record_number', read_only=True)
    recorded_by_name = serializers.SerializerMethodField()
    entry_type_display = serializers.CharField(source='get_entry_type_display', read_only=True)

    class Meta:
        model = FluidBalance
        fields = [
            'id', 'patient', 'patient_name', 'patient_mrn',
            'entry_type', 'entry_type_display', 'category', 'subcategory',
            'volume_ml', 'recorded_at', 'recorded_by_name', 'notes', 'colour'
        ]

    def get_patient_name(self, obj):
        if obj.patient and obj.patient.user:
            return obj.patient.user.get_full_name()
        return None

    def get_recorded_by_name(self, obj):
        if obj.recorded_by and obj.recorded_by.staff and obj.recorded_by.staff.user:
            return obj.recorded_by.staff.user.get_full_name()
        return None


class FluidBalanceCreateSerializer(serializers.ModelSerializer):
    """
    Serializer for creating fluid balance entries.
    """
    class Meta:
        model = FluidBalance
        fields = [
            'patient', 'admission', 'entry_type', 'category',
            'subcategory', 'volume_ml', 'recorded_at', 'notes', 'colour'
        ]

    def validate_volume_ml(self, value):
        if value <= 0:
            raise serializers.ValidationError("Volume must be greater than 0.")
        if value > 10000:
            raise serializers.ValidationError("Volume cannot exceed 10000ml.")
        return value

    def validate(self, data):
        """Validate category based on entry type."""
        entry_type = data.get('entry_type')
        category = data.get('category')

        valid_intake_categories = ['oral', 'iv', 'enteral', 'blood']
        valid_output_categories = ['urine', 'vomit', 'stool', 'drain', 'ng_suction', 'other']

        if entry_type == 'intake' and category not in valid_intake_categories:
            raise serializers.ValidationError({
                'category': f"For intake, category must be one of: {', '.join(valid_intake_categories)}"
            })

        if entry_type == 'output' and category not in valid_output_categories:
            raise serializers.ValidationError({
                'category': f"For output, category must be one of: {', '.join(valid_output_categories)}"
            })

        return data


class FluidBalanceSummarySerializer(serializers.Serializer):
    """
    Serializer for fluid balance summary/totals.
    """
    total_intake = serializers.IntegerField()
    total_output = serializers.IntegerField()
    balance = serializers.IntegerField()
    date = serializers.DateField()
    patient = serializers.UUIDField()

    # Optional breakdown by category
    intake_breakdown = serializers.DictField(required=False)
    output_breakdown = serializers.DictField(required=False)
