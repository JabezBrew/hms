from datetime import timedelta
from decimal import Decimal

import pytest
from django.db import connection
from django.test import override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from apps.ai.models import AIArtifact, AIMessage, AISession
from apps.core.tests.factories import DefaultFacilityFactory, FacilityFactory
from apps.laboratory.tests.factories import (
    LabOrderFactory,
    LabOrderTestFactory,
    LabResultFactory,
    LabSpecimenFactory,
    LabTestCatalogFactory,
)
from apps.patients.models import PatientSearch
from apps.users.tests.factories import DoctorUserFactory, PatientProfileFactory


def _auth_client(user, facility):
    client = APIClient()
    token = AccessToken.for_user(user)
    client.credentials(
        HTTP_AUTHORIZATION=f'Bearer {token}',
        HTTP_X_FACILITY_CODE=facility.code,
    )
    return client


def _enable_deployment_features(settings, *features):
    settings.DEPLOYMENT_FEATURES = {
        **getattr(settings, 'DEPLOYMENT_FEATURES', {}),
        **{feature: True for feature in features},
    }


def _create_lab_result(
    *,
    facility,
    patient,
    test=None,
    value='120',
    unit='mg/dL',
    flag='normal',
    reference_low=Decimal('70'),
    reference_high=Decimal('100'),
    performed_at=None,
):
    if test is None:
        test = LabTestCatalogFactory(
            facility=facility,
            code='GLU',
            short_name='GLU',
            unit=unit,
        )

    order = LabOrderFactory(patient=patient, facility=facility, status='completed')
    order_test = LabOrderTestFactory(order=order, facility=facility, test=test, status='completed')
    specimen = LabSpecimenFactory(order=order, facility=facility)
    result = LabResultFactory(
        order_test=order_test,
        specimen=specimen,
        facility=facility,
        value=value,
        unit=unit,
        flag=flag,
        reference_low=reference_low,
        reference_high=reference_high,
        performed_at=performed_at or timezone.now(),
    )
    return result, order, test


@pytest.mark.django_db
@override_settings(AI_ENABLED=True, AI_OMNI_NL_ENABLED=True, TEAM_ACCESS_STRICT=False)
@pytest.mark.parametrize(
    'query, expected_intent',
    [
        ('delete appointment for patient', 'delete.record'),
        ('submit claim for invoice', 'billing_submit.claim'),
        ('grant admin role to user', 'role_change.update'),
        ('export patient chart', 'phi_export.records'),
        ('order lab test for patient', 'order.create'),
    ],
)
def test_omni_parse_sensitive_intents_require_confirmation(settings, query, expected_intent):
    _enable_deployment_features(settings, 'ai_omni_nl')
    facility = DefaultFacilityFactory()
    doctor = DoctorUserFactory(primary_facility=facility)
    doctor.facilities.add(facility)
    client = _auth_client(doctor, facility)

    response = client.post('/api/ai/omni/parse/', {'text': query}, format='json')

    assert response.status_code == status.HTTP_200_OK
    assert response.data['result']['intent_type'] == expected_intent
    assert response.data['result']['requires_confirmation'] is True


@pytest.mark.django_db
@override_settings(AI_ENABLED=True, AI_OMNI_NL_ENABLED=True, TEAM_ACCESS_STRICT=False)
def test_omni_parse_and_preview_have_no_side_effects(settings):
    _enable_deployment_features(settings, 'ai_omni_nl')
    facility = DefaultFacilityFactory()
    doctor = DoctorUserFactory(primary_facility=facility)
    doctor.facilities.add(facility)
    client = _auth_client(doctor, facility)

    sessions_before = AISession.objects.count()
    artifacts_before = AIArtifact.objects.count()
    messages_before = AIMessage.objects.count()
    patient_search_before = PatientSearch.objects.count()

    parse_response = client.post('/api/ai/omni/parse/', {'text': 'open laboratory results'}, format='json')
    preview_response = client.post('/api/ai/omni/execute-preview/', {'text': 'open laboratory results'}, format='json')

    assert parse_response.status_code == status.HTTP_200_OK
    assert preview_response.status_code == status.HTTP_200_OK
    assert preview_response.data['result']['preview']['dry_run'] is True
    assert AISession.objects.count() == sessions_before
    assert AIArtifact.objects.count() == artifacts_before
    assert AIMessage.objects.count() == messages_before
    assert PatientSearch.objects.count() == patient_search_before


@pytest.mark.django_db
@override_settings(AI_ENABLED=True, AI_OMNI_NL_ENABLED=True, TEAM_ACCESS_STRICT=False)
def test_omni_execute_preview_query_budget(settings):
    _enable_deployment_features(settings, 'ai_omni_nl')
    facility = DefaultFacilityFactory()
    doctor = DoctorUserFactory(primary_facility=facility)
    doctor.facilities.add(facility)
    client = _auth_client(doctor, facility)

    with CaptureQueriesContext(connection) as ctx:
        response = client.post('/api/ai/omni/execute-preview/', {'text': 'open laboratory results'}, format='json')

    assert response.status_code == status.HTTP_200_OK
    assert len(ctx) <= 18


@pytest.mark.django_db
@override_settings(AI_ENABLED=True, AI_LAB_INTERPRET_ENABLED=True, TEAM_ACCESS_STRICT=False)
def test_lab_interpret_result_query_budget_and_no_ai_writes():
    facility = DefaultFacilityFactory()
    doctor = DoctorUserFactory(primary_facility=facility)
    doctor.facilities.add(facility)
    patient = PatientProfileFactory(facility=facility, user__primary_facility=facility)

    current_result, _, test = _create_lab_result(
        facility=facility,
        patient=patient,
        value='180',
        flag='high',
        performed_at=timezone.now(),
    )
    _create_lab_result(
        facility=facility,
        patient=patient,
        test=test,
        value='150',
        flag='high',
        performed_at=timezone.now() - timedelta(days=1),
    )

    client = _auth_client(doctor, facility)
    sessions_before = AISession.objects.count()
    artifacts_before = AIArtifact.objects.count()
    messages_before = AIMessage.objects.count()

    with CaptureQueriesContext(connection) as ctx:
        response = client.post(
            '/api/ai/labs/interpret/',
            {'result_id': str(current_result.id), 'audience': 'clinician'},
            format='json',
        )

    assert response.status_code == status.HTTP_200_OK
    assert response.data['result']['advisory_only'] is True
    assert len(ctx) <= 22
    assert AISession.objects.count() == sessions_before
    assert AIArtifact.objects.count() == artifacts_before
    assert AIMessage.objects.count() == messages_before


@pytest.mark.django_db
@override_settings(AI_ENABLED=True, AI_LAB_INTERPRET_ENABLED=True, TEAM_ACCESS_STRICT=False)
def test_lab_interpret_cross_facility_result_returns_404():
    facility_a = FacilityFactory(code='ALPHA')
    facility_b = FacilityFactory(code='BRAVO')
    doctor = DoctorUserFactory(primary_facility=facility_a)
    doctor.facilities.add(facility_a)

    patient_b = PatientProfileFactory(facility=facility_b, user__primary_facility=facility_b)
    result_b, _, _ = _create_lab_result(
        facility=facility_b,
        patient=patient_b,
        value='95',
        flag='normal',
    )

    client = _auth_client(doctor, facility_a)
    response = client.post(
        '/api/ai/labs/interpret/',
        {'result_id': str(result_b.id), 'audience': 'clinician'},
        format='json',
    )

    assert response.status_code == status.HTTP_404_NOT_FOUND
