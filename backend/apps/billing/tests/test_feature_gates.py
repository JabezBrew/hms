from types import SimpleNamespace

import pytest
from rest_framework.exceptions import NotFound

from apps.billing.models import PayerServiceCodeImportJob, SettlementBatch
from apps.billing.tasks import (
    process_payer_service_code_import_job,
    process_settlement_batch,
)
from apps.billing.tests.factories import InsuranceProviderFactory
from apps.billing.views import (
    AccountsReceivableViewSet,
    ClaimViewSet,
    InsurancePlanViewSet,
    InsuranceProviderViewSet,
    InvoiceViewSet,
    NHISClaimBatchViewSet,
    NHISClaimExportJobViewSet,
    PatientInsuranceViewSet,
    PayerServiceCodeImportJobViewSet,
    PayerServiceCodeViewSet,
    RemittanceImportJobViewSet,
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


@pytest.mark.parametrize(
    'view_class',
    [
        InsuranceProviderViewSet,
        InsurancePlanViewSet,
        PatientInsuranceViewSet,
        ClaimViewSet,
        PayerServiceCodeViewSet,
        NHISClaimBatchViewSet,
        NHISClaimExportJobViewSet,
        RemittanceImportJobViewSet,
        PayerServiceCodeImportJobViewSet,
        AccountsReceivableViewSet,
    ],
)
def test_insurance_claims_surfaces_require_insurance_claims_feature(view_class):
    assert view_class.required_feature == 'insurance_claims'
    assert FeatureRequiredPermission in view_class.permission_classes


def test_invoice_generate_claim_action_fails_closed_when_insurance_disabled(settings):
    settings.DEPLOYMENT_FEATURES = {
        **getattr(settings, 'DEPLOYMENT_FEATURES', {}),
        'billing': True,
        'insurance_claims': False,
    }
    view = InvoiceViewSet()
    request = _request_for('billing')

    with pytest.raises(NotFound) as exc:
        view.generate_claim(request)

    assert exc.value.detail['code'] == 'feature_disabled'


@pytest.mark.django_db
def test_settlement_task_marks_job_failed_when_billing_disabled(settings, default_facility):
    settings.DEPLOYMENT_FEATURES = {
        **getattr(settings, 'DEPLOYMENT_FEATURES', {}),
        'billing': False,
    }
    batch = SettlementBatch.objects.create(
        facility=default_facility,
        provider='hubtel',
        status='pending',
        file_name='settlement.csv',
        payload_checksum='x' * 64,
    )

    process_settlement_batch.run(str(batch.id))

    batch.refresh_from_db()
    assert batch.status == 'failed'
    assert 'billing feature is disabled' in batch.error_message


@pytest.mark.django_db
def test_payer_code_import_task_marks_job_failed_when_insurance_disabled(
    settings,
    default_facility,
):
    settings.DEPLOYMENT_FEATURES = {
        **getattr(settings, 'DEPLOYMENT_FEATURES', {}),
        'billing': True,
        'insurance_claims': False,
    }
    payer = InsuranceProviderFactory(facility=default_facility)
    job = PayerServiceCodeImportJob.objects.create(
        facility=default_facility,
        payer=payer,
        status='pending',
        file_name='codes.csv',
        payload_checksum='y' * 64,
    )

    process_payer_service_code_import_job.run(str(job.id))

    job.refresh_from_db()
    assert job.status == 'failed'
    assert 'insurance_claims feature is disabled' in job.error_message
