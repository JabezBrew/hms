from rest_framework import serializers
from .models import Ward, Bed, Admission, BedAllocationLog, WardTransfer
from ..users.serializers import PatientProfileSerializer, StaffSerializer, UserSerializer, PractitionerProfileSerializer


class WardSerializer(serializers.ModelSerializer):
    """
    Serializer for the Ward model.
    """
    available_beds_count = serializers.ReadOnlyField()
    occupancy_rate = serializers.ReadOnlyField()
    head_nurse_details = StaffSerializer(source='head_nurse', read_only=True)
    auto_create_beds = serializers.BooleanField(default=True, write_only=True, required=False,
                                               help_text="Automatically create beds when ward is created")

    class Meta:
        model = Ward
        fields = ['id', 'name', 'description', 'ward_type', 'is_active', 
                  'total_beds', 'base_rate_per_night', 'head_nurse', 
                  'head_nurse_details', 'available_beds_count', 'occupancy_rate',
                  'auto_create_beds', 'created_at', 'updated_at', 'created_by', 'updated_by']
        read_only_fields = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by']

    def validate_total_beds(self, value):
        """
        Validate that total_beds is a reasonable number.
        """
        if value < 0:
            raise serializers.ValidationError("Total beds cannot be negative.")
        if value > 100:  # Assuming 100 is a reasonable upper limit for beds in a ward
            raise serializers.ValidationError("Total beds cannot exceed 100.")
        return value


class BedSerializer(serializers.ModelSerializer):
    """
    Serializer for the Bed model.
    """
    ward_details = WardSerializer(source='ward', read_only=True)
    total_rate = serializers.ReadOnlyField()

    class Meta:
        model = Bed
        fields = ['id', 'ward', 'ward_details', 'bed_number', 'bed_type', 
                  'status', 'additional_rate', 'total_rate', 'location_x', 
                  'location_y', 'notes', 'created_at', 'updated_at', 
                  'created_by', 'updated_by']
        read_only_fields = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by']


class BedAllocationLogSerializer(serializers.ModelSerializer):
    """
    Serializer for the BedAllocationLog model.
    """
    bed_details = BedSerializer(source='bed', read_only=True)
    created_by_details = UserSerializer(source='created_by', read_only=True)

    class Meta:
        model = BedAllocationLog
        fields = ['id', 'bed', 'bed_details', 'previous_status', 'new_status', 
                  'admission', 'notes', 'timestamp', 'created_by', 'created_by_details']
        read_only_fields = ['id', 'timestamp', 'created_by']


class AdmissionSerializer(serializers.ModelSerializer):
    """
    Serializer for the Admission model.
    """
    patient_details = PatientProfileSerializer(source='patient', read_only=True)
    bed_details = BedSerializer(source='bed', read_only=True)
    admitting_doctor_details = PractitionerProfileSerializer(source='admitting_doctor', read_only=True)
    length_of_stay = serializers.ReadOnlyField()
    total_cost = serializers.ReadOnlyField()

    class Meta:
        model = Admission
        fields = ['id', 'patient', 'patient_details', 'bed', 'bed_details', 
                  'fhir_encounter_id', 'admission_date', 'expected_discharge_date', 
                  'actual_discharge_date', 'status', 'admission_type', 
                  'admission_notes', 'discharge_notes', 'daily_rate', 
                  'is_billed', 'admitting_doctor', 'admitting_doctor_details', 
                  'length_of_stay', 'total_cost', 'created_at', 'updated_at', 
                  'created_by', 'updated_by']
        read_only_fields = ['id', 'daily_rate', 'created_at', 'updated_at', 'created_by', 'updated_by']


class AdmissionCreateSerializer(serializers.ModelSerializer):
    """
    Serializer for creating a new Admission.
    """
    class Meta:
        model = Admission
        fields = ['id', 'patient', 'bed', 'fhir_encounter_id', 'admission_date', 
                  'expected_discharge_date', 'admission_type', 'admission_notes', 
                  'admitting_doctor']
        read_only_fields = ['id']

    def validate(self, data):
        """
        Validate that the bed is available.
        """
        bed = data.get('bed')
        if bed and bed.status != 'available':
            raise serializers.ValidationError(f"Bed {bed.bed_number} is not available. Current status: {bed.get_status_display()}")

        return data


class DischargeSerializer(serializers.Serializer):
    """
    Serializer for discharging a patient.
    """
    discharge_notes = serializers.CharField(required=False, allow_blank=True)

    def validate(self, data):
        """
        Validate that the admission exists and the patient is admitted.
        """
        admission = self.context.get('admission')
        if not admission:
            raise serializers.ValidationError("Admission not found.")

        if admission.status != 'admitted':
            raise serializers.ValidationError(f"Patient is not currently admitted. Status: {admission.get_status_display()}")

        return data


class WardTransferSerializer(serializers.ModelSerializer):
    """
    Serializer for the WardTransfer model.
    """
    patient_details = PatientProfileSerializer(source='patient', read_only=True)
    from_admission_details = AdmissionSerializer(source='from_admission', read_only=True)
    to_admission_details = AdmissionSerializer(source='to_admission', read_only=True)
    created_by_details = UserSerializer(source='created_by', read_only=True)

    class Meta:
        model = WardTransfer
        fields = ['id', 'patient', 'patient_details', 'from_admission', 
                  'from_admission_details', 'to_admission', 'to_admission_details', 
                  'reason', 'transfer_time', 'created_at', 'created_by', 
                  'created_by_details']
        read_only_fields = ['id', 'created_at', 'created_by']


class TransferRequestSerializer(serializers.Serializer):
    """
    Serializer for requesting a patient transfer.
    """
    from_admission_id = serializers.UUIDField()
    to_bed_id = serializers.UUIDField()
    reason = serializers.CharField()

    def validate(self, data):
        """
        Validate that the from_admission exists and the patient is admitted,
        and that the to_bed is available.
        """
        from .models import Admission, Bed

        try:
            from_admission = Admission.objects.get(id=data['from_admission_id'])
            if from_admission.status != 'admitted':
                raise serializers.ValidationError(f"Patient is not currently admitted. Status: {from_admission.get_status_display()}")

            data['from_admission'] = from_admission
        except Admission.DoesNotExist:
            raise serializers.ValidationError("Source admission not found.")

        try:
            to_bed = Bed.objects.get(id=data['to_bed_id'])
            if to_bed.status != 'available':
                raise serializers.ValidationError(f"Destination bed is not available. Status: {to_bed.get_status_display()}")

            data['to_bed'] = to_bed
        except Bed.DoesNotExist:
            raise serializers.ValidationError("Destination bed not found.")

        return data
