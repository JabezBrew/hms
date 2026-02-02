from celery import shared_task
from django.core.cache import cache
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string
from django.conf import settings
from django.utils import timezone
from django.db import models
import hashlib
import logging

from apps.core.retry import EMAIL_CONFIG
from apps.core.cache_utils import facility_cache_key
from apps.fhir_client.client import fhir_client
from apps.fhir_client.utils import (
    project_fhir_practitioner,
    create_human_name,
    create_identifier,
    create_contact_point,
    create_address,
    generate_fhir_id,
)
from .models import PractitionerFHIRMapping, PractitionerProfile, User

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
def update_session_geolocation(session_id, ip_address):
    """
    Populate session location fields from GeoIP without blocking auth requests.
    """
    if not session_id or not ip_address:
        return {"status": "skipped"}

    from .models import UserSession
    from .geolocation import get_location_from_ip

    session = UserSession.objects.filter(id=session_id, ip_address=ip_address).first()
    if not session:
        return {"status": "missing"}
    if session.location_city or session.location_country:
        return {"status": "already_set"}

    location = get_location_from_ip(ip_address)
    if not location:
        return {"status": "no_location"}

    session.location_city = location.city or ''
    session.location_country = location.country or ''
    session.save(update_fields=['location_city', 'location_country', 'updated_at'])
    return {"status": "updated"}


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


@shared_task
def cleanup_user_sessions():
    """
    Periodic task to clean up expired and revoked user sessions.
    Run daily via Celery Beat.
    """
    from django.conf import settings
    from .models import UserSession

    retention_days = getattr(settings, 'USER_SESSION_RETENTION_DAYS', 90)
    cutoff = timezone.now() - timezone.timedelta(days=retention_days)

    deleted_count, _ = UserSession.objects.filter(
        models.Q(expires_at__lt=cutoff) |
        models.Q(revoked_at__isnull=False, revoked_at__lt=cutoff)
    ).delete()

    logger.info(f"Cleaned up {deleted_count} expired/revoked user sessions")
    return {"deleted": deleted_count}


@shared_task(bind=True, max_retries=3)
def fetch_practitioner_fhir_snapshot(self, practitioner_id, fhir_practitioner_id, facility_code=None):
    """
    Fetch and cache a minimal Practitioner FHIR snapshot.
    """
    try:
        if not fhir_practitioner_id:
            return {"status": "skipped"}
        fhir_resource = fhir_client.get_resource("Practitioner", fhir_practitioner_id)
        snapshot_key = facility_cache_key(f'fhir_practitioner_snapshot_{practitioner_id}')
        cache.set(snapshot_key, project_fhir_practitioner(fhir_resource), timeout=300)
        mapping = PractitionerFHIRMapping.objects.filter(fhir_practitioner_id=fhir_practitioner_id).first()
        if mapping:
            mapping.fhir_resource_version = fhir_resource.get("meta", {}).get("versionId")
            mapping.is_synced = True
            mapping.save(update_fields=['fhir_resource_version', 'is_synced', 'updated_at'])
        return {"status": "success"}
    except Exception as e:
        logger.error("Error fetching practitioner FHIR snapshot")
        raise self.retry(exc=e, countdown=60)


@shared_task(bind=True, max_retries=3)
def search_practitioners_in_fhir(self, query, user_id, facility_code=None):
    """
    Search practitioners in FHIR and cache minimal results for the user.
    """
    try:
        search_params = {"name": query, "_sort": "family", "_count": 10}
        fhir_results = fhir_client.search_resources("Practitioner", search_params)
        if "entry" not in fhir_results or len(fhir_results.get("entry", [])) == 0:
            identifier_search_params = {"identifier": query, "_sort": "family", "_count": 10}
            fhir_results = fhir_client.search_resources("Practitioner", identifier_search_params)

        practitioners = []
        for entry in fhir_results.get("entry", []) or []:
            resource = entry.get("resource", {})
            fhir_id = resource.get("id")
            local_id = None
            if fhir_id:
                mapping = PractitionerFHIRMapping.objects.filter(fhir_practitioner_id=fhir_id).first()
                if mapping:
                    local_id = str(mapping.practitioner_profile_id)
            practitioners.append({
                "fhir_resource": project_fhir_practitioner(resource),
                "local_id": local_id
            })

        query_hash = hashlib.md5(query.encode()).hexdigest()
        cache_key = facility_cache_key(f'fhir_practitioner_search_{user_id}_{query_hash}')
        cache.set(cache_key, practitioners, timeout=60)
        return {"status": "success", "count": len(practitioners)}
    except Exception as e:
        logger.error("Error searching practitioners in FHIR")
        raise self.retry(exc=e, countdown=60)


