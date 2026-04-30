import pytest

from apps.core.security import FeatureRequiredPermission
from apps.laboratory.fhir_sync import sync_lab_order_to_fhir
from apps.laboratory.tasks import send_daily_lab_summary
from apps.laboratory.tests.factories import LabOrderFactory
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


def test_laboratory_daily_summary_task_noops_when_feature_disabled(settings):
    settings.DEPLOYMENT_FEATURES = {
        **getattr(settings, 'DEPLOYMENT_FEATURES', {}),
        'laboratory': False,
    }

    result = send_daily_lab_summary.run('00000000-0000-0000-0000-000000000000')

    assert result == {'status': 'skipped', 'reason': 'feature_disabled'}


@pytest.mark.django_db
def test_laboratory_fhir_sync_noops_when_feature_disabled(settings):
    settings.DEPLOYMENT_FEATURES = {
        **getattr(settings, 'DEPLOYMENT_FEATURES', {}),
        'laboratory': False,
    }
    lab_order = LabOrderFactory()

    result = sync_lab_order_to_fhir(str(lab_order.id))

    assert result == {'status': 'skipped', 'message': 'feature_disabled'}
