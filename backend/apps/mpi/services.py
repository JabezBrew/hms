"""
MPI services for resolving and linking patient identities.
"""
from typing import Optional

from django.utils import timezone

from .models import PatientIdentity, PatientFacilityLink


def _normalize_nhis_id(value: Optional[str]) -> str:
    if not value:
        return ''
    return value.strip().upper()


def resolve_patient_identity(
    first_name: str,
    last_name: str,
    date_of_birth,
    gender: str = '',
    nhis_id: str = '',
    phone: str = '',
    email: str = '',
    created_by_facility_code: str = '',
    created_by_user_id=None,
):
    """
    Resolve an MPI identity by NHIS ID when present, otherwise create a new identity.
    """
    normalized_nhis = _normalize_nhis_id(nhis_id)
    identity = None

    if normalized_nhis:
        identity = PatientIdentity.objects.filter(nhis_id=normalized_nhis).first()

    if identity:
        updated_fields = []
        if not identity.first_name and first_name:
            identity.first_name = first_name
            updated_fields.append('first_name')
        if not identity.last_name and last_name:
            identity.last_name = last_name
            updated_fields.append('last_name')
        if not identity.gender and gender:
            identity.gender = gender
            updated_fields.append('gender')
        if not identity.phone and phone:
            identity.phone = phone
            updated_fields.append('phone')
        if not identity.email and email:
            identity.email = email
            updated_fields.append('email')
        if updated_fields:
            updated_fields.append('updated_at')
            identity.save(update_fields=updated_fields)
        return identity, False

    identity = PatientIdentity.objects.create(
        first_name=first_name,
        last_name=last_name,
        date_of_birth=date_of_birth,
        gender=gender or '',
        nhis_id=normalized_nhis,
        phone=phone or '',
        email=email or '',
        created_by_facility_code=created_by_facility_code or '',
        created_by_user_id=created_by_user_id,
    )
    return identity, True


def link_patient_to_facility(
    patient_identity: PatientIdentity,
    facility_code: str,
    facility_patient_id,
    created_by_facility_code: str = '',
    created_by_user_id=None,
):
    """
    Create or refresh the MPI link between identity and facility patient record.
    """
    if not patient_identity or not facility_code or not facility_patient_id:
        return None

    link, created = PatientFacilityLink.objects.get_or_create(
        patient_identity=patient_identity,
        facility_code=facility_code,
        defaults={
            'facility_patient_id': facility_patient_id,
            'created_by_facility_code': created_by_facility_code or '',
            'created_by_user_id': created_by_user_id,
        }
    )

    if not created:
        update_fields = []
        if link.facility_patient_id != facility_patient_id:
            link.facility_patient_id = facility_patient_id
            update_fields.append('facility_patient_id')
        link.last_seen_at = timezone.now()
        update_fields.append('last_seen_at')
        if update_fields:
            link.save(update_fields=update_fields)

    return link
