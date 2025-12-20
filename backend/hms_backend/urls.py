"""
URL configuration for hms_backend project.
"""

from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from django.http import JsonResponse
from django.db import connection
from rest_framework_simplejwt.views import TokenVerifyView
from .auth_views import CookieTokenRefreshView, LogoutView, LoginView
from apps.users.password_reset_views import (
    PasswordResetRequestView,
    PasswordResetConfirmView,
    PasswordResetValidateTokenView,
    AdminForceResetView,
)


def health_check(request):
    """
    Health check endpoint for Docker/Kubernetes probes.

    Returns:
        - 200 OK if the service is healthy
        - 503 Service Unavailable if database is not reachable
    """
    try:
        # Check database connectivity
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        return JsonResponse({
            'status': 'healthy',
            'database': 'connected',
        })
    except Exception as e:
        return JsonResponse({
            'status': 'unhealthy',
            'database': 'disconnected',
            'error': str(e),
        }, status=503)


urlpatterns = [
    # Health check endpoint (unauthenticated for k8s probes)
    path('api/health/', health_check, name='health_check'),

    path('admin/', admin.site.urls),

    # Authentication endpoints
    path('api/auth/login/', LoginView.as_view(), name='login'),
    path('api/auth/token/refresh/', CookieTokenRefreshView.as_view(), name='token_refresh'),
    path('api/auth/token/verify/', TokenVerifyView.as_view(), name='token_verify'),
    path('api/auth/logout/', LogoutView.as_view(), name='auth_logout'),

    # Password reset endpoints
    path('api/auth/password-reset/', PasswordResetRequestView.as_view(), name='password_reset_request'),
    path('api/auth/password-reset/confirm/', PasswordResetConfirmView.as_view(), name='password_reset_confirm'),
    path('api/auth/password-reset/validate-token/', PasswordResetValidateTokenView.as_view(), name='password_reset_validate'),
    path('api/auth/admin/force-reset/', AdminForceResetView.as_view(), name='admin_force_reset'),

    # Include app URLs
    path('api/users/', include('apps.users.urls')),
    path('api/patients/', include('apps.patients.urls')),
    path('api/appointments/', include('apps.appointments.urls')),
    path('api/wards/', include('apps.wards.urls')),
    path('api/inventory/', include('apps.inventory.urls')),
    path('api/billing/', include('apps.billing.urls')),
    path('api/clinical-notes/', include('apps.clinical_notes.urls')),
    path('api/nursing/', include('apps.nursing.urls')),
    path('api/pharmacy/', include('apps.pharmacy.urls')),
    path('api/drug-safety/', include('apps.drug_safety.urls')),
    path('api/laboratory/', include('apps.laboratory.urls')),
    path('api/referrals/', include('apps.referrals.urls')),
    path('api/charts/', include('apps.charts.urls')),
    path('api/', include('apps.workflows.urls')),
    path('api/', include('apps.dashboards.urls')),
    path('api/admin/', include('apps.audit.urls')),
    path('api/', include('apps.core.urls')),
]

# Serve media files in development
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
