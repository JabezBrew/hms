from celery import shared_task
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string
from django.conf import settings
from django.utils import timezone
from django.db import models
import logging

from apps.core.retry import EMAIL_CONFIG

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=EMAIL_CONFIG.max_retries)
def send_password_reset_email(self, user_id, token, user_email, user_name):
    """
    Send password reset email with secure link.
    Uses exponential backoff for retries.
    """
    try:
        reset_url = f"{settings.FRONTEND_URL}/reset-password/confirm?token={token}"

        context = {
            'user_name': user_name,
            'reset_url': reset_url,
            'expiry_minutes': settings.PASSWORD_RESET_TOKEN_EXPIRY_MINUTES,
            'hospital_name': 'HMS Hospital',
        }

        html_content = render_to_string('emails/password_reset.html', context)
        text_content = render_to_string('emails/password_reset.txt', context)

        email = EmailMultiAlternatives(
            subject='Password Reset Request - HMS',
            body=text_content,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[user_email],
        )
        email.attach_alternative(html_content, 'text/html')
        email.send(fail_silently=False)

        logger.info(f"Password reset email sent successfully")
        return {"status": "success"}

    except Exception as e:
        logger.error(f"Failed to send password reset email: {str(e)}")
        raise self.retry(exc=e, countdown=EMAIL_CONFIG.get_countdown(self.request.retries))


@shared_task(bind=True, max_retries=EMAIL_CONFIG.max_retries)
def send_account_setup_email(self, user_id, token, user_email, user_name):
    """
    Send initial account setup email with a secure set-password link.
    Uses exponential backoff for retries.
    """
    try:
        setup_url = f"{settings.FRONTEND_URL}/reset-password/confirm?token={token}"

        context = {
            'user_name': user_name,
            'setup_url': setup_url,
            'expiry_minutes': settings.PASSWORD_RESET_TOKEN_EXPIRY_MINUTES,
            'hospital_name': 'HMS Hospital',
        }

        html_content = render_to_string('emails/account_setup.html', context)
        text_content = render_to_string('emails/account_setup.txt', context)

        email = EmailMultiAlternatives(
            subject='Welcome to HMS - Set Up Your Password',
            body=text_content,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[user_email],
        )
        email.attach_alternative(html_content, 'text/html')
        email.send(fail_silently=False)

        logger.info("Account setup email sent successfully")
        return {"status": "success"}

    except Exception as e:
        logger.error(f"Failed to send account setup email: {str(e)}")
        raise self.retry(exc=e, countdown=EMAIL_CONFIG.get_countdown(self.request.retries))


@shared_task(bind=True, max_retries=EMAIL_CONFIG.max_retries)
def send_admin_force_reset_email(self, user_id, temp_password, user_email, user_name, admin_name):
    """
    Send email with temporary password after admin force reset.
    Uses exponential backoff for retries.
    """
    try:
        login_url = f"{settings.FRONTEND_URL}/login"

        context = {
            'user_name': user_name,
            'temp_password': temp_password,
            'login_url': login_url,
            'admin_name': admin_name,
            'hospital_name': 'HMS Hospital',
        }

        html_content = render_to_string('emails/admin_force_reset.html', context)
        text_content = render_to_string('emails/admin_force_reset.txt', context)

        email = EmailMultiAlternatives(
            subject='Your Password Has Been Reset - HMS',
            body=text_content,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[user_email],
        )
        email.attach_alternative(html_content, 'text/html')
        email.send(fail_silently=False)

        logger.info(f"Admin force reset email sent for user {user_id}")
        return {"status": "success"}

    except Exception as e:
        logger.error(f"Failed to send admin force reset email for user {user_id}: {str(e)}")
        raise self.retry(exc=e, countdown=EMAIL_CONFIG.get_countdown(self.request.retries))


@shared_task(bind=True, max_retries=EMAIL_CONFIG.max_retries)
def send_welcome_credentials_email(self, user_email, user_name, password, employee_id, department, position):
    """
    Send welcome email with login credentials to newly created staff.
    Uses exponential backoff for retries.
    """
    try:
        login_url = f"{settings.FRONTEND_URL}/login"

        context = {
            'user_name': user_name,
            'email': user_email,
            'password': password,
            'employee_id': employee_id,
            'department': department,
            'position': position,
            'login_url': login_url,
            'hospital_name': 'HMS Hospital',
        }

        html_content = render_to_string('emails/welcome_credentials.html', context)
        text_content = render_to_string('emails/welcome_credentials.txt', context)

        email = EmailMultiAlternatives(
            subject='Welcome to HMS - Your Login Credentials',
            body=text_content,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[user_email],
        )
        email.attach_alternative(html_content, 'text/html')
        email.send(fail_silently=False)

        logger.info(f"Welcome credentials email sent successfully")
        return {"status": "success"}

    except Exception as e:
        logger.error(f"Failed to send welcome credentials email: {str(e)}")
        raise self.retry(exc=e, countdown=EMAIL_CONFIG.get_countdown(self.request.retries))


@shared_task
def cleanup_expired_tokens():
    """
    Periodic task to clean up expired and used tokens.
    Run daily via Celery Beat.
    """
    from .models import PasswordResetToken

    cutoff = timezone.now() - timezone.timedelta(hours=24)

    deleted_count, _ = PasswordResetToken.objects.filter(
        models.Q(expires_at__lt=timezone.now()) |
        models.Q(is_used=True, used_at__lt=cutoff)
    ).delete()

    logger.info(f"Cleaned up {deleted_count} expired password reset tokens")
    return {"deleted": deleted_count}
