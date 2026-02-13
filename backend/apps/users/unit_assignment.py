"""
Staff-to-unit assignment helpers for user onboarding flows.

This module keeps registration/invite serializers focused on user creation while
centralizing robust department-unit assignment rules.
"""
from __future__ import annotations

import logging
from uuid import UUID

from django.db.models import Q

from apps.organization.models import (
    ClinicalUnit,
    StaffAssignmentTypeConfig,
    StaffUnitAssignment,
    UnitMemberAssignment,
)

logger = logging.getLogger(__name__)

CLINICAL_USER_TYPES = {'doctor', 'nurse'}
CLINICAL_STAFFING_MODES = {'clinical_only', 'mixed'}
OPS_STAFFING_MODES = {'ops_only', 'mixed'}


def _normalize_text(value):
    if not isinstance(value, str):
        return ''
    return ' '.join(value.split()).strip().lower()


def _parse_uuid(value):
    if not value:
        return None
    if isinstance(value, UUID):
        return value
    try:
        return UUID(str(value))
    except (TypeError, ValueError, AttributeError):
        return None


def _get_default_assignment_type():
    assignment_type = StaffAssignmentTypeConfig.objects.filter(
        code='single',
        is_active=True
    ).first()
    if assignment_type:
        return assignment_type
    return StaffAssignmentTypeConfig.objects.filter(
        is_active=True
    ).order_by('name').first()


def _resolve_department_unit(*, facility, department_name=None, department_unit_id=None):
    if not facility:
        return None

    base_qs = ClinicalUnit.objects.filter(
        unit_type__code='department',
        root_unit__code=facility.code,
        is_active=True,
    ).select_related('unit_type', 'core_department', 'root_unit')

    explicit_unit_id = _parse_uuid(department_unit_id)
    if explicit_unit_id:
        return base_qs.filter(id=explicit_unit_id).first()

    department_uuid = _parse_uuid(department_name)
    if department_uuid:
        return base_qs.filter(id=department_uuid).first()

    normalized_name = _normalize_text(department_name)
    if not normalized_name:
        return None

    lookup_value = str(department_name).strip()
    candidates = list(base_qs.filter(
        Q(name__iexact=lookup_value) |
        Q(short_name__iexact=lookup_value) |
        Q(code__iexact=lookup_value) |
        Q(core_department__name__iexact=lookup_value) |
        Q(core_department__code__iexact=lookup_value)
    ).order_by('name', 'id'))

    if not candidates:
        return None
    if len(candidates) == 1:
        return candidates[0]

    exact_core_name_matches = [
        unit for unit in candidates
        if unit.core_department and _normalize_text(unit.core_department.name) == normalized_name
    ]
    if len(exact_core_name_matches) == 1:
        return exact_core_name_matches[0]

    exact_unit_name_matches = [
        unit for unit in candidates
        if _normalize_text(unit.name) == normalized_name
    ]
    if len(exact_unit_name_matches) == 1:
        return exact_unit_name_matches[0]

    logger.warning(
        "Ambiguous department unit for facility=%s department=%r candidate_count=%s",
        facility.code,
        department_name,
        len(candidates),
    )
    return None


def auto_assign_staff_to_department_unit(
    staff,
    *,
    facility,
    department_name=None,
    department_unit_id=None,
    assigned_by=None,
):
    """
    Auto-assign staff to their selected department unit.

    Returns:
        The created/reused assignment instance, or None when assignment is skipped.
    """
    if not staff or not facility:
        return None

    unit = _resolve_department_unit(
        facility=facility,
        department_name=department_name,
        department_unit_id=department_unit_id,
    )
    if not unit:
        logger.warning(
            "Skipping auto assignment: department unit not found for staff_id=%s department=%r facility=%s",
            getattr(staff, 'id', None),
            department_name,
            facility.code,
        )
        return None

    assignment_type = _get_default_assignment_type()
    if not assignment_type:
        logger.warning(
            "Skipping auto assignment: no active StaffAssignmentTypeConfig for staff_id=%s",
            getattr(staff, 'id', None),
        )
        return None

    user_type = getattr(getattr(staff, 'user', None), 'user_type', None)
    is_clinical = user_type in CLINICAL_USER_TYPES

    if is_clinical:
        if unit.staffing_mode not in CLINICAL_STAFFING_MODES:
            logger.warning(
                "Skipping clinical auto assignment: unit %s has staffing_mode=%s",
                unit.id,
                unit.staffing_mode,
            )
            return None
        practitioner = getattr(staff, 'practitioner_profile', None)
        if not practitioner:
            logger.warning(
                "Skipping clinical auto assignment: no practitioner profile for staff_id=%s",
                getattr(staff, 'id', None),
            )
            return None
        assignment, _ = StaffUnitAssignment.objects.get_or_create(
            unit=unit,
            practitioner=practitioner,
            is_active=True,
            defaults={
                'assignment_type': assignment_type,
                'is_primary': True,
                'is_secondary': False,
                'assigned_by': assigned_by,
            }
        )
        return assignment

    if unit.staffing_mode not in OPS_STAFFING_MODES:
        logger.warning(
            "Skipping ops auto assignment: unit %s has staffing_mode=%s",
            unit.id,
            unit.staffing_mode,
        )
        return None

    assignment, _ = UnitMemberAssignment.objects.get_or_create(
        unit=unit,
        staff=staff,
        is_active=True,
        defaults={
            'assignment_type': assignment_type,
            'is_primary': True,
            'is_secondary': False,
            'assigned_by': assigned_by,
        }
    )
    return assignment
