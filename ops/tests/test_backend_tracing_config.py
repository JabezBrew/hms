from __future__ import annotations

import builtins
import importlib.util
from pathlib import Path


# Legacy Django ops test. Active Rust V2 runtime lives under backend-rs/.
REPO_ROOT = Path(__file__).resolve().parents[2]
TRACING_PATH = REPO_ROOT / 'backend' / 'hms_backend' / 'tracing.py'


def _load_tracing_module():
    spec = importlib.util.spec_from_file_location('hms_backend_tracing_test_module', TRACING_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_tracing_disabled_does_not_import_opentelemetry(monkeypatch):
    monkeypatch.delenv('HMS_OTEL_TRACING_ENABLED', raising=False)
    tracing = _load_tracing_module()

    original_import = builtins.__import__

    def guarded_import(name, *args, **kwargs):
        if name.startswith('opentelemetry'):
            raise AssertionError('disabled tracing must not import OpenTelemetry')
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, '__import__', guarded_import)

    tracing.configure_tracing()

    assert tracing._CONFIGURED is True


def test_tracing_enabled_without_endpoint_does_not_import_opentelemetry(monkeypatch):
    monkeypatch.setenv('HMS_OTEL_TRACING_ENABLED', 'true')
    monkeypatch.delenv('OTEL_EXPORTER_OTLP_ENDPOINT', raising=False)
    monkeypatch.delenv('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT', raising=False)
    tracing = _load_tracing_module()

    original_import = builtins.__import__

    def guarded_import(name, *args, **kwargs):
        if name.startswith('opentelemetry'):
            raise AssertionError('tracing without endpoint must not import OpenTelemetry')
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, '__import__', guarded_import)

    tracing.configure_tracing()

    assert tracing._CONFIGURED is True
