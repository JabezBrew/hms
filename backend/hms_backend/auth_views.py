from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenRefreshView
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework.throttling import AnonRateThrottle, ScopedRateThrottle, SimpleRateThrottle
from django.contrib.auth import authenticate
from rest_framework.permissions import AllowAny, IsAuthenticated
from django.conf import settings
from .jwt_serializers import resolve_user_facility_code
from .tenancy import facility_context, set_current_facility_code
from .auth_utils import build_auth_response, get_access_context
from apps.core.security import get_user_facility_codes, normalize_facility_code
from apps.audit.services import AuditService
from apps.audit.models import AuditAction
from apps.users.mfa_service import (
    create_mfa_session,
    get_mfa_enrollment_status,
    is_mfa_required,
)


class LoginRateThrottle(SimpleRateThrottle):
    """
    Limits the rate of login attempts per IP address
    """
    scope = 'login'

    def get_cache_key(self, request, view):
        # Always throttle login attempts, regardless of authentication status
        # Get the user identifier (IP address)
        ident = self.get_ident(request)

        # Generate cache key
        cache_key = self.cache_format % {
            'scope': self.scope,
            'ident': ident
        }

        return cache_key



class CookieTokenRefreshView(APIView):
    permission_classes = []
    authentication_classes = []

    def post(self, request, *args, **kwargs):
        refresh_token = request.COOKIES.get(settings.JWT_AUTH_REFRESH_COOKIE)
        if not refresh_token:
            return Response(
                {"detail": "Refresh token not found."},
                status=status.HTTP_401_UNAUTHORIZED
            )

        # Use the serializer directly with the refresh token
        serializer = TokenRefreshSerializer(data={'refresh': refresh_token})

        try:
            serializer.is_valid(raise_exception=True)
            response_data = serializer.validated_data

            response = Response({
                'access': response_data['access']
            })

            # If the response contains a new refresh token, update the cookie
            if 'refresh' in response_data:
                response.set_cookie(
                    settings.JWT_AUTH_REFRESH_COOKIE,
                    response_data['refresh'],
                    max_age=settings.SIMPLE_JWT['REFRESH_TOKEN_LIFETIME'].total_seconds(),
                    httponly=settings.JWT_AUTH_HTTPONLY,
                    samesite=settings.JWT_AUTH_SAMESITE,
                    secure=settings.JWT_AUTH_SECURE
                )

            return response

        except (InvalidToken, TokenError) as e:
            response = Response(
                {"detail": "Token is invalid or expired"},
                status=status.HTTP_401_UNAUTHORIZED
            )
            response.delete_cookie(
                settings.JWT_AUTH_REFRESH_COOKIE,
                path='/',
                samesite=settings.JWT_AUTH_SAMESITE
            )
            return response


class LogoutView(APIView):
    permission_classes = []  # Allow logout even with expired tokens
    authentication_classes = []  # Don't require authentication

    def post(self, request, *args, **kwargs):
        # Try to get user from request for audit logging
        user = getattr(request, 'user', None) if hasattr(request, 'user') and request.user.is_authenticated else None

        try:
            # Get refresh token from cookie
            refresh_token = request.COOKIES.get(settings.JWT_AUTH_REFRESH_COOKIE)

            if refresh_token:
                try:
                    # Blacklist the refresh token
                    token = RefreshToken(refresh_token)
                    token.blacklist()
                except (InvalidToken, TokenError):
                    # Token already invalid/expired, that's fine - proceed with logout
                    pass
        except Exception:
            # If blacklisting fails, still proceed with logout
            pass

        # Log the logout action
        try:
            AuditService.log_authentication(request, action=AuditAction.LOGOUT, user=user)
        except Exception:
            pass  # Don't let audit logging break logout

        response = Response({"detail": "Successfully logged out."})
        response.delete_cookie(
            settings.JWT_AUTH_REFRESH_COOKIE,
            path='/',
            samesite=settings.JWT_AUTH_SAMESITE
        )
        return response


