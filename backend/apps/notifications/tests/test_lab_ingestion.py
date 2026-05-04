import pytest
from django.utils import timezone

from apps.laboratory.models import LabOrderStatus, LabResult
from apps.laboratory.tests.factories import (
    LabOrderFactory,
    LabOrderTestFactory,
    LabResultFactory,
    LabSpecimenFactory,
)
from apps.notifications.models import InboxItem
from apps.users.tests.factories import PractitionerProfileFactory


@pytest.mark.django_db
class TestLabOrderInboxIngestion:
    def _build_order_with_result(self, *, flag='normal', priority='routine'):
        practitioner = PractitionerProfileFactory()
        order = LabOrderFactory(
            ordering_provider=practitioner,
            priority=priority,
            status=LabOrderStatus.ORDERED,
        )
        order_test = LabOrderTestFactory(order=order, facility=order.facility)
        specimen = LabSpecimenFactory(order=order, facility=order.facility)
        LabResultFactory(
            order_test=order_test,
            specimen=specimen,
            facility=order.facility,
            flag=flag,
            is_verified=True,
        )
        return order, practitioner

    def test_completion_creates_inbox_item_for_ordering_doctor(self):
        order, practitioner = self._build_order_with_result()

        order.status = LabOrderStatus.COMPLETED
        order.completed_at = timezone.now()
        order.save(update_fields=['status', 'completed_at'])

        item = InboxItem.objects.get(
            source_type=InboxItem.SourceType.LAB_RESULT,
            source_id=order.id,
        )
        assert item.recipient_user == practitioner.staff.user
        assert item.recipient_role == 'doctor'
        assert item.patient_id == order.patient_id
        assert item.facility_id == order.facility_id
        assert item.priority == InboxItem.PriorityLevel.NORMAL
        assert item.status == InboxItem.ItemStatus.UNREAD
        assert item.is_action_required is True
        assert order.order_number in item.title
        assert str(order.id) in item.action_url

    def test_non_completed_save_does_not_create_inbox_item(self):
        order, _ = self._build_order_with_result()

        order.status = LabOrderStatus.PROCESSING
        order.save(update_fields=['status'])

        assert not InboxItem.objects.filter(
            source_type=InboxItem.SourceType.LAB_RESULT,
            source_id=order.id,
        ).exists()

    def test_critical_result_elevates_priority(self):
        order, _ = self._build_order_with_result(flag='critical_high')

        order.status = LabOrderStatus.COMPLETED
        order.completed_at = timezone.now()
        order.save(update_fields=['status', 'completed_at'])

        item = InboxItem.objects.get(
            source_type=InboxItem.SourceType.LAB_RESULT,
            source_id=order.id,
        )
        assert item.priority == InboxItem.PriorityLevel.URGENT
        assert 'CRITICAL' in item.title

    def test_stat_order_elevates_priority(self):
        order, _ = self._build_order_with_result(priority='stat')

        order.status = LabOrderStatus.COMPLETED
        order.completed_at = timezone.now()
        order.save(update_fields=['status', 'completed_at'])

        item = InboxItem.objects.get(
            source_type=InboxItem.SourceType.LAB_RESULT,
            source_id=order.id,
        )
        assert item.priority == InboxItem.PriorityLevel.URGENT

    def test_completion_is_idempotent(self):
        order, _ = self._build_order_with_result()

        order.status = LabOrderStatus.COMPLETED
        order.completed_at = timezone.now()
        order.save(update_fields=['status', 'completed_at'])
        order.save(update_fields=['status', 'completed_at'])

        count = InboxItem.objects.filter(
            source_type=InboxItem.SourceType.LAB_RESULT,
            source_id=order.id,
        ).count()
        assert count == 1
