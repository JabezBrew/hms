"""
Patient search projection helpers.
"""
from __future__ import annotations

import re

from django.contrib.postgres.search import TrigramWordSimilarity
from django.db.models import Case, Exists, FloatField, OuterRef, Q, Value, When
from django.utils import timezone

from apps.core.bulk_utils import queryset_in_batches
from apps.users.models import PatientProfile

from .models import PatientSearchIndex

_FUZZY_SIMILARITY_THRESHOLD = 0.25
_FUZZY_MIN_QUERY_LEN = 4
_FUZZY_CANDIDATE_CAP = 50


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


def _tokenize(query: str) -> list[str]:
    return re.sub(r'[^\w\s]', ' ', query).split()


_CLINICAL_USER_TYPES = {'doctor', 'physician', 'practitioner', 'nurse', 'head_nurse'}
_ENCOUNTER_BOOST_USER_TYPES = {'doctor', 'physician', 'practitioner'}
_NURSE_USER_TYPES = {'nurse', 'head_nurse'}


def _context_boost_expr(*, user, facility):
    """
    Returns an expression producing a float in [0.0, ~0.55] based on the user's
    relationship to the patient. Caller is expected to use this inside a Case()
    sum to combine with search_rank before ordering.

    Sources (all Exists subqueries, constant # of queries regardless of result count):
      - Clinicians: RecentPatient (+0.1), UserPatientList (+0.2),
        active encounter as practitioner (+0.3, doctor/physician only),
        active admission in assigned ward (+0.25, nurse/head_nurse only).
      - Receptionist: patient has a booked/arrived appointment today (+0.2).
      - Others: 0.0.
    """
    from apps.patients.models import RecentPatient

    user_type = getattr(user, 'user_type', None)
    zero = Value(0.0, output_field=FloatField())

    if user_type in _CLINICAL_USER_TYPES:
        from apps.users.models import UserPatientList

        recent_case = Case(
            When(
                Exists(
                    RecentPatient.objects.filter(
                        patient_profile=OuterRef('pk'),
                        user=user,
                        facility=facility,
                    )
                ),
                then=Value(0.1, output_field=FloatField()),
            ),
            default=zero,
            output_field=FloatField(),
        )
        list_case = Case(
            When(
                Exists(
                    UserPatientList.objects.filter(
                        patient=OuterRef('pk'),
                        user=user,
                    )
                ),
                then=Value(0.2, output_field=FloatField()),
            ),
            default=zero,
            output_field=FloatField(),
        )
        expr = recent_case + list_case

        if user_type in _ENCOUNTER_BOOST_USER_TYPES:
            from apps.encounters.models import Encounter
            from apps.users.models import PractitionerProfile

            practitioner = PractitionerProfile.objects.filter(staff__user=user).first()
            if practitioner is not None:
                expr = expr + Case(
                    When(
                        Exists(
                            Encounter.objects.filter(
                                patient=OuterRef('pk'),
                                practitioner=practitioner,
                                status__in=('open', 'active', 'in_progress'),
                            )
                        ),
                        then=Value(0.3, output_field=FloatField()),
                    ),
                    default=zero,
                    output_field=FloatField(),
                )

        elif user_type in _NURSE_USER_TYPES:
            from apps.wards.models import Admission

            ward_ids = []
            if (
                hasattr(user, 'staff_profile')
                and getattr(user.staff_profile, 'practitioner_profile', None) is not None
            ):
                ward_ids = list(
                    user.staff_profile.practitioner_profile.ward_assignments
                    .filter(is_active=True)
                    .values_list('ward_id', flat=True)
                )

            if ward_ids:
                expr = expr + Case(
                    When(
                        Exists(
                            Admission.objects.filter(
                                patient=OuterRef('pk'),
                                status__in=('admitted', 'active'),
                                bed__ward_id__in=ward_ids,
                            )
                        ),
                        then=Value(0.25, output_field=FloatField()),
                    ),
                    default=zero,
                    output_field=FloatField(),
                )

        return expr

    if user_type == 'receptionist':
        from apps.appointments.models import Appointment

        today_start = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)
        today_end = today_start.replace(hour=23, minute=59, second=59)
        return Case(
            When(
                Exists(
                    Appointment.objects.filter(
                        patient=OuterRef('pk'),
                        facility=facility,
                        status__in=('booked', 'arrived'),
                        start_time__gte=today_start,
                        start_time__lte=today_end,
                    )
                ),
                then=Value(0.2, output_field=FloatField()),
            ),
            default=zero,
            output_field=FloatField(),
        )

    return zero