class LoginView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []  # Disable authentication for login endpoint
    throttle_classes = [LoginRateThrottle]

    def _get_client_ip(self, request):
        """Get the client's real IP address from the request."""
        x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
        if x_forwarded_for:
            ip = x_forwarded_for.split(',')[0].strip()
        else:
            ip = request.META.get('REMOTE_ADDR')
        return ip

    def post(self, request, *args, **kwargs):
        email = request.data.get('email')
        password = request.data.get('password')

        # Validate required fields before authentication (and before rate limiting counts)
        if not email:
            return Response(
                {"email": ["This field is required."]},
                status=status.HTTP_400_BAD_REQUEST
            )
        if not password:
            return Response(
                {"password": ["This field is required."]},
                status=status.HTTP_400_BAD_REQUEST
            )

        header_name = getattr(settings, 'FACILITY_HEADER_NAME', 'X-Facility-Code')
        header_key = f'HTTP_{header_name.upper().replace("-", "_")}'
        requested_facility = normalize_facility_code(
            request.META.get(header_key) or request.data.get('facility_code')
        )
        if settings.FACILITY_CONTEXT_REQUIRED and not requested_facility and not settings.DEFAULT_FACILITY_CODE:
            return Response(
                {'detail': 'Facility code is required.', 'code': 'facility_required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        user = authenticate(request, username=email, password=password)

        if user is not None:
            allowed_codes = get_user_facility_codes(user)
            allow_cross_facility = getattr(settings, 'ALLOW_CROSS_FACILITY_ACCESS', False)
            if requested_facility and allowed_codes:
                is_admin = user.user_type == 'admin'
                if requested_facility not in allowed_codes and not (allow_cross_facility and is_admin):
                    return Response(
                        {'detail': 'Facility access denied.', 'code': 'facility_forbidden'},
                        status=status.HTTP_403_FORBIDDEN
                    )
            if (not requested_facility and allowed_codes and len(allowed_codes) > 1
                    and getattr(settings, 'MULTI_FACILITY_MODE', False)):
                return Response(
                    {'detail': 'Facility code is required.', 'code': 'facility_required'},
                    status=status.HTTP_400_BAD_REQUEST
                )

            facility_code = resolve_user_facility_code(user, requested_facility)
            if facility_code:
                set_current_facility_code(facility_code)

            if is_mfa_required(user):
                with facility_context(facility_code):
                    enrollment_status = get_mfa_enrollment_status(user)
                enrollment_required = not (
                    enrollment_status['totp_enrolled'] or enrollment_status['webauthn_enrolled']
                )
                session, session_token = create_mfa_session(
                    user=user,
                    facility_code=facility_code,
                    enrollment_required=enrollment_required,
                    purpose='login',
                )

                access_context = get_access_context(request)
                return Response({
                    'mfa_required': True,
                    'mfa_session': session_token,
                    'mfa': {
                        'totp': enrollment_status['totp_enrolled'],
                        'webauthn': enrollment_status['webauthn_enrolled'],
                        'enrollment_required': enrollment_required,
                    },
                    'user': {
                        'email': user.email,
                        'id': user.id,
                        'user_type': user.user_type,
                        'first_name': user.first_name,
                        'last_name': user.last_name,
                        'facility_code': facility_code or None,
                    },
                    'access_context': access_context,
                })

            response = build_auth_response(request, user, facility_code=facility_code)

            try:
                AuditService.log_authentication(request, action=AuditAction.LOGIN, user=user)
            except Exception:
                pass

            access_context = response.data.get('access_context') or {}
            if access_context.get('is_offsite'):
                try:
                    AuditService.log_authentication(
                        request,
                        action=AuditAction.OFFSITE_ACCESS,
                        user=user
                    )
                except Exception:
                    pass

            return response

        # Log failed login attempt
        try:
            AuditService.log_authentication(request, action=AuditAction.LOGIN_FAILED, email=email)
        except Exception:
            pass  # Don't let audit logging break login

        return Response(
            {"detail": "Invalid credentials"},
            status=status.HTTP_401_UNAUTHORIZED
        )

    def handle_exception(self, exc):
        """
        Override to customize throttled response
        """
        from rest_framework.exceptions import Throttled
        if isinstance(exc, Throttled):
            return Response(
                {
                    "detail": f"Too many login attempts. Please try again in {int(exc.wait)} seconds.",
                    "retry_after": int(exc.wait)
                },
                status=status.HTTP_429_TOO_MANY_REQUESTS
            )
        return super().handle_exception(exc)
