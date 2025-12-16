"""
Django signals for broadcasting nursing events via WebSocket.

These signals automatically broadcast alerts and vital signs updates
to connected WebSocket clients when database changes occur.
"""

import logging
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db.models.signals import post_save
from django.dispatch import receiver

logger = logging.getLogger(__name__)


def serialize_alert(alert):
    """Serialize a NursingAlert instance for WebSocket broadcast."""
    return {
        'id': str(alert.id),
        'patient_id': str(alert.patient_id),
        'patient_name': alert.patient.user.get_full_name(),
        'patient_mrn': alert.patient.medical_record_number,
        'alert_type': alert.alert_type,
        'alert_type_display': alert.get_alert_type_display(),
        'severity': alert.severity,
        'severity_display': alert.get_severity_display(),
        'message': alert.message,
        'is_acknowledged': alert.is_acknowledged,
        'created_at': alert.created_at.isoformat(),
    }


def serialize_vitals(vitals):
    """Serialize a VitalSigns instance for WebSocket broadcast."""
    return {
        'id': str(vitals.id),
        'patient_id': str(vitals.patient_id),
        'temperature': float(vitals.temperature) if vitals.temperature else None,
        'heart_rate': vitals.heart_rate,
        'blood_pressure_systolic': vitals.blood_pressure_systolic,
        'blood_pressure_diastolic': vitals.blood_pressure_diastolic,
        'blood_pressure': vitals.blood_pressure,
        'respiratory_rate': vitals.respiratory_rate,
        'oxygen_saturation': vitals.oxygen_saturation,
        'pain_level': vitals.pain_level,
        'is_critical': vitals.is_critical,
        'recorded_at': vitals.recorded_at.isoformat(),
        'recorded_by': vitals.recorded_by.staff.user.get_full_name() if vitals.recorded_by else None,
    }


def get_patient_ward_id(patient):
    """Get the current ward ID for a patient (if admitted)."""
    try:
        # Check for active admission
        from apps.wards.models import Admission
        active_admission = Admission.objects.filter(
            patient=patient,
            status__in=['admitted', 'waiting']
        ).select_related('bed__ward').first()

        if active_admission and active_admission.bed:
            return str(active_admission.bed.ward_id)
    except Exception as e:
        logger.warning(f"Error getting patient ward: {e}")

    return None


@receiver(post_save, sender='nursing.NursingAlert')
def broadcast_new_alert(sender, instance, created, **kwargs):
    """
    Broadcast new nursing alerts via WebSocket.

    Sends to:
    - Ward-specific group if patient is admitted
    - Critical alerts group for high/critical severity
    """
    if not created:
        return

    try:
        channel_layer = get_channel_layer()
        if not channel_layer:
            logger.warning("Channel layer not available for alert broadcast")
            return

        alert_data = serialize_alert(instance)

        # Get patient's current ward
        ward_id = get_patient_ward_id(instance.patient)

        # Broadcast to ward-specific group
        if ward_id:
            async_to_sync(channel_layer.group_send)(
                f'alerts_ward_{ward_id}',
                {
                    'type': 'alert.new',
                    'alert': alert_data,
                }
            )
            logger.info(f"Alert {instance.id} broadcast to ward {ward_id}")

        # Broadcast critical/high severity to critical alerts group
        if instance.severity in ['critical', 'high']:
            async_to_sync(channel_layer.group_send)(
                'alerts_critical',
                {
                    'type': 'alert.new',
                    'alert': alert_data,
                }
            )
            logger.info(f"Critical alert {instance.id} broadcast to all subscribers")

    except Exception as e:
        # Don't let broadcast failures break the save operation
        logger.error(f"Failed to broadcast alert {instance.id}: {e}")


