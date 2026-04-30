import pytest

from apps.core.security import FeatureRequiredPermission
from apps.wards.views import (
    BedAmenityViewSet,
    StaffRoleViewSet,
    WardStaffAssignmentViewSet,
)


def _permissions_for(view_class, action):
    view = view_class()
    view.action = action
    return view.get_permissions()


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
        for permission in _permissions_for(view_class, action)
    )
