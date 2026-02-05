import uuid

from django.db import models


class RecordExportStatus(models.TextChoices):
    PENDING = 'pending', 'Pending'
    RUNNING = 'running', 'Running'
    READY = 'ready', 'Ready'
    FAILED = 'failed', 'Failed'
    DELIVERED = 'delivered', 'Delivered'


class RecordExportJob(models.Model):
    """
    Facility-scoped export job for full patient record bundles.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    patient = models.ForeignKey(
        'users.PatientProfile',
        on_delete=models.CASCADE,
        related_name='record_exports'
    )
    patient_identity_id = models.UUIDField(null=True, blank=True, db_index=True)
    target_facility_code = models.CharField(max_length=20)
    consent_grant_id = models.UUIDField(null=True, blank=True)
    status = models.CharField(
        max_length=20,
        choices=RecordExportStatus.choices,
        default=RecordExportStatus.PENDING
    )
    payload_encrypted = models.TextField(blank=True)
    payload_checksum = models.CharField(max_length=64, blank=True)
    error_message = models.TextField(blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)

    requested_by_user_id = models.UUIDField(null=True, blank=True)
    requested_by_facility_code = models.CharField(max_length=20, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=['patient', 'status']),
            models.Index(fields=['target_facility_code', 'status']),
            models.Index(fields=['expires_at']),
        ]
        ordering = ['-created_at']
        verbose_name = 'Record Export Job'
        verbose_name_plural = 'Record Export Jobs'

    def __str__(self):
        return f"{self.patient_id}:{self.target_facility_code}:{self.status}"
