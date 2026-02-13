import pytest
from django.test import Client, override_settings


def test_secure_redirect_exempt_includes_healthcheck(settings):
    assert r'^api/health/$' in settings.SECURE_REDIRECT_EXEMPT


@pytest.mark.django_db
@override_settings(
    SECURE_SSL_REDIRECT=True,
    SECURE_REDIRECT_EXEMPT=[r'^api/health/$'],
    ALLOWED_HOSTS=['testserver'],
)
def test_healthcheck_path_is_not_redirected_when_ssl_redirect_enabled():
    response = Client().get('/api/health/', follow=False)

    assert response.status_code == 200
    assert response.json()['status'] == 'healthy'


@pytest.mark.django_db
@override_settings(
    SECURE_SSL_REDIRECT=True,
    SECURE_REDIRECT_EXEMPT=[r'^api/health/$'],
    ALLOWED_HOSTS=['testserver'],
)
def test_non_healthcheck_path_still_redirects_to_https():
    response = Client().get('/api/auth/login/', follow=False)

    assert response.status_code == 301
    assert response['Location'].startswith('https://testserver/api/auth/login/')
