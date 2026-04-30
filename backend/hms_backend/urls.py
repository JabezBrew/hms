"""
URL configuration for hms_backend project.
"""

import importlib.util

from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from rest_framework_simplejwt.views import TokenVerifyView
from .auth_views import CookieTokenRefreshView, LogoutView, LoginView
from apps.core import views as core_views
from apps.users.mfa_views import (
    MFAStatusView,
    MFATOTPStartView,
    MFATOTPConfirmView,
    MFATOTPVerifyView,
    MFARecoveryGenerateView,
    MFARecoveryVerifyView,
    MFAWebAuthnRegistrationOptionsView,
    MFAWebAuthnRegistrationVerifyView,
    MFAWebAuthnAuthenticationOptionsView,
    MFAWebAuthnAuthenticationVerifyView,
)
from apps.users.password_reset_views import (
    PasswordResetRequestView,
    PasswordResetConfirmView,
    PasswordResetValidateTokenView,
    AdminForceResetView,
)


def _module_available(module_path):
    try:
        return importlib.util.find_spec(module_path) is not None
    except (ModuleNotFoundError, ValueError):
        return False


def _ward_board_urlconf():
    if _module_available('apps.ward_board.urls'):
        return include('apps.ward_board.urls')
    return include(([], 'ward_board'))


urlpatterns = [
    # Health and metrics endpoints (unauthenticated for probes/scraping)
    path('api/health/', core_views.health_ready, name='health_check'),
    path('api/health/alive/', core_views.health_alive, name='health_alive'),
    path('api/health/ready/', core_views.health_ready, name='health_ready'),
    path('api/health/started/', core_views.health_started, name='health_started'),
    path('api/metrics/', core_views.metrics_view, name='metrics'),

    path('admin/', admin.site.urls),

    # Authentication endpoints
    path('api/auth/login/', LoginView.as_view(), name='login'),
    path('api/auth/token/refresh/', CookieTokenRefreshView.as_view(), name='token_refresh'),
    path('api/auth/token/verify/', TokenVerifyView.as_view(), name='token_verify'),
    path('api/auth/logout/', LogoutView.as_view(), name='auth_logout'),
    path('api/auth/mfa/status/', MFAStatusView.as_view(), name='mfa_status'),
    path('api/auth/mfa/totp/start/', MFATOTPStartView.as_view(), name='mfa_totp_start'),
    path('api/auth/mfa/totp/confirm/', MFATOTPConfirmView.as_view(), name='mfa_totp_confirm'),
    path('api/auth/mfa/totp/verify/', MFATOTPVerifyView.as_view(), name='mfa_totp_verify'),
    path('api/auth/mfa/recovery/', MFARecoveryGenerateView.as_view(), name='mfa_recovery_generate'),
    path('api/auth/mfa/recovery/verify/', MFARecoveryVerifyView.as_view(), name='mfa_recovery_verify'),
    path('api/auth/mfa/webauthn/registration/options/', MFAWebAuthnRegistrationOptionsView.as_view(), name='mfa_webauthn_reg_options'),
    path('api/auth/mfa/webauthn/registration/verify/', MFAWebAuthnRegistrationVerifyView.as_view(), name='mfa_webauthn_reg_verify'),
    path('api/auth/mfa/webauthn/authentication/options/', MFAWebAuthnAuthenticationOptionsView.as_view(), name='mfa_webauthn_auth_options'),
    path('api/auth/mfa/webauthn/authentication/verify/', MFAWebAuthnAuthenticationVerifyView.as_view(), name='mfa_webauthn_auth_verify'),

    # Password reset endpoints
    path('api/auth/password-reset/', PasswordResetRequestView.as_view(), name='password_reset_request'),
    path('api/auth/password-reset/confirm/', PasswordResetConfirmView.as_view(), name='password_reset_confirm'),
    path('api/auth/password-reset/validate-token/', PasswordResetValidateTokenView.as_view(), name='password_reset_validate'),
    path('api/auth/admin/force-reset/', AdminForceResetView.as_view(), name='admin_force_reset'),

    # Include app URLs
    path('api/users/', include('apps.users.urls')),
    path('api/patients/', include('apps.patients.urls')),
    path('api/admissions/', include('apps.admissions.urls')),
    path('api/appointments/', include('apps.appointments.urls')),
    path('api/wards/', include('apps.wards.urls')),
    path('api/encounters/', include('apps.encounters.urls')),
    path('api/inventory/', include('apps.inventory.urls')),
    path('api/billing/', include('apps.billing.urls')),
    path('api/clinical-notes/', include('apps.clinical_notes.urls')),
    path('api/nursing/', include('apps.nursing.urls')),
    path('api/pharmacy/', include('apps.pharmacy.urls')),
    path('api/discharges/', include('apps.discharge.urls')),
    path('api/drug-safety/', include('apps.drug_safety.urls')),
    path('api/laboratory/', include('apps.laboratory.urls')),
    path('api/referrals/', include('apps.referrals.urls')),
    path('api/charts/', include('apps.charts.urls')),
    path('api/organization/', include('apps.organization.urls')),
    path('api/interop/', include('apps.interop.urls')),
    path('api/consent/', include('apps.consent.urls')),
    path('api/notifications/', include('apps.notifications.urls')),
    path('api/ai/', include('apps.ai.urls')),
    path('api/ward-board/', _ward_board_urlconf()),
    path('api/', include('apps.workflows.urls')),
    path('api/', include('apps.dashboards.urls')),
    path('api/admin/', include('apps.audit.urls')),
    path('api/', include('apps.core.urls')),
]

# Serve media files in development
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
