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

        # Check if user has nurse role via user_type
        user_type = getattr(request.user, 'user_type', None)
        if user_type in ['nurse', 'admin']:
            return True

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

        # Check if user has clinical role via user_type
        user_type = getattr(request.user, 'user_type', None)
        if user_type in ['doctor', 'nurse', 'admin']:
            return True

        return False
