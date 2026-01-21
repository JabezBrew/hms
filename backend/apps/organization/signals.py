"""
Signals for the organization app.

Handles:
- Denormalized field updates for ClinicalUnit (path_cache, root_unit)
- Cache invalidation for UnitAccessService
"""
from django.core.cache import cache
from django.db import transaction
from django.db.models.signals import post_save, post_delete, pre_save
from django.dispatch import receiver

from apps.core.cache_utils import facility_cache_key

from .models import (
    UnitTypeConfig,
    ClinicalUnit,
    StaffAssignmentTypeConfig,
    UnitLeadership,
    StaffUnitAssignment,
    UnitMemberAssignment,
    CrossCoverageSchedule,
)


# =============================================================================
# ClinicalUnit Denormalization
# =============================================================================


@receiver(pre_save, sender=ClinicalUnit)
def set_root_unit_on_save(sender, instance, **kwargs):
    """Set root_unit before save for new root nodes."""
    if instance.pk:
        instance._previous_parent_id = (
            ClinicalUnit.objects.filter(pk=instance.pk)
            .values_list('parent_id', flat=True)
            .first()
        )
    if not instance.parent_id:
        # Will be set to self after save (need pk first)
        instance._is_new_root = True


@receiver(post_save, sender=ClinicalUnit)
def update_unit_denormalized_fields(sender, instance, created, **kwargs):
    """Update path_cache and root_unit after save."""
    needs_update = False
    updates = {}

    # Handle new root node
    if getattr(instance, '_is_new_root', False) and not instance.root_unit_id:
        updates['root_unit'] = instance
        needs_update = True
        delattr(instance, '_is_new_root')
    elif instance.parent_id:
        # For non-root nodes, compute root from tree
        root = instance.get_root()
        if instance.root_unit_id != root.id:
            updates['root_unit'] = root
            needs_update = True

    # Compute and cache path
    new_path = ' > '.join([a.name for a in instance.get_ancestors(include_self=True)])
    if instance.path_cache != new_path:
        updates['path_cache'] = new_path
        needs_update = True

    if needs_update:
        # Use update() to avoid triggering signals again
        ClinicalUnit.objects.filter(pk=instance.pk).update(**updates)
        # Update instance in memory
        for key, value in updates.items():
            setattr(instance, key, value if key != 'root_unit' else value)

    previous_parent_id = getattr(instance, '_previous_parent_id', None)
    parent_changed = previous_parent_id != instance.parent_id
    if hasattr(instance, '_previous_parent_id'):
        delattr(instance, '_previous_parent_id')

    # Update descendants if this unit's name changed or it was moved
    if not created:
        if parent_changed:
            ClinicalUnit.objects.rebuild()
        _update_descendant_caches(instance)


def _update_descendant_caches(unit):
    """Update path_cache and root_unit for all descendants."""
    # Refresh from DB to get updated MPTT fields after move operations
    unit.refresh_from_db()

    descendants = unit.get_descendants()
    if not descendants.exists():
        return

    root = unit.root_unit or unit.get_root()

    # Bulk update in batches to avoid memory issues
    for descendant in descendants.iterator():
        new_path = ' > '.join([a.name for a in descendant.get_ancestors(include_self=True)])
        ClinicalUnit.objects.filter(pk=descendant.pk).update(
            path_cache=new_path,
            root_unit=root
        )


# =============================================================================
# Cache Invalidation for UnitAccessService
# =============================================================================


def invalidate_user_unit_cache(user_id):
    """Invalidate the unit access cache for a user."""
    cache.delete(facility_cache_key(f'user_unit_access:{user_id}'))


def _bump_unit_list_cache_version(unit_id, kind):
    cache_key = facility_cache_key(f'org_unit_{kind}_version:{unit_id}')
    try:
        cache.incr(cache_key)
    except ValueError:
        cache.set(cache_key, 2, timeout=None)


def invalidate_unit_list_cache(unit, kind):
    if not unit:
        return
    unit_ids = unit.get_ancestors(include_self=True).values_list('id', flat=True)
    for unit_id in unit_ids:
        _bump_unit_list_cache_version(unit_id, kind)


def invalidate_org_tree_cache():
    from .tree_cache import bump_org_tree_cache_version, schedule_org_tree_cache_rebuild
    version = bump_org_tree_cache_version()
    transaction.on_commit(
        lambda: schedule_org_tree_cache_rebuild(version=version)
    )


@receiver(post_save, sender=ClinicalUnit)
@receiver(post_delete, sender=ClinicalUnit)
def invalidate_org_tree_cache_on_unit_change(sender, instance, **kwargs):
    invalidate_org_tree_cache()


