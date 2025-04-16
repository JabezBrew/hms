from django.urls import path, include
from .auth_views import CookieRegisterView
from dj_rest_auth.registration.views import (
    VerifyEmailView, ResendEmailVerificationView,
    ConfirmEmailView
)

urlpatterns = [
    # Override the default registration view
    path('', CookieRegisterView.as_view(), name='rest_register'),
    
    # Include the other registration views from dj-rest-auth
    path('verify-email/', VerifyEmailView.as_view(), name='rest_verify_email'),
    path('resend-email/', ResendEmailVerificationView.as_view(), name='rest_resend_email'),
    path('account-confirm-email/<str:key>/', ConfirmEmailView.as_view(), name='account_confirm_email'),
    path('account-confirm-email/', VerifyEmailView.as_view(), name='account_email_verification_sent'),
]