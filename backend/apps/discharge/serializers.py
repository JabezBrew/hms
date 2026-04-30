from decimal import Decimal

from rest_framework import serializers

from apps.billing.models import Invoice
from apps.discharge.models import DischargeCase, DischargeTask
from apps.discharge.services import BILLING_ROLES, build_billing_summary


class DischargeTaskSerializer(serializers.ModelSerializer):
    task_type_display = serializers.CharField(source='get_task_type_display', read_only=True)

    class Meta:
        model = DischargeTask
        fields = [
            'id',
            'task_type',
            'task_type_display',
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


class DischargeCaseListSerializer(serializers.ModelSerializer):
    patient_name = serializers.CharField(source='patient.user.get_full_name', read_only=True)
    medical_record_number = serializers.CharField(source='patient.medical_record_number', read_only=True)
    ward_name = serializers.SerializerMethodField()
    blockers = serializers.SerializerMethodField()
    advisory_tasks_open = serializers.SerializerMethodField()
    invoice_summary = serializers.SerializerMethodField()

    class Meta:
        model = DischargeCase
        fields = [
            'id',
            'admission',
            'patient',
            'patient_name',
            'medical_record_number',
            'ward_name',
            'status',
            'medical_ready_at',
            'billing_cutoff_at',
            'finalized_at',
            'discharge_disposition',
            'blockers',
            'advisory_tasks_open',
            'invoice_summary',
        ]
        read_only_fields = ['__all__']

    def get_ward_name(self, obj):
        if obj.admission.bed:
            return obj.admission.bed.ward.name
        if obj.admission.status == 'waiting':
            return 'Waiting List'
        return 'Admitted (No Bed)'

    def get_blockers(self, obj):
        tasks = getattr(obj, 'prefetched_tasks', None)
        if tasks is None:
            tasks = obj.tasks.filter(blocking=True)
        return [
            {
                'task_type': task.task_type,
                'status': task.status,
            }
            for task in tasks
            if task.blocking
        ]

    def get_advisory_tasks_open(self, obj):
        tasks = getattr(obj, 'prefetched_tasks', None)
        if tasks is None:
            tasks = obj.tasks.filter(blocking=False)
        return sum(1 for task in tasks if not task.blocking and task.status == DischargeTask.Status.PENDING)

    def get_invoice_summary(self, obj):
        summary = build_billing_summary(obj)
        return {
            'invoice_count': summary.invoice_count,
            'patient_balance_due': str(summary.patient_balance_due),
            'insurance_balance_due': str(summary.insurance_balance_due),
            'total_balance_due': str(summary.total_balance_due),
            'draft_count': summary.draft_count,
            'auto_update_count': summary.auto_update_count,
        }


class DischargeCaseDetailSerializer(DischargeCaseListSerializer):
    tasks = serializers.SerializerMethodField()
    discharge_note_id = serializers.UUIDField(source='discharge_note_id', read_only=True)
    workflow_id = serializers.UUIDField(source='workflow_id', read_only=True)
    nursing_task_id = serializers.UUIDField(source='nursing_task_id', read_only=True)
    metadata = serializers.JSONField(read_only=True)

    class Meta(DischargeCaseListSerializer.Meta):
        fields = DischargeCaseListSerializer.Meta.fields + [
            'tasks',
            'discharge_note_id',
            'workflow_id',
            'nursing_task_id',
            'metadata',
            'cancelled_at',
            'cancel_reason',
            'reopened_at',
        ]

    def get_tasks(self, obj):
        tasks = getattr(obj, 'prefetched_tasks', None)
        if tasks is None:
            tasks = obj.tasks.all().order_by('blocking', 'task_type')
        user = self.context.get('request').user if self.context.get('request') else None
        user_type = getattr(user, 'user_type', None)
        if user_type in BILLING_ROLES:
            tasks = [task for task in tasks if task.task_type == DischargeTask.TaskType.BILLING_CLEARANCE]
        return DischargeTaskSerializer(tasks, many=True).data


class BillingCutoffSerializer(serializers.Serializer):
    billing_cutoff_at = serializers.DateTimeField()


class DischargeTaskCreateSerializer(serializers.Serializer):
    task_type = serializers.ChoiceField(
        choices=[
            DischargeTask.TaskType.PHARMACY_FOLLOWUP,
            DischargeTask.TaskType.LAB_FOLLOWUP,
            DischargeTask.TaskType.IMAGING,
            DischargeTask.TaskType.SOCIAL_WORK,
            DischargeTask.TaskType.TRANSPORT,
            DischargeTask.TaskType.DOCUMENTS,
            DischargeTask.TaskType.OTHER,
        ]
    )
    assigned_role = serializers.CharField(required=False, allow_blank=True)
    notes = serializers.CharField(required=False, allow_blank=True)
    snapshot = serializers.JSONField(required=False, default=dict)


class DischargeTaskUpdateSerializer(serializers.Serializer):
    notes = serializers.CharField(required=False, allow_blank=True)


class DischargeFinalizeSerializer(serializers.Serializer):
    finalized_at = serializers.DateTimeField(required=False)
    acknowledge_task_ids = serializers.ListField(
        child=serializers.UUIDField(),
        required=False,
        default=list,
    )


class DischargeCancelSerializer(serializers.Serializer):
    reason = serializers.CharField(required=False, allow_blank=True)
