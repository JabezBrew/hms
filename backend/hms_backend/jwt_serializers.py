from django.conf import settings
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.tokens import RefreshToken
from apps.users.admin_access import is_platform_admin
from hms_backend.deployment import feature_enabled


def _normalize_facility_code(code):
    if not code:
        return ''
    return str(code).strip().upper()


def _get_user_facility_codes(user):
    if not user:
        return set()

    codes = set()
    primary_facility = getattr(user, 'primary_facility', None)
    if primary_facility:
        codes.add(_normalize_facility_code(primary_facility.code))

    try:
        staff = getattr(user, 'staff_profile', None)
    except Exception:
        staff = None
    if staff and getattr(staff, 'primary_facility', None):
        codes.add(_normalize_facility_code(staff.primary_facility.code))

    try:
        facility_codes = user.facilities.values_list('code', flat=True)
    except Exception:
        facility_codes = []
    for code in facility_codes:
        normalized = _normalize_facility_code(code)
        if normalized:
            codes.add(normalized)

    codes.discard('')
    return codes


def resolve_user_facility_code(user, requested_code=None):
    requested = _normalize_facility_code(requested_code)
    allowed_codes = _get_user_facility_codes(user)
    allow_cross_facility = feature_enabled('cross_facility_access')
    can_cross_facility = bool(allow_cross_facility and is_platform_admin(user))
    default_facility_code = _normalize_facility_code(getattr(settings, 'DEFAULT_FACILITY_CODE', ''))

    if requested:
        if requested in allowed_codes:
            return requested
        if can_cross_facility:
            return requested
        if not allowed_codes and default_facility_code and requested == default_facility_code:
            return requested
        return ''

    if allowed_codes:
        if len(allowed_codes) == 1:
            return next(iter(allowed_codes))
        primary_facility = getattr(user, 'primary_facility', None)
        if primary_facility:
            return _normalize_facility_code(primary_facility.code)
        try:
            staff = getattr(user, 'staff_profile', None)
        except Exception:
            staff = None
        if staff and getattr(staff, 'primary_facility', None):
            return _normalize_facility_code(staff.primary_facility.code)
        return ''

    return default_facility_code


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    """
    Custom JWT serializer that includes user type in token claims
    """
    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)

        # Add custom claims
        token['user_type'] = user.user_type
        token['email'] = user.email
        facility_code = resolve_user_facility_code(user)
        if facility_code:
            token['facility_code'] = facility_code

        return token


def get_tokens_for_user(user, facility_code=None):
    """
    Generate JWT tokens with custom claims for a user
    """
    resolved_facility = resolve_user_facility_code(user, requested_code=facility_code)
    refresh = RefreshToken.for_user(user)

    # Add custom claims
    refresh['user_type'] = user.user_type
    refresh['email'] = user.email
    if resolved_facility:
        refresh['facility_code'] = resolved_facility

    # Access token inherits claims from refresh token
    access = refresh.access_token
    access['user_type'] = user.user_type
    access['email'] = user.email
    if resolved_facility:
        access['facility_code'] = resolved_facility

    return {
        'refresh': str(refresh),
        'access': str(access),
    }
