import pytest
from datetime import timedelta, date

from django.utils import timezone

from apps.consent.models import ConsentGrant, ConsentStatus, ConsentScope
from apps.consent.services import issue_access_token, validate_access_token
from apps.mpi.services import resolve_patient_identity


@pytest.mark.django_db
def test_issue_and_validate_access_token():
    identity, _ = resolve_patient_identity(
        first_name='Grace',
        last_name='Hopper',
        date_of_birth=date(1906, 12, 9),
        nhis_id='NHIS-999'
    )
    grant = ConsentGrant.objects.create(
        patient_identity=identity,
        source_facility_code='SRC',
        target_facility_code='TGT',
        scope=ConsentScope.FULL_RECORD,
        status=ConsentStatus.ACTIVE,
        granted_at=timezone.now(),
        expires_at=timezone.now() + timedelta(hours=1),
    )
    token = issue_access_token(grant, target_facility_code='TGT', ttl_seconds=3600)

    validated = validate_access_token(
        token,
        patient_identity_id=identity.id,
        source_facility_code='SRC',
        target_facility_code='TGT'
    )

    assert validated is not None
    assert validated.id == grant.id
