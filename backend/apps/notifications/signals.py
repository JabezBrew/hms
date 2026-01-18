from django.db.models.signals import post_save
from django.dispatch import receiver

from apps.nursing.models import NursingAlert, NursingTask
from apps.referrals.models import ReferralNotification

from .tasks import (
    ingest_drug_safety_alert_async,
    ingest_nursing_alert_async,
    ingest_nursing_task_async,
    ingest_referral_notification_async,
)


@receiver(post_save, sender='referrals.ReferralNotification')
def ingest_referral_notification(sender, instance, **kwargs):
    ingest_referral_notification_async.delay(str(instance.id))


@receiver(post_save, sender='nursing.NursingAlert')
def ingest_nursing_alert(sender, instance, **kwargs):
    ingest_nursing_alert_async.delay(str(instance.id))


@receiver(post_save, sender='nursing.NursingTask')
def ingest_nursing_task(sender, instance, **kwargs):
    ingest_nursing_task_async.delay(str(instance.id))


@receiver(post_save, sender='drug_safety.DrugSafetyAlert')
def ingest_drug_safety_alert(sender, instance, **kwargs):
    ingest_drug_safety_alert_async.delay(str(instance.id))
