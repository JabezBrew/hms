import pytest
from django.test import RequestFactory
from rest_framework.exceptions import AuthenticationFailed

from hms_backend.middleware import FacilityContextMiddleware, JWTAuthentication


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
