from types import SimpleNamespace

import pytest

from apps.admissions.views import AdmissionCaseViewSet, AdmissionTaskViewSet
from apps.core.security import FeatureRequiredPermission


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
        'inpatient_admissions': True,
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
        (AdmissionCaseViewSet, 'list'),
        (AdmissionCaseViewSet, 'start'),
        (AdmissionCaseViewSet, 'reserve_bed'),
        (AdmissionCaseViewSet, 'activate'),
        (AdmissionCaseViewSet, 'complete_case_intake'),
        (AdmissionTaskViewSet, 'list'),
        (AdmissionTaskViewSet, 'complete'),
        (AdmissionTaskViewSet, 'acknowledge'),
    ],
)
def test_admissions_permissions_preserve_feature_gate(view_class, action):
    view, permissions = _permissions_for(view_class, action)

    assert view.required_feature == 'inpatient_admissions'
    assert any(
        isinstance(permission, FeatureRequiredPermission)
        for permission in permissions
    )


@pytest.mark.django_db
def test_disabled_admissions_feature_returns_not_found(settings):
    settings.DEPLOYMENT_FEATURES = _deployment_features(inpatient_admissions=False)
    request = _request_for()
    view, permissions = _permissions_for(AdmissionCaseViewSet, 'list', request)

    with pytest.raises(Exception) as exc:
        _feature_permission(permissions).has_permission(request, view)

    assert getattr(exc.value, 'status_code', None) == 404


@pytest.mark.django_db
def test_start_with_requested_bed_requires_bed_management_before_validation(settings):
    settings.DEPLOYMENT_FEATURES = _deployment_features(bed_management=False)
    request = _request_for('doctor', data={'requested_bed_id': 'bed-1'})
    view = AdmissionCaseViewSet()
    view.action = 'start'
    view.request = request

    with pytest.raises(Exception) as exc:
        view.start(request)

    assert getattr(exc.value, 'status_code', None) == 404


@pytest.mark.django_db
@pytest.mark.parametrize(
    ('action', 'user_type'),
    [
        ('reserve_bed', 'nurse'),
        ('activate', 'nurse'),
    ],
)
def test_bed_assignment_actions_require_bed_management_before_object_lookup(
    settings,
    action,
    user_type,
):
    settings.DEPLOYMENT_FEATURES = _deployment_features(bed_management=False)
    request = _request_for(user_type)
    view = AdmissionCaseViewSet()
    view.action = action
    view.request = request
    view.get_object = lambda: pytest.fail(
        'get_object should not run while bed management is disabled'
    )

    with pytest.raises(Exception) as exc:
        getattr(view, action)(request, pk='case-1')

    assert getattr(exc.value, 'status_code', None) == 404


@pytest.mark.django_db
def test_complete_intake_requires_nursing_workflows_before_object_lookup(settings):
    settings.DEPLOYMENT_FEATURES = _deployment_features(nursing_workflows=False)
    request = _request_for('nurse')
    view = AdmissionCaseViewSet()
    view.action = 'complete_case_intake'
    view.request = request
    view.get_object = lambda: pytest.fail(
        'get_object should not run while nursing workflows are disabled'
    )

    with pytest.raises(Exception) as exc:
        view.complete_case_intake(request, pk='case-1')

    assert getattr(exc.value, 'status_code', None) == 404
