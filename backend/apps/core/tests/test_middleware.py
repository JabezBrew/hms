import pytest
import json
from django.test import RequestFactory
from rest_framework.exceptions import AuthenticationFailed

from hms_backend.auth_utils import get_access_context
from hms_backend.middleware import FacilityContextMiddleware, JWTAuthentication, _scrub_path, get_client_ip
from apps.core.tests.factories import DefaultFacilityFactory, FacilityFactory
from apps.users.tests.factories import AdminUserFactory, UserFactory


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


def test_deployment_capabilities_endpoint_does_not_require_facility_context(settings):
    settings.FACILITY_CONTEXT_REQUIRED = True
    settings.DEFAULT_FACILITY_CODE = None

    request = RequestFactory().get('/api/settings/deployment-capabilities/')
    middleware = FacilityContextMiddleware(lambda req: None)

    response = middleware.process_request(request)

    assert response is None
    assert request.facility is None
    assert request.facility_code is None


def test_disabled_feature_api_prefix_is_blocked(settings):
    settings.FACILITY_CONTEXT_REQUIRED = False
    settings.DEPLOYMENT_FEATURES = {'wards': False}

    request = RequestFactory().get('/api/wards/wards/')
    middleware = FacilityContextMiddleware(lambda req: None)

    response = middleware.process_request(request)

    assert response is not None
    assert response.status_code == 404
    body = json.loads(response.content.decode('utf-8'))
    assert body.get('code') == 'feature_disabled'
    assert body.get('feature') == 'wards'


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
    assert body.get('code') == 'facility_unavailable'


@pytest.mark.django_db
def test_facility_context_middleware_denies_facility_admin_cross_facility(
    monkeypatch, settings
):
    settings.FACILITY_CONTEXT_REQUIRED = False
    settings.DEFAULT_FACILITY_CODE = None
    settings.ALLOW_CROSS_FACILITY_ACCESS = True

    facility_a = DefaultFacilityFactory(code='FACILITYA')
    facility_b = FacilityFactory(code='FACILITYB')
    admin = UserFactory(
        user_type='admin',
        is_staff=True,
        is_superuser=False,
        primary_facility=facility_a,
    )

    request = RequestFactory().get(
        '/api/settings/deployment-capabilities/',
        HTTP_AUTHORIZATION='Bearer valid-token',
        HTTP_X_FACILITY_CODE=facility_b.code,
    )

    middleware = FacilityContextMiddleware(lambda req: None)

    monkeypatch.setattr(JWTAuthentication, 'get_header', lambda self, req: b'Bearer valid-token')
    monkeypatch.setattr(JWTAuthentication, 'get_raw_token', lambda self, header: b'valid-token')
    monkeypatch.setattr(
        JWTAuthentication,
        'get_validated_token',
        lambda self, raw: {'user_id': str(admin.id), 'facility_code': facility_b.code},
    )
    monkeypatch.setattr(JWTAuthentication, 'get_user', lambda self, validated_token: admin)

    response = middleware.process_request(request)

    assert response is not None
    assert response.status_code == 403
    body = json.loads(response.content.decode('utf-8'))
    assert body.get('code') == 'facility_unavailable'


@pytest.mark.django_db
def test_facility_context_middleware_allows_platform_admin_cross_facility(
    monkeypatch, settings
):
    settings.FACILITY_CONTEXT_REQUIRED = False
    settings.DEFAULT_FACILITY_CODE = None
    settings.ALLOW_CROSS_FACILITY_ACCESS = True

    facility_a = DefaultFacilityFactory(code='PLATFORMA')
    facility_b = FacilityFactory(code='PLATFORMB')
    admin = AdminUserFactory(primary_facility=facility_a)

    request = RequestFactory().get(
        '/api/settings/deployment-capabilities/',
        HTTP_AUTHORIZATION='Bearer valid-token',
        HTTP_X_FACILITY_CODE=facility_b.code,
    )

    middleware = FacilityContextMiddleware(lambda req: None)

    monkeypatch.setattr(JWTAuthentication, 'get_header', lambda self, req: b'Bearer valid-token')
    monkeypatch.setattr(JWTAuthentication, 'get_raw_token', lambda self, header: b'valid-token')
    monkeypatch.setattr(
        JWTAuthentication,
        'get_validated_token',
        lambda self, raw: {'user_id': str(admin.id), 'facility_code': facility_b.code},
    )
    monkeypatch.setattr(JWTAuthentication, 'get_user', lambda self, validated_token: admin)

    response = middleware.process_request(request)

    assert response is None
    assert request.facility_code == facility_b.code
    assert request.allow_cross_facility is True


def test_get_client_ip_uses_single_forwarded_hop_when_proxy_headers_are_trusted(settings):
    settings.TRUST_PROXY_HEADERS = True
    settings.TRUSTED_PROXY_HOPS = 1
    request = RequestFactory().get(
        '/api/health/',
        HTTP_X_FORWARDED_FOR='203.0.113.10',
        REMOTE_ADDR='10.0.0.5',
    )

    assert get_client_ip(request) == '203.0.113.10'


def test_api_path_scrubbing_redacts_identifiers_before_truncating():
    scrubbed = _scrub_path('/api/patients/00000000-0000-0000-0000-000000000000/get_patient/')

    assert scrubbed == '/api/patients/<id>/<path>'
    assert '00000000-0000-0000-0000-000000000000' not in scrubbed


def test_get_access_context_uses_trusted_forwarded_client_ip(monkeypatch, settings):
    settings.TRUST_PROXY_HEADERS = True
    settings.TRUSTED_PROXY_HOPS = 1
    request = RequestFactory().get(
        '/api/auth/login/',
        HTTP_X_FORWARDED_FOR='203.0.113.10',
        REMOTE_ADDR='10.0.0.5',
    )
    seen = {}

    def fake_is_ip_on_site(*args):
        ip = args[-1]
        seen['ip'] = ip
        return True

    monkeypatch.setattr('apps.core.models.SiteNetwork.is_ip_on_site', fake_is_ip_on_site)

    context = get_access_context(request)

    assert seen['ip'] == '203.0.113.10'
    assert context['is_offsite'] is False
