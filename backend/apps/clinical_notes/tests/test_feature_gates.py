from types import SimpleNamespace

import pytest

from apps.clinical_notes.views import PrescriptionViewSet
from apps.core.security import FeatureRequiredPermission


def _permissions_for(view_class, action):
    view = view_class()
    view.action = action
    view.request = SimpleNamespace(user=SimpleNamespace(is_authenticated=True))
    return view.get_permissions()


@pytest.mark.parametrize('action', ['list', 'create', 'discontinue'])
def test_prescription_permission_overrides_preserve_feature_gate(action):
    assert any(
        isinstance(permission, FeatureRequiredPermission)
        for permission in _permissions_for(PrescriptionViewSet, action)
    )
