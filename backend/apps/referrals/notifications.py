from django.contrib.auth import get_user_model
from django.db.models import Q

from apps.users.models import PractitionerProfile
from .models import ReferralNotification

User = get_user_model()


def resolve_referral_notification_recipients(referral, event):
    """
    Resolve in-app referral notification recipients.

    Priority:
    - submitted: notify specialists (specific provider if set, else department/specialty doctors)
    - accepted/declined/scheduled/completed: notify referring provider only
    """
    if event == 'submitted':
        if referral.referred_to_provider:
            provider_user = referral.referred_to_provider.staff.user
            if (
                provider_user.user_type == 'doctor'
                and referral.referred_to_provider.staff.primary_facility_id == referral.facility_id
            ):
                return [provider_user]
            return []

        practitioners = PractitionerProfile.objects.select_related('staff__user').filter(
            staff__user__user_type='doctor',
            staff__primary_facility_id=referral.facility_id
        ).filter(
            Q(staff__department__iexact=referral.referred_to_department)
            | Q(specialization__iexact=referral.referred_to_specialty)
        )

        user_ids = list(practitioners.values_list('staff__user_id', flat=True).distinct())
        if not user_ids:
            return []
        return list(User.objects.filter(id__in=user_ids))

    referring_provider = referral.referring_provider
    if not referring_provider:
        return []

    provider_user = referring_provider.staff.user
    if (
        provider_user.user_type == 'doctor'
        and referring_provider.staff.primary_facility_id == referral.facility_id
    ):
        return [provider_user]
    return []


def create_referral_notifications(referral, event, actor=None):
    """
    Create in-app notifications for a referral event.
    """
    recipients = resolve_referral_notification_recipients(referral, event)
    notifications = []

    for recipient in recipients:
        notifications.append(
            ReferralNotification.objects.create(
                recipient=recipient,
                actor=actor,
                referral=referral,
                facility=referral.facility,
                event=event,
                status=referral.status,
                urgency=referral.urgency
            )
        )

    return notifications