@shared_task(bind=True, max_retries=3)
def create_practitioner_in_fhir(self, practitioner_profile_id, address_fields=None, requested_by_user_id=None, facility_code=None):
    """
    Background task to create a practitioner in FHIR and establish mapping.
    """
    try:
        practitioner_profile = PractitionerProfile.objects.select_related('staff__user').get(id=practitioner_profile_id)
        staff = practitioner_profile.staff
        user = staff.user if staff else None
        if not user:
            raise ValueError("Practitioner user missing")

        address_fields = address_fields or {}

        fhir_practitioner_data = {
            "resourceType": "Practitioner",
            "id": generate_fhir_id(),
            "active": True,
            "name": [
                create_human_name(
                    family=user.last_name,
                    given=[user.first_name]
                )
            ],
            "identifier": [
                create_identifier(
                    system="http://hospital.example.org/fhir/identifier/employee",
                    value=staff.employee_id
                ),
                create_identifier(
                    system="http://hospital.example.org/fhir/identifier/license",
                    value=practitioner_profile.license_number
                )
            ]
        }

        if user.phone_number:
            fhir_practitioner_data["telecom"] = [
                create_contact_point(
                    system="phone",
                    value=user.phone_number,
                    use="work"
                )
            ]

        if any(address_fields.values()):
            lines = [address_fields.get('address_line1')] if address_fields.get('address_line1') else []
            if address_fields.get('address_line2'):
                lines.append(address_fields.get('address_line2'))

            fhir_practitioner_data["address"] = [
                create_address(
                    line=lines,
                    city=address_fields.get('city', ''),
                    state=address_fields.get('state', ''),
                    postalCode=address_fields.get('postal_code', ''),
                    country=address_fields.get('country', '')
                )
            ]

        if practitioner_profile.qualification:
            fhir_practitioner_data["qualification"] = [
                {"code": {"text": practitioner_profile.qualification}}
            ]

        fhir_practitioner = fhir_client.create_resource("Practitioner", fhir_practitioner_data)

        created_by = None
        if requested_by_user_id:
            created_by = User.objects.filter(id=requested_by_user_id).first()

        mapping, _ = PractitionerFHIRMapping.objects.get_or_create(
            practitioner_profile=practitioner_profile,
            defaults={
                'fhir_practitioner_id': fhir_practitioner["id"],
                'fhir_resource_version': fhir_practitioner.get("meta", {}).get("versionId"),
                'created_by': created_by,
                'updated_by': created_by,
            }
        )
        if mapping.fhir_practitioner_id != fhir_practitioner["id"]:
            mapping.fhir_practitioner_id = fhir_practitioner["id"]
            mapping.fhir_resource_version = fhir_practitioner.get("meta", {}).get("versionId")
            mapping.is_synced = True
            mapping.updated_by = created_by
            mapping.save(update_fields=['fhir_practitioner_id', 'fhir_resource_version', 'is_synced', 'updated_by', 'updated_at'])

        practitioner_profile.fhir_practitioner_id = fhir_practitioner["id"]
        practitioner_profile.save(update_fields=['fhir_practitioner_id'])

        snapshot_key = facility_cache_key(f'fhir_practitioner_snapshot_{practitioner_profile.id}')
        cache.set(snapshot_key, project_fhir_practitioner(fhir_practitioner), timeout=300)
        return {"status": "success"}
    except Exception as e:
        logger.error("Error creating practitioner in FHIR")
        raise self.retry(exc=e, countdown=60)
