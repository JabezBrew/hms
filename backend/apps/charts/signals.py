from django.db import transaction
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from apps.charts.models import ChartEntry
from apps.charts.seeding import ensure_system_templates_for_facility
from apps.charts.tasks import sync_chart_entry_timeline_event
from apps.core.models import Facility

@receiver(post_save, sender=Facility)
def seed_system_chart_templates(sender, instance, created, raw=False, **kwargs):
    if raw or not created:
        return

    def seed_templates():
        ensure_system_templates_for_facility(instance)

    transaction.on_commit(seed_templates)


@receiver(post_save, sender=ChartEntry)
def sync_chart_entry_to_timeline(sender, instance, created, **kwargs):
    transaction.on_commit(lambda: sync_chart_entry_timeline_event.delay(str(instance.id)))


@receiver(post_delete, sender=ChartEntry)
def delete_chart_entry_timeline_event(sender, instance, **kwargs):
    from apps.clinical_notes.models import TimelineEvent

    TimelineEvent.objects.filter(
        source_model='ChartEntry',
        source_id=instance.id,
    ).delete()
