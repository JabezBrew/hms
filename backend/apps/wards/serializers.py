from rest_framework import serializers
from .models import Ward, Bed, Admission, BedAllocationLog, WardTransfer, Encounter, WardSection, BedAmenity, StaffRole, WardStaffAssignment
from ..users.serializers import PatientProfileSerializer, StaffSerializer, UserSerializer, PractitionerProfileSerializer


# ============================================================================
# Ward Staff Assignment Serializers
# ============================================================================

class StaffRoleSerializer(serializers.ModelSerializer):
    """
    Serializer for configurable staff roles.
    """
    class Meta:
        model = StaffRole
        fields = ['id', 'name', 'code', 'category', 'description', 'is_active']
        read_only_fields = ['id']


class WardStaffAssignmentSerializer(serializers.ModelSerializer):
    """
    Full serializer for ward staff assignments.
    """
    practitioner_details = PractitionerProfileSerializer(source='practitioner', read_only=True)
    role_details = StaffRoleSerializer(source='role', read_only=True)
    ward_name = serializers.CharField(source='ward.name', read_only=True)

    class Meta:
        model = WardStaffAssignment
        fields = [
            'id', 'ward', 'ward_name', 'practitioner', 'practitioner_details',
            'role', 'role_details', 'is_active', 'is_primary', 'assigned_at'
        ]
        read_only_fields = ['id', 'assigned_at']


class WardStaffAssignmentListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for ward staff - optimized for dropdowns.

    Returns minimal data needed for nurse selection in shift handoffs:
    - id: practitioner ID (for form submission)
    - full_name: display name
    - role_name: role display
    """
    id = serializers.UUIDField(source='practitioner.id', read_only=True)
    full_name = serializers.SerializerMethodField()
    role_name = serializers.CharField(source='role.name', read_only=True)

    class Meta:
        model = WardStaffAssignment
        fields = ['id', 'full_name', 'role_name']

    def get_full_name(self, obj):
        """Get practitioner's full name."""
        if obj.practitioner and obj.practitioner.staff and obj.practitioner.staff.user:
            return obj.practitioner.staff.user.get_full_name()
        return 'Unknown'


class WardStaffAssignmentDetailSerializer(serializers.ModelSerializer):
    """
    Detailed serializer for ward staff assignments - used for management UI.
    Returns assignment ID (not practitioner ID) for edit/delete operations.
    """
    practitioner_id = serializers.UUIDField(source='practitioner.id', read_only=True)
    practitioner_name = serializers.SerializerMethodField()
    role_id = serializers.UUIDField(source='role.id', read_only=True)
    role_name = serializers.CharField(source='role.name', read_only=True)
    role_category = serializers.CharField(source='role.category', read_only=True)
    ward_name = serializers.CharField(source='ward.name', read_only=True)
    assigned_by_name = serializers.SerializerMethodField()

    class Meta:
        model = WardStaffAssignment
        fields = [
            'id', 'ward', 'ward_name',
            'practitioner', 'practitioner_id', 'practitioner_name',
            'role', 'role_id', 'role_name', 'role_category',
            'is_active', 'is_primary',
            'assigned_at', 'assigned_by', 'assigned_by_name'
        ]
        read_only_fields = ['id', 'assigned_at']

    def get_practitioner_name(self, obj):
        """Get practitioner's full name."""
        if obj.practitioner and obj.practitioner.staff and obj.practitioner.staff.user:
            return obj.practitioner.staff.user.get_full_name()
        return 'Unknown'

    def get_assigned_by_name(self, obj):
        """Get assigner's name."""
        if obj.assigned_by:
            return obj.assigned_by.get_full_name()
        return None


class WardStaffAssignmentCreateSerializer(serializers.ModelSerializer):
    """
    Serializer for creating/updating ward staff assignments.
    """
    class Meta:
        model = WardStaffAssignment
        fields = ['ward', 'practitioner', 'role', 'is_active', 'is_primary']

    def validate(self, data):
        """Validate the assignment data."""
        ward = data.get('ward')
        practitioner = data.get('practitioner')
        role = data.get('role')

        # Check if role is active
        if role and not role.is_active:
            raise serializers.ValidationError({
                'role': 'This role is no longer active.'
            })

        # Check for duplicate assignment (only on create)
        if not self.instance:
            existing = WardStaffAssignment.objects.filter(
                ward=ward,
                practitioner=practitioner
            ).exists()
            if existing:
                raise serializers.ValidationError({
                    'practitioner': 'This staff member is already assigned to this ward.'
                })

        return data


# ============================================================================
# Existing Serializers
# ============================================================================


