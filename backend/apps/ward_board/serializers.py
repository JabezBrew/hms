from django.contrib.auth import get_user_model
from rest_framework import serializers

from apps.users.models import PatientProfile
from apps.ward_board.models import (
    WardBoardAcknowledgement,
    WardBoardTask,
    WardBoardTaskEvent,
)
from apps.wards.models import Admission, Ward

User = get_user_model()


class WardBoardTaskListSerializer(serializers.ModelSerializer):
    class Meta:
        model = WardBoardTask
        fields = [
            'id',
            'patient',
            'category',
            'priority',
            'status',
            'owner_role',
            'due_at',
            'action_text',
        ]
        read_only_fields = fields


class WardBoardTaskDetailSerializer(serializers.ModelSerializer):
    patient_name = serializers.CharField(source='patient.user.get_full_name', read_only=True)
    medical_record_number = serializers.CharField(source='patient.medical_record_number', read_only=True)
    ward_name = serializers.CharField(source='ward.name', read_only=True)
    owner_user_name = serializers.CharField(source='owner_user.get_full_name', read_only=True)
    created_by_name = serializers.CharField(source='created_by.get_full_name', read_only=True)
    updated_by_name = serializers.CharField(source='updated_by.get_full_name', read_only=True)
    completed_by_name = serializers.CharField(source='completed_by.get_full_name', read_only=True)
    cancelled_by_name = serializers.CharField(source='cancelled_by.get_full_name', read_only=True)
    acknowledgement_count = serializers.IntegerField(read_only=True)
    is_acknowledged_by_me = serializers.SerializerMethodField()
    is_overdue = serializers.BooleanField(read_only=True)

    class Meta:
        model = WardBoardTask
        fields = [
            'id',
            'facility',
            'ward',
            'ward_name',
            'admission',
            'patient',
            'patient_name',
            'medical_record_number',
            'category',
            'priority',
            'status',
            'owner_user',
            'owner_user_name',
            'owner_role',
            'due_at',
            'action_text',
            'contingency_text',
            'source_type',
            'source_id',
            'cancellation_reason',
            'is_overdue',
            'acknowledgement_count',
            'is_acknowledged_by_me',
            'created_by',
            'created_by_name',
            'updated_by',
            'updated_by_name',
            'completed_by',
            'completed_by_name',
            'completed_at',
            'cancelled_by',
            'cancelled_by_name',
            'cancelled_at',
            'escalated_at',
            'created_at',
            'updated_at',
        ]
        read_only_fields = fields

    def get_is_acknowledged_by_me(self, obj):
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if not user or not getattr(user, 'is_authenticated', False):
            return False
        return obj.acknowledgements.filter(user=user).exists()


class WardBoardTaskCreateSerializer(serializers.Serializer):
    patient_id = serializers.PrimaryKeyRelatedField(
        source='patient',
        queryset=PatientProfile.objects.select_related('user'),
    )
    admission_id = serializers.PrimaryKeyRelatedField(
        source='admission',
        queryset=Admission.objects.select_related('patient', 'bed__ward__department'),
        required=False,
        allow_null=True,
    )
    ward_id = serializers.PrimaryKeyRelatedField(
        source='ward',
        queryset=Ward.objects.select_related('department'),
        required=False,
        allow_null=True,
    )
    category = serializers.ChoiceField(choices=WardBoardTask.Category.choices, required=False)
    priority = serializers.ChoiceField(choices=WardBoardTask.Priority.choices, required=False)
    owner_user_id = serializers.PrimaryKeyRelatedField(
        source='owner_user',
        queryset=User.objects.all(),
        required=False,
        allow_null=True,
    )
    owner_role = serializers.CharField(required=False, allow_blank=True, max_length=30)
    due_at = serializers.DateTimeField(required=False, allow_null=True)
    action_text = serializers.CharField(allow_blank=False)
    contingency_text = serializers.CharField(required=False, allow_blank=True)
    source_type = serializers.ChoiceField(choices=WardBoardTask.SourceType.choices, required=False)
    source_id = serializers.CharField(required=False, allow_blank=True, max_length=64)

    def validate(self, attrs):
        owner_user = attrs.get('owner_user')
        owner_role = (attrs.get('owner_role') or '').strip()
        if bool(owner_user) == bool(owner_role):
            raise serializers.ValidationError({'owner': 'Provide exactly one of owner_user_id or owner_role.'})
        attrs['owner_role'] = owner_role
        return attrs