@receiver(post_save, sender=UnitTypeConfig)
@receiver(post_delete, sender=UnitTypeConfig)
def invalidate_org_tree_cache_on_unit_type_change(sender, instance, **kwargs):
    invalidate_org_tree_cache()


@receiver(post_save, sender=StaffUnitAssignment)
@receiver(post_delete, sender=StaffUnitAssignment)
def invalidate_staff_cache(sender, instance, **kwargs):
    """Invalidate cache when staff assignments change."""
    invalidate_unit_list_cache(instance.unit, 'staff')
    if instance.practitioner_id:
        try:
            user_id = instance.practitioner.staff.user_id
            invalidate_user_unit_cache(user_id)
        except Exception:
            pass  # Practitioner may not have staff/user relationship


@receiver(post_save, sender=UnitMemberAssignment)
@receiver(post_delete, sender=UnitMemberAssignment)
def invalidate_member_cache(sender, instance, **kwargs):
    """Invalidate cache when ops member assignments change."""
    invalidate_unit_list_cache(instance.unit, 'members')
    if instance.staff_id:
        try:
            invalidate_user_unit_cache(instance.staff.user_id)
        except Exception:
            pass


@receiver(post_save, sender=UnitLeadership)
@receiver(post_delete, sender=UnitLeadership)
def invalidate_leadership_cache(sender, instance, **kwargs):
    """Invalidate cache when leadership assignments change."""
    if instance.user_id:
        invalidate_user_unit_cache(instance.user_id)


@receiver(post_save, sender=UnitLeadership)
def ensure_leader_staff_assignment(sender, instance, created, **kwargs):
    """
    Automatically add leaders to unit staff assignments when possible.
    This keeps leadership and staff lists in sync for UX.
    """
    if not created:
        return

    staff = getattr(instance.user, 'staff_profile', None)
    if not staff:
        return

    practitioner = getattr(staff, 'practitioner_profile', None)
    staffing_mode = instance.unit.staffing_mode
    if staffing_mode == 'ops_only':
        if practitioner:
            return
        if UnitMemberAssignment.objects.filter(
            unit=instance.unit,
            staff=staff,
            is_active=True
        ).exists():
            return
    elif staffing_mode == 'clinical_only':
        if not practitioner:
            return
        if StaffUnitAssignment.objects.filter(
            unit=instance.unit,
            practitioner=practitioner,
            is_active=True
        ).exists():
            return
    else:
        if practitioner:
            if StaffUnitAssignment.objects.filter(
                unit=instance.unit,
                practitioner=practitioner,
                is_active=True
            ).exists():
                return
        else:
            if UnitMemberAssignment.objects.filter(
                unit=instance.unit,
                staff=staff,
                is_active=True
            ).exists():
                return

    assignment_type = StaffAssignmentTypeConfig.objects.filter(
        code='single',
        is_active=True
    ).first()
    if not assignment_type:
        assignment_type = StaffAssignmentTypeConfig.objects.filter(
            is_active=True
        ).order_by('name').first()
    if not assignment_type:
        return

    if staffing_mode == 'ops_only':
        UnitMemberAssignment.objects.create(
            unit=instance.unit,
            staff=staff,
            assignment_type=assignment_type,
            effective_from=instance.effective_from,
            effective_until=instance.effective_until,
            role_description=instance.role.name,
            is_active=instance.is_active,
            assigned_by=instance.created_by
        )
    elif staffing_mode == 'clinical_only' or practitioner:
        StaffUnitAssignment.objects.create(
            unit=instance.unit,
            practitioner=practitioner,
            assignment_type=assignment_type,
            effective_from=instance.effective_from,
            effective_until=instance.effective_until,
            role_description=instance.role.name,
            is_active=instance.is_active,
            assigned_by=instance.created_by
        )
    else:
        UnitMemberAssignment.objects.create(
            unit=instance.unit,
            staff=staff,
            assignment_type=assignment_type,
            effective_from=instance.effective_from,
            effective_until=instance.effective_until,
            role_description=instance.role.name,
            is_active=instance.is_active,
            assigned_by=instance.created_by
        )


@receiver(post_save, sender=CrossCoverageSchedule)
@receiver(post_delete, sender=CrossCoverageSchedule)
def invalidate_coverage_cache(sender, instance, **kwargs):
    """Invalidate cache when coverage schedules change."""
    if instance.covering_practitioner_id:
        try:
            user_id = instance.covering_practitioner.staff.user_id
            invalidate_user_unit_cache(user_id)
        except Exception:
            pass  # Practitioner may not have staff/user relationship

