"""
Signal handlers for syncing laboratory data to TimelineEvent.
"""
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver


@receiver(post_save, sender='laboratory.LabOrder')
def sync_lab_order_to_timeline(sender, instance, created, **kwargs):
    """Sync LabOrder to TimelineEvent on save."""
    from apps.clinical_notes.models import TimelineEvent

    # Get author info
    author_name = ''
    author_id = None
    if instance.ordering_provider and instance.ordering_provider.staff:
        staff = instance.ordering_provider.staff
        if staff.user:
            author_name = staff.user.get_full_name()
            author_id = staff.user.id

    # Build summary - list tests ordered
    test_names = []
    for order_test in instance.order_tests.select_related('test')[:5]:
        test_names.append(order_test.test.short_name)
    
    if len(test_names) < instance.order_tests.count():
        test_names.append(f"+{instance.order_tests.count() - len(test_names)} more")
    
    summary = ", ".join(test_names) if test_names else "Lab tests ordered"

    # Build search text
    search_parts = [instance.order_number, summary]
    if instance.clinical_notes:
        search_parts.append(instance.clinical_notes)

    TimelineEvent.objects.update_or_create(
        source_model='LabOrder',
        source_id=instance.id,
        defaults={
            'patient': instance.patient,
            'encounter': instance.encounter,
            'event_type': 'lab',
            'event_subtype': instance.status,
            'timestamp': instance.created_at,
            'title': f"Lab Order #{instance.order_number}",
            'content_summary': summary,
            'author_name': author_name,
            'author_id': author_id,
            'is_critical': instance.priority == 'stat',
            'status': instance.status,
            'has_edits': False,
            'version_count': 0,
            'template_id': None,
            'template_title': '',
            'search_text': ' '.join(search_parts),
        }
    )


@receiver(post_delete, sender='laboratory.LabOrder')
def delete_lab_order_timeline_event(sender, instance, **kwargs):
    """Delete TimelineEvent when LabOrder is deleted."""
    from apps.clinical_notes.models import TimelineEvent

    TimelineEvent.objects.filter(
        source_model='LabOrder',
        source_id=instance.id
    ).delete()
