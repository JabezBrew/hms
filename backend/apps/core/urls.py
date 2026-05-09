"""
Core URL configuration for system-wide settings APIs.
"""
from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

app_name = 'core'

router = DefaultRouter()
router.register(r'facilities', views.FacilityViewSet, basename='facility')
router.register(
    r'settings/feature-entitlements',
    views.FeatureEntitlementOverrideViewSet,
    basename='feature-entitlement',
)

urlpatterns = [
    path(
        'settings/deployment-capabilities/',
        views.deployment_capabilities,
        name='deployment-capabilities',
    ),
    path(
        'search/omni/',
        views.omni_search,
        name='omni-search',
    ),
    path(
        'observability/rum/',
        views.rum_ingest,
        name='rum-ingest',
    ),
    # Fluid Balance Settings
    path(
        'settings/fluid-balance/',
        views.fluid_balance_settings,
        name='fluid-balance-settings'
    ),
    path(
        'settings/fluid-balance/update/',
        views.update_fluid_balance_settings,
        name='fluid-balance-settings-update'
    ),
]

urlpatterns += router.urls
