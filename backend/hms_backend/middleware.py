import logging
import time
import json
from django.utils.deprecation import MiddlewareMixin
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken
from rest_framework.response import Response
from rest_framework import status as http_status

logger = logging.getLogger('django.request')

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