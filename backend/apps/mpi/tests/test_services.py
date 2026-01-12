import pytest
from datetime import date

from apps.mpi.services import resolve_patient_identity, link_patient_to_facility


@pytest.mark.django_db
def test_resolve_patient_identity_by_nhis():
    identity1, created1 = resolve_patient_identity(
        first_name='Ada',
        last_name='Lovelace',
        date_of_birth=date(1815, 12, 10),
        nhis_id='NHIS-001'
    )
    identity2, created2 = resolve_patient_identity(
        first_name='Ada',
        last_name='Lovelace',
        date_of_birth=date(1815, 12, 10),
        nhis_id='nhis-001'
    )

    assert created1 is True
    assert created2 is False
    assert identity1.id == identity2.id


@pytest.mark.django_db
def test_link_patient_to_facility_creates_link():
    identity, _ = resolve_patient_identity(
        first_name='Alan',
        last_name='Turing',
        date_of_birth=date(1912, 6, 23),
        nhis_id='NHIS-002'
    )
    link = link_patient_to_facility(
        patient_identity=identity,
        facility_code='MAIN',
        facility_patient_id=identity.id,
    )

    assert link is not None
    assert link.facility_code == 'MAIN'
