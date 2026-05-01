"""
Signals for staff search projection maintenance.
"""
from __future__ import annotations

from django.db import transaction
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from apps.core.search_projections import sync_staff_search_index


@receiver(post_save, sender='users.Staff')
def sync_search_index_for_staff(sender, instance, **kwargs):
    transaction.on_commit(lambda: sync_staff_search_index(instance))


@receiver(post_delete, sender='users.Staff')
def delete_search_index_for_staff(sender, instance, **kwargs):
    from apps.users.models import StaffSearchIndex
    pk = instance.pk
    transaction.on_commit(
        lambda: StaffSearchIndex.objects.filter(staff_id=pk).delete()
    )
