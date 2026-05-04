from celery import shared_task
from celery import shared_task

from .models import InboxItem


def _priority_from_referral(urgency):
    if urgency == 'emergency':
        return InboxItem.PriorityLevel.EMERGENCY
    if urgency == 'urgent':
        return InboxItem.PriorityLevel.URGENT
    return InboxItem.PriorityLevel.NORMAL


def _priority_from_severity(severity):
    if severity in ['critical', 'high']:
        return InboxItem.PriorityLevel.URGENT
    if severity == 'moderate':
        return InboxItem.PriorityLevel.NORMAL
    return InboxItem.PriorityLevel.ROUTINE


def _priority_from_task(priority):
    if priority == 'urgent':
        return InboxItem.PriorityLevel.EMERGENCY
    if priority == 'high':
        return InboxItem.PriorityLevel.URGENT
    if priority == 'medium':
        return InboxItem.PriorityLevel.NORMAL
    return InboxItem.PriorityLevel.ROUTINE


@shared_task(bind=True, max_retries=3)
def ingest_referral_notification_async(self, notification_id):
    from apps.referrals.models import ReferralNotification

    try:
        notification = ReferralNotification.objects.select_related(
            'referral',
            'recipient',
            'facility',
            'referral__patient__user',
        ).get(id=notification_id)
    except ReferralNotification.DoesNotExist:
        return

    referral = notification.referral
    title = f"Referral {notification.get_event_display()}"
    summary = f"#{referral.referral_number} - {referral.referred_to_department}"

    action_required = referral.requires_action
    InboxItem.objects.update_or_create(
        recipient_user=notification.recipient,
        recipient_role=notification.recipient.user_type,
        source_type=InboxItem.SourceType.REFERRAL,
        source_id=notification.id,
        dedupe_key=f"referral:{notification.id}",
        defaults={
            'facility': notification.facility,
            'patient': referral.patient,
            'title': title,
            'summary': summary or '',
            'action_url': f"/patients/{referral.patient_id}?action=add_note&referral_id={referral.id}",
            'priority': _priority_from_referral(notification.urgency),
            'status': InboxItem.ItemStatus.READ if notification.is_read else InboxItem.ItemStatus.UNREAD,
            'is_action_required': action_required,
            'is_read': notification.is_read,
            'occurred_at': notification.created_at,
        }
    )

    if action_required:
        InboxItem.objects.update_or_create(
            facility=notification.facility,
            recipient_role='doctor',
            source_type=InboxItem.SourceType.REFERRAL,
            source_id=referral.id,
            dedupe_key=f"referral_action:{referral.id}",
            defaults={
                'recipient_user': None,
                'patient': referral.patient,
                'title': 'Referral Needs Review',
                'summary': summary or '',
                'action_url': f"/patients/{referral.patient_id}?action=add_note&referral_id={referral.id}",
                'priority': _priority_from_referral(notification.urgency),
                'status': InboxItem.ItemStatus.UNREAD,
                'is_action_required': True,
                'is_read': False,
                'occurred_at': notification.created_at,
            }
        )


@shared_task(bind=True, max_retries=3)
def ingest_nursing_alert_async(self, alert_id):
    from apps.nursing.models import NursingAlert

    try:
        alert = NursingAlert.objects.select_related('patient__user', 'facility').get(id=alert_id)
    except NursingAlert.DoesNotExist:
        return

    summary = alert.message[:200] if alert.message else ''

    InboxItem.objects.update_or_create(
        facility=alert.facility,
        recipient_role='nurse',
        source_type=InboxItem.SourceType.NURSING_ALERT,
        source_id=alert.id,
        dedupe_key=f"nursing_alert:{alert.id}:nurse",
        defaults={
            'recipient_user': None,
            'patient': alert.patient,
            'title': alert.get_alert_type_display(),
            'summary': summary or '',
            'action_url': f"/patients/{alert.patient_id}?action=ward_round",
            'priority': _priority_from_severity(alert.severity),
            'status': InboxItem.ItemStatus.ACKNOWLEDGED if alert.is_acknowledged else InboxItem.ItemStatus.UNREAD,
            'is_action_required': not alert.is_acknowledged,
            'is_read': alert.is_acknowledged,
            'occurred_at': alert.created_at,
        }
    )

    InboxItem.objects.update_or_create(
        facility=alert.facility,
        recipient_role='doctor',
        source_type=InboxItem.SourceType.NURSING_ALERT,
        source_id=alert.id,
        dedupe_key=f"nursing_alert:{alert.id}:doctor",
        defaults={
            'recipient_user': None,
            'patient': alert.patient,
            'title': alert.get_alert_type_display(),
            'summary': summary or '',
            'action_url': f"/patients/{alert.patient_id}?action=consultation",
            'priority': _priority_from_severity(alert.severity),
            'status': InboxItem.ItemStatus.ACKNOWLEDGED if alert.is_acknowledged else InboxItem.ItemStatus.UNREAD,
            'is_action_required': not alert.is_acknowledged,
            'is_read': alert.is_acknowledged,
            'occurred_at': alert.created_at,
        }
    )


