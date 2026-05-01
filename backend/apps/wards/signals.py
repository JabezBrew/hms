"""
Signals for ward and admission search projection maintenance.
"""
from __future__ import annotations

from django.db import transaction
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from apps.core.search_projections import sync_admission_search_index, sync_ward_search_index


@receiver(post_save, sender='wards.Ward')
def sync_search_index_for_ward(sender, instance, **kwargs):
    transaction.on_commit(lambda: sync_ward_search_index(instance))


@receiver(post_delete, sender='wards.Ward')
def delete_search_index_for_ward(sender, instance, **kwargs):
    from apps.wards.models import WardSearchIndex
    pk = instance.pk
    transaction.on_commit(
        lambda: WardSearchIndex.objects.filter(ward_id=pk).delete()
    )


@receiver(post_save, sender='wards.Admission')
def sync_search_index_for_admission(sender, instance, **kwargs):
    transaction.on_commit(lambda: sync_admission_search_index(instance))


@receiver(post_delete, sender='wards.Admission')
def delete_search_index_for_admission(sender, instance, **kwargs):
    from apps.wards.models import AdmissionSearchIndex
    pk = instance.pk
    transaction.on_commit(
        lambda: AdmissionSearchIndex.objects.filter(admission_id=pk).delete()
    )
