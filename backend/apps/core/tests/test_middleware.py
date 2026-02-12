import pytest
import json
from django.test import RequestFactory
from rest_framework.exceptions import AuthenticationFailed

from hms_backend.middleware import FacilityContextMiddleware, JWTAuthentication
from apps.core.tests.factories import DefaultFacilityFactory
from apps.users.tests.factories import UserFactory


@pytest.mark.django_db
def test_facility_context_middleware_handles_authentication_failed(monkeypatch, settings):
    settings.FACILITY_CONTEXT_REQUIRED = False
    settings.DEFAULT_FACILITY_CODE = None

    request = RequestFactory().get(
        '/api/settings/deployment-capabilities/',
        HTTP_AUTHORIZATION='Bearer stale-token',
    )

    middleware = FacilityContextMiddleware(lambda req: None)

    monkeypatch.setattr(JWTAuthentication, 'get_header', lambda self, req: b'Bearer stale-token')
    monkeypatch.setattr(JWTAuthentication, 'get_raw_token', lambda self, header: b'stale-token')
    monkeypatch.setattr(JWTAuthentication, 'get_validated_token', lambda self, raw: {'user_id': 'deadbeef'})

    def _raise_authentication_failed(self, validated_token):
        raise AuthenticationFailed("User not found")

    monkeypatch.setattr(JWTAuthentication, 'get_user', _raise_authentication_failed)

    response = middleware.process_request(request)

    assert response is None
    assert request.facility is None
    assert request.facility_code is None


@pytest.mark.django_db
def test_facility_context_middleware_denies_authenticated_user_without_facility_assignments(
    monkeypatch, settings
):
    settings.FACILITY_CONTEXT_REQUIRED = False
    settings.DEFAULT_FACILITY_CODE = None
    settings.ALLOW_CROSS_FACILITY_ACCESS = False

    facility = DefaultFacilityFactory()
    user = UserFactory(primary_facility=None)

    request = RequestFactory().get(
        '/api/settings/deployment-capabilities/',
        HTTP_AUTHORIZATION='Bearer valid-token',
        HTTP_X_FACILITY_CODE=facility.code,
    )

    middleware = FacilityContextMiddleware(lambda req: None)

    monkeypatch.setattr(JWTAuthentication, 'get_header', lambda self, req: b'Bearer valid-token')
    monkeypatch.setattr(JWTAuthentication, 'get_raw_token', lambda self, header: b'valid-token')
    monkeypatch.setattr(
        JWTAuthentication,
        'get_validated_token',
        lambda self, raw: {'user_id': str(user.id), 'facility_code': facility.code},
    )
    monkeypatch.setattr(JWTAuthentication, 'get_user', lambda self, validated_token: user)

    response = middleware.process_request(request)

    assert response is not None
    assert response.status_code == 403
    body = json.loads(response.content.decode('utf-8'))
    assert body.get('code') == 'facility_forbidden'
