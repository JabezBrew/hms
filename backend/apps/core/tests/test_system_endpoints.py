import pytest

from django.core.cache import cache
from rest_framework import status

from apps.core import observability
from apps.core import views as core_views
from apps.core.observability import (
    CELERY_OPERABILITY_CACHE_KEY,
    CELERY_OPERABILITY_STALE_CACHE_KEY,
    cache_celery_operability,
)


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


@pytest.mark.django_db
def test_metrics_endpoint_uses_cached_celery_operability(client, monkeypatch):
    monkeypatch.setattr(
        core_views,
        'get_cached_celery_operability',
        lambda: {
            'ok': True,
            'stale': False,
            'collection_duration_seconds': 0.023,
            'worker_count': 2,
            'workers': {},
            'queue_depths': {'default': 3},
            'aggregates': {
                'active_tasks': 1,
                'scheduled_tasks': 0,
                'reserved_tasks': 0,
                'queue_depth_total': 3,
            },
        },
    )

    def fail_if_dependency_snapshot_runs():
        raise AssertionError('metrics endpoint must not run dependency probes synchronously')

    monkeypatch.setattr(core_views, '_dependency_snapshot', fail_if_dependency_snapshot_runs)

    response = client.get('/api/metrics/')
    body = response.content.decode('utf-8')

    assert response.status_code == status.HTTP_200_OK
    assert 'hms_celery_workers 2.0' in body
    assert 'hms_celery_queue_depth{queue="default"} 3.0' in body


@pytest.mark.django_db
def test_health_ready_updates_readiness_metric_consumed_by_metrics(client, monkeypatch):
    monkeypatch.setattr(core_views, '_check_database', lambda: (True, 0.001, None))
    monkeypatch.setattr(core_views, '_check_cache', lambda: (True, 0.001, None))

    ready_response = client.get('/api/health/ready/')
    metrics_response = client.get('/api/metrics/')
    metrics_body = metrics_response.content.decode('utf-8')

    assert ready_response.status_code == status.HTTP_200_OK
    assert 'hms_health_ready 1.0' in metrics_body
    assert 'hms_dependency_snapshot_timestamp_seconds' in metrics_body


def test_collect_celery_operability_keeps_partial_data_when_inspect_call_fails(monkeypatch):
    class PartialInspector:
        def stats(self):
            return {
                'worker@hms': {
                    'pool': {'max-concurrency': 4},
                    'uptime': 120,
                    'total': {'apps.core.tasks.refresh_celery_operability_metrics': 3},
                },
            }

        def active(self):
            raise TimeoutError

        def scheduled(self):
            return {'worker@hms': [{}, {}]}

        def reserved(self):
            return {'worker@hms': [{}]}

    class PartialControl:
        def inspect(self, timeout):
            assert timeout > 0
            return PartialInspector()

    monkeypatch.setattr(observability.celery_app, 'control', PartialControl())
    monkeypatch.setattr(observability, '_redis_queue_depths', lambda: {'default': 7})

    payload = observability.collect_celery_operability()

    assert payload['ok'] is False
    assert payload['stale'] is False
    assert 'active:TimeoutError' in payload['error']
    assert payload['worker_count'] == 1
    assert payload['workers']['worker@hms']['active_count'] == 0
    assert payload['workers']['worker@hms']['scheduled_count'] == 2
    assert payload['workers']['worker@hms']['reserved_count'] == 1
    assert payload['queue_depths'] == {'default': 7}


def test_cache_celery_operability_writes_fresh_and_stale_entries():
    payload = {
        'ok': True,
        'stale': False,
        'collection_duration_seconds': 0.01,
        'worker_count': 1,
        'workers': {},
        'queue_depths': {},
        'aggregates': {},
    }

    cache_celery_operability(payload)

    assert cache.get(CELERY_OPERABILITY_CACHE_KEY) == payload
    assert cache.get(CELERY_OPERABILITY_STALE_CACHE_KEY) == payload


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
