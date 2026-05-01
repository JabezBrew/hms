"""
Signals for appointment search projection maintenance.
"""
from __future__ import annotations

from django.db import transaction
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from apps.core.search_projections import sync_appointment_search_index


@receiver(post_save, sender='appointments.Appointment')
def sync_search_index_for_appointment(sender, instance, **kwargs):
    transaction.on_commit(lambda: sync_appointment_search_index(instance))


@receiver(post_delete, sender='appointments.Appointment')
def delete_search_index_for_appointment(sender, instance, **kwargs):
    from apps.appointments.models import AppointmentSearchIndex
    pk = instance.pk
    transaction.on_commit(
        lambda: AppointmentSearchIndex.objects.filter(appointment_id=pk).delete()
    )
