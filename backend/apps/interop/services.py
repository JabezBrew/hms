from datetime import timedelta

from django.utils import timezone
from django.conf import settings

from .models import RecordExportJob, RecordExportStatus
from .tasks import build_record_export


def create_export_job(
    patient,
    target_facility_code: str,
    consent_grant_id=None,
    requested_by_user_id=None,
    requested_by_facility_code: str = '',
    ttl_hours: int = None,
):
    if ttl_hours is None:
        ttl_hours = getattr(settings, 'RECORD_EXPORT_TTL_HOURS', 24)
    expires_at = timezone.now() + timedelta(hours=ttl_hours)
    job = RecordExportJob.objects.create(
        patient=patient,
        patient_identity_id=patient.patient_identity_id,
        target_facility_code=target_facility_code,
        consent_grant_id=consent_grant_id,
        status=RecordExportStatus.PENDING,
        expires_at=expires_at,
        requested_by_user_id=requested_by_user_id,
        requested_by_facility_code=requested_by_facility_code or '',
    )
    build_record_export.delay(str(job.id), facility_code=requested_by_facility_code)
    return job
