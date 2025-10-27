from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenRefreshView
from rest_framework_simplejwt.tokens import RefreshToken
from django.contrib.auth import authenticate, login
from rest_framework.permissions import AllowAny
from django.conf import settings
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator


class CookieTokenRefreshView(TokenRefreshView):
    def post(self, request, *args, **kwargs):
        refresh_token = request.COOKIES.get(settings.JWT_AUTH_REFRESH_COOKIE)
        if not refresh_token:
            return Response(
                {"detail": "Refresh token not found."},
                status=status.HTTP_401_UNAUTHORIZED
            )

        request.data['refresh'] = refresh_token
        response = super().post(request, *args, **kwargs)

        if response.status_code == status.HTTP_400_BAD_REQUEST:
            response.status_code = status.HTTP_401_UNAUTHORIZED
            response.delete_cookie(settings.JWT_AUTH_REFRESH_COOKIE)

        # If the response contains a new refresh token, update the cookie
        if response.status_code == 200 and 'refresh' in response.data:
            response.set_cookie(
                settings.JWT_AUTH_REFRESH_COOKIE,
                response.data['refresh'],
                max_age=settings.SIMPLE_JWT['REFRESH_TOKEN_LIFETIME'].total_seconds(),
                httponly=settings.JWT_AUTH_HTTPONLY,
                samesite=settings.JWT_AUTH_SAMESITE,
                secure=settings.JWT_AUTH_SECURE
            )
            # Remove the refresh token from the response data to prevent it from being exposed
            del response.data['refresh']

        return response


class LogoutView(APIView):
    def post(self, request, *args, **kwargs):
        response = Response({"detail": "Successfully logged out."})
        response.delete_cookie(settings.JWT_AUTH_REFRESH_COOKIE)
        return response


@method_decorator(csrf_exempt, name='dispatch')
class LoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, *args, **kwargs):
        email = request.data.get('email')
        password = request.data.get('password')

        user = authenticate(request, username=email, password=password)

        if user is not None:
            login(request, user)
            refresh = RefreshToken.for_user(user)

            response = Response({
                'access': str(refresh.access_token),
                'user': {
                    'email': user.email,
                    'id': user.id,
                    'user_type': user.user_type,
                }
            })

            response.set_cookie(
                settings.JWT_AUTH_REFRESH_COOKIE,
                str(refresh),
                max_age=settings.SIMPLE_JWT['REFRESH_TOKEN_LIFETIME'].total_seconds(),
                httponly=settings.JWT_AUTH_HTTPONLY,
                samesite=settings.JWT_AUTH_SAMESITE,
                secure=settings.JWT_AUTH_SECURE
            )

            return response

        return Response(
            {"detail": "Invalid credentials"},
            status=status.HTTP_401_UNAUTHORIZED
        )
