import logging
import time
import json
from uuid import UUID
from django.utils.deprecation import MiddlewareMixin
from django.http import JsonResponse
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.response import Response
from rest_framework import status as http_status

logger = logging.getLogger('django.request')


def get_client_ip(request):
    """
    Get the client's real IP address from the request.
    Handles X-Forwarded-For header for reverse proxy setups.
    """
    x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
    if x_forwarded_for:
        # X-Forwarded-For can contain multiple IPs; the first is the client's
        ip = x_forwarded_for.split(',')[0].strip()
    else:
        ip = request.META.get('REMOTE_ADDR')
    return ip


def _scrub_path(path):
    if not path:
        return path
    parts = []
    for segment in path.split('/'):
        if not segment:
            parts.append(segment)
            continue
        try:
            UUID(segment)
            parts.append('<id>')
            continue
        except (ValueError, AttributeError, TypeError):
            pass
        if segment.isdigit() and len(segment) >= 4:
            parts.append('<id>')
            continue
        parts.append(segment)
    return '/'.join(parts)


class FacilityContextMiddleware(MiddlewareMixin):
    """
    Resolve facility context early so access control and cache scoping are consistent.

    Facility code resolution order:
    1) X-Facility-Code header
    2) JWT claim (facility_code)
    3) Default facility code (single-site deployments)
    """

    def process_request(self, request):
        from django.conf import settings
        from apps.core.security import get_user_facility_codes, normalize_facility_code
        from apps.core.models import Facility
        from hms_backend.tenancy import (
            clear_current_facility_code,
            get_current_facility_code,
            set_current_facility_code,
        )

        # Clear any stale facility context from previous requests
        clear_current_facility_code()

        request.facility = None
        request.facility_code = None

        header_name = getattr(settings, 'FACILITY_HEADER_NAME', 'X-Facility-Code')
        header_key = f'HTTP_{header_name.upper().replace("-", "_")}'
        facility_code = normalize_facility_code(request.META.get(header_key))
        facility_code_source = 'header' if facility_code else None

        user = None
        jwt_auth = JWTAuthentication()
        validated_token = None
        try:
            header = jwt_auth.get_header(request)
            if header is not None:
                raw_token = jwt_auth.get_raw_token(header)
                if raw_token is not None:
                    validated_token = jwt_auth.get_validated_token(raw_token)
                    user = jwt_auth.get_user(validated_token)
        except (InvalidToken, AuthenticationFailed, AttributeError, KeyError, TypeError):
            validated_token = None
            user = None

        if not facility_code and validated_token:
            facility_code = normalize_facility_code(validated_token.get('facility_code'))
            facility_code_source = 'token' if facility_code else None

        allowed_codes = set()
        if user:
            primary_facility = getattr(user, 'primary_facility', None)
            primary_code = normalize_facility_code(getattr(primary_facility, 'code', None))
            if facility_code and primary_code and facility_code == primary_code:
                allowed_codes = {primary_code}
            else:
                allowed_codes = get_user_facility_codes(user)
        allow_cross_facility = getattr(settings, 'ALLOW_CROSS_FACILITY_ACCESS', False)

        if not facility_code and allowed_codes:
            if len(allowed_codes) == 1:
                facility_code = next(iter(allowed_codes))
                facility_code_source = 'user'
            elif getattr(settings, 'MULTI_FACILITY_MODE', False):
                if getattr(settings, 'FACILITY_CONTEXT_REQUIRED', True):
                    return JsonResponse(
                        {'detail': 'Facility context is required.', 'code': 'facility_required'},
                        status=403
                    )

        if not facility_code and not allowed_codes:
            default_code = normalize_facility_code(getattr(settings, 'DEFAULT_FACILITY_CODE', None))
            if default_code:
                facility_code = default_code
                facility_code_source = 'default'

        if facility_code and allowed_codes:
            is_admin = bool(user and user.user_type == 'admin')
            if facility_code not in allowed_codes and not (allow_cross_facility and is_admin):
                return JsonResponse(
                    {'detail': 'Facility access denied.', 'code': 'facility_forbidden'},
                    status=403
                )

        if facility_code:
            set_current_facility_code(facility_code)

        request.facility_code = get_current_facility_code()
        if request.facility_code:
            request.facility = Facility.get_by_code(request.facility_code)
            if request.facility is None and facility_code_source in {'header', 'token', 'user'}:
                return JsonResponse(
                    {'detail': 'Facility not found.', 'code': 'facility_invalid'},
                    status=404
                )

        if getattr(settings, 'FACILITY_CONTEXT_REQUIRED', True):
            skip_paths = ['/api/auth/', '/api/facilities/', '/admin/', '/static/', '/media/']
            if not any(request.path.startswith(path) for path in skip_paths):
                if not request.facility_code:
                    return JsonResponse(
                        {'detail': 'Facility context is required.', 'code': 'facility_required'},
                        status=403
                    )

        return None


