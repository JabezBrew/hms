from types import SimpleNamespace

import pytest

from apps.core.security import FeatureRequiredPermission
from apps.wards.views import (
    AdmissionViewSet,
    BedAllocationLogViewSet,
    BedAmenityViewSet,
    BedViewSet,
    StaffRoleViewSet,
    WardSectionViewSet,
    WardStaffAssignmentViewSet,
    WardTransferViewSet,
    WardViewSet,
)


def _facility():
    return SimpleNamespace(code='TEST', id=1, is_active=True)


def _request_for(user_type='admin', *, data=None):
    facility = _facility()
    return SimpleNamespace(
        data=data or {},
        facility=facility,
        facility_code=facility.code,
        META={},
        query_params={},
        user=SimpleNamespace(
            is_authenticated=True,
            user_type=user_type,
            primary_facility=facility,
        ),
    )


def _deployment_features(**overrides):
    features = {
        'bed_management': True,
        'discharge_workflows': True,
        'inpatient_admissions': True,
        'nursing_workflows': True,
        'wards': True,
    }
    features.update(overrides)
    return features


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
        (BedAmenityViewSet, 'list'),
        (BedAmenityViewSet, 'create'),
        (StaffRoleViewSet, 'list'),
        (StaffRoleViewSet, 'create'),
        (WardStaffAssignmentViewSet, 'list'),
        (WardStaffAssignmentViewSet, 'create'),
    ],
)
def test_manual_ward_permissions_preserve_feature_gate(view_class, action):
    assert any(
        isinstance(permission, FeatureRequiredPermission)
        for permission in _permissions_for(view_class, action)[1]
    )


@pytest.mark.parametrize(
    ('view_class', 'action', 'feature'),
    [
        (WardViewSet, 'list', 'wards'),
        (WardViewSet, 'beds', 'bed_management'),
        (WardViewSet, 'analytics', 'bed_management'),
        (WardViewSet, 'admissions', 'inpatient_admissions'),
        (BedViewSet, 'list', 'bed_management'),
        (BedAllocationLogViewSet, 'list', 'bed_management'),
        (WardTransferViewSet, 'list', 'bed_management'),
        (WardSectionViewSet, 'list', 'bed_management'),
        (BedAmenityViewSet, 'list', 'bed_management'),
        (AdmissionViewSet, 'list', 'inpatient_admissions'),
        (AdmissionViewSet, 'discharge', 'discharge_workflows'),
        (StaffRoleViewSet, 'list', 'wards'),
        (WardStaffAssignmentViewSet, 'list', 'wards'),
    ],
)
def test_ward_viewsets_declare_expected_feature_gates(view_class, action, feature):
    view, permissions = _permissions_for(view_class, action)

    assert view.required_feature == feature
    assert any(
        isinstance(permission, FeatureRequiredPermission)
        for permission in permissions
    )


@pytest.mark.django_db
@pytest.mark.parametrize(
    ('view_class', 'action', 'feature'),
    [
        (WardViewSet, 'beds', 'bed_management'),
        (WardViewSet, 'admissions', 'inpatient_admissions'),
        (BedViewSet, 'available', 'bed_management'),
        (WardTransferViewSet, 'request_transfer', 'bed_management'),
        (AdmissionViewSet, 'list', 'inpatient_admissions'),
        (AdmissionViewSet, 'discharge', 'discharge_workflows'),
    ],
)
def test_disabled_ward_features_return_not_found(settings, view_class, action, feature):
    settings.DEPLOYMENT_FEATURES = _deployment_features(**{feature: False})
    request = _request_for()
    view, permissions = _permissions_for(view_class, action, request)

    with pytest.raises(Exception) as exc:
        _feature_permission(permissions).has_permission(request, view)

    assert getattr(exc.value, 'status_code', None) == 404


@pytest.mark.django_db
def test_ward_transfer_requires_inpatient_admissions_before_listing(settings):
    settings.DEPLOYMENT_FEATURES = _deployment_features(inpatient_admissions=False)
    request = _request_for()
    view = WardTransferViewSet()
    view.action = 'list'
    view.request = request

    with pytest.raises(Exception) as exc:
        view.get_queryset()

    assert getattr(exc.value, 'status_code', None) == 404
