from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenRefreshView
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework.throttling import AnonRateThrottle, ScopedRateThrottle, SimpleRateThrottle
from django.contrib.auth import authenticate, login
from rest_framework.permissions import AllowAny, IsAuthenticated
from django.conf import settings
from .jwt_serializers import get_tokens_for_user
from apps.audit.services import AuditService
from apps.audit.models import AuditAction


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
            AuditService.log_authentication(request, AuditAction.LOGOUT, success=True, user=user)
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

    def post(self, request, *args, **kwargs):
        email = request.data.get('email')
        password = request.data.get('password')

        user = authenticate(request, username=email, password=password)

        if user is not None:
            login(request, user)

            # Log successful login
            try:
                AuditService.log_authentication(request, AuditAction.LOGIN, success=True, user=user)
            except Exception:
                pass  # Don't let audit logging break login

            # Generate tokens with custom claims
            tokens = get_tokens_for_user(user)

            response = Response({
                'access': tokens['access'],
                'user': {
                    'email': user.email,
                    'id': user.id,
                    'user_type': user.user_type,
                }
            })

            response.set_cookie(
                settings.JWT_AUTH_REFRESH_COOKIE,
                tokens['refresh'],
                max_age=settings.SIMPLE_JWT['REFRESH_TOKEN_LIFETIME'].total_seconds(),
                httponly=settings.JWT_AUTH_HTTPONLY,
                samesite=settings.JWT_AUTH_SAMESITE,
                secure=settings.JWT_AUTH_SECURE
            )

            return response

        # Log failed login attempt
        try:
            AuditService.log_authentication(request, AuditAction.LOGIN_FAILED, success=False, email=email)
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
