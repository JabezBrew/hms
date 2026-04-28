import pytest

from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.core import views as core_views
from apps.core.tests.factories import DefaultFacilityFactory
from apps.users.tests.factories import AdminUserFactory


def _auth_client(user, facility):
    client = APIClient()
    refresh = RefreshToken.for_user(user)
    client.credentials(
        HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}',
        HTTP_X_FACILITY_CODE=facility.code,
    )
    return client


@pytest.mark.django_db
def test_metrics_endpoint_is_public(client):
    response = client.get('/api/metrics/')

    assert response.status_code == status.HTTP_200_OK
    assert 'text/plain' in response['Content-Type']
    assert 'process_start_time_seconds' in response.content.decode('utf-8')


@pytest.mark.django_db
def test_celery_operability_endpoint_requires_admin(client):
    response = client.get('/api/system/jobs/')

    assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
def test_admin_can_fetch_celery_operability(monkeypatch):
    facility = DefaultFacilityFactory()
    admin = AdminUserFactory(primary_facility=facility)
    client = _auth_client(admin, facility)

    monkeypatch.setattr(
        'apps.core.views._collect_celery_operability',
        lambda: {
            'worker_count': 1,
            'workers': {
                'worker@test': {
                    'active_count': 0,
                    'scheduled_count': 1,
                    'reserved_count': 0,
                    'pool_max_concurrency': 4,
                    'uptime_seconds': 60,
                    'processed_total': 12,
                }
            },
            'queue_depths': {'default': 2},
            'aggregates': {
                'active_tasks': 0,
                'scheduled_tasks': 1,
                'reserved_tasks': 0,
                'queue_depth_total': 2,
            },
        },
    )

    response = client.get('/api/system/jobs/')

    assert response.status_code == status.HTTP_200_OK
    assert response.data['facility_scope'] == facility.code
    assert response.data['celery']['worker_count'] == 1
    assert response.data['celery']['queue_depths']['default'] == 2


def test_check_cache_uses_unique_probe_keys(monkeypatch):
    recorded_keys = []

    class RecordingCache:
        def __init__(self):
            self._store = {}

        def set(self, key, value, timeout=None):
            recorded_keys.append(key)
            self._store[key] = value

        def get(self, key):
            return self._store.get(key)

        def delete(self, key):
            self._store.pop(key, None)
            return True

    monkeypatch.setattr(core_views, 'cache', RecordingCache())

    first_ok, _, _ = core_views._check_cache()
    second_ok, _, _ = core_views._check_cache()

    assert first_ok is True
    assert second_ok is True
    assert len(recorded_keys) == 2
    assert recorded_keys[0] != recorded_keys[1]
