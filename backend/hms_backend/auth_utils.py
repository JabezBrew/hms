"""
Authentication response helpers.
"""
import logging

from django.conf import settings
from rest_framework.response import Response

from hms_backend.middleware import get_client_ip
from .jwt_serializers import get_tokens_for_user, resolve_user_facility_code

logger = logging.getLogger(__name__)


def get_access_context(request):
    from apps.core.models import SiteNetwork, OffSiteAccessSettings

    client_ip = get_client_ip(request)

    try:
        is_offsite = not SiteNetwork.is_ip_on_site(client_ip)
        settings_obj = OffSiteAccessSettings.get_settings()
        offsite_mode = settings_obj.offsite_mode
        readonly_message = settings_obj.readonly_message
    except Exception:
        logger.exception("Failed to resolve off-site access context during authentication response.")
        is_offsite = True
        offsite_mode = 'readonly'
        readonly_message = "System is in restricted mode. Write operations are temporarily disabled."

    return {
        'is_offsite': is_offsite,
        'offsite_mode': offsite_mode,
        'readonly_message': (
            readonly_message
            if is_offsite and offsite_mode == 'readonly'
            else None
        ),
    }


def build_auth_response(request, user, facility_code=None):
    resolved_facility = resolve_user_facility_code(user, facility_code)
    tokens = get_tokens_for_user(user, facility_code=resolved_facility)
    password_change_required = bool(getattr(user, 'must_change_password', False))

    staff_id = None
    practitioner_id = None
    if user.user_type in ['doctor', 'nurse', 'lab_technician', 'pharmacist', 'receptionist']:
        from apps.users.models import Staff, PractitionerProfile
        try:
            staff = Staff.objects.get(user=user)
            staff_id = str(staff.id)
            if user.user_type in ['doctor', 'nurse', 'lab_technician', 'pharmacist']:
                practitioner = PractitionerProfile.objects.filter(staff=staff).first()
                if practitioner:
                    practitioner_id = str(practitioner.id)
        except Staff.DoesNotExist:
            pass

    access_context = get_access_context(request)

    response = Response({
        'access': tokens['access'],
        'password_change_required': password_change_required,
        'user': {
            'email': user.email,
            'id': user.id,
            'user_type': user.user_type,
            'first_name': user.first_name,
            'last_name': user.last_name,
            'staff_id': staff_id,
            'practitioner_id': practitioner_id,
            'facility_code': resolved_facility or None,
            'must_change_password': password_change_required,
        },
        'access_context': access_context,
    })

    response.set_cookie(
        settings.JWT_AUTH_REFRESH_COOKIE,
        tokens['refresh'],
        max_age=settings.SIMPLE_JWT['REFRESH_TOKEN_LIFETIME'].total_seconds(),
        httponly=settings.JWT_AUTH_HTTPONLY,
        samesite=settings.JWT_AUTH_SAMESITE,
        secure=settings.JWT_AUTH_SECURE,
    )

    try:
        from apps.users.session_service import record_login_session
        record_login_session(request, user, tokens['refresh'], facility_code=resolved_facility)
    except Exception:
        pass

    return response