@receiver(post_save, sender='nursing.VitalSigns')
def broadcast_vital_signs(sender, instance, created, **kwargs):
    """
    Broadcast vital signs updates via WebSocket.

    Sends to patient-specific vitals group.
    For critical vitals, also broadcasts an alert notification.
    """
    if not created:
        return

    try:
        channel_layer = get_channel_layer()
        if not channel_layer:
            logger.warning("Channel layer not available for vitals broadcast")
            return

        vitals_data = serialize_vitals(instance)
        patient_id = str(instance.patient_id)

        # Determine message type based on critical status
        message_type = 'vitals_critical' if instance.is_critical else 'vitals_new'

        async_to_sync(channel_layer.group_send)(
            f'vitals_patient_{patient_id}',
            {
                'type': message_type,
                'vitals': vitals_data,
            }
        )

        logger.debug(f"Vitals {instance.id} broadcast for patient {patient_id}")

    except Exception as e:
        logger.error(f"Failed to broadcast vitals {instance.id}: {e}")


@receiver(post_save, sender='nursing.NursingAlert')
def broadcast_alert_acknowledged(sender, instance, created, **kwargs):
    """
    Broadcast alert acknowledgment via WebSocket.

    Only triggers when an existing alert is acknowledged (not on create).
    """
    if created:
        return

    # Check if this was an acknowledgment update
    if not instance.is_acknowledged:
        return

    try:
        channel_layer = get_channel_layer()
        if not channel_layer:
            return

        ward_id = get_patient_ward_id(instance.patient)

        acknowledgment_data = {
            'type': 'alert.acknowledged',
            'alert_id': str(instance.id),
            'acknowledged_by': instance.acknowledged_by.staff.user.get_full_name() if instance.acknowledged_by else None,
        }

        # Broadcast to ward
        if ward_id:
            async_to_sync(channel_layer.group_send)(
                f'alerts_ward_{ward_id}',
                acknowledgment_data
            )

        # Broadcast to critical group if was critical
        if instance.severity in ['critical', 'high']:
            async_to_sync(channel_layer.group_send)(
                'alerts_critical',
                acknowledgment_data
            )

        logger.info(f"Alert {instance.id} acknowledgment broadcast")

    except Exception as e:
        logger.error(f"Failed to broadcast alert acknowledgment: {e}")


# ============================================================================
# Timeline Event Sync Signals
# ============================================================================

@receiver(post_save, sender='nursing.VitalSigns')
def sync_vitals_to_timeline(sender, instance, created, **kwargs):
    """Sync VitalSigns to TimelineEvent on save."""
    from apps.clinical_notes.models import TimelineEvent

    # Get author info
    author_name = ''
    author_id = None
    if instance.recorded_by and instance.recorded_by.staff:
        staff = instance.recorded_by.staff
        if staff.user:
            author_name = staff.user.get_full_name()
            author_id = staff.user.id

    # Build summary
    parts = []
    if instance.blood_pressure:
        parts.append(f"BP: {instance.blood_pressure}")
    if instance.heart_rate:
        parts.append(f"HR: {instance.heart_rate}")
    if instance.temperature:
        parts.append(f"Temp: {instance.temperature}°C")
    if instance.oxygen_saturation:
        parts.append(f"SpO2: {instance.oxygen_saturation}%")
    if instance.respiratory_rate:
        parts.append(f"RR: {instance.respiratory_rate}")

    summary = " | ".join(parts) if parts else "Vital signs recorded"

    # Build search text
    search_parts = [summary]
    if instance.notes:
        search_parts.append(instance.notes)

    TimelineEvent.objects.update_or_create(
        source_model='VitalSigns',
        source_id=instance.id,
        defaults={
            'patient': instance.patient,
            'encounter': instance.encounter,
            'event_type': 'vitals',
            'event_subtype': 'critical' if instance.is_critical else 'normal',
            'timestamp': instance.recorded_at,
            'title': 'Vital Signs',
            'content_summary': summary,
            'author_name': author_name,
            'author_id': author_id,
            'is_critical': instance.is_critical,
            'status': '',
            'has_edits': False,
            'version_count': 0,
            'template_id': None,
            'template_title': '',
            'search_text': ' '.join(search_parts),
        }
    )


from django.db.models.signals import post_delete


@receiver(post_delete, sender='nursing.VitalSigns')
def delete_vitals_timeline_event(sender, instance, **kwargs):
    """Delete TimelineEvent when VitalSigns is deleted."""
    from apps.clinical_notes.models import TimelineEvent

    TimelineEvent.objects.filter(
        source_model='VitalSigns',
        source_id=instance.id
    ).delete()
