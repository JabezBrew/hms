import logging
import time
import ipaddress
import re
import threading
from uuid import uuid4
from uuid import UUID
from django.conf import settings
from django.utils.deprecation import MiddlewareMixin
from django.http import JsonResponse
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.response import Response
from rest_framework import status as http_status
from hms_backend.deployment import api_path_enabled, feature_enabled

logger = logging.getLogger('django.request')


REQUEST_ID_HEADER = 'X-Request-ID'
REQUEST_ID_META_KEY = 'HTTP_X_REQUEST_ID'
SAFE_REQUEST_ID_RE = re.compile(r'^[A-Za-z0-9._:-]{1,64}$')
_HTTP_IN_FLIGHT_LOCK = threading.Lock()
_HTTP_IN_FLIGHT_REQUESTS = 0


FACILITY_CONTEXT_OPTIONAL_PATH_PREFIXES = (
    '/api/auth/',
    '/api/facilities/',
    '/api/settings/deployment-capabilities/',
    '/django-admin/',
    '/static/',
    '/media/',
)

FACILITY_CONTEXT_BYPASS_PATH_PREFIXES = (
    '/api/health/',
    '/api/metrics/',
)


def _facility_context_required_applies(path):
    normalized_path = str(path or '')
    return not any(
        normalized_path.startswith(prefix)
        for prefix in FACILITY_CONTEXT_OPTIONAL_PATH_PREFIXES
    )


def _feature_disabled_response(feature_key):
    from apps.core.security import feature_disabled_payload

    return JsonResponse(feature_disabled_payload(feature_key), status=404)


def _disabled_feature_response_for_request(request):
    feature_is_enabled, feature_key = api_path_enabled(request.path, request=request)
    if feature_is_enabled:
        return None
    return _feature_disabled_response(feature_key)


def _normalize_ip_address(value):
    if not value:
        return None
    try:
        return str(ipaddress.ip_address(str(value).strip()))
    except ValueError:
        return None


def _trusted_proxy_networks():
    cidrs = getattr(settings, 'TRUSTED_PROXY_CIDRS', [])
    networks = []
    for cidr in cidrs:
        try:
            networks.append(ipaddress.ip_network(str(cidr).strip(), strict=False))
        except ValueError:
            logger.warning("Ignoring invalid trusted proxy CIDR setting.")
    return networks


def _is_trusted_proxy_source(remote_addr):
    remote_ip = _normalize_ip_address(remote_addr)
    if remote_ip is None:
        return False
    ip = ipaddress.ip_address(remote_ip)
    return any(ip in network for network in _trusted_proxy_networks())


def _trusted_forwarded_client_ip(x_forwarded_for, trusted_hops):
    raw_hops = [part.strip() for part in str(x_forwarded_for or '').split(',') if part.strip()]
    if not raw_hops:
        return None

    normalized_hops = [_normalize_ip_address(hop) for hop in raw_hops]
    if any(hop is None for hop in normalized_hops):
        return None

    trusted_hops = max(1, trusted_hops)
    if len(normalized_hops) > trusted_hops:
        return normalized_hops[-(trusted_hops + 1)]
    return normalized_hops[0]


def get_client_ip(request):
    """
    Get the client's real IP address from the request.
    Handles X-Forwarded-For header for reverse proxy setups.
    """
    remote_addr = _normalize_ip_address(request.META.get('REMOTE_ADDR'))

    if getattr(settings, 'TRUST_PROXY_HEADERS', False) and _is_trusted_proxy_source(remote_addr):
        x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
        if x_forwarded_for:
            try:
                trusted_hops = int(getattr(settings, 'TRUSTED_PROXY_HOPS', 1))
            except (TypeError, ValueError):
                trusted_hops = 1
            forwarded_ip = _trusted_forwarded_client_ip(x_forwarded_for, trusted_hops)
            if forwarded_ip:
                return forwarded_ip

    return remote_addr


def _scrub_path_segment(segment):
    try:
        UUID(segment)
        return '<id>'
    except (ValueError, AttributeError, TypeError):
        pass
    if segment.isdigit():
        return '<id>'
    return segment


def _scrub_path(path):
    if not path:
        return path
    if path.startswith('/api/'):
        parts = [_scrub_path_segment(segment) for segment in path.split('/') if segment]
        if len(parts) <= 3:
            return '/' + '/'.join(parts)
        return '/' + '/'.join(parts[:3] + ['<path>'])
    parts = []
    for segment in path.split('/'):
        if not segment:
            parts.append(segment)
            continue
        parts.append(_scrub_path_segment(segment))
    return '/'.join(parts)


def _is_observability_excluded_path(path):
    normalized_path = str(path or '')
    return normalized_path.startswith((
        '/api/metrics/',
        '/api/health/',
        '/static/',
        '/media/',
    ))