class WardBoardTaskUpdateSerializer(serializers.Serializer):
    category = serializers.ChoiceField(choices=WardBoardTask.Category.choices, required=False)
    priority = serializers.ChoiceField(choices=WardBoardTask.Priority.choices, required=False)
    status = serializers.ChoiceField(
        choices=[
            WardBoardTask.Status.OPEN,
            WardBoardTask.Status.IN_PROGRESS,
        ],
        required=False,
    )
    admission_id = serializers.PrimaryKeyRelatedField(
        source='admission',
        queryset=Admission.objects.select_related('patient', 'bed__ward__department'),
        required=False,
        allow_null=True,
    )
    ward_id = serializers.PrimaryKeyRelatedField(
        source='ward',
        queryset=Ward.objects.select_related('department'),
        required=False,
        allow_null=True,
    )
    owner_user_id = serializers.PrimaryKeyRelatedField(
        source='owner_user',
        queryset=User.objects.all(),
        required=False,
        allow_null=True,
    )
    owner_role = serializers.CharField(required=False, allow_blank=True, max_length=30)
    due_at = serializers.DateTimeField(required=False, allow_null=True)
    action_text = serializers.CharField(required=False, allow_blank=False)
    contingency_text = serializers.CharField(required=False, allow_blank=True)

    def validate(self, attrs):
        if 'owner_user' in attrs and 'owner_role' in attrs:
            owner_user = attrs.get('owner_user')
            owner_role = (attrs.get('owner_role') or '').strip()
            if bool(owner_user) == bool(owner_role):
                raise serializers.ValidationError({'owner': 'Provide exactly one of owner_user_id or owner_role.'})
            attrs['owner_role'] = owner_role
        elif 'owner_user' in attrs:
            attrs['owner_role'] = ''
        elif 'owner_role' in attrs:
            attrs['owner_user'] = None
            attrs['owner_role'] = (attrs.get('owner_role') or '').strip()
        return attrs


class WardBoardTaskActionSerializer(serializers.Serializer):
    note = serializers.CharField(required=False, allow_blank=True)


class WardBoardTaskCancelSerializer(serializers.Serializer):
    reason = serializers.CharField(required=True, allow_blank=False)


class WardBoardTaskEscalateSerializer(serializers.Serializer):
    priority = serializers.ChoiceField(
        choices=[WardBoardTask.Priority.URGENT, WardBoardTask.Priority.STAT],
        required=False,
    )
    owner_user_id = serializers.PrimaryKeyRelatedField(
        source='owner_user',
        queryset=User.objects.all(),
        required=False,
        allow_null=True,
    )
    owner_role = serializers.CharField(required=False, allow_blank=True, max_length=30)
    due_at = serializers.DateTimeField(required=False, allow_null=True)
    note = serializers.CharField(required=False, allow_blank=True)

    def validate(self, attrs):
        if 'owner_user' in attrs and 'owner_role' in attrs:
            owner_user = attrs.get('owner_user')
            owner_role = (attrs.get('owner_role') or '').strip()
            if bool(owner_user) == bool(owner_role):
                raise serializers.ValidationError({'owner': 'Provide exactly one of owner_user_id or owner_role.'})
            attrs['owner_role'] = owner_role
        return attrs


class WardBoardAcknowledgementSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source='user.get_full_name', read_only=True)

    class Meta:
        model = WardBoardAcknowledgement
        fields = [
            'id',
            'task',
            'user',
            'user_name',
            'acknowledged_at',
        ]
        read_only_fields = fields


class WardBoardTaskEventListSerializer(serializers.ModelSerializer):
    actor_name = serializers.CharField(source='actor.get_full_name', read_only=True)

    class Meta:
        model = WardBoardTaskEvent
        fields = [
            'id',
            'event_type',
            'actor',
            'actor_name',
            'metadata',
            'created_at',
        ]
        read_only_fields = fields


class WardBoardPatientRowSerializer(serializers.Serializer):
    patient_id = serializers.UUIDField()
    patient_name = serializers.CharField()
    medical_record_number = serializers.CharField(allow_blank=True, allow_null=True)
    admission_id = serializers.UUIDField(allow_null=True)
    admission_status = serializers.CharField(allow_blank=True, allow_null=True)
    ward_id = serializers.UUIDField(allow_null=True)
    ward_name = serializers.CharField(allow_blank=True, allow_null=True)
    bed_number = serializers.CharField(allow_blank=True, allow_null=True)
    open_task_count = serializers.IntegerField()
    urgent_task_count = serializers.IntegerField()
    overdue_task_count = serializers.IntegerField()
    next_due_at = serializers.DateTimeField(allow_null=True)
    nursing_task_count = serializers.IntegerField()
    active_alert_count = serializers.IntegerField()
    discharge_task_count = serializers.IntegerField()
    open_lab_order_count = serializers.IntegerField()


class WardBoardPatientDetailSerializer(WardBoardPatientRowSerializer):
    tasks = serializers.SerializerMethodField()

    def get_tasks(self, obj):
        return WardBoardTaskListSerializer(obj.get('tasks', []), many=True).data
