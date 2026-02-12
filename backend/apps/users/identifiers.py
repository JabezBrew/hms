"""
Facility-scoped identifier generation utilities.

Generates deterministic, lock-safe IDs backed by a per-facility yearly sequence.
"""

from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.core.models import Facility

from .models import IdentifierSequence

SEQUENCE_WIDTH = 7
MAX_SEQUENCE_VALUE = (10 ** SEQUENCE_WIDTH) - 1
MAX_ALLOCATION_ATTEMPTS = 5


def _resolve_facility_code(facility: Facility) -> str:
    code = (getattr(facility, 'code', '') or '').strip().upper()
    if not code:
        raise ValueError("Facility code is required for identifier generation.")
    return code


def _resolve_sequence_year(facility: Facility) -> int:
    now = timezone.now()
    tz_name = (getattr(facility, 'timezone', '') or '').strip()
    if tz_name:
        try:
            now = now.astimezone(ZoneInfo(tz_name))
        except (ZoneInfoNotFoundError, ValueError):
            pass
    return now.year


def _reserve_next_sequence(facility: Facility, identifier_type: str, year: int) -> int:
    for _ in range(MAX_ALLOCATION_ATTEMPTS):
        with transaction.atomic():
            sequence = (
                IdentifierSequence.objects
                .select_for_update()
                .filter(
                    facility_id=facility.id,
                    identifier_type=identifier_type,
                    year=year,
                )
                .first()
            )

            if sequence is None:
                try:
                    IdentifierSequence.objects.create(
                        facility=facility,
                        identifier_type=identifier_type,
                        year=year,
                        next_number=2,
                    )
                    return 1
                except IntegrityError:
                    continue

            current_number = sequence.next_number
            if current_number > MAX_SEQUENCE_VALUE:
                raise ValueError(
                    f"Identifier capacity reached for facility={facility.id}, "
                    f"type={identifier_type}, year={year}."
                )

            sequence.next_number = current_number + 1
            sequence.save(update_fields=['next_number', 'updated_at'])
            return current_number

    raise RuntimeError("Unable to allocate identifier sequence due to high contention.")


def _generate_identifier(facility: Facility, prefix: str, identifier_type: str) -> str:
    if facility is None:
        raise ValueError("Facility is required for identifier generation.")

    facility_code = _resolve_facility_code(facility)
    year = _resolve_sequence_year(facility)
    sequence_number = _reserve_next_sequence(
        facility=facility,
        identifier_type=identifier_type,
        year=year,
    )
    return f"{prefix}-{facility_code}-{year}-{sequence_number:0{SEQUENCE_WIDTH}d}"


def generate_unique_mrn(facility: Facility) -> str:
    """Generate a facility-coded MRN."""
    return _generate_identifier(
        facility=facility,
        prefix='MRN',
        identifier_type=IdentifierSequence.TYPE_MRN,
    )


def generate_unique_employee_id(facility: Facility) -> str:
    """Generate a facility-coded employee ID."""
    return _generate_identifier(
        facility=facility,
        prefix='EMP',
        identifier_type=IdentifierSequence.TYPE_EMPLOYEE,
    )