@shared_task(bind=True, max_retries=3)
def ingest_nursing_task_async(self, task_id):
    from apps.nursing.models import NursingTask

    try:
        task = NursingTask.objects.select_related('patient__user', 'facility', 'assigned_to__staff__user').get(id=task_id)
    except NursingTask.DoesNotExist:
        return

    action_required = task.status in ['pending', 'overdue']
    title = f"{task.get_task_type_display()}"
    summary = task.description[:200] if task.description else ''

    recipient_user = None
    recipient_role = 'nurse'
    if task.assigned_to and task.assigned_to.staff and task.assigned_to.staff.user:
        recipient_user = task.assigned_to.staff.user

    InboxItem.objects.update_or_create(
        facility=task.facility,
        recipient_user=recipient_user,
        recipient_role=recipient_role,
        source_type=InboxItem.SourceType.NURSING_TASK,
        source_id=task.id,
        dedupe_key=f"nursing_task:{task.id}",
        defaults={
            'patient': task.patient,
            'title': title,
            'summary': summary or '',
            'action_url': f"/patients/{task.patient_id}?action=ward_round",
            'priority': _priority_from_task(task.priority),
            'status': InboxItem.ItemStatus.DONE if task.status == 'completed' else InboxItem.ItemStatus.UNREAD,
            'is_action_required': action_required,
            'is_read': task.status == 'completed',
            'occurred_at': task.scheduled_time,
        }
    )


@shared_task(bind=True, max_retries=3)
def ingest_lab_order_completion_async(self, order_id):
    from apps.laboratory.models import LabOrder, LabResult

    try:
        order = LabOrder.objects.select_related(
            'patient',
            'facility',
            'ordering_provider__staff__user',
        ).get(id=order_id)
    except LabOrder.DoesNotExist:
        return

    if order.status != 'completed':
        return

    provider = order.ordering_provider
    recipient_user = None
    if provider and provider.staff and provider.staff.user:
        recipient_user = provider.staff.user
    if not recipient_user:
        return

    has_critical = LabResult.objects.filter(
        order_test__order=order,
        flag__in=['critical_low', 'critical_high'],
    ).exists()

    if has_critical:
        priority = InboxItem.PriorityLevel.URGENT
    elif order.priority == 'stat':
        priority = InboxItem.PriorityLevel.URGENT
    else:
        priority = InboxItem.PriorityLevel.NORMAL

    test_count = order.order_tests.count()
    title = f"Lab Results Ready - {order.order_number}"
    if has_critical:
        title = f"CRITICAL Lab Results - {order.order_number}"
    summary = f"{test_count} test{'s' if test_count != 1 else ''} completed for {order.patient.user.get_full_name()}"

    InboxItem.objects.update_or_create(
        recipient_user=recipient_user,
        recipient_role='doctor',
        source_type=InboxItem.SourceType.LAB_RESULT,
        source_id=order.id,
        dedupe_key=f"lab_order:{order.id}",
        defaults={
            'facility': order.facility,
            'patient': order.patient,
            'title': title,
            'summary': summary,
            'action_url': f"/patients/{order.patient_id}?action=view_lab_results&order_id={order.id}",
            'priority': priority,
            'status': InboxItem.ItemStatus.UNREAD,
            'is_action_required': True,
            'is_read': False,
            'occurred_at': order.completed_at or order.updated_at,
        }
    )


@shared_task(bind=True, max_retries=3)
def ingest_drug_safety_alert_async(self, alert_id):
    from apps.drug_safety.models import DrugSafetyAlert

    try:
        alert = DrugSafetyAlert.objects.select_related('patient__user', 'prescription', 'encounter').get(id=alert_id)
    except DrugSafetyAlert.DoesNotExist:
        return

    summary = alert.description[:200] if alert.description else ''

    InboxItem.objects.update_or_create(
        facility=alert.patient.facility,
        recipient_role='doctor',
        source_type=InboxItem.SourceType.DRUG_SAFETY,
        source_id=alert.id,
        dedupe_key=f"drug_safety:{alert.id}:doctor",
        defaults={
            'recipient_user': None,
            'patient': alert.patient,
            'title': alert.title,
            'summary': summary or '',
            'action_url': f"/patients/{alert.patient_id}?action=add_prescription&alert_id={alert.id}",
            'priority': _priority_from_severity(alert.severity),
            'status': InboxItem.ItemStatus.DONE if alert.is_overridden else InboxItem.ItemStatus.UNREAD,
            'is_action_required': not alert.is_overridden,
            'is_read': alert.is_overridden,
            'occurred_at': alert.created_at,
        }
    )

    InboxItem.objects.update_or_create(
        facility=alert.patient.facility,
        recipient_role='nurse',
        source_type=InboxItem.SourceType.DRUG_SAFETY,
        source_id=alert.id,
        dedupe_key=f"drug_safety:{alert.id}:nurse",
        defaults={
            'recipient_user': None,
            'patient': alert.patient,
            'title': alert.title,
            'summary': summary or '',
            'action_url': f"/patients/{alert.patient_id}?action=ward_round&alert_id={alert.id}",
            'priority': _priority_from_severity(alert.severity),
            'status': InboxItem.ItemStatus.DONE if alert.is_overridden else InboxItem.ItemStatus.UNREAD,
            'is_action_required': not alert.is_overridden,
            'is_read': alert.is_overridden,
            'occurred_at': alert.created_at,
        }
    )
