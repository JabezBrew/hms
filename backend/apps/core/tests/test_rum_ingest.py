import pytest
from rest_framework import status


def _event(**overrides):
    payload = {
        'type': 'api',
        'name': 'duration',
        'route': '/patients/PAT-928374/chronicle?tab=labs',
        'method': 'GET',
        'status': '200',
        'value': 42,
        'ts': 1700000000000,
    }
    payload.update(overrides)
    return payload


@pytest.mark.django_db
def test_rum_ingest_requires_authentication(api_client):
    response = api_client.post(
        '/api/observability/rum/',
        {'events': [_event(route='/patients/:id/chronicle')]},
        format='json',
    )

    assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
def test_rum_ingest_validates_event_shape(authenticated_client):
    response = authenticated_client.post(
        '/api/observability/rum/',
        {'events': [{'type': 'api', 'name': 'duration'}]},
        format='json',
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_rum_ingest_enforces_batch_limit(authenticated_client):
    response = authenticated_client.post(
        '/api/observability/rum/',
        {'events': [_event(route='/patients/:id/chronicle') for _ in range(21)]},
        format='json',
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_rum_ingest_rejects_raw_query_labels(authenticated_client):
    response = authenticated_client.post(
        '/api/observability/rum/',
        {'events': [_event()]},
        format='json',
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_rum_ingest_scrubs_dynamic_route_labels_and_emits_metrics(authenticated_client, monkeypatch):
    counters = []
    histograms = []

    def fake_inc_counter(name, amount=1.0, *, labels=None, description=''):
        counters.append((name, amount, labels, description))

    def fake_observe_histogram(name, value, *, labels=None, description='', buckets=None):
        histograms.append((name, value, labels, description, buckets))

    monkeypatch.setattr('apps.core.views.inc_counter', fake_inc_counter)
    monkeypatch.setattr('apps.core.views.observe_histogram', fake_observe_histogram)

    response = authenticated_client.post(
        '/api/observability/rum/',
        {'events': [_event(route='/patients/PAT-928374/chronicle')]},
        format='json',
    )

    assert response.status_code == status.HTTP_204_NO_CONTENT
    assert counters[0][0] == 'hms_browser_rum_events_total'
    assert counters[0][2] == {
        'type': 'api',
        'name': 'duration',
        'route': '/patients/:id/chronicle',
        'method': 'get',
        'status': '200',
    }
    assert histograms[0][0] == 'hms_browser_rum_duration_seconds'
    assert histograms[0][1] == 0.042
