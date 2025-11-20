"""
URL configuration for hms_backend project.
"""

from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from rest_framework_simplejwt.views import TokenVerifyView
from .auth_views import CookieTokenRefreshView, LogoutView, LoginView

urlpatterns = [
    path('admin/', admin.site.urls),

    # Authentication endpoints
    path('api/auth/login/', LoginView.as_view(), name='login'),
    path('api/auth/token/refresh/', CookieTokenRefreshView.as_view(), name='token_refresh'),
    path('api/auth/token/verify/', TokenVerifyView.as_view(), name='token_verify'),
    path('api/auth/logout/', LogoutView.as_view(), name='auth_logout'),

    # Include app URLs
    path('api/users/', include('apps.users.urls')),
    path('api/patients/', include('apps.patients.urls')),
    path('api/appointments/', include('apps.appointments.urls')),
    path('api/wards/', include('apps.wards.urls')),
    path('api/inventory/', include('apps.inventory.urls')),
    path('api/billing/', include('apps.billing.urls')),
    path('api/clinical-notes/', include('apps.clinical_notes.urls')),
    path('api/nursing/', include('apps.nursing.urls')),
    path('api/', include('apps.workflows.urls')),
    path('api/', include('apps.dashboards.urls')),
]

# Serve media files in development
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
