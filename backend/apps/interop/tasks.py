import hashlib
import json

from celery import shared_task
from django.utils import timezone

from hms_backend.tenancy import facility_task
from .crypto import encrypt_payload
from .exporters import build_patient_record_bundle
from .models import RecordExportJob, RecordExportStatus


@shared_task
@facility_task
def build_record_export(job_id, facility_code=None):
    job = RecordExportJob.objects.select_related('patient', 'patient__user').get(id=job_id)
    job.status = RecordExportStatus.RUNNING
    job.save(update_fields=['status', 'updated_at'])

    try:
        bundle = build_patient_record_bundle(job.patient)
        serialized = json.dumps(bundle, separators=(',', ':'), ensure_ascii=True)
        checksum = hashlib.sha256(serialized.encode('utf-8')).hexdigest()
        encrypted = encrypt_payload(serialized.encode('utf-8'))

        job.payload_encrypted = encrypted
        job.payload_checksum = checksum
        job.status = RecordExportStatus.READY
        job.updated_at = timezone.now()
        job.save(update_fields=['payload_encrypted', 'payload_checksum', 'status', 'updated_at'])
    except Exception as exc:
        job.status = RecordExportStatus.FAILED
        job.error_message = str(exc)
        job.updated_at = timezone.now()
        job.save(update_fields=['status', 'error_message', 'updated_at'])
        raise
