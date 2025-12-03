from django.utils import timezone
from .models import AuditLog, AuditCategory, AuditAction


class AuditService:
    """
    Centralized service for creating audit log entries.
    Provides consistent logging across the application.
    """

    @classmethod
    def log(cls, request, action, category, resource_type=None, resource_id=None,
            resource_name=None, description=None, changes=None, user=None):
        """
        Create an audit log entry.

        Args:
            request: Django request object (can be None for system actions)
            action: Action type from AuditAction
            category: Category from AuditCategory
            resource_type: Type of resource affected (e.g., 'Patient', 'Encounter')
            resource_id: ID of the affected resource
            resource_name: Human-readable name of the resource
            description: Human-readable description of the action
            changes: Dict of field changes for UPDATE actions
            user: User who performed the action (defaults to request.user)

        Returns:
            AuditLog instance
        """
        # Get user from request or parameter
        if user is None and request and hasattr(request, 'user') and request.user.is_authenticated:
            user = request.user

        # Extract user info
        user_email = user.email if user else 'system'
        user_type = user.user_type if user else 'system'

        # Get IP address
        ip_address = cls.get_client_ip(request) if request else None

        # Get user agent
        user_agent = None
        if request:
            user_agent = request.META.get('HTTP_USER_AGENT', '')[:500]

        # Build description if not provided
        if not description:
            description = cls._build_description(action, resource_type, resource_name, user_email)

        # Create audit log
        audit_log = AuditLog.objects.create(
            user=user,
            user_email=user_email,
            user_type=user_type,
            action=action,
            category=category,
            resource_type=resource_type or '',
            resource_id=str(resource_id) if resource_id else None,
            resource_name=resource_name,
            description=description,
            changes=changes,
            ip_address=ip_address,
            user_agent=user_agent,
        )

        return audit_log

    @classmethod
    def log_authentication(cls, request, action, success=True, user=None, email=None):
        """
        Log authentication events (login, logout, failed attempts).

        Args:
            request: Django request object
            action: LOGIN, LOGOUT, or LOGIN_FAILED
            success: Whether the action succeeded
            user: User object (if available)
            email: Email attempted (for failed logins)
        """
        description = ''
        if action == AuditAction.LOGIN:
            description = f"User {user.email if user else email} logged in successfully"
        elif action == AuditAction.LOGOUT:
            description = f"User {user.email if user else 'unknown'} logged out"
        elif action == AuditAction.LOGIN_FAILED:
            description = f"Failed login attempt for {email or 'unknown email'}"
        elif action == AuditAction.PASSWORD_CHANGE:
            description = f"User {user.email if user else email} changed their password"
        elif action == AuditAction.OFFSITE_ACCESS:
            ip = cls.get_client_ip(request) if request else 'unknown'
            description = f"Off-site access by {user.email if user else 'unknown'} from IP {ip}"

        return cls.log(
            request=request,
            action=action,
            category=AuditCategory.AUTHENTICATION,
            resource_type='User',
            resource_id=str(user.id) if user else None,
            resource_name=user.email if user else email,
            description=description,
            user=user,
        )

    @classmethod
    def log_model_change(cls, request, instance, action, changes=None, category=None):
        """
        Log model create/update/delete operations.

        Args:
            request: Django request object
            instance: Model instance that was changed
            action: CREATE, UPDATE, or DELETE
            changes: Dict of field changes for UPDATE
            category: Override category (defaults based on model type)
        """
        model_name = instance.__class__.__name__

        # Determine category based on model
        if category is None:
            category = cls._get_category_for_model(model_name)

        # Get resource name
        resource_name = str(instance)[:255]

        # Build description
        description = cls._build_description(action, model_name, resource_name)

        return cls.log(
            request=request,
            action=action,
            category=category,
            resource_type=model_name,
            resource_id=str(instance.pk),
            resource_name=resource_name,
            description=description,
            changes=changes,
        )

    @classmethod
    def get_client_ip(cls, request):
        """
        Extract the real client IP address from the request.
        Handles X-Forwarded-For header for proxied requests.
        """
        if not request:
            return None

        x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
        if x_forwarded_for:
            ip = x_forwarded_for.split(',')[0].strip()
        else:
            ip = request.META.get('REMOTE_ADDR')
        return ip

    @classmethod
    def _build_description(cls, action, resource_type, resource_name, user_email=None):
        """Build a human-readable description."""
        action_verbs = {
            AuditAction.CREATE: 'created',
            AuditAction.UPDATE: 'updated',
            AuditAction.DELETE: 'deleted',
            AuditAction.READ: 'viewed',
            AuditAction.NOTE_CREATE: 'created note for',
            AuditAction.NOTE_UPDATE: 'updated note for',
            AuditAction.NOTE_DELETE: 'deleted note for',
            AuditAction.ORDER_CREATE: 'created order for',
            AuditAction.ADMISSION: 'admitted',
            AuditAction.DISCHARGE: 'discharged',
            AuditAction.TRANSFER: 'transferred',
            AuditAction.CANCEL: 'cancelled',
            AuditAction.CHECK_IN: 'checked in',
            AuditAction.USER_CREATE: 'created user',
            AuditAction.USER_UPDATE: 'updated user',
            AuditAction.ROLE_CHANGE: 'changed role for',
        }

        verb = action_verbs.get(action, action.lower())

        if resource_name:
            return f"{verb.capitalize()} {resource_type}: {resource_name}"
        else:
            return f"{verb.capitalize()} {resource_type}"

    @classmethod
    def _get_category_for_model(cls, model_name):
        """Determine audit category based on model name."""
        model_categories = {
            'Patient': AuditCategory.PATIENT,
            'PatientProfile': AuditCategory.PATIENT,
            'Encounter': AuditCategory.ENCOUNTER,
            'NoteEntry': AuditCategory.CLINICAL,
            'NoteTemplate': AuditCategory.CLINICAL,
            'Prescription': AuditCategory.CLINICAL,
            'LabOrder': AuditCategory.CLINICAL,
            'User': AuditCategory.ADMIN,
            'Staff': AuditCategory.ADMIN,
            'PractitionerProfile': AuditCategory.ADMIN,
            'WardAdmission': AuditCategory.WARD,
            'Bed': AuditCategory.WARD,
            'Ward': AuditCategory.WARD,
            'Appointment': AuditCategory.APPOINTMENT,
        }

        return model_categories.get(model_name, AuditCategory.ADMIN)
