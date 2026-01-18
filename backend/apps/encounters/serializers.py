"""
Encounter serializers for API data transformation.
"""
from rest_framework import serializers

from .models import Encounter, OutpatientVisit, TriageQueue
from apps.users.serializers import PatientProfileSerializer, PractitionerProfileSerializer


class OutpatientVisitSerializer(serializers.ModelSerializer):
    """Serializer for outpatient visit lifecycle data."""

    class Meta:
        model = OutpatientVisit
        fields = [
            'appointment', 'clinic', 'visit_status', 'queue_number',
            'checked_in_at', 'checked_in_by', 'called_at',
            'consultation_started_at', 'consultation_ended_at',
            'checked_out_at', 'checked_out_by',
        ]
        read_only_fields = fields


class TriageQueueSerializer(serializers.ModelSerializer):
    """Serializer for triage queue entries."""
    patient_name = serializers.CharField(source='patient.user.get_full_name', read_only=True)

    class Meta:
        model = TriageQueue
        fields = [
            'id', 'patient', 'patient_name', 'priority', 'chief_complaint',
            'triage_notes', 'status', 'triaged_at', 'assigned_clinic',
            'assigned_practitioner', 'assigned_at', 'appointment',
            'created_at', 'updated_at'
        ]
        read_only_fields = [
            'id', 'status', 'triaged_at', 'assigned_at',
            'created_at', 'updated_at'
        ]


class TriageQueueCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating triage queue entries."""

    class Meta:
        model = TriageQueue
        fields = ['patient', 'priority', 'chief_complaint']


class EncounterSerializer(serializers.ModelSerializer):
    """
    Serializer for reading Encounter data.
    """
    patient_name = serializers.ReadOnlyField()
    practitioner_name = serializers.ReadOnlyField()
    clinic_name = serializers.CharField(source='clinic.name', read_only=True)
    department_name = serializers.CharField(source='department.name', read_only=True)
    duration_minutes = serializers.ReadOnlyField()
    outpatient_visit = OutpatientVisitSerializer(read_only=True)
    patient_details = PatientProfileSerializer(source='patient', read_only=True)
    practitioner_details = PractitionerProfileSerializer(source='practitioner', read_only=True)

    class Meta:
        model = Encounter
        fields = [
            'id', 'patient', 'patient_details', 'patient_name',
            'practitioner', 'practitioner_details', 'practitioner_name',
            'clinic', 'clinic_name', 'department', 'department_name',
            'appointment', 'outpatient_visit',
            'encounter_type', 'status', 'start_time', 'end_time',
            'reason', 'service_type', 'location',
            'admission_source', 'discharge_disposition', 'destination',
            'admission', 'duration_minutes',
            'fhir_id', 'fhir_synced', 'fhir_last_synced',
            'created_at', 'updated_at'
        ]
        read_only_fields = [
            'id', 'patient_name', 'practitioner_name', 'duration_minutes',
            'outpatient_visit', 'fhir_id', 'fhir_synced', 'fhir_last_synced',
            'created_at', 'updated_at'
        ]


class EncounterListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for listing Encounters (faster queries).
    """
    patient_name = serializers.ReadOnlyField()
    practitioner_name = serializers.ReadOnlyField()
    clinic_name = serializers.CharField(source='clinic.name', read_only=True)
    department_name = serializers.CharField(source='department.name', read_only=True)
    patient_id = serializers.UUIDField(source='patient.id', read_only=True)
    practitioner_id = serializers.UUIDField(source='practitioner.id', read_only=True, allow_null=True)
    clinic_id = serializers.UUIDField(source='clinic.id', read_only=True, allow_null=True)
    department_id = serializers.UUIDField(source='department.id', read_only=True, allow_null=True)

    class Meta:
        model = Encounter
        fields = [
            'id', 'patient_id', 'patient_name',
            'practitioner_id', 'practitioner_name',
            'clinic_id', 'clinic_name',
            'department_id', 'department_name',
            'encounter_type', 'status', 'start_time', 'end_time',
            'reason', 'service_type', 'location',
            'created_at', 'updated_at'
        ]


