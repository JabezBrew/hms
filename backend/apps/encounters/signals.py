"""
Signals for encounter search projection maintenance.
"""
from __future__ import annotations

from django.db import transaction
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from apps.core.search_projections import sync_encounter_search_index


@receiver(post_save, sender='encounters.Encounter')
def sync_search_index_for_encounter(sender, instance, **kwargs):
    transaction.on_commit(lambda: sync_encounter_search_index(instance))


@receiver(post_delete, sender='encounters.Encounter')
def delete_search_index_for_encounter(sender, instance, **kwargs):
    from apps.encounters.models import EncounterSearchIndex
    pk = instance.pk
    transaction.on_commit(
        lambda: EncounterSearchIndex.objects.filter(encounter_id=pk).delete()
    )
