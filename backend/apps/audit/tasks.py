from celery import shared_task
from django.contrib.auth import get_user_model
from .models import AuditLog

User = get_user_model()

@shared_task
def log_audit_async(user_id, action, category, resource_type, resource_id, description, ip_address=None, user_agent=None):
    """
    Asynchronous task to create an audit log entry.
    """
    try:
        user = User.objects.get(id=user_id) if user_id else None
        
        AuditLog.objects.create(
            user=user,
            action=action,
            category=category,
            resource_type=resource_type,
            resource_id=resource_id,
            description=description,
            ip_address=ip_address,
            user_agent=user_agent
        )
    except Exception as e:
        # Just log error, don't retry as audit logs are fire-and-forget
        print(f"Failed to create audit log: {str(e)}")