class EncounterCreateSerializer(serializers.ModelSerializer):
    """
    Serializer for creating a new Encounter.
    """
    patient_id = serializers.UUIDField(write_only=True)
    practitioner_id = serializers.UUIDField(write_only=True, required=False, allow_null=True)
    clinic_id = serializers.UUIDField(write_only=True, required=False, allow_null=True)
    department_id = serializers.UUIDField(write_only=True, required=False, allow_null=True)
    appointment_id = serializers.UUIDField(write_only=True, required=False, allow_null=True)

    class Meta:
        model = Encounter
        fields = [
            'patient_id', 'practitioner_id', 'clinic_id', 'department_id', 'appointment_id',
            'encounter_type', 'status', 'start_time',
            'reason', 'service_type', 'location',
            'admission_source'
        ]

    def validate_patient_id(self, value):
        """Validate patient exists."""
        from apps.users.models import PatientProfile
        try:
            PatientProfile.objects.get(id=value)
        except PatientProfile.DoesNotExist:
            raise serializers.ValidationError("Patient not found.")
        return value

    def validate_practitioner_id(self, value):
        """Validate practitioner exists if provided."""
        if value:
            from apps.users.models import PractitionerProfile
            try:
                PractitionerProfile.objects.get(id=value)
            except PractitionerProfile.DoesNotExist:
                raise serializers.ValidationError("Practitioner not found.")
        return value

    def validate_clinic_id(self, value):
        """Validate clinic exists if provided."""
        if value:
            from apps.organization.models import Clinic
            try:
                Clinic.objects.get(id=value)
            except Clinic.DoesNotExist:
                raise serializers.ValidationError("Clinic not found.")
        return value

    def validate_department_id(self, value):
        """Validate department exists if provided."""
        if value:
            from apps.organization.models import ClinicalUnit
            try:
                department = ClinicalUnit.objects.get(id=value)
            except ClinicalUnit.DoesNotExist:
                raise serializers.ValidationError("Department not found.")
            if getattr(department.unit_type, 'code', None) != 'department':
                raise serializers.ValidationError("Department must be a department unit.")
        return value

    def validate_appointment_id(self, value):
        """Validate appointment exists if provided."""
        if value:
            from apps.appointments.models import Appointment
            try:
                Appointment.objects.get(id=value)
            except Appointment.DoesNotExist:
                raise serializers.ValidationError("Appointment not found.")
        return value

    def validate(self, data):
        encounter_type = data.get('encounter_type', 'outpatient')
        clinic_id = data.get('clinic_id')
        department_id = data.get('department_id')
        if encounter_type == 'outpatient' and not clinic_id:
            raise serializers.ValidationError({'clinic_id': 'Clinic is required for outpatient encounters.'})
        if clinic_id and department_id:
            from apps.organization.models import Clinic
            clinic = Clinic.objects.filter(id=clinic_id).first()
            if clinic and clinic.department_id and str(clinic.department_id) != str(department_id):
                raise serializers.ValidationError({'department_id': 'Department must match the clinic.'})
        return data

    def create(self, validated_data):
        """Create encounter with patient and practitioner references."""
        from apps.users.models import PatientProfile, PractitionerProfile
        from apps.organization.models import Clinic, ClinicalUnit
        from apps.appointments.models import Appointment

        patient_id = validated_data.pop('patient_id')
        practitioner_id = validated_data.pop('practitioner_id', None)
        clinic_id = validated_data.pop('clinic_id', None)
        department_id = validated_data.pop('department_id', None)
        appointment_id = validated_data.pop('appointment_id', None)
        practitioner = validated_data.pop('practitioner', None)

        validated_data['patient'] = PatientProfile.objects.get(id=patient_id)
        if practitioner_id:
            validated_data['practitioner'] = PractitionerProfile.objects.get(id=practitioner_id)
        elif practitioner:
            validated_data['practitioner'] = practitioner
        if department_id:
            validated_data['department'] = ClinicalUnit.objects.get(id=department_id)
        if clinic_id:
            clinic = Clinic.objects.get(id=clinic_id)
            validated_data['clinic'] = clinic
            if not department_id:
                validated_data['department'] = clinic.department
        if appointment_id:
            appointment = Appointment.objects.get(id=appointment_id)
            validated_data['appointment'] = appointment
            if not clinic_id and appointment.clinic_id:
                validated_data['clinic'] = appointment.clinic
                if not department_id:
                    validated_data['department'] = appointment.clinic.department

        return super().create(validated_data)


class EncounterUpdateSerializer(serializers.ModelSerializer):
    """
    Serializer for updating an Encounter.
    """
    class Meta:
        model = Encounter
        fields = [
            'status', 'end_time',
            'discharge_disposition', 'destination'
        ]

    def update(self, instance, validated_data):
        """Mark encounter for re-sync when updated."""
        instance = super().update(instance, validated_data)
        instance.fhir_synced = False
        instance.save(update_fields=['fhir_synced'])
        return instance