class BedAmenitySerializer(serializers.ModelSerializer):
    """
    Serializer for BedAmenity model.
    """
    class Meta:
        model = BedAmenity
        fields = ['id', 'code', 'name', 'description', 'icon', 'category', 'additional_rate', 'is_active']
        read_only_fields = ['id']


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
    Serializer for the Bed model with full details including section and amenities.
    """
    ward_details = WardSerializer(source='ward', read_only=True)
    section_details = serializers.SerializerMethodField()
    amenities_details = BedAmenitySerializer(source='amenities', many=True, read_only=True)
    total_rate = serializers.ReadOnlyField()
    effective_accommodation_tier = serializers.ReadOnlyField()
    effective_gender_restriction = serializers.ReadOnlyField()

    class Meta:
        model = Bed
        fields = ['id', 'ward', 'ward_details', 'section', 'section_details',
                  'bed_number', 'bed_type', 'status', 'additional_rate', 'total_rate',
                  'location_x', 'location_y', 'notes',
                  'amenities', 'amenities_details',
                  'is_isolation_capable', 'has_negative_pressure', 'current_isolation_type',
                  'accommodation_tier', 'effective_accommodation_tier', 'effective_gender_restriction',
                  'created_at', 'updated_at', 'created_by', 'updated_by']
        read_only_fields = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by']

    def get_section_details(self, obj):
        """Get section details without circular reference."""
        if obj.section:
            return {
                'id': str(obj.section.id),
                'name': obj.section.name,
                'gender_restriction': obj.section.gender_restriction,
                'accommodation_tier': obj.section.accommodation_tier,
            }
        return None


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
    ed_encounter_id = serializers.UUIDField(write_only=True, required=False, allow_null=True)

    class Meta:
        model = Admission
        fields = ['id', 'patient', 'bed', 'fhir_encounter_id', 'admission_date', 
                  'expected_discharge_date', 'admission_type', 'admission_notes', 
                  'admitting_doctor', 'ed_encounter_id']
        read_only_fields = ['id']

    def validate(self, data):
        """
        Validate that the bed is available and matches patient gender restrictions.
        """
        ed_encounter_id = data.pop('ed_encounter_id', None)
        bed = data.get('bed')
        patient = data.get('patient')

        if bed:
            # Check bed availability
            if bed.status != 'available':
                raise serializers.ValidationError({
                    'bed': f"Bed {bed.bed_number} is not available. Current status: {bed.get_status_display()}"
                })

            # Check gender restriction if patient provided
            if patient:
                patient_gender = patient.user.gender
                gender_restriction = bed.effective_gender_restriction

                if gender_restriction == 'male_only' and patient_gender != 'M':
                    raise serializers.ValidationError({
                        'bed': f"Bed {bed.bed_number} is in a male-only section. Patient gender: {patient.user.get_gender_display()}"
                    })

                if gender_restriction == 'female_only' and patient_gender != 'F':
                    raise serializers.ValidationError({
                        'bed': f"Bed {bed.bed_number} is in a female-only section. Patient gender: {patient.user.get_gender_display()}"
                    })

        admission_type = data.get('admission_type') or 'elective'
        if admission_type == 'emergency':
            from apps.core.security import get_user_facility

            request = self.context.get('request')
            facility = get_user_facility(request) if request else None
            if not facility:
                raise serializers.ValidationError("Facility context is required.")
            if not patient:
                raise serializers.ValidationError("Patient is required for emergency admissions.")

            encounter = None
            if ed_encounter_id:
                encounter = Encounter.objects.filter(
                    id=ed_encounter_id,
                    patient=patient,
                    facility=facility
                ).first()
                if not encounter:
                    raise serializers.ValidationError({
                        'ed_encounter_id': 'Emergency encounter not found for patient.'
                    })
            else:
                encounters = Encounter.objects.filter(
                    patient=patient,
                    facility=facility,
                    encounter_type='emergency',
                    status__in=['planned', 'in-progress']
                ).order_by('-start_time')
                if not encounters.exists():
                    raise serializers.ValidationError({
                        'ed_encounter_id': 'Emergency admission requires an active ED encounter.'
                    })
                if encounters.count() > 1:
                    raise serializers.ValidationError({
                        'ed_encounter_id': 'Multiple ED encounters found. Provide ed_encounter_id.'
                    })
                encounter = encounters.first()

            if encounter.encounter_type != 'emergency':
                raise serializers.ValidationError({
                    'ed_encounter_id': 'Encounter is not an emergency encounter.'
                })
            if encounter.status in ['finished', 'cancelled']:
                raise serializers.ValidationError({
                    'ed_encounter_id': 'Emergency encounter is not active.'
                })
            self._ed_encounter = encounter

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


class EncounterSerializer(serializers.ModelSerializer):
    """
    Serializer for reading Encounter data.
    """
    patient_name = serializers.ReadOnlyField()
    practitioner_name = serializers.ReadOnlyField()
    duration_minutes = serializers.ReadOnlyField()
    patient_details = PatientProfileSerializer(source='patient', read_only=True)
    practitioner_details = PractitionerProfileSerializer(source='practitioner', read_only=True)

    class Meta:
        model = Encounter
        fields = [
            'id', 'patient', 'patient_details', 'patient_name',
            'practitioner', 'practitioner_details', 'practitioner_name',
            'encounter_type', 'status', 'start_time', 'end_time',
            'reason', 'service_type', 'location',
            'admission_source', 'discharge_disposition', 'destination',
            'admission', 'duration_minutes',
            'fhir_id', 'fhir_synced', 'fhir_last_synced',
            'created_at', 'updated_at'
        ]
        read_only_fields = [
            'id', 'patient_name', 'practitioner_name', 'duration_minutes',
            'fhir_id', 'fhir_synced', 'fhir_last_synced',
            'created_at', 'updated_at'
        ]


class EncounterListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for listing Encounters (faster queries).
    """
    patient_name = serializers.ReadOnlyField()
    practitioner_name = serializers.ReadOnlyField()
    patient_id = serializers.UUIDField(source='patient.id', read_only=True)
    practitioner_id = serializers.UUIDField(source='practitioner.id', read_only=True, allow_null=True)

    class Meta:
        model = Encounter
        fields = [
            'id', 'patient_id', 'patient_name',
            'practitioner_id', 'practitioner_name',
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

    class Meta:
        model = Encounter
        fields = [
            'patient_id', 'practitioner_id',
            'encounter_type', 'status', 'start_time',
            'reason', 'service_type', 'location',
            'admission_source'
        ]

    def validate_patient_id(self, value):
        """Validate patient exists."""
        from ..users.models import PatientProfile
        try:
            PatientProfile.objects.get(id=value)
        except PatientProfile.DoesNotExist:
            raise serializers.ValidationError("Patient not found.")
        return value

    def validate_practitioner_id(self, value):
        """Validate practitioner exists if provided."""
        if value:
            from ..users.models import PractitionerProfile
            try:
                PractitionerProfile.objects.get(id=value)
            except PractitionerProfile.DoesNotExist:
                raise serializers.ValidationError("Practitioner not found.")
        return value

    def create(self, validated_data):
        """Create encounter with patient and practitioner references."""
        from ..users.models import PatientProfile, PractitionerProfile

        patient_id = validated_data.pop('patient_id')
        practitioner_id = validated_data.pop('practitioner_id', None)

        validated_data['patient'] = PatientProfile.objects.get(id=patient_id)
        if practitioner_id:
            validated_data['practitioner'] = PractitionerProfile.objects.get(id=practitioner_id)

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


# =============================================================================
# LIST SERIALIZERS - Lightweight serializers for list views
# These reduce payload sizes by 50-80% compared to full serializers
# =============================================================================

class WardListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for ward lists.
    Removes nested head_nurse details.

    Payload reduction: ~50% (8 fields vs full nested details)
    """
    head_nurse_name = serializers.SerializerMethodField()

    class Meta:
        model = Ward
        fields = [
            'id', 'name', 'ward_type', 'is_active',
            'total_beds', 'available_beds_count', 'occupancy_rate',
            'head_nurse_name'
        ]

    def get_head_nurse_name(self, obj):
        if obj.head_nurse and obj.head_nurse.user:
            return obj.head_nurse.user.get_full_name()
        return None


class WardSearchSerializer(serializers.ModelSerializer):
    """
    Minimal serializer for ward search pickers.
    Avoids computed fields that trigger extra queries.
    """
    department_name = serializers.CharField(source='department.name', read_only=True)

    class Meta:
        model = Ward
        fields = [
            'id', 'name', 'ward_type', 'is_active',
            'total_beds', 'department_name'
        ]


class BedListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for bed lists.
    Flattens ward info instead of nesting full WardSerializer.

    Payload reduction: ~60% (with section and amenity info)
    """
    ward_name = serializers.CharField(source='ward.name', read_only=True)
    section_name = serializers.CharField(source='section.name', read_only=True, allow_null=True)
    effective_gender_restriction = serializers.ReadOnlyField()
    effective_accommodation_tier = serializers.ReadOnlyField()
    amenity_codes = serializers.SlugRelatedField(
        source='amenities',
        many=True,
        read_only=True,
        slug_field='code'
    )

    class Meta:
        model = Bed
        fields = [
            'id', 'ward', 'ward_name', 'section', 'section_name',
            'bed_number', 'bed_type', 'status', 'additional_rate', 'total_rate',
            'effective_accommodation_tier', 'effective_gender_restriction',
            'is_isolation_capable', 'current_isolation_type',
            'amenity_codes', 'notes'
        ]


class AdmissionListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for admission lists.
    Breaks the deep nesting chain (patient->bed->ward->staff).

    Payload reduction: ~83% (~1KB vs ~6KB per item)
    """
    patient_name = serializers.SerializerMethodField()
    patient_mrn = serializers.CharField(source='patient.medical_record_number', read_only=True)
    ward_name = serializers.SerializerMethodField()
    bed_number = serializers.SerializerMethodField()
    admitting_doctor_name = serializers.SerializerMethodField()

    class Meta:
        model = Admission
        fields = [
            'id', 'patient', 'patient_name', 'patient_mrn',
            'ward_name', 'bed_number', 'bed',
            'admission_date', 'expected_discharge_date', 'status',
            'admission_type', 'admitting_doctor_name', 'is_billed'
        ]

    def get_patient_name(self, obj):
        if obj.patient and obj.patient.user:
            return obj.patient.user.get_full_name()
        return None

    def get_ward_name(self, obj):
        if obj.bed and obj.bed.ward:
            return obj.bed.ward.name
        return None

    def get_bed_number(self, obj):
        if obj.bed:
            return obj.bed.bed_number
        return None

    def get_admitting_doctor_name(self, obj):
        if obj.admitting_doctor and obj.admitting_doctor.staff and obj.admitting_doctor.staff.user:
            return obj.admitting_doctor.staff.user.get_full_name()
        return None


class WardTransferListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for ward transfer lists.
    Removes nested admission details.

    Payload reduction: ~75% (10 fields vs deeply nested admissions)
    """
    patient_name = serializers.SerializerMethodField()
    patient_mrn = serializers.CharField(source='patient.medical_record_number', read_only=True)
    from_ward = serializers.SerializerMethodField()
    to_ward = serializers.SerializerMethodField()

    class Meta:
        model = WardTransfer
        fields = [
            'id', 'patient', 'patient_name', 'patient_mrn',
            'from_ward', 'to_ward', 'reason',
            'transfer_time', 'created_at'
        ]

    def get_patient_name(self, obj):
        if obj.patient and obj.patient.user:
            return obj.patient.user.get_full_name()
        return None

    def get_from_ward(self, obj):
        if obj.from_admission and obj.from_admission.bed and obj.from_admission.bed.ward:
            return obj.from_admission.bed.ward.name
        return None

    def get_to_ward(self, obj):
        if obj.to_admission and obj.to_admission.bed and obj.to_admission.bed.ward:
            return obj.to_admission.bed.ward.name
        return None


# =============================================================================
# WARD SECTION SERIALIZERS
# =============================================================================

class WardSectionSerializer(serializers.ModelSerializer):
    """
    Full serializer for WardSection model with computed properties.
    """
    bed_count = serializers.ReadOnlyField()
    available_beds_count = serializers.ReadOnlyField()
    occupancy_rate = serializers.ReadOnlyField()
    effective_rate = serializers.ReadOnlyField()
    ward_name = serializers.CharField(source='ward.name', read_only=True)

    class Meta:
        model = WardSection
        fields = [
            'id', 'ward', 'ward_name', 'name', 'description',
            'display_order', 'gender_restriction', 'accommodation_tier',
            'rate_multiplier', 'effective_rate', 'is_isolation_capable',
            'has_negative_pressure', 'default_isolation_type', 'max_beds',
            'bed_count', 'available_beds_count', 'occupancy_rate',
            'is_active', 'created_at', 'updated_at', 'created_by', 'updated_by'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by']

    def validate(self, data):
        """Validate section data."""
        # Validate rate multiplier
        rate_multiplier = data.get('rate_multiplier', 1.0)
        if rate_multiplier < 0:
            raise serializers.ValidationError({'rate_multiplier': 'Rate multiplier cannot be negative.'})
        if rate_multiplier > 10:
            raise serializers.ValidationError({'rate_multiplier': 'Rate multiplier cannot exceed 10.'})

        # Validate max_beds
        max_beds = data.get('max_beds', 0)
        if max_beds < 0:
            raise serializers.ValidationError({'max_beds': 'Max beds cannot be negative.'})

        # Validate negative pressure with isolation capability
        has_negative_pressure = data.get('has_negative_pressure', False)
        is_isolation_capable = data.get('is_isolation_capable', False)
        if has_negative_pressure and not is_isolation_capable:
            data['is_isolation_capable'] = True  # Auto-enable if negative pressure

        return data


class WardSectionListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for section lists.
    Payload reduction: ~60% compared to full serializer.
    """
    bed_count = serializers.ReadOnlyField()
    available_beds_count = serializers.ReadOnlyField()
    effective_rate = serializers.ReadOnlyField()

    class Meta:
        model = WardSection
        fields = [
            'id', 'name', 'gender_restriction', 'accommodation_tier',
            'rate_multiplier', 'effective_rate', 'bed_count',
            'available_beds_count', 'is_isolation_capable', 'is_active'
        ]
