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


class IsAdminOrDoctor(permissions.BasePermission):
    """
    Custom permission to allow access to administrators and doctors.
    """
    def has_permission(self, request, view):
        return request.user.is_authenticated and (
            request.user.user_type == 'admin' or
            request.user.user_type == 'doctor'
        )


class IsDoctorOnly(permissions.BasePermission):
    """
    Custom permission to allow access only to doctors.
    Used for clinical functions like prescribing that require a licensed practitioner.
    """
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.user_type == 'doctor'


class IsAdminOrNurse(permissions.BasePermission):
    """
    Custom permission to allow access to administrators and nurses.
    """
    def has_permission(self, request, view):
        return request.user.is_authenticated and (
            request.user.user_type == 'admin' or
            request.user.user_type == 'nurse'
        )


class CanAccessPatient(permissions.BasePermission):
    """
    Permission to check if user can access patient data.
    - Admins can access all patients
    - Doctors/Nurses can access patients they're treating
    - Patients can only access their own data
    """
    def has_object_permission(self, request, view, obj):
        user = request.user

        # Admin has full access
        if user.user_type == 'admin':
            return True

        # Patient can only access their own data
        if user.user_type == 'patient':
            if hasattr(obj, 'user'):
                return obj.user == user
            return False

        # Medical staff (doctor, nurse, etc.) can access patient data
        if user.user_type in ['doctor', 'nurse', 'receptionist', 'lab_technician', 'pharmacist', 'billing']:
            return True

        return False


class CanAccessAppointment(permissions.BasePermission):
    """
    Permission to check if user can access appointment data.
    """
    def has_object_permission(self, request, view, obj):
        user = request.user

        # Admin has full access
        if user.user_type == 'admin':
            return True

        # Patient can access their own appointments
        if user.user_type == 'patient':
            # Check if patient owns the appointment
            if hasattr(obj, 'patient') and hasattr(obj.patient, 'user'):
                return obj.patient.user == user
            return False

        # Staff can access appointments
        if user.user_type in ['doctor', 'nurse', 'receptionist']:
            return True

        return False


class CanAccessEncounter(permissions.BasePermission):
    """
    Permission to check if user can access encounter data.
    """
    def has_object_permission(self, request, view, obj):
        user = request.user

        # Admin has full access
        if user.user_type == 'admin':
            return True

        # Patient can access their own encounters
        if user.user_type == 'patient':
            if hasattr(obj, 'patient') and hasattr(obj.patient, 'user'):
                return obj.patient.user == user
            return False

        # Medical staff can access encounters
        if user.user_type in ['doctor', 'nurse']:
            return True

        return False


class IsBillingStaff(permissions.BasePermission):
    """
    Permission to restrict billing endpoints to billing staff and admins.

    This enforces data-type access control: clinical staff (doctors/nurses)
    should NOT have access to billing data.
    """
    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        return request.user.user_type in ['admin', 'billing']

    def has_object_permission(self, request, view, obj):
        if not request.user.is_authenticated:
            return False

        user = request.user

        # Admin and billing staff have full access
        if user.user_type in ['admin', 'billing']:
            return True

        # Patients can access their own billing data
        if user.user_type == 'patient':
            if hasattr(obj, 'patient') and hasattr(obj.patient, 'user'):
                return obj.patient.user == user
            return False

        return False