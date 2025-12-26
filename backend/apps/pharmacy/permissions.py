from rest_framework import permissions


class IsPharmacistOrAdmin(permissions.BasePermission):
    """
    Permission class that allows pharmacists and admins only.
    """
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False

        # Superusers have full access
        if request.user.is_superuser or request.user.is_staff:
            return True

        # Check if user has pharmacist role via user_type
        user_type = getattr(request.user, 'user_type', None)
        if user_type in ['pharmacist', 'admin']:
            return True

        return False