def _safe_request_id(value):
    request_id = str(value or '').strip()
    if request_id and SAFE_REQUEST_ID_RE.fullmatch(request_id):
        return request_id
    return str(uuid4())


def _safe_route_label(request):
    resolver_match = getattr(request, 'resolver_match', None)
    route = getattr(resolver_match, 'route', None)
    if route:
        return '/' + str(route).strip('/')

    view_name = (
        getattr(resolver_match, 'view_name', None)
        or getattr(resolver_match, 'url_name', None)
    )
    if view_name:
        return f'view:{view_name}'

    return _scrub_path(getattr(request, 'path', '')) or '<unknown>'


def _status_class(status_code):
    try:
        code = int(status_code)
    except (TypeError, ValueError):
        return 'unknown'
    return f'{code // 100}xx'


def _response_size(response):
    if response.has_header('Content-Length'):
        try:
            return int(response['Content-Length'])
        except (TypeError, ValueError):
            return 0
    if getattr(response, 'streaming', False):
        return 0
    content = getattr(response, 'content', b'')
    return len(content or b'')


def _increment_in_flight_requests():
    global _HTTP_IN_FLIGHT_REQUESTS
    from apps.core.metrics import set_gauge

    with _HTTP_IN_FLIGHT_LOCK:
        _HTTP_IN_FLIGHT_REQUESTS += 1
        current = _HTTP_IN_FLIGHT_REQUESTS
    set_gauge(
        'hms_http_in_flight_requests',
        current,
        description='Current number of non-probe HTTP requests in flight.',
    )


def _decrement_in_flight_requests():
    global _HTTP_IN_FLIGHT_REQUESTS
    from apps.core.metrics import set_gauge

    with _HTTP_IN_FLIGHT_LOCK:
        _HTTP_IN_FLIGHT_REQUESTS = max(0, _HTTP_IN_FLIGHT_REQUESTS - 1)
        current = _HTTP_IN_FLIGHT_REQUESTS
    set_gauge(
        'hms_http_in_flight_requests',
        current,
        description='Current number of non-probe HTTP requests in flight.',
    )


