from rest_framework import permissions


class IsAdminOrSelf(permissions.BasePermission):
    """
    Custom permission to only allow users to edit their own profile.
    Administrators can edit any profile.
    """
    
    def has_object_permission(self, request, view, obj):
        # Read permissions are allowed to any authenticated user
        if request.method in permissions.SAFE_METHODS:
            return True
        
        # Write permissions are only allowed to the user themselves or admin
        return obj == request.user or request.user.is_staff


class IsAdminOrOwner(permissions.BasePermission):
    """
    Custom permission to only allow owners of an object to edit it.
    Administrators can edit any object.
    """
    
    def has_object_permission(self, request, view, obj):
        # Read permissions are allowed to any authenticated user
        if request.method in permissions.SAFE_METHODS:
            return True
        
        # Write permissions are only allowed to the owner or admin
        if hasattr(obj, 'user'):
            return obj.user == request.user or request.user.is_staff
        elif hasattr(obj, 'staff'):
            return obj.staff.user == request.user or request.user.is_staff
        
        # If we can't determine ownership, restrict to admin only
        return request.user.is_staff