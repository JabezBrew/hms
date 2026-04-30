import pytest

from apps.core.security import FeatureRequiredPermission
from apps.laboratory.views import (
    LabOrderViewSet,
    LabPanelViewSet,
    LabResultViewSet,
    LabSpecimenViewSet,
    LabTestCatalogViewSet,
)


def _permissions_for(view_class, action):
    view = view_class()
    view.action = action
    return view.get_permissions()


@pytest.mark.parametrize(
    ('view_class', 'action'),
    [
        (LabTestCatalogViewSet, 'list'),
        (LabTestCatalogViewSet, 'create'),
        (LabPanelViewSet, 'list'),
        (LabPanelViewSet, 'create'),
        (LabOrderViewSet, 'list'),
        (LabOrderViewSet, 'create'),
        (LabOrderViewSet, 'collect'),
        (LabSpecimenViewSet, 'list'),
        (LabSpecimenViewSet, 'receive'),
        (LabResultViewSet, 'list'),
        (LabResultViewSet, 'verify'),
        (LabResultViewSet, 'bulk_verify'),
    ],
)
def test_manual_laboratory_permissions_preserve_feature_gate(view_class, action):
    assert any(
        isinstance(permission, FeatureRequiredPermission)
        for permission in _permissions_for(view_class, action)
    )
