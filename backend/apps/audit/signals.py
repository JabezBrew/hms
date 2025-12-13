"""
Signal handlers for automatic audit logging.
Connects to post_save and post_delete signals for critical models.
"""
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
from django.contrib.auth import get_user_model
from threading import local

from .models import AuditAction, AuditCategory
from .services import AuditService

User = get_user_model()

# Thread-local storage for the current request
_thread_locals = local()


def set_current_request(request):
    """Set the current request in thread-local storage."""
    _thread_locals.request = request


def get_current_request():
    """Get the current request from thread-local storage."""
    return getattr(_thread_locals, 'request', None)


def clear_current_request():
    """Clear the current request from thread-local storage."""
    if hasattr(_thread_locals, 'request'):
        del _thread_locals.request


# Models to track with signals
# Note: We use lazy imports to avoid circular imports

def _get_tracked_models():
    """Get models that should be tracked for audit logging."""
    try:
        from apps.users.models import PatientProfile
        from apps.clinical_notes.models import NoteEntry, NoteTemplate
        from apps.wards.models import WardAdmission
        from apps.appointments.models import Appointment

        return {
            'PatientProfile': (PatientProfile, AuditCategory.PATIENT),
            'NoteEntry': (NoteEntry, AuditCategory.CLINICAL),
            'NoteTemplate': (NoteTemplate, AuditCategory.CLINICAL),
            'WardAdmission': (WardAdmission, AuditCategory.WARD),
            'Appointment': (Appointment, AuditCategory.APPOINTMENT),
        }
    except ImportError:
        # Return empty dict during migrations
        return {}


@receiver(post_save)
def audit_model_save(sender, instance, created, **kwargs):
    """Log model create/update operations."""
    # Skip audit log itself to prevent recursion
    from .models import AuditLog
    if sender == AuditLog:
        return

    # Check if this model should be tracked
    model_name = sender.__name__
    tracked_models = _get_tracked_models()

    if model_name not in tracked_models:
        return

    _, category = tracked_models[model_name]

    # Get the current request
    request = get_current_request()

    # Determine action
    action = AuditAction.CREATE if created else AuditAction.UPDATE

    # Get changes for updates (if model has _original_values attribute)
    changes = None
    if not created and hasattr(instance, '_audit_changes'):
        changes = instance._audit_changes

    try:
        AuditService.log_model_change(
            request=request,
            instance=instance,
            action=action,
            changes=changes,
            category=category,
        )
    except Exception:
        # Don't let audit logging failures break the application
        pass


@receiver(post_delete)
def audit_model_delete(sender, instance, **kwargs):
    """Log model delete operations."""
    # Skip audit log itself
    from .models import AuditLog
    if sender == AuditLog:
        return

    # Check if this model should be tracked
    model_name = sender.__name__
    tracked_models = _get_tracked_models()

    if model_name not in tracked_models:
        return

    _, category = tracked_models[model_name]

    # Get the current request
    request = get_current_request()

    try:
        AuditService.log_model_change(
            request=request,
            instance=instance,
            action=AuditAction.DELETE,
            category=category,
        )
    except Exception:
        # Don't let audit logging failures break the application
        pass


# User-specific signals
@receiver(post_save, sender=User)
def audit_user_save(sender, instance, created, **kwargs):
    """Log user create/update operations."""
    # Skip updates that are just last_login changes (handled by login audit)
    update_fields = kwargs.get('update_fields')
    if update_fields and set(update_fields) <= {'last_login'}:
        return

    # Only log user creation from this signal
    # Updates are typically handled elsewhere or are trivial (like last_login)
    if not created:
        return

    request = get_current_request()

    try:
        AuditService.log(
            request=request,
            action=AuditAction.USER_CREATE,
            category=AuditCategory.ADMIN,
            resource_type='User',
            resource_id=str(instance.pk),
            resource_name=instance.email,
            description=f"Created user: {instance.email}",
        )
    except Exception:
        pass
