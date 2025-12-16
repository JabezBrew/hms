"""
Signal handlers for syncing referral data to TimelineEvent.
"""
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver


@receiver(post_save, sender='referrals.Referral')
def sync_referral_to_timeline(sender, instance, created, **kwargs):
    """Sync Referral to TimelineEvent on save."""
    from apps.clinical_notes.models import TimelineEvent

    # Get author info
    author_name = ''
    author_id = None
    if instance.referring_provider and instance.referring_provider.staff:
        staff = instance.referring_provider.staff
        if staff.user:
            author_name = staff.user.get_full_name()
            author_id = staff.user.id

    # Build summary
    summary = f"Referral to {instance.referred_to_specialty}"
    if instance.referred_to_department:
        summary = f"Referral to {instance.referred_to_department} ({instance.referred_to_specialty})"

    # Build search text
    search_parts = [
        instance.referral_number,
        instance.referred_to_specialty,
        instance.referred_to_department or '',
        instance.reason or '',
    ]

    TimelineEvent.objects.update_or_create(
        source_model='Referral',
        source_id=instance.id,
        defaults={
            'patient': instance.patient,
            'encounter': instance.encounter,
            'event_type': 'referral',
            'event_subtype': instance.status,
            'timestamp': instance.created_at,
            'title': f"Referral: {instance.referred_to_specialty}",
            'content_summary': summary,
            'author_name': author_name,
            'author_id': author_id,
            'is_critical': instance.urgency == 'emergency',
            'status': instance.status,
            'has_edits': False,
            'version_count': 0,
            'template_id': None,
            'template_title': '',
            'search_text': ' '.join(search_parts),
        }
    )


@receiver(post_delete, sender='referrals.Referral')
def delete_referral_timeline_event(sender, instance, **kwargs):
    """Delete TimelineEvent when Referral is deleted."""
    from apps.clinical_notes.models import TimelineEvent

    TimelineEvent.objects.filter(
        source_model='Referral',
        source_id=instance.id
    ).delete()
