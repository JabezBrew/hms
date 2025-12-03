import logging
import time
import json
from django.utils.deprecation import MiddlewareMixin
from django.http import JsonResponse
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken
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

        # Check if IP is on-site
        is_on_site = SiteNetwork.is_ip_on_site(client_ip)
        request.is_offsite = not is_on_site

        # Get settings
        settings = OffSiteAccessSettings.get_settings()
        request.offsite_mode = settings.offsite_mode

        # If on-site or mode is 'allow', proceed normally
        if is_on_site or settings.offsite_mode == 'allow':
            return None

        # Skip checks for certain endpoints
        skip_paths = ['/api/auth/', '/admin/', '/static/', '/media/', '/api/users/me/']
        if any(request.path.startswith(path) for path in skip_paths):
            return None

        # Check if admin override is allowed
        if settings.allow_admin_override:
            # Need to check if user is admin - but user might not be authenticated yet
            # This will be handled in the permission class instead
            pass

        # If mode is 'deny', block all off-site access
        if settings.offsite_mode == 'deny':
            return JsonResponse(
                {
                    'detail': settings.deny_message,
                    'code': 'offsite_access_denied'
                },
                status=403
            )

        # For 'readonly' mode, block write operations
        if settings.offsite_mode == 'readonly' and request.method not in ('GET', 'HEAD', 'OPTIONS'):
            return JsonResponse(
                {
                    'detail': settings.readonly_message,
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
        log_data = {
            'remote_address': request.META.get('REMOTE_ADDR'),
            'server_hostname': request.META.get('SERVER_NAME'),
            'request_method': request.method,
            'request_path': request.get_full_path(),
            'request_body': self._get_request_body(request),
            'user': str(request.user) if request.user.is_authenticated else 'Anonymous',
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
        log_data = {
            'remote_address': request.META.get('REMOTE_ADDR'),
            'request_method': request.method,
            'request_path': request.get_full_path(),
            'response_status': response.status_code,
            'processing_time': processing_time,
            'user': str(request.user) if request.user.is_authenticated else 'Anonymous',
        }
        
        logger.info(f"Response: {json.dumps(log_data)}")
        return response
        
    def _get_request_body(self, request):
        """
        Get the request body, but don't log sensitive information.
        """
        if not request.body:
            return ''
            
        try:
            # Try to parse as JSON
            body = json.loads(request.body)
            
            # Remove sensitive information
            if 'password' in body:
                body['password'] = '********'
            if 'confirm_password' in body:
                body['confirm_password'] = '********'
                
            return json.dumps(body)
        except:
            # If not JSON, return truncated body
            return str(request.body)[:100] + '...' if len(str(request.body)) > 100 else str(request.body)


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