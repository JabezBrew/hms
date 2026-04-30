from types import SimpleNamespace

import pytest

from apps.billing.views import (
    InsurancePlanViewSet,
    InsuranceProviderViewSet,
    InvoiceViewSet,
    PatientInsuranceViewSet,
)
from apps.core.security import FeatureRequiredPermission


def _request_for(user_type):
    return SimpleNamespace(
        user=SimpleNamespace(
            is_authenticated=True,
            user_type=user_type,
        )
    )


def _permissions_for(view_class, action, request=None):
    view = view_class()
    view.action = action
    view.request = request or _request_for('billing')
    return view.get_permissions()


@pytest.mark.parametrize(
    ('view_class', 'action', 'req'),
    [
        (InsuranceProviderViewSet, 'list', _request_for('receptionist')),
        (InsuranceProviderViewSet, 'plans', _request_for('receptionist')),
        (InsurancePlanViewSet, 'list', _request_for('receptionist')),
        (PatientInsuranceViewSet, 'for_patient', _request_for('receptionist')),
        (InvoiceViewSet, 'for_patient', _request_for('receptionist')),
    ],
)
def test_billing_read_permission_exceptions_preserve_feature_gate(
    view_class,
    action,
    req,
):
    assert any(
        isinstance(permission, FeatureRequiredPermission)
        for permission in _permissions_for(view_class, action, req)
    )
