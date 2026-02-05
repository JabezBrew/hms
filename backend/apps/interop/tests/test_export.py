import json
import uuid

import pytest

from apps.interop.crypto import decrypt_payload
from apps.interop.models import RecordExportJob, RecordExportStatus
from apps.interop.tasks import build_record_export
from apps.users.tests.factories import PatientProfileFactory


@pytest.mark.django_db
def test_build_record_export_creates_payload():
    patient = PatientProfileFactory()
    patient.patient_identity_id = uuid.uuid4()
    patient.save(update_fields=['patient_identity_id'])

    job = RecordExportJob.objects.create(
        patient=patient,
        patient_identity_id=patient.patient_identity_id,
        target_facility_code='TARGET',
    )

    build_record_export(str(job.id), facility_code='TEST')

    job.refresh_from_db()
    assert job.status == RecordExportStatus.READY
    assert job.payload_encrypted
    assert job.payload_checksum

    payload = json.loads(decrypt_payload(job.payload_encrypted).decode('utf-8'))
    assert payload['patient_identity_id'] == str(patient.patient_identity_id)
