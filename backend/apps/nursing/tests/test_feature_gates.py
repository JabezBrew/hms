from types import SimpleNamespace

import pytest

from apps.core.security import FeatureRequiredPermission
from apps.nursing.views import (
    FluidBalanceViewSet,
    MedicationAdministrationViewSet,
    NursingAlertViewSet,
    NursingTaskViewSet,
    PatientMonitoringViewSet,
    ShiftHandoffViewSet,
    SupplyRequestViewSet,
    TreatmentSheetEntryViewSet,
    VitalSignsViewSet,
)


def _request_for(user_type='nurse'):
    return SimpleNamespace(
        data={},
        facility=None,
        facility_code=None,
        META={},
        query_params={},
        user=SimpleNamespace(
            is_authenticated=True,
            user_type=user_type,
        ),
    )


def _permissions_for(view_class, action, request=None):
    view = view_class()
    view.action = action
    view.request = request or _request_for()
    return view, view.get_permissions()


def _feature_permission(permissions):
    return next(
        permission
        for permission in permissions
        if isinstance(permission, FeatureRequiredPermission)
    )


@pytest.mark.parametrize(
    ('view_class', 'action'),
    [
        (VitalSignsViewSet, 'list'),
        (VitalSignsViewSet, 'patient_trends'),
        (NursingTaskViewSet, 'list'),
        (NursingTaskViewSet, 'complete'),
        (NursingTaskViewSet, 'today'),
        (NursingAlertViewSet, 'list'),
        (NursingAlertViewSet, 'acknowledge'),
        (MedicationAdministrationViewSet, 'list'),
        (MedicationAdministrationViewSet, 'administer'),
        (MedicationAdministrationViewSet, 'ready_for_admin'),
        (ShiftHandoffViewSet, 'list'),
        (PatientMonitoringViewSet, 'dashboard'),
        (TreatmentSheetEntryViewSet, 'by_admission'),
        (SupplyRequestViewSet, 'pending_queue'),
        (FluidBalanceViewSet, 'patient_summary'),
        (FluidBalanceViewSet, 'trends'),
    ],
)
def test_nursing_permissions_preserve_feature_gate(view_class, action):
    view, permissions = _permissions_for(view_class, action)

    assert view.required_feature == 'nursing_workflows'
    assert any(
        isinstance(permission, FeatureRequiredPermission)
        for permission in permissions
    )


@pytest.mark.django_db
def test_disabled_nursing_feature_returns_not_found(settings):
    settings.DEPLOYMENT_FEATURES = {'nursing_workflows': False}
    request = _request_for()
    view, permissions = _permissions_for(PatientMonitoringViewSet, 'dashboard', request)

    with pytest.raises(Exception) as exc:
        _feature_permission(permissions).has_permission(request, view)

    assert getattr(exc.value, 'status_code', None) == 404
