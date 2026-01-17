"""
Tests for referral notification helpers.
"""
import pytest

from apps.referrals.notifications import (
    resolve_referral_notification_recipients,
    create_referral_notifications
)
from apps.referrals.models import ReferralNotification
from .factories import ReferralFactory
from apps.users.tests.factories import (
    PractitionerProfileFactory, NurseUserFactory, StaffFactory
)


@pytest.mark.django_db
class TestReferralNotificationRecipients:
    def test_prefers_specific_referred_provider(self):
        referral = ReferralFactory(
            status='pending',
            referred_to_department='Cardiology',
            referred_to_specialty='Cardiology'
        )
        referred_provider = PractitionerProfileFactory(
            staff__primary_facility=referral.facility,
            staff__department='Cardiology',
            specialization='Cardiology'
        )
        referral.referred_to_provider = referred_provider
        referral.save(update_fields=['referred_to_provider'])

        PractitionerProfileFactory(
            staff__primary_facility=referral.facility,
            staff__department='Cardiology',
            specialization='Cardiology'
        )

        recipients = resolve_referral_notification_recipients(referral, 'submitted')

        assert recipients == [referred_provider.staff.user]

    def test_matches_department_or_specialty_doctors_only(self):
        referral = ReferralFactory(
            status='pending',
            referred_to_department='Neurology',
            referred_to_specialty='Neurology'
        )

        department_doctor = PractitionerProfileFactory(
            staff__primary_facility=referral.facility,
            staff__department='Neurology',
            specialization='Cardiology'
        )
        specialty_doctor = PractitionerProfileFactory(
            staff__primary_facility=referral.facility,
            staff__department='Radiology',
            specialization='Neurology'
        )

        nurse_user = NurseUserFactory(primary_facility=referral.facility)
        nurse_staff = StaffFactory(
            user=nurse_user,
            primary_facility=referral.facility,
            department='Neurology',
            position='Staff Nurse'
        )
        PractitionerProfileFactory(
            staff=nurse_staff,
            specialization='Neurology'
        )

        recipients = resolve_referral_notification_recipients(referral, 'submitted')

        assert department_doctor.staff.user in recipients
        assert specialty_doctor.staff.user in recipients
        assert nurse_user not in recipients


@pytest.mark.django_db
class TestReferralNotificationCreation:
    def test_creates_notifications_for_recipients(self):
        referral = ReferralFactory(
            status='pending',
            referred_to_department='Orthopedics',
            referred_to_specialty='Orthopedics'
        )
        doctor = PractitionerProfileFactory(
            staff__primary_facility=referral.facility,
            staff__department='Orthopedics',
            specialization='Orthopedics'
        )

        notifications = create_referral_notifications(referral, 'submitted', actor=doctor.staff.user)

        recipients = [notification.recipient for notification in notifications]
        assert doctor.staff.user in recipients
        for notification in notifications:
            assert notification.event == 'submitted'
            assert notification.status == referral.status
            assert notification.urgency == referral.urgency
            assert ReferralNotification.objects.filter(id=notification.id).exists()

    def test_non_submitted_notifies_referring_provider(self):
        referral = ReferralFactory(status='pending')
        specialist = PractitionerProfileFactory(
            staff__primary_facility=referral.facility,
            staff__department='Cardiology',
            specialization='Cardiology'
        )
        referral.referred_to_provider = specialist
        referral.save(update_fields=['referred_to_provider'])

        notifications = create_referral_notifications(referral, 'accepted')

        assert len(notifications) == 1
        assert notifications[0].recipient == referral.referring_provider.staff.user
