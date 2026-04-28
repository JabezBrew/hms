from rest_framework import serializers

from apps.admissions.models import AdmissionCase, AdmissionTask, BedReservation
from apps.wards.models import Admission, Bed, Ward
from apps.encounters.models import Encounter
from apps.users.models import PatientProfile, PractitionerProfile


_CLINICAL_DRAFT_ROLES = {
    'admin',
    'doctor',
    'physician',
    'practitioner',
    'inpatient_doctor',
    'nurse',
    'head_nurse',
    'nurse_practitioner',
}


class BedReservationSummarySerializer(serializers.ModelSerializer):
    bed_number = serializers.CharField(source='bed.bed_number', read_only=True)
    ward_id = serializers.UUIDField(source='bed.ward_id', read_only=True)
    ward_name = serializers.CharField(source='bed.ward.name', read_only=True)

    class Meta:
        model = BedReservation
        fields = [
            'id',
            'bed',
            'bed_number',
            'ward_id',
            'ward_name',
            'status',
            'reserved_at',
            'expires_at',
            'released_at',
        ]
        read_only_fields = ['__all__']


class AdmissionTaskSerializer(serializers.ModelSerializer):
    task_type_display = serializers.CharField(source='get_task_type_display', read_only=True)

    class Meta:
        model = AdmissionTask
        fields = [
            'id',
            'task_type',
            'task_type_display',
            'phase',
            'assigned_role',
            'blocking',
            'status',
            'notes',
            'snapshot',
            'completed_by',
            'completed_at',
            'acknowledged_by',
            'acknowledged_at',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['__all__']


class AdmissionCaseListSerializer(serializers.ModelSerializer):
    patient_name = serializers.CharField(source='patient.user.get_full_name', read_only=True)
    medical_record_number = serializers.CharField(source='patient.medical_record_number', read_only=True)
    requested_ward_name = serializers.SerializerMethodField()
    requested_bed_label = serializers.SerializerMethodField()
    active_reservation = serializers.SerializerMethodField()
    blockers = serializers.SerializerMethodField()
    advisory_tasks_open = serializers.SerializerMethodField()
    admission_id = serializers.UUIDField(read_only=True)
    can_activate = serializers.SerializerMethodField()
    source_encounter_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = AdmissionCase
        fields = [
            'id',
            'patient',
            'patient_name',
            'medical_record_number',
            'status',
            'admission_source',
            'urgency',
            'requested_admission_type',
            'requested_for_at',
            'requested_at',
            'ready_for_activation_at',
            'activated_at',
            'completed_at',
            'cancelled_at',
            'requested_ward',
            'requested_ward_name',
            'requested_bed',
            'requested_bed_label',
            'active_reservation',
            'admission_id',
            'source_encounter_id',
            'blockers',
            'advisory_tasks_open',
            'can_activate',
        ]
        read_only_fields = ['__all__']

    def _get_tasks(self, obj):
        return getattr(obj, 'prefetched_tasks', None) or obj.tasks.all()

    def _get_reservations(self, obj):
        return getattr(obj, 'prefetched_reservations', None) or obj.bed_reservations.select_related('bed__ward').all()

    def _get_active_reservation(self, obj):
        for reservation in self._get_reservations(obj):
            if reservation.status == BedReservation.Status.ACTIVE:
                return reservation
        return None

    def get_requested_ward_name(self, obj):
        reservation = self._get_active_reservation(obj)
        if reservation:
            return reservation.bed.ward.name
        if obj.requested_bed and obj.requested_bed.ward:
            return obj.requested_bed.ward.name
        if obj.requested_ward:
            return obj.requested_ward.name
        if obj.admission and obj.admission.bed:
            return obj.admission.bed.ward.name
        return None

    def get_requested_bed_label(self, obj):
        reservation = self._get_active_reservation(obj)
        bed = reservation.bed if reservation else obj.requested_bed
        if not bed:
            return None
        return f"{bed.ward.name} · Bed {bed.bed_number}"

    def get_active_reservation(self, obj):
        reservation = self._get_active_reservation(obj)
        if not reservation:
            return None
        return BedReservationSummarySerializer(reservation).data

    def get_blockers(self, obj):
        return [
            {
                'task_type': task.task_type,
                'status': task.status,
            }
            for task in self._get_tasks(obj)
            if task.blocking
        ]

    def get_advisory_tasks_open(self, obj):
        return sum(
            1
            for task in self._get_tasks(obj)
            if not task.blocking and task.status == AdmissionTask.Status.PENDING
        )

    def get_can_activate(self, obj):
        return (
            obj.status == AdmissionCase.Status.READY_FOR_ACTIVATION
            and not obj.admission_id
            and not obj.cancelled_at
        )


class AdmissionCaseDetailSerializer(AdmissionCaseListSerializer):
    tasks = serializers.SerializerMethodField()
    requested_by_name = serializers.CharField(source='requested_by.get_full_name', read_only=True)
    admitting_practitioner_name = serializers.SerializerMethodField()
    primary_team_name = serializers.CharField(source='primary_team.name', read_only=True)
    draft_payload = serializers.SerializerMethodField()
    metadata = serializers.JSONField(read_only=True)
    cancel_reason = serializers.CharField(read_only=True)

    class Meta(AdmissionCaseListSerializer.Meta):
        fields = AdmissionCaseListSerializer.Meta.fields + [
            'admission',
            'facility',
            'requested_by',
            'requested_by_name',
            'admitting_practitioner',
            'admitting_practitioner_name',
            'primary_team',
            'primary_team_name',
            'draft_payload',
            'metadata',
            'cancel_reason',
            'tasks',
        ]

    def get_tasks(self, obj):
        tasks = getattr(obj, 'prefetched_tasks', None) or obj.tasks.all().order_by('phase', '-blocking', 'created_at')
        return AdmissionTaskSerializer(tasks, many=True).data

    def get_admitting_practitioner_name(self, obj):
        practitioner = obj.admitting_practitioner
        if not practitioner:
            return None
        if getattr(practitioner, 'staff', None) and getattr(practitioner.staff, 'user', None):
            return practitioner.staff.user.get_full_name()
        return str(practitioner.id)

    def get_draft_payload(self, obj):
        request = self.context.get('request')
        user_type = getattr(getattr(request, 'user', None), 'user_type', None)
        if user_type in _CLINICAL_DRAFT_ROLES:
            return obj.draft_payload or {}
        return {}


class AdmissionCaseStartSerializer(serializers.Serializer):
    patient_id = serializers.PrimaryKeyRelatedField(
        source='patient',
        queryset=PatientProfile.objects.select_related('user'),
    )
    source_encounter_id = serializers.PrimaryKeyRelatedField(
        source='source_encounter',
        queryset=Encounter.objects.all(),
        required=False,
        allow_null=True,
    )
    requested_ward_id = serializers.PrimaryKeyRelatedField(
        source='requested_ward',
        queryset=Ward.objects.select_related('department'),
        required=False,
        allow_null=True,
    )
    requested_bed_id = serializers.PrimaryKeyRelatedField(
        source='requested_bed',
        queryset=Bed.objects.select_related('ward__department', 'section'),
        required=False,
        allow_null=True,
    )
    admitting_practitioner_id = serializers.PrimaryKeyRelatedField(
        source='admitting_practitioner',
        queryset=PractitionerProfile.objects.select_related('staff__user'),
        required=False,
        allow_null=True,
    )
    requested_for_at = serializers.DateTimeField(required=False, allow_null=True)
    admission_source = serializers.CharField(required=False, allow_blank=True)
    urgency = serializers.ChoiceField(choices=AdmissionCase.Urgency.choices, required=False)
    requested_admission_type = serializers.ChoiceField(
        choices=Admission.ADMISSION_TYPE_CHOICES,
        required=False,
    )
    payload = serializers.JSONField(required=False, default=dict)

    def validate(self, attrs):
        facility = self.context.get('facility')
        patient = attrs['patient']
        requested_ward = attrs.get('requested_ward')
        requested_bed = attrs.get('requested_bed')
        source_encounter = attrs.get('source_encounter')

        if facility and patient.facility_id != facility.id:
            raise serializers.ValidationError({'patient_id': 'Patient does not belong to the active facility.'})

        if facility and requested_ward and requested_ward.department.facility_id != facility.id:
            raise serializers.ValidationError({'requested_ward_id': 'Ward does not belong to the active facility.'})

        if requested_bed:
            if facility and requested_bed.facility_id != facility.id:
                raise serializers.ValidationError({'requested_bed_id': 'Bed does not belong to the active facility.'})
            if requested_ward and requested_bed.ward_id != requested_ward.id:
                raise serializers.ValidationError({'requested_bed_id': 'Selected bed does not belong to the requested ward.'})
            if requested_bed.status not in {'available', 'reserved'}:
                raise serializers.ValidationError({'requested_bed_id': f'Bed {requested_bed.bed_number} is not available.'})
            patient_gender = getattr(patient.user, 'gender', None)
            if requested_bed.effective_gender_restriction == 'male_only' and patient_gender != 'M':
                raise serializers.ValidationError({'requested_bed_id': f'Bed {requested_bed.bed_number} is restricted to male patients.'})
            if requested_bed.effective_gender_restriction == 'female_only' and patient_gender != 'F':
                raise serializers.ValidationError({'requested_bed_id': f'Bed {requested_bed.bed_number} is restricted to female patients.'})

        if source_encounter:
            if facility and source_encounter.facility_id != facility.id:
                raise serializers.ValidationError({'source_encounter_id': 'Encounter does not belong to the active facility.'})
            if source_encounter.patient_id != patient.id:
                raise serializers.ValidationError({'source_encounter_id': 'Encounter does not belong to the selected patient.'})

        return attrs


class AdmissionCaseNotesSerializer(serializers.Serializer):
    notes = serializers.CharField(required=False, allow_blank=True)


class BedReservationUpdateSerializer(serializers.Serializer):
    bed_id = serializers.PrimaryKeyRelatedField(
        source='bed',
        queryset=Bed.objects.select_related('ward__department', 'section'),
    )
    expires_at = serializers.DateTimeField(required=False, allow_null=True)


class AdmissionCaseActivateSerializer(serializers.Serializer):
    activated_at = serializers.DateTimeField(required=False, allow_null=True)


class AdmissionTaskCreateSerializer(serializers.Serializer):
    task_type = serializers.ChoiceField(
        choices=[
            AdmissionTask.TaskType.PHARMACY_MED_REC,
            AdmissionTask.TaskType.BASELINE_LAB_FOLLOWUP,
            AdmissionTask.TaskType.INFECTION_CONTROL,
            AdmissionTask.TaskType.DIETARY,
            AdmissionTask.TaskType.SOCIAL_WORK,
            AdmissionTask.TaskType.TRANSPORT,
            AdmissionTask.TaskType.DOCUMENTS,
            AdmissionTask.TaskType.OTHER,
        ]
    )
    assigned_role = serializers.CharField(required=False, allow_blank=True)
    notes = serializers.CharField(required=False, allow_blank=True)
    snapshot = serializers.JSONField(required=False, default=dict)


class AdmissionTaskUpdateSerializer(serializers.Serializer):
    notes = serializers.CharField(required=False, allow_blank=True)