def reset_http_observability_state_for_tests():
    global _HTTP_IN_FLIGHT_REQUESTS
    with _HTTP_IN_FLIGHT_LOCK:
        _HTTP_IN_FLIGHT_REQUESTS = 0


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
        from apps.core.security import (
            can_use_cross_facility_access,
            get_user_facility_codes,
            normalize_facility_code,
        )
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
        if any(request.path.startswith(prefix) for prefix in FACILITY_CONTEXT_BYPASS_PATH_PREFIXES):
            return None

        facility_context_required_applies = _facility_context_required_applies(request.path)

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
        default_facility_code = normalize_facility_code(getattr(settings, 'DEFAULT_FACILITY_CODE', None))

        if not facility_code and allowed_codes:
            if len(allowed_codes) == 1:
                facility_code = next(iter(allowed_codes))
                facility_code_source = 'user'
            elif feature_enabled('multi_facility'):
                if feature_enabled('facility_context_required') and facility_context_required_applies:
                    disabled_response = _disabled_feature_response_for_request(request)
                    if disabled_response is not None:
                        return disabled_response
                    return JsonResponse(
                        {'detail': 'Facility context is required.', 'code': 'facility_required'},
                        status=403
                    )

        if not facility_code and not allowed_codes:
            default_code = normalize_facility_code(getattr(settings, 'DEFAULT_FACILITY_CODE', None))
            if default_code:
                facility_code = default_code
                facility_code_source = 'default'

        if facility_code and user:
            can_cross_facility = can_use_cross_facility_access(user)
            request.allow_cross_facility = can_cross_facility
            if allowed_codes:
                is_facility_allowed = facility_code in allowed_codes
            else:
                # Users without explicit assignments are restricted to the deployment default facility.
                is_facility_allowed = bool(default_facility_code and facility_code == default_facility_code)

            if not is_facility_allowed and not can_cross_facility:
                return JsonResponse(
                    {'detail': 'Facility context is not available.', 'code': 'facility_unavailable'},
                    status=403
                )

        if facility_code:
            set_current_facility_code(facility_code)

        request.facility_code = get_current_facility_code()
        if request.facility_code:
            request.facility = Facility.get_by_code(request.facility_code)
            if request.facility is None and facility_code_source in {'header', 'token', 'user'}:
                return JsonResponse(
                    {'detail': 'Facility context is not available.', 'code': 'facility_unavailable'},
                    status=403
                )

        disabled_response = _disabled_feature_response_for_request(request)
        if disabled_response is not None:
            return disabled_response

        if feature_enabled('facility_context_required'):
            if facility_context_required_applies:
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
        skip_paths = ['/api/auth/', '/django-admin/', '/static/', '/media/', '/api/users/me/']
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
    Middleware for safe HTTP request correlation, metrics, and logs.
    """
    def process_request(self, request):
        """
        Attach a safe request id and start HTTP observability.
        """
        request.start_time = time.perf_counter()
        request.request_id = _safe_request_id(request.META.get(REQUEST_ID_META_KEY))
        request.http_observability_excluded = _is_observability_excluded_path(request.path)

        if request.http_observability_excluded:
            return None

        _increment_in_flight_requests()
        request.http_observability_in_flight = True
        route = _safe_route_label(request)

        log_data = {
            'event': 'http_request_started',
            'request_id': request.request_id,
            'remote_addr': request.META.get('REMOTE_ADDR'),
            'server_hostname': request.META.get('SERVER_NAME'),
            'http_method': request.method,
            'http_path': _scrub_path(request.path),
            'http_route': route,
        }

        logger.info('http_request_started', extra=log_data)
        return None

    def process_response(self, request, response):
        """
        Echo request id, emit metrics, and log safe response fields.
        """
        request_id = getattr(request, 'request_id', None)
        if request_id is None:
            request_id = _safe_request_id(request.META.get(REQUEST_ID_META_KEY))
            request.request_id = request_id
        response[REQUEST_ID_HEADER] = request_id

        if getattr(request, 'http_observability_excluded', False):
            return response

        if hasattr(request, 'start_time'):
            duration_seconds = max(0.0, time.perf_counter() - request.start_time)
        else:
            duration_seconds = 0.0

        route = _safe_route_label(request)
        status_code = str(getattr(response, 'status_code', 0))
        status_class = _status_class(status_code)
        response_size = _response_size(response)
        labels = {
            'method': request.method,
            'route': route,
            'status_code': status_code,
            'status_class': status_class,
        }

        from apps.core.metrics import inc_counter, observe_histogram

        inc_counter(
            'hms_http_requests_total',
            labels=labels,
            description='Total non-probe HTTP requests by method, safe route, and status.',
        )
        observe_histogram(
            'hms_http_request_duration_seconds',
            duration_seconds,
            labels=labels,
            description='Non-probe HTTP request duration in seconds.',
        )
        observe_histogram(
            'hms_http_response_size_bytes',
            response_size,
            labels=labels,
            description='Non-probe HTTP response size in bytes.',
            buckets=(100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000),
        )
        if getattr(request, 'http_observability_in_flight', False):
            _decrement_in_flight_requests()
            request.http_observability_in_flight = False

        log_data = {
            'event': 'http_request_finished',
            'request_id': request_id,
            'remote_addr': request.META.get('REMOTE_ADDR'),
            'http_method': request.method,
            'http_path': _scrub_path(request.path),
            'http_route': route,
            'status_code': response.status_code,
            'status_class': status_class,
            'duration_seconds': duration_seconds,
            'response_size_bytes': response_size,
        }

        logger.info('http_request_finished', extra=log_data)
        return response

    def process_exception(self, request, exception):
        if getattr(request, 'http_observability_in_flight', False):
            _decrement_in_flight_requests()
            request.http_observability_in_flight = False
        return None

    def _get_request_body(self, request):
        return ''


class JWTUserTypeValidationMiddleware(MiddlewareMixin):
    """
    Middleware to validate that the user_type in JWT token matches the database user_type.
    This prevents authorization bypass from client-side role manipulation.
    """

    def process_request(self, request):
        # Skip validation for certain endpoints
        skip_paths = ['/api/auth/', '/django-admin/', '/static/', '/media/']
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


class PasswordChangeRequiredMiddleware(MiddlewareMixin):
    """
    Restrict authenticated users with password-change requirements
    to the minimal endpoints needed to complete the change.
    """

    def process_request(self, request):
        # Always allow preflight
        if request.method == 'OPTIONS':
            return None

        skip_paths = [
            '/api/auth/',
            '/api/health/',
            '/api/health/alive/',
            '/api/health/ready/',
            '/api/health/started/',
            '/api/metrics/',
            '/api/users/users/change_password',
            '/api/users/users/me/',
            '/api/users/sessions/',
            '/django-admin/',
            '/static/',
            '/media/',
        ]
        if any(request.path.startswith(path) for path in skip_paths):
            return None

        user = getattr(request, 'user', None)
        if not user or not getattr(user, 'is_authenticated', False):
            jwt_auth = JWTAuthentication()
            try:
                header = jwt_auth.get_header(request)
                if header is not None:
                    raw_token = jwt_auth.get_raw_token(header)
                    if raw_token is not None:
                        validated_token = jwt_auth.get_validated_token(raw_token)
                        user = jwt_auth.get_user(validated_token)
            except (InvalidToken, AuthenticationFailed, AttributeError, KeyError, TypeError):
                user = None

        if not user or not getattr(user, 'is_authenticated', False):
            return None

        if not getattr(user, 'must_change_password', False):
            return None

        return JsonResponse(
            {
                'detail': 'Password change required before accessing this resource.',
                'code': 'password_change_required',
            },
            status=403,
        )
