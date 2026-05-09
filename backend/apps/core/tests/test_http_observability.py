import json
import re
import uuid

import pytest
from django.http import JsonResponse
from django.test import Client, override_settings
from django.urls import path

from apps.core.metrics import render_prometheus_metrics, reset_metrics_for_tests
from apps.core.views import health_ready, metrics_view
from hms_backend.logging_utils import JsonLogFormatter
from hms_backend.middleware import _scrub_path, reset_http_observability_state_for_tests


def observed_view(request, patient_id=None):
    return JsonResponse({'ok': True, 'patient_id_seen': bool(patient_id)})


urlpatterns = [
    path('api/health/ready/', health_ready, name='health_ready'),
    path('api/metrics/', metrics_view, name='metrics'),
    path('api/observability/ping/', observed_view, name='observability-ping'),
    path('api/patients/<uuid:patient_id>/summary/', observed_view, name='patient-summary'),
]


@pytest.fixture(autouse=True)
def reset_observability_metrics():
    reset_metrics_for_tests()
    reset_http_observability_state_for_tests()
    yield
    reset_metrics_for_tests()
    reset_http_observability_state_for_tests()


@pytest.fixture
def observability_client():
    with override_settings(
        ROOT_URLCONF=__name__,
        MIDDLEWARE=['hms_backend.middleware.RequestLoggingMiddleware'],
    ):
        yield Client()


def test_http_metrics_increment_with_safe_route_labels(observability_client):
    response = observability_client.get('/api/observability/ping/')

    body = render_prometheus_metrics()

    assert response.status_code == 200
    assert (
        'hms_http_requests_total{method="GET",route="/api/observability/ping",'
        'status_class="2xx",status_code="200"} 1.0'
    ) in body
    assert 'hms_http_request_duration_seconds_bucket{' in body
    assert 'hms_http_response_size_bytes_bucket{' in body
    assert 'hms_http_in_flight_requests 0.0' in body


def test_http_metric_route_label_does_not_include_ids_or_query_strings(observability_client):
    patient_id = uuid.uuid4()

    observability_client.get(
        f'/api/patients/{patient_id}/summary/?patient_id={patient_id}&search=free-text'
    )

    body = render_prometheus_metrics()

    assert 'route="/api/patients/<uuid:patient_id>/summary"' in body
    assert str(patient_id) not in body
    assert 'free-text' not in body
    assert 'patient_id=' not in body


def test_scrubbed_path_masks_short_numeric_ids_for_metric_fallback():
    assert _scrub_path('/api/patients/12/summary/') == '/api/patients/<id>/<path>'


def test_excluded_paths_do_not_emit_http_metrics(observability_client, monkeypatch):
    monkeypatch.setattr('apps.core.views._check_database', lambda: (True, 0.001, None))
    monkeypatch.setattr('apps.core.views._check_cache', lambda: (True, 0.001, None))

    health_response = observability_client.get('/api/health/ready/')
    metrics_response = observability_client.get('/api/metrics/')
    body = metrics_response.content.decode('utf-8')

    assert health_response.status_code == 200
    assert metrics_response.status_code == 200
    assert 'hms_http_requests_total' not in body
    assert 'hms_http_request_duration_seconds' not in body
    assert 'hms_http_response_size_bytes' not in body


def test_request_id_header_is_echoed_when_safe(observability_client):
    response = observability_client.get(
        '/api/observability/ping/',
        HTTP_X_REQUEST_ID='req-123.safe:abc',
    )

    assert response['X-Request-ID'] == 'req-123.safe:abc'


def test_unsafe_request_id_header_is_replaced(observability_client):
    response = observability_client.get(
        '/api/observability/ping/',
        HTTP_X_REQUEST_ID='unsafe request id with spaces and a patient name',
    )

    assert response['X-Request-ID'] != 'unsafe request id with spaces and a patient name'
    assert re.fullmatch(
        r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
        response['X-Request-ID'],
    )


def test_logs_include_flat_safe_fields(observability_client, monkeypatch):
    log_events = []

    class RecordingLogger:
        def info(self, message, extra=None):
            log_events.append((message, extra or {}))

    monkeypatch.setattr('hms_backend.middleware.logger', RecordingLogger())

    response = observability_client.get(
        '/api/observability/ping/',
        HTTP_X_REQUEST_ID='req-log-1',
    )

    finished_records = [
        extra for message, extra in log_events if message == 'http_request_finished'
    ]

    assert response.status_code == 200
    assert finished_records
    record = finished_records[-1]
    assert record['request_id'] == 'req-log-1'
    assert record['http_method'] == 'GET'
    assert record['http_path'] == '/api/observability/ping'
    assert record['http_route'] == '/api/observability/ping'
    assert record['status_code'] == 200
    assert 'user_id' not in record


def test_json_formatter_emits_safe_extra_fields_at_top_level():
    formatter = JsonLogFormatter()
    record = __import__('logging').LogRecord(
        name='django.request',
        level=20,
        pathname=__file__,
        lineno=1,
        msg='http_request_finished',
        args=(),
        exc_info=None,
    )
    record.request_id = 'req-json-1'
    record.http_method = 'GET'
    record.http_route = '/api/observability/ping'
    record.status_code = 200
    record.user_id = 'must-not-render'

    payload = json.loads(formatter.format(record))

    assert payload['request_id'] == 'req-json-1'
    assert payload['http_method'] == 'GET'
    assert payload['http_route'] == '/api/observability/ping'
    assert payload['status_code'] == 200
    assert 'user_id' not in payload
