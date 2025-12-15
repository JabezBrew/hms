import logging
from celery import shared_task
from django.contrib.auth import get_user_model
from .models import AuditLog

User = get_user_model()
logger = logging.getLogger(__name__)


@shared_task
def log_audit_async(
    user_id,
    action,
    category,
    resource_type,
    resource_id,
    description,
    ip_address=None,
    user_agent=None,
    user_email=None,
    user_type=None,
    resource_name=None,
    changes=None,
):
    """
    Asynchronous task to create an audit log entry.

    Args:
        user_id: UUID of the user who performed the action
        action: The action type (from AuditAction)
        category: The category (from AuditCategory)
        resource_type: Type of resource affected (e.g., 'User', 'Ward')
        resource_id: ID of the affected resource
        description: Human-readable description
        ip_address: Client IP address
        user_agent: Client user agent string
        user_email: Email of the user (denormalized for when user is deleted)
        user_type: Type of user (admin, doctor, nurse, etc.)
        resource_name: Display name of the resource
        changes: JSON dict of field changes for updates
    """
    try:
        user = None
        if user_id:
            try:
                user = User.objects.get(id=user_id)
                # Use user data if not explicitly provided
                if not user_email:
                    user_email = user.email
                if not user_type:
                    user_type = getattr(user, 'user_type', 'unknown')
            except User.DoesNotExist:
                pass

        # Ensure required fields have values
        if not user_email:
            user_email = 'system' if not user_id else 'unknown'
        if not user_type:
            user_type = 'system' if not user_id else 'unknown'

        AuditLog.objects.create(
            user=user,
            user_email=user_email,
            user_type=user_type,
            action=action,
            category=category,
            resource_type=resource_type,
            resource_id=resource_id,
            resource_name=resource_name,
            description=description,
            changes=changes,
            ip_address=ip_address,
            user_agent=user_agent,
        )
    except Exception as e:
        # Log error but don't retry - audit logs are fire-and-forget
        logger.error(f"Failed to create audit log: {str(e)}", exc_info=True)
