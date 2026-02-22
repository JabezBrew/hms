from datetime import timedelta
from decimal import Decimal

import pytest
from django.test import override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from apps.ai.models import AIArtifact, AIMessage, AISession
from apps.core.tests.factories import DefaultFacilityFactory
from apps.laboratory.tests.factories import (
    LabOrderFactory,
    LabOrderTestFactory,
    LabResultFactory,
    LabSpecimenFactory,
    LabTestCatalogFactory,
)
from apps.users.tests.factories import DoctorUserFactory, PatientProfileFactory, ReceptionistUserFactory


def _auth_client(user, facility):
    client = APIClient()
    token = AccessToken.for_user(user)
    client.credentials(
        HTTP_AUTHORIZATION=f'Bearer {token}',
        HTTP_X_FACILITY_CODE=facility.code,
    )
    return client


def _create_lab_result(
    *,
    facility,
    patient,
    test=None,
    value='110',
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
@override_settings(
    AI_ENABLED=True,
    AI_OMNI_NL_ENABLED=True,
    AI_LAB_INTERPRET_ENABLED=True,
    TEAM_ACCESS_STRICT=False,
)
def test_omni_parse_returns_fallback_signal_for_low_confidence():
    facility = DefaultFacilityFactory()
    doctor = DoctorUserFactory(primary_facility=facility)
    doctor.facilities.add(facility)

    client = _auth_client(doctor, facility)
    response = client.post('/api/ai/omni/parse/', {'text': 'zqv'}, format='json')

    assert response.status_code == status.HTTP_200_OK
    assert response.data['feature'] == 'omni_nl'
    assert response.data['confidence_band'] == 'fallback'
    assert response.data['result']['fallback_to_legacy'] is True


@pytest.mark.django_db
@override_settings(
    AI_ENABLED=True,
    AI_OMNI_NL_ENABLED=True,
    TEAM_ACCESS_STRICT=False,
)
def test_omni_execute_preview_is_dry_run_and_blocks_sensitive_non_admin():
    facility = DefaultFacilityFactory()
    receptionist = ReceptionistUserFactory(primary_facility=facility)
    receptionist.facilities.add(facility)

    client = _auth_client(receptionist, facility)
    sessions_before = AISession.objects.count()
    artifacts_before = AIArtifact.objects.count()
    messages_before = AIMessage.objects.count()

    response = client.post(
        '/api/ai/omni/execute-preview/',
        {'text': 'grant admin role to user'},
        format='json',
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data['result']['preview']['dry_run'] is True
    assert response.data['result']['preview']['allowed'] is False
    assert response.data['result']['intent']['requires_confirmation'] is True
    assert AISession.objects.count() == sessions_before
    assert AIArtifact.objects.count() == artifacts_before
    assert AIMessage.objects.count() == messages_before


@pytest.mark.django_db
@override_settings(
    AI_ENABLED=True,
    AI_LAB_INTERPRET_ENABLED=True,
    TEAM_ACCESS_STRICT=False,
)
def test_lab_interpret_result_requires_lab_access():
    facility = DefaultFacilityFactory()
    receptionist = ReceptionistUserFactory(primary_facility=facility)
    receptionist.facilities.add(facility)
    patient = PatientProfileFactory(facility=facility, user__primary_facility=facility)
    result, _, _ = _create_lab_result(facility=facility, patient=patient, value='185', flag='high')

    client = _auth_client(receptionist, facility)
    response = client.post(
        '/api/ai/labs/interpret/',
        {'result_id': str(result.id), 'audience': 'clinician'},
        format='json',
    )

    assert response.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.django_db
@override_settings(
    AI_ENABLED=True,
    AI_LAB_INTERPRET_ENABLED=True,
    TEAM_ACCESS_STRICT=False,
)
def test_lab_interpret_result_returns_envelope_and_citations_for_doctor():
    facility = DefaultFacilityFactory()
    doctor = DoctorUserFactory(primary_facility=facility)
    doctor.facilities.add(facility)
    patient = PatientProfileFactory(facility=facility, user__primary_facility=facility)

    current_result, _, test = _create_lab_result(
        facility=facility,
        patient=patient,
        value='185',
        flag='high',
        reference_low=Decimal('70'),
        reference_high=Decimal('100'),
        performed_at=timezone.now(),
    )
    _create_lab_result(
        facility=facility,
        patient=patient,
        test=test,
        value='150',
        flag='high',
        reference_low=Decimal('70'),
        reference_high=Decimal('100'),
        performed_at=timezone.now() - timedelta(days=2),
    )

    client = _auth_client(doctor, facility)
    response = client.post(
        '/api/ai/labs/interpret/',
        {'result_id': str(current_result.id), 'audience': 'clinician'},
        format='json',
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data['feature'] == 'lab_interpretation'
    assert response.data['requires_human_review'] is True
    assert response.data['result']['mode'] == 'result'
    assert response.data['result']['result']['advisory_only'] is True
    assert response.data['result']['safety_notice']
    assert response.data['citations']


@pytest.mark.django_db
@override_settings(
    AI_ENABLED=True,
    AI_LAB_INTERPRET_ENABLED=True,
    TEAM_ACCESS_STRICT=False,
)
def test_lab_interpret_order_uses_worst_case_confidence_band():
    facility = DefaultFacilityFactory()
    doctor = DoctorUserFactory(primary_facility=facility)
    doctor.facilities.add(facility)
    patient = PatientProfileFactory(facility=facility, user__primary_facility=facility)

    _, order, _ = _create_lab_result(
        facility=facility,
        patient=patient,
        value='positive',
        unit='qualitative',
        flag='abnormal',
        reference_low=None,
        reference_high=None,
    )

    # Move the normal result to the same order so the endpoint interprets a batch.
    normal_test = LabTestCatalogFactory(facility=facility, code='ALT', short_name='ALT', unit='U/L')
    order_test = LabOrderTestFactory(order=order, facility=facility, test=normal_test, status='completed')
    specimen = LabSpecimenFactory(order=order, facility=facility)
    LabResultFactory(
        order_test=order_test,
        specimen=specimen,
        facility=facility,
        value='32',
        unit='U/L',
        flag='normal',
        reference_low=Decimal('5'),
        reference_high=Decimal('40'),
        performed_at=timezone.now(),
    )

    client = _auth_client(doctor, facility)
    response = client.post(
        '/api/ai/labs/interpret/',
        {'order_id': str(order.id), 'audience': 'clinician'},
        format='json',
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data['result']['mode'] == 'order'
    assert response.data['result']['result_count'] >= 2
    assert response.data['confidence_band'] in {'needs_review', 'advisory'}
    assert response.data['result']['suggested_next_checks']
