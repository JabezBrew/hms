from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.throttling import SimpleRateThrottle
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError

from .models import PasswordResetToken
from .serializers import (
    PasswordResetRequestSerializer,
    PasswordResetConfirmSerializer,
    AdminForceResetSerializer,
)
from .tasks import send_password_reset_email, send_admin_force_reset_email
from apps.audit.services import AuditService
from apps.audit.models import AuditAction, AuditCategory
from .rbac import IsAdmin

User = get_user_model()


class PasswordResetRateThrottle(SimpleRateThrottle):
    """
    Limits password reset requests to prevent abuse.
    3 requests per email per hour.
    """
    scope = 'password_reset'

    def get_cache_key(self, request, view):
        email = request.data.get('email', '').lower()
        if email:
            return f"password_reset_{email}"
        return self.get_ident(request)


class PasswordResetRequestView(APIView):
    """
    POST /api/auth/password-reset/

    Request a password reset email. Always returns success to prevent
    email enumeration attacks.
    """
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [PasswordResetRateThrottle]

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        email = serializer.validated_data['email'].lower()

        try:
            user = User.objects.get(email=email, is_active=True)

            # Generate token
            plain_token, token_obj = PasswordResetToken.create_for_user(
                user=user,
                reset_type='self_service',
                expiry_minutes=15
            )

            # Send email asynchronously
            send_password_reset_email.delay(
                user_id=str(user.id),
                token=plain_token,
                user_email=user.email,
                user_name=user.get_full_name() or user.email
            )

            # Audit log
            AuditService.log(
                request=request,
                action=AuditAction.PASSWORD_CHANGE,
                category=AuditCategory.AUTHENTICATION,
                resource_type='User',
                resource_id=str(user.id),
                description=f"Password reset requested for {email}",
            )

        except User.DoesNotExist:
            # Don't reveal that the email doesn't exist
            pass

        # Always return success to prevent email enumeration
        return Response({
            "detail": "If an account with this email exists, a password reset link has been sent."
        })


class PasswordResetConfirmView(APIView):
    """
    POST /api/auth/password-reset/confirm/

    Confirm password reset with token and set new password.
    """
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        token = serializer.validated_data['token']
        new_password = serializer.validated_data['password']

        # Verify token
        user, token_obj = PasswordResetToken.verify_token(token)

        if not user:
            return Response(
                {"detail": "Invalid or expired reset token."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Validate password
        try:
            validate_password(new_password, user)
        except DjangoValidationError as e:
            return Response(
                {"detail": list(e.messages)},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Set new password
        user.set_password(new_password)
        user.save()

        # Mark token as used
        token_obj.mark_as_used()

        # Invalidate all existing sessions/tokens for this user
        from rest_framework_simplejwt.token_blacklist.models import OutstandingToken
        OutstandingToken.objects.filter(user=user).delete()

        # Audit log
        AuditService.log(
            request=request,
            action=AuditAction.PASSWORD_CHANGE,
            category=AuditCategory.AUTHENTICATION,
            resource_type='User',
            resource_id=str(user.id),
            description=f"Password reset completed for {user.email}",
            user=user,
        )

        return Response({
            "detail": "Password has been reset successfully. Please log in with your new password."
        })


class PasswordResetValidateTokenView(APIView):
    """
    POST /api/auth/password-reset/validate-token/

    Validate a reset token without consuming it.
    Used by frontend to show appropriate UI.
    """
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        token = request.data.get('token')
        if not token:
            return Response(
                {"valid": False, "detail": "Token is required."},
                status=status.HTTP_400_BAD_REQUEST
            )

        user, token_obj = PasswordResetToken.verify_token(token)

        if user:
            return Response({
                "valid": True,
                "email": user.email,
            })

        return Response({
            "valid": False,
            "detail": "Invalid or expired reset token."
        })


class AdminForceResetView(APIView):
    """
    POST /api/auth/admin/force-reset/

    Admin-only endpoint to force reset a user's password.
    Generates a temporary password and sends it via email.
    """
    permission_classes = [IsAuthenticated, IsAdmin]

    def post(self, request):
        serializer = AdminForceResetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user_id = serializer.validated_data['user_id']

        try:
            user = User.objects.get(id=user_id, is_active=True)
        except User.DoesNotExist:
            return Response(
                {"detail": "User not found."},
                status=status.HTTP_404_NOT_FOUND
            )

        # Prevent resetting admin passwords unless you're a superuser
        if user.user_type == 'admin' and not request.user.is_superuser:
            return Response(
                {"detail": "Cannot reset admin passwords without superuser privileges."},
                status=status.HTTP_403_FORBIDDEN
            )

        # Generate temporary password
        import secrets
        import string
        alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
        temp_password = ''.join(secrets.choice(alphabet) for _ in range(16))

        # Set the temporary password
        user.set_password(temp_password)
        user.save()

        # Invalidate all existing sessions/tokens
        from rest_framework_simplejwt.token_blacklist.models import OutstandingToken
        OutstandingToken.objects.filter(user=user).delete()

        # Send email with temporary password
        send_admin_force_reset_email.delay(
            user_id=str(user.id),
            temp_password=temp_password,
            user_email=user.email,
            user_name=user.get_full_name() or user.email,
            admin_name=request.user.get_full_name() or request.user.email
        )

        # Audit log
        AuditService.log(
            request=request,
            action=AuditAction.PASSWORD_CHANGE,
            category=AuditCategory.ADMIN,
            resource_type='User',
            resource_id=str(user.id),
            description=f"Admin {request.user.email} force reset password for {user.email}",
            user=request.user,
        )

        return Response({
            "detail": f"Temporary password has been sent to {user.email}."
        })
