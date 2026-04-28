import pytest

from rest_framework import status

from apps.core import views as core_views


@pytest.mark.django_db
def test_metrics_endpoint_is_public(client):
    response = client.get('/api/metrics/')

    assert response.status_code == status.HTTP_200_OK
    assert 'text/plain' in response['Content-Type']
    assert 'process_start_time_seconds' in response.content.decode('utf-8')


@pytest.mark.django_db
def test_celery_operability_endpoint_is_not_exposed(client):
    response = client.get('/api/system/jobs/')

    assert response.status_code == status.HTTP_404_NOT_FOUND


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
