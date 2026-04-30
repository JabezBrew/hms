from types import SimpleNamespace

import pytest

from apps.core.security import FeatureRequiredPermission
from apps.discharge.views import DischargeCaseViewSet, DischargeTaskViewSet


def _request_for(user_type='admin', *, data=None):
    return SimpleNamespace(
        data=data or {},
        facility=None,
        facility_code=None,
        META={},
        query_params={},
        user=SimpleNamespace(
            is_authenticated=True,
            user_type=user_type,
        ),
    )


def _deployment_features(**overrides):
    features = {
        'bed_management': True,
        'discharge_workflows': True,
        'nursing_workflows': True,
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
        (DischargeCaseViewSet, 'list'),
        (DischargeCaseViewSet, 'billing_cutoff'),
        (DischargeCaseViewSet, 'billing_clear'),
        (DischargeCaseViewSet, 'advisory_tasks'),
        (DischargeCaseViewSet, 'finalize'),
        (DischargeCaseViewSet, 'cancel'),
        (DischargeCaseViewSet, 'reopen'),
        (DischargeTaskViewSet, 'list'),
        (DischargeTaskViewSet, 'complete'),
        (DischargeTaskViewSet, 'acknowledge'),
    ],
)
def test_discharge_permissions_preserve_feature_gate(view_class, action):
    view, permissions = _permissions_for(view_class, action)

    assert view.required_feature == 'discharge_workflows'
    assert any(
        isinstance(permission, FeatureRequiredPermission)
        for permission in permissions
    )


@pytest.mark.django_db
def test_disabled_discharge_feature_returns_not_found(settings):
    settings.DEPLOYMENT_FEATURES = _deployment_features(discharge_workflows=False)
    request = _request_for()
    view, permissions = _permissions_for(DischargeCaseViewSet, 'list', request)

    with pytest.raises(Exception) as exc:
        _feature_permission(permissions).has_permission(request, view)

    assert getattr(exc.value, 'status_code', None) == 404


@pytest.mark.django_db
@pytest.mark.parametrize(
    'disabled_feature',
    ['bed_management', 'nursing_workflows'],
)
def test_finalize_requires_dependency_features_before_object_lookup(
    settings,
    disabled_feature,
):
    settings.DEPLOYMENT_FEATURES = _deployment_features(**{disabled_feature: False})
    request = _request_for('nurse')
    view = DischargeCaseViewSet()
    view.action = 'finalize'
    view.request = request
    view.get_object = lambda: pytest.fail(
        f'get_object should not run while {disabled_feature} is disabled'
    )

    with pytest.raises(Exception) as exc:
        view.finalize(request, pk='case-1')

    assert getattr(exc.value, 'status_code', None) == 404