class OffSiteDetectionMiddleware(MiddlewareMixin):
    """
    Middleware to detect off-site access and enforce read-only mode.

    Adds the following attributes to the request:
    - request.is_offsite: Boolean indicating if user is accessing from off-site
    - request.offsite_mode: The configured mode ('readonly', 'deny', 'allow')
    - request.client_ip: The client's IP address
    """

    def process_request(self, request):
        """Check if request is from off-site and handle accordingly."""
        from apps.core.models import SiteNetwork, OffSiteAccessSettings

        # Get client IP
        client_ip = get_client_ip(request)
        request.client_ip = client_ip

        try:
            # Check if IP is on-site
            is_on_site = SiteNetwork.is_ip_on_site(client_ip)
            request.is_offsite = not is_on_site

            # Get settings
            settings = OffSiteAccessSettings.get_settings()
            request.offsite_mode = settings.offsite_mode
            readonly_message = settings.readonly_message
            deny_message = settings.deny_message
            allow_admin_override = settings.allow_admin_override
        except Exception:
            # Never hard-fail requests when off-site settings lookups fail.
            logger.exception("Off-site access lookup failed; defaulting to restricted readonly mode.")
            is_on_site = False
            request.is_offsite = True
            request.offsite_mode = 'readonly'
            readonly_message = "System is in restricted mode. Write operations are temporarily disabled."
            deny_message = "Access is temporarily unavailable."
            allow_admin_override = False

        # If on-site or mode is 'allow', proceed normally
        if is_on_site or request.offsite_mode == 'allow':
            return None

        # Skip checks for certain endpoints
        skip_paths = ['/api/auth/', '/admin/', '/static/', '/media/', '/api/users/me/']
        if any(request.path.startswith(path) for path in skip_paths):
            return None

        # Check if admin override is allowed
        if allow_admin_override:
            # Need to check if user is admin - but user might not be authenticated yet
            # This will be handled in the permission class instead
            pass

        # If mode is 'deny', block all off-site access
        if request.offsite_mode == 'deny':
            return JsonResponse(
                {
                    'detail': deny_message,
                    'code': 'offsite_access_denied'
                },
                status=403
            )

        # For 'readonly' mode, block write operations
        if request.offsite_mode == 'readonly' and request.method not in ('GET', 'HEAD', 'OPTIONS'):
            return JsonResponse(
                {
                    'detail': readonly_message,
                    'code': 'offsite_readonly',
                    'is_offsite': True
                },
                status=403
            )

        return None

class RequestLoggingMiddleware(MiddlewareMixin):
    """
    Middleware to log all requests and responses.
    """
    def process_request(self, request):
        """
        Process the request and log it.
        """
        request.start_time = time.time()
        
        # Don't log media or static file requests
        if request.path.startswith('/media/') or request.path.startswith('/static/'):
            return None
            
        # Log the request
        user_id = getattr(request.user, 'id', None) if request.user.is_authenticated else None
        if user_id is not None:
            user_id = str(user_id)

        log_data = {
            'remote_address': request.META.get('REMOTE_ADDR'),
            'server_hostname': request.META.get('SERVER_NAME'),
            'request_method': request.method,
            'request_path': _scrub_path(request.path),
            'user_id': user_id,
        }
        
        logger.info(f"Request: {json.dumps(log_data)}")
        return None

    def process_response(self, request, response):
        """
        Process the response and log it.
        """
        # Don't log media or static file responses
        if request.path.startswith('/media/') or request.path.startswith('/static/'):
            return response
            
        # Calculate request processing time
        if hasattr(request, 'start_time'):
            processing_time = time.time() - request.start_time
        else:
            processing_time = 0
            
        # Log the response
        user_id = getattr(request.user, 'id', None) if request.user.is_authenticated else None
        if user_id is not None:
            user_id = str(user_id)

        log_data = {
            'remote_address': request.META.get('REMOTE_ADDR'),
            'request_method': request.method,
            'request_path': _scrub_path(request.path),
            'response_status': response.status_code,
            'processing_time': processing_time,
            'user_id': user_id,
        }
        
        logger.info(f"Response: {json.dumps(log_data)}")
        return response
        
    def _get_request_body(self, request):
        return ''


class JWTUserTypeValidationMiddleware(MiddlewareMixin):
    """
    Middleware to validate that the user_type in JWT token matches the database user_type.
    This prevents authorization bypass from client-side role manipulation.
    """

    def process_request(self, request):
        # Skip validation for certain endpoints
        skip_paths = ['/api/auth/', '/admin/', '/static/', '/media/']
        if any(request.path.startswith(path) for path in skip_paths):
            return None

        # Try to authenticate with JWT
        jwt_auth = JWTAuthentication()

        try:
            # Get authorization header
            header = jwt_auth.get_header(request)
            if header is None:
                return None

            # Extract and validate token
            raw_token = jwt_auth.get_raw_token(header)
            if raw_token is None:
                return None

            validated_token = jwt_auth.get_validated_token(raw_token)

            # Get user from token
            user = jwt_auth.get_user(validated_token)

            if user and user.is_authenticated:
                # Validate that token's user_type matches database user_type
                token_user_type = validated_token.get('user_type')

                if token_user_type and token_user_type != user.user_type:
                    # Token user_type doesn't match database - possible tampering
                    logger.warning(
                        f"JWT user_type mismatch for user {user.email}: "
                        f"token={token_user_type}, db={user.user_type}"
                    )

                    return Response(
                        {"detail": "Invalid token claims. Please login again."},
                        status=http_status.HTTP_401_UNAUTHORIZED
                    )

        except (InvalidToken, AttributeError, TypeError, KeyError):
            # No token or invalid token - let the view handle authentication
            pass

        return None
