"""
Patient search projection helpers.
"""
from __future__ import annotations

from django.db.models import Q, Subquery
from django.utils import timezone

from apps.core.bulk_utils import queryset_in_batches
from apps.users.models import PatientProfile

from .models import PatientSearchIndex


def normalize_search_query(value) -> str:
    return " ".join(str(value or "").split()).strip().lower()


def build_search_document(patient_profile: PatientProfile) -> str:
    user = getattr(patient_profile, 'user', None)
    fields = [
        getattr(user, 'first_name', '') or '',
        getattr(user, 'last_name', '') or '',
        getattr(patient_profile, 'medical_record_number', '') or '',
        getattr(patient_profile, 'nhis_id', '') or '',
    ]
    return " ".join(part.strip().lower() for part in fields if part and part.strip())


def build_index_payload(patient_profile: PatientProfile) -> dict:
    user = getattr(patient_profile, 'user', None)
    first_name = (getattr(user, 'first_name', '') or '').strip()
    last_name = (getattr(user, 'last_name', '') or '').strip()
    full_name = " ".join(part for part in [first_name, last_name] if part)
    return {
        'facility': patient_profile.facility,
        'first_name': first_name,
        'last_name': last_name,
        'full_name': full_name,
        'medical_record_number': patient_profile.medical_record_number,
        'nhis_id': patient_profile.nhis_id,
        'search_document': build_search_document(patient_profile),
        'updated_at': timezone.now(),
    }


def sync_patient_search_index(patient_profile: PatientProfile) -> PatientSearchIndex:
    payload = build_index_payload(patient_profile)
    index, _created = PatientSearchIndex.objects.update_or_create(
        patient_profile=patient_profile,
        defaults=payload,
    )
    return index


def rebuild_patient_search_index(*, facility_id=None, patient_ids=None, chunk_size: int = 500) -> int:
    queryset = PatientProfile.objects.select_related('user', 'facility')
    if facility_id:
        queryset = queryset.filter(facility_id=facility_id)
    if patient_ids:
        queryset = queryset.filter(id__in=patient_ids)

    total_indexed = 0
    for batch in queryset_in_batches(queryset, chunk_size=chunk_size):
        rows = [
            PatientSearchIndex(
                patient_profile=patient_profile,
                **build_index_payload(patient_profile),
            )
            for patient_profile in batch
        ]
        if not rows:
            continue
        PatientSearchIndex.objects.bulk_create(
            rows,
            update_conflicts=True,
            update_fields=[
                'facility',
                'first_name',
                'last_name',
                'full_name',
                'medical_record_number',
                'nhis_id',
                'search_document',
                'updated_at',
            ],
            unique_fields=['patient_profile'],
        )
        total_indexed += len(rows)
    return total_indexed


def apply_search_index_filter(queryset, *, facility, query: str):
    normalized_query = normalize_search_query(query)
    if not normalized_query:
        return queryset, None

    matching_index_rows = PatientSearchIndex.objects.filter(facility=facility)
    query_terms = normalized_query.split()
    prefix_filter = (
        Q(full_name__istartswith=normalized_query) |
        Q(medical_record_number__istartswith=normalized_query) |
        Q(nhis_id__istartswith=normalized_query)
    )
    search_filter = prefix_filter
    for term in query_terms:
        search_filter &= Q(search_document__icontains=term)

    matching_index_rows = matching_index_rows.filter(search_filter)
    return queryset.filter(id__in=Subquery(matching_index_rows.values('patient_profile_id'))), normalized_query