def apply_search_index_filter(queryset, *, facility, query: str, limit: int = 8, user=None):
    """
    Returns a (queryset, normalized_query, match_reasons) triple ranked by
    (search_rank + context_boost) DESC.

    Tier 1 — exact MRN / NHIS      → rank 1.0  → 'id_exact'
    Tier 2 — MRN / NHIS prefix     → rank 0.8  → 'id_prefix'
    Tier 3 — full_name iexact      → rank 0.7  → 'name_exact'
    Tier 4 — all tokens in doc     → rank 0.5  → 'name_token'
    Tier 5 — trigram word sim      → rank 0.3  → 'name_fuzzy'

    When `user` is supplied, a context boost is added to search_rank *before*
    slicing so it actually influences ordering.

    match_reasons is a dict mapping patient_profile_id → reason string.
    """
    normalized_query = normalize_search_query(query)
    if not normalized_query:
        return queryset, None, {}

    index_qs = PatientSearchIndex.objects.filter(facility=facility)
    boost_expr = _context_boost_expr(user=user, facility=facility) if user is not None else Value(
        0.0, output_field=FloatField()
    )

    def _finalize(matched_ids, rank, reason):
        result_qs = (
            queryset.filter(id__in=matched_ids)
            .annotate(
                search_rank=Value(rank, output_field=FloatField()),
                context_boost=boost_expr,
            )
            .order_by('-search_rank', '-context_boost', 'user__last_name', 'user__first_name')
        )
        reasons = {str(pid): reason for pid in matched_ids}
        return result_qs[:limit], normalized_query, reasons

    # Tier 1: exact ID match
    exact_ids = list(
        index_qs.filter(
            Q(medical_record_number__iexact=normalized_query)
            | Q(nhis_id__iexact=normalized_query)
        ).values_list('patient_profile_id', flat=True)
    )
    if exact_ids:
        return _finalize(exact_ids, 1.0, 'id_exact')

    # Tier 2: ID prefix
    prefix_ids = list(
        index_qs.filter(
            Q(medical_record_number__istartswith=normalized_query)
            | Q(nhis_id__istartswith=normalized_query)
        ).values_list('patient_profile_id', flat=True)
    )
    if prefix_ids:
        return _finalize(prefix_ids, 0.8, 'id_prefix')

    # Tier 3: exact full name
    name_exact_ids = list(
        index_qs.filter(full_name__iexact=normalized_query)
        .values_list('patient_profile_id', flat=True)
    )
    if name_exact_ids:
        return _finalize(name_exact_ids, 0.7, 'name_exact')

    # Tier 4: all query tokens present in search_document
    tokens = _tokenize(normalized_query)
    token_ids: set = set()
    if tokens:
        token_filter = Q()
        for token in tokens:
            token_filter &= Q(search_document__icontains=token)
        token_ids = set(
            index_qs.filter(token_filter).values_list('patient_profile_id', flat=True)
        )

    # Tier 5: trigram similarity (only for queries long enough to be meaningful)
    fuzzy_ids: set = set()
    if len(normalized_query) >= _FUZZY_MIN_QUERY_LEN:
        fuzzy_ids = set(
            index_qs
            .annotate(sim=TrigramWordSimilarity(normalized_query, 'search_document'))
            .filter(sim__gte=_FUZZY_SIMILARITY_THRESHOLD)
            .order_by('-sim')
            .values_list('patient_profile_id', flat=True)[:_FUZZY_CANDIDATE_CAP]
        )

    all_ids = token_ids | fuzzy_ids
    if not all_ids:
        return queryset.none(), normalized_query, {}

    result_qs = (
        queryset.filter(id__in=all_ids)
        .annotate(
            search_rank=Case(
                When(id__in=token_ids, then=Value(0.5, output_field=FloatField())),
                default=Value(0.3, output_field=FloatField()),
                output_field=FloatField(),
            ),
            context_boost=boost_expr,
        )
        .order_by('-search_rank', '-context_boost', 'user__last_name', 'user__first_name')
    )
    reasons = {
        str(pid): ('name_token' if pid in token_ids else 'name_fuzzy')
        for pid in all_ids
    }
    return result_qs[:limit], normalized_query, reasons
