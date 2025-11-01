from rest_framework import permissions


class IsNurseOrAdmin(permissions.BasePermission):
    """
    Permission class that allows nurses and admins only.
    """
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False

        # Superusers have full access
        if request.user.is_superuser or request.user.is_staff:
            return True

        # Check if user has nurse role
        if hasattr(request.user, 'staff_profile'):
            staff = request.user.staff_profile
            return staff.role in ['nurse', 'head_nurse', 'nurse_practitioner']

        if hasattr(request.user, 'practitioner_profile'):
            practitioner = request.user.practitioner_profile
            return practitioner.role in ['nurse', 'head_nurse', 'nurse_practitioner']

        return False


class IsNurseOrDoctor(permissions.BasePermission):
    """
    Permission class that allows nurses, doctors, and admins.
    """
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False

        # Superusers have full access
        if request.user.is_superuser or request.user.is_staff:
            return True

        # Check if user has clinical role
        if hasattr(request.user, 'staff_profile'):
            staff = request.user.staff_profile
            return staff.role in ['doctor', 'nurse', 'head_nurse', 'nurse_practitioner']

        if hasattr(request.user, 'practitioner_profile'):
            practitioner = request.user.practitioner_profile
            return practitioner.role in ['doctor', 'nurse', 'head_nurse', 'nurse_practitioner']

        return False
