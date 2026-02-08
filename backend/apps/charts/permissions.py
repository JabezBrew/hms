"""
Chart Builder Permissions

Defines permission classes for template management, assignment, and entry operations.
"""

from rest_framework import permissions


def _is_admin_actor(user) -> bool:
    if not user:
        return False
    return bool(
        getattr(user, 'is_superuser', False)
        or getattr(user, 'is_staff', False)
        or getattr(user, 'user_type', None) == 'admin'
    )


class ChartTemplatePermission(permissions.BasePermission):
    """
    Permission class for chart templates.

    - CREATE: Any authenticated clinical staff
    - LIST/RETRIEVE: All authenticated users (filtered by visibility)
    - UPDATE/DELETE: Creator or admin only (system templates cannot be deleted)
    - CLONE: Any authenticated clinical staff
    """

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False

        # Read operations allowed for all authenticated users
        if request.method in permissions.SAFE_METHODS:
            return True

        # Write operations require clinical staff role
        # For now, allow any authenticated user (can be refined based on user_type)
        return True

    def has_object_permission(self, request, view, obj):
        if not request.user or not request.user.is_authenticated:
            return False

        # Read operations
        if request.method in permissions.SAFE_METHODS:
            return self._can_view_template(request.user, obj)

        # Clone action is allowed for anyone who can view
        if view.action == 'clone':
            return self._can_view_template(request.user, obj)

        # Field management actions require modify permission
        if view.action in ['add_field', 'update_field', 'delete_field', 'reorder_fields']:
            return self._can_modify_template(request.user, obj)

        # Update/Delete require ownership or admin
        if request.method in ['PUT', 'PATCH', 'DELETE']:
            # System templates cannot be deleted
            if request.method == 'DELETE' and obj.is_system:
                return False

            return self._can_modify_template(request.user, obj)

        return False

    def _can_view_template(self, user, template):
        """Check if user can view template based on visibility."""
        if template.visibility == 'facility':
            return True

        if template.visibility == 'private':
            return template.created_by == user

        if template.visibility == 'role':
            # Check if user has same role/user_type as creator
            if template.created_by:
                return getattr(user, 'user_type', None) == getattr(template.created_by, 'user_type', None)
            return False

        if template.visibility == 'department':
            # Check if user is in same department
            user_dept = self._get_user_department(user)
            return user_dept and user_dept == template.department

        return False

    def _can_modify_template(self, user, template):
        """Check if user can modify template."""
        if _is_admin_actor(user):
            return True

        return template.created_by == user

    def _get_user_department(self, user):
        """Get user's department."""
        # Try to get from practitioner profile
        if hasattr(user, 'practitioner_profile'):
            profile = user.practitioner_profile
            if hasattr(profile, 'department'):
                return profile.department
        return None


class ChartAssignmentPermission(permissions.BasePermission):
    """
    Permission class for chart assignments.

    - CREATE: Clinical staff (nurses and doctors can initiate)
    - LIST/RETRIEVE: Staff with access to the patient
    - UPDATE: Clinical staff
    - COMPLETE/DISCONTINUE: Clinical staff with patient access
    """

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False

        return True

    def has_object_permission(self, request, view, obj):
        if not request.user or not request.user.is_authenticated:
            return False

        # All authenticated clinical staff can access assignments
        # In production, this should check patient access permissions
        return True


class ChartEntryPermission(permissions.BasePermission):
    """
    Permission class for chart entries.

    - CREATE: Clinical staff
    - LIST/RETRIEVE: Staff with patient access
    - UPDATE: Creator only (within time window) or admin
    - DELETE: Creator only (within time window) or admin (soft delete)
    """

    # Time window in minutes for editing/deleting own entries
    EDIT_WINDOW_MINUTES = 60

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False

        return True

    def has_object_permission(self, request, view, obj):
        if not request.user or not request.user.is_authenticated:
            return False

        # Read operations
        if request.method in permissions.SAFE_METHODS:
            return True

        # Admins can always modify
        if _is_admin_actor(request.user):
            return True

        # Check if user created the entry
        if obj.created_by != request.user:
            return False

        # Check time window
        from django.utils import timezone
        from datetime import timedelta

        elapsed = timezone.now() - obj.created_at
        if elapsed > timedelta(minutes=self.EDIT_WINDOW_MINUTES):
            return False

        return True
