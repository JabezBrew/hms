"""
Optional OpenTelemetry tracing setup for HMS.

Tracing is disabled by default. Keep imports lazy so local/dev/test startup does
not require the OpenTelemetry packages unless tracing is explicitly enabled.
"""
from __future__ import annotations

import logging
import os


logger = logging.getLogger(__name__)
_CONFIGURED = False


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def configure_tracing() -> None:
    global _CONFIGURED

    if _CONFIGURED:
        return
    _CONFIGURED = True

    if not _env_bool("HMS_OTEL_TRACING_ENABLED", default=False):
        return

    if not (
        os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT")
        or os.environ.get("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT")
    ):
        logger.warning("OpenTelemetry tracing is enabled without an OTLP endpoint; tracing is disabled.")
        return

    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.instrumentation.django import DjangoInstrumentor
        from opentelemetry.instrumentation.psycopg2 import Psycopg2Instrumentor
        from opentelemetry.instrumentation.requests import RequestsInstrumentor
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
    except Exception:
        logger.exception("OpenTelemetry tracing is enabled but required packages are unavailable.")
        return

    service_name = os.environ.get("OTEL_SERVICE_NAME") or "hms-api"
    resource = Resource.create(
        {
            "service.name": service_name,
            "deployment.environment": os.environ.get("OBS_ENVIRONMENT") or os.environ.get("DEPLOYMENT_MODE") or "unknown",
            "hms.client": os.environ.get("CLIENT_SLUG") or "unknown",
        }
    )

    provider = TracerProvider(resource=resource)
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(provider)

    DjangoInstrumentor().instrument()
    RequestsInstrumentor().instrument()
    Psycopg2Instrumentor().instrument()
