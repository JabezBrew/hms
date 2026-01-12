"""
Authentication response helpers.
"""
from django.conf import settings
from rest_framework.response import Response

from .jwt_serializers import get_tokens_for_user, resolve_user_facility_code


def get_access_context(request):
    from apps.core.models import SiteNetwork, OffSiteAccessSettings

    client_ip = request.META.get('HTTP_X_FORWARDED_FOR')
    if client_ip:
        client_ip = client_ip.split(',')[0].strip()
    else:
        client_ip = request.META.get('REMOTE_ADDR')

    is_offsite = not SiteNetwork.is_ip_on_site(client_ip)
    settings_obj = OffSiteAccessSettings.get_settings()

    return {
        'is_offsite': is_offsite,
        'offsite_mode': settings_obj.offsite_mode,
        'readonly_message': (
            settings_obj.readonly_message
            if is_offsite and settings_obj.offsite_mode == 'readonly'
            else None
        ),
    }


def build_auth_response(request, user, facility_code=None):
    resolved_facility = resolve_user_facility_code(user, facility_code)
    tokens = get_tokens_for_user(user, facility_code=resolved_facility)

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
        'user': {
            'email': user.email,
            'id': user.id,
            'user_type': user.user_type,
            'first_name': user.first_name,
            'last_name': user.last_name,
            'staff_id': staff_id,
            'practitioner_id': practitioner_id,
            'facility_code': resolved_facility or None,
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

    return response
