from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenRefreshView
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework.throttling import AnonRateThrottle, ScopedRateThrottle, SimpleRateThrottle
from rest_framework.exceptions import AuthenticationFailed
from django.contrib.auth import authenticate
from rest_framework.permissions import AllowAny, IsAuthenticated
from django.conf import settings
from .jwt_serializers import resolve_user_facility_code
from .tenancy import facility_context, set_current_facility_code
from .auth_utils import build_auth_response, get_access_context
from apps.core.security import get_user_facility_codes, normalize_facility_code
from apps.core.models import Facility
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

        header_name = getattr(settings, 'FACILITY_HEADER_NAME', 'X-Facility-Code')
        header_key = f'HTTP_{header_name.upper().replace("-", "_")}'
        requested_facility = normalize_facility_code(request.META.get(header_key))

        token_facility = None
        token_user_id = None
        try:
            token = RefreshToken(refresh_token)
            token_facility = normalize_facility_code(token.get('facility_code'))
            token_user_id = str(token.get('user_id')) if token.get('user_id') else None
        except TokenError:
            token_facility = None

        facility_code = requested_facility or token_facility
        if not facility_code and settings.FACILITY_CONTEXT_REQUIRED and not settings.DEFAULT_FACILITY_CODE:
            if getattr(settings, 'MULTI_FACILITY_MODE', False) and token_user_id:
                from django.contrib.auth import get_user_model

                User = get_user_model()
                user = User.objects.filter(id=token_user_id).first()
                allowed_codes = get_user_facility_codes(user) if user else set()
                if len(allowed_codes) > 1:
                    return Response(
                        {'detail': 'Facility code is required.', 'code': 'facility_required'},
                        status=status.HTTP_400_BAD_REQUEST
                    )
                if len(allowed_codes) == 1:
                    facility_code = next(iter(allowed_codes))
            if not facility_code:
                return Response(
                    {'detail': 'Facility code is required.', 'code': 'facility_required'},
                    status=status.HTTP_400_BAD_REQUEST
                )

        if facility_code:
            set_current_facility_code(facility_code)
            request.facility_code = facility_code
            request.facility = Facility.get_by_code(facility_code)

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

            try:
                from apps.users.session_service import rotate_session, touch_session
                if 'refresh' in response_data:
                    rotate_session(
                        request,
                        refresh_token,
                        response_data['refresh'],
                        facility_code=getattr(request, 'facility_code', None),
                    )
                else:
                    touch_session(request, refresh_token)
            except Exception:
                pass

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
        from django.contrib.auth import get_user_model
        User = get_user_model()

        user = None
        email = None
        token_facility_code = None
        refresh = None
        refresh_token = request.COOKIES.get(settings.JWT_AUTH_REFRESH_COOKIE)

        jwt_auth = JWTAuthentication()
        try:
            header = jwt_auth.get_header(request)
            if header is not None:
                raw_token = jwt_auth.get_raw_token(header)
                if raw_token is not None:
                    validated_token = jwt_auth.get_validated_token(raw_token)
                    token_user_id = validated_token.get('user_id')
                    token_facility_code = normalize_facility_code(validated_token.get('facility_code'))
                    email = validated_token.get('email') or email
                    user = jwt_auth.get_user(validated_token)
                    if not user and token_user_id:
                        user = User.objects.filter(id=token_user_id).first()
        except (InvalidToken, TokenError, AuthenticationFailed, AttributeError, KeyError, TypeError):
            pass

        if refresh_token:
            try:
                refresh = RefreshToken(refresh_token)
                token_user_id = refresh.get('user_id')
                token_facility_code = token_facility_code or normalize_facility_code(refresh.get('facility_code'))
                email = email or refresh.get('email')
                if token_user_id and not user:
                    user = User.objects.filter(id=token_user_id).first()
            except (InvalidToken, TokenError):
                refresh = None

        if not getattr(request, 'facility_code', None) and token_facility_code:
            set_current_facility_code(token_facility_code)
            request.facility_code = token_facility_code
            request.facility = Facility.get_by_code(token_facility_code)

        revoked_session = None
        if refresh_token:
            try:
                from apps.users.session_service import revoke_session_by_refresh_token
                revoked_session = revoke_session_by_refresh_token(
                    refresh_token,
                    revoked_by=user,
                    request=request,
                )
            except Exception:
                pass

            try:
                refresh = refresh or RefreshToken(refresh_token)
                refresh.blacklist()
            except (InvalidToken, TokenError):
                # Token already invalid/expired, that's fine - proceed with logout
                pass

        if not revoked_session and user:
            try:
                if not getattr(request, 'user', None) or not request.user.is_authenticated:
                    request.user = user
                from apps.users.session_service import get_current_session_from_request, revoke_session
                current_session = get_current_session_from_request(request)
                if current_session:
                    revoke_session(current_session, revoked_by=user)
                else:
                    from apps.users.models import UserSession
                    facility_code = normalize_facility_code(getattr(request, 'facility_code', None))
                    fallback_qs = UserSession.objects.filter(
                        user=user,
                        revoked_at__isnull=True,
                    )
                    if facility_code:
                        fallback_qs = fallback_qs.filter(facility_code=facility_code)
                    fallback_session = fallback_qs.order_by('-last_seen_at').first()
                    if fallback_session:
                        revoke_session(fallback_session, revoked_by=user)
            except Exception:
                pass

        # Log the logout action with the best identity we have
        try:
            AuditService.log_authentication(request, action=AuditAction.LOGOUT, user=user, email=email)
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

    def _extract_login_email(self, request):
        try:
            data = request.data
        except Exception:
            data = {}
        if isinstance(data, dict):
            value = data.get('email')
        else:
            value = request.query_params.get('email')
        if isinstance(value, str):
            return value.strip()
        return value

    def _log_login_failure(self, request, email=None, details=None, facility_code=None, user=None):
        try:
            facility = Facility.get_by_code(facility_code) if facility_code else None
            AuditService.log_authentication(
                request,
                action=AuditAction.LOGIN_FAILED,
                user=user,
                email=email,
                details=details,
                facility=facility,
            )
        except Exception:
            pass

    def post(self, request, *args, **kwargs):
        email = request.data.get('email')
        password = request.data.get('password')

        header_name = getattr(settings, 'FACILITY_HEADER_NAME', 'X-Facility-Code')
        header_key = f'HTTP_{header_name.upper().replace("-", "_")}'
        requested_facility = normalize_facility_code(
            request.META.get(header_key) or request.data.get('facility_code')
        )

        # Validate required fields before authentication (and before rate limiting counts)
        if not email:
            self._log_login_failure(
                request,
                details="Missing email.",
                facility_code=requested_facility,
            )
            return Response(
                {"email": ["This field is required."]},
                status=status.HTTP_400_BAD_REQUEST
            )
        if not password:
            self._log_login_failure(
                request,
                email=email,
                details="Missing password.",
                facility_code=requested_facility,
            )
            return Response(
                {"password": ["This field is required."]},
                status=status.HTTP_400_BAD_REQUEST
            )
        if settings.FACILITY_CONTEXT_REQUIRED and not requested_facility and not settings.DEFAULT_FACILITY_CODE:
            self._log_login_failure(
                request,
                email=email,
                details="Facility code required.",
            )
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
                    self._log_login_failure(
                        request,
                        email=email,
                        user=user,
                        details=f"Facility access denied for {requested_facility}.",
                        facility_code=requested_facility,
                    )
                    return Response(
                        {'detail': 'Facility access denied.', 'code': 'facility_forbidden'},
                        status=status.HTTP_403_FORBIDDEN
                    )
            if (not requested_facility and allowed_codes and len(allowed_codes) > 1
                    and getattr(settings, 'MULTI_FACILITY_MODE', False)):
                self._log_login_failure(
                    request,
                    email=email,
                    user=user,
                    details="Facility code required for multi-facility user.",
                )
                return Response(
                    {'detail': 'Facility code is required.', 'code': 'facility_required'},
                    status=status.HTTP_400_BAD_REQUEST
                )

            facility_code = resolve_user_facility_code(user, requested_facility)
            if facility_code:
                set_current_facility_code(facility_code)
                # Also set on request so audit logging can access it
                request.facility_code = facility_code
                request.facility = Facility.get_by_code(facility_code)

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
        self._log_login_failure(
            request,
            email=email,
            details="Invalid credentials.",
            facility_code=requested_facility,
        )

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
            self._log_login_failure(
                self.request,
                email=self._extract_login_email(self.request),
                details=f"Login throttled. Retry after {int(exc.wait)} seconds.",
            )
            return Response(
                {
                    "detail": f"Too many login attempts. Please try again in {int(exc.wait)} seconds.",
                    "retry_after": int(exc.wait)
                },
                status=status.HTTP_429_TOO_MANY_REQUESTS
            )
        return super().handle_exception(exc)
