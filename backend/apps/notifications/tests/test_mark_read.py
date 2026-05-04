import uuid

import pytest
from django.utils import timezone
from rest_framework_simplejwt.tokens import AccessToken

from apps.core.tests.factories import BreakGlassEventFactory
from apps.notifications.models import InboxItem
from apps.users.tests.factories import PatientProfileFactory


@pytest.mark.django_db
class TestInboxMarkRead:
    def _make_item(self, *, user, facility, patient=None, is_read=False):
        return InboxItem.objects.create(
            facility=facility,
            recipient_user=user,
            recipient_role=user.user_type,
            patient=patient,
            source_type=InboxItem.SourceType.LAB_RESULT,
            source_id=uuid.uuid4(),
            title='Lab Results Ready',
            summary='CBC complete',
            priority=InboxItem.PriorityLevel.NORMAL,
            status=InboxItem.ItemStatus.READ if is_read else InboxItem.ItemStatus.UNREAD,
            is_action_required=True,
            is_read=is_read,
            occurred_at=timezone.now(),
            dedupe_key=f"test:{uuid.uuid4()}",
        )

    def test_mark_read_flips_status_and_is_read(self, doctor_client, doctor_user, default_facility):
        doctor_user.primary_facility = default_facility
        doctor_user.save(update_fields=['primary_facility'])
        patient = PatientProfileFactory(facility=default_facility, created_by=doctor_user)
        BreakGlassEventFactory(user=doctor_user, patient=patient)
        item = self._make_item(user=doctor_user, facility=default_facility, patient=patient)

        response = doctor_client.post(f'/api/notifications/inbox/{item.id}/mark-read/')

        assert response.status_code == 200
        item.refresh_from_db()
        assert item.is_read is True
        assert item.status == InboxItem.ItemStatus.READ

    def test_mark_read_is_idempotent(self, doctor_client, doctor_user, default_facility):
        doctor_user.primary_facility = default_facility
        doctor_user.save(update_fields=['primary_facility'])
        patient = PatientProfileFactory(facility=default_facility, created_by=doctor_user)
        BreakGlassEventFactory(user=doctor_user, patient=patient)
        item = self._make_item(user=doctor_user, facility=default_facility, patient=patient, is_read=True)

        response = doctor_client.post(f'/api/notifications/inbox/{item.id}/mark-read/')

        assert response.status_code == 200
        item.refresh_from_db()
        assert item.is_read is True

    def test_mark_read_blocks_other_users_items(self, doctor_client, default_facility, user_factory):
        other = user_factory(user_type='doctor')
        item = self._make_item(user=other, facility=default_facility)

        response = doctor_client.post(f'/api/notifications/inbox/{item.id}/mark-read/')

        assert response.status_code == 404
        item.refresh_from_db()
        assert item.is_read is False
