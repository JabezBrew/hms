"""
Core URL configuration for system-wide settings APIs.
"""
from django.urls import path

from . import views

app_name = 'core'

urlpatterns = [
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
