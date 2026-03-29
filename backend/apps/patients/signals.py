"""
Signals for patient search projection maintenance.
"""
from __future__ import annotations

from django.db import transaction
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from apps.users.models import PatientProfile, User

from .models import PatientSearchIndex
from .tasks import sync_patient_search_index_task


def _enqueue_patient_index_sync(patient_profile_id: str, facility_code: str | None):
    def _sync():
        sync_patient_search_index_task.delay(
            str(patient_profile_id),
            facility_code=facility_code,
        )

    transaction.on_commit(_sync)


@receiver(post_save, sender='users.PatientProfile')
def sync_search_index_for_patient_profile(sender, instance, **kwargs):
    facility = getattr(instance, 'facility', None)
    _enqueue_patient_index_sync(instance.id, getattr(facility, 'code', None))


@receiver(post_save, sender='users.User')
def sync_search_index_for_patient_user(sender, instance, **kwargs):
    patient_profile = getattr(instance, 'patient_profile', None)
    if patient_profile is None:
        return
    facility = getattr(patient_profile, 'facility', None)
    _enqueue_patient_index_sync(patient_profile.id, getattr(facility, 'code', None))


@receiver(post_delete, sender='users.PatientProfile')
def delete_search_index_for_patient_profile(sender, instance, **kwargs):
    PatientSearchIndex.objects.filter(patient_profile_id=instance.id).delete()
