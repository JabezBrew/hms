"""
Celery tasks for organization app.
"""
from celery import shared_task
from django.core.cache import cache

from .tree_cache import (
    ORG_TREE_CACHE_TTL,
    build_org_tree_cache_key,
    build_org_tree_payload,
    get_org_tree_cache_version,
)
from hms_backend.tenancy import facility_task
from apps.core.cache_utils import facility_cache_key


@shared_task
@facility_task
def rebuild_org_tree_cache(version=None, facility_id=None, include_inactive=False, facility_code=None):
    current_version = get_org_tree_cache_version()
    if version is not None and version != current_version:
        return
    payload = build_org_tree_payload(
        facility_id=facility_id,
        include_inactive=include_inactive
    )
    cache_key = build_org_tree_cache_key(
        current_version,
        facility_id,
        include_inactive
    )
    cache.set(facility_cache_key(cache_key), payload, timeout=ORG_TREE_CACHE_TTL)


# =============================================================================
# Duty Roster Tasks
# =============================================================================


@shared_task
@facility_task
def generate_weekly_roster(weeks_ahead=2, facility_code=None):
    """
    Generate roster entries for the next N weeks.

    Schedule: Run weekly (e.g., Sunday night)
    """
    from datetime import date, timedelta
    from .services import DutyRosterService
    from apps.core.models import Facility
    import logging

    logger = logging.getLogger(__name__)

    today = date.today()
    start_date = today + timedelta(days=1)  # Start from tomorrow
    end_date = today + timedelta(weeks=weeks_ahead)

    if facility_code:
        facilities = Facility.objects.filter(code=facility_code, is_active=True)
    else:
        facilities = Facility.objects.filter(is_active=True)

    total_created = 0
    for facility in facilities:
        count = DutyRosterService.generate_facility_roster(
            facility=facility,
            start_date=start_date,
            end_date=end_date,
        )
        total_created += count
        logger.info(f"Generated {count} roster entries for facility {facility.code}")

    return {
        'success': True,
        'entries_created': total_created,
        'date_range': f'{start_date} to {end_date}',
    }


@shared_task
@facility_task
def send_duty_reminders(days_ahead=1, facility_code=None):
    """
    Send reminders for upcoming duty assignments.

    Schedule: Run daily (e.g., 6 PM for next day's duties)
    """
    from datetime import date, timedelta
    from .models import DutyRoster
    from apps.core.models import Facility
    import logging

    logger = logging.getLogger(__name__)

    target_date = date.today() + timedelta(days=days_ahead)

    if facility_code:
        facilities = Facility.objects.filter(code=facility_code, is_active=True)
    else:
        facilities = Facility.objects.filter(is_active=True)

    reminders_sent = 0
    for facility in facilities:
        entries = DutyRoster.objects.filter(
            facility=facility,
            date=target_date,
            is_active=True,
        ).select_related('practitioner', 'practitioner__staff', 'practitioner__staff__user', 'unit')

        for entry in entries:
            # TODO: Implement actual notification (email, push, in-app)
            # For now, just log
            logger.info(
                f"Duty reminder: {entry.practitioner} has duty at {entry.unit.name} "
                f"on {target_date} ({entry.start_time}-{entry.end_time})"
            )
            reminders_sent += 1

    return {
        'success': True,
        'reminders_sent': reminders_sent,
        'target_date': target_date.isoformat(),
    }


@shared_task
def notify_duty_swap(swap_entry_id):
    """
    Send notification when a duty swap occurs.
    Notifies both the original practitioner and the replacement.
    """
    from .models import DutyRoster
    import logging

    logger = logging.getLogger(__name__)

    try:
        entry = DutyRoster.objects.select_related(
            'practitioner', 'practitioner__staff', 'practitioner__staff__user',
            'original_practitioner', 'original_practitioner__staff', 'original_practitioner__staff__user',
            'unit'
        ).get(id=swap_entry_id)
    except DutyRoster.DoesNotExist:
        logger.error(f"Swap entry {swap_entry_id} not found")
        return {'success': False, 'error': 'Entry not found'}

    # TODO: Implement actual notification (email, push, in-app)
    # For now, just log
    logger.info(
        f"Duty swap notification: {entry.original_practitioner} -> {entry.practitioner} "
        f"at {entry.unit.name} on {entry.date}"
    )

    return {
        'success': True,
        'swap_id': swap_entry_id,
    }
