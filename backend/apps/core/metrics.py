"""
Lightweight in-process metrics helpers with Prometheus text exposition.

These metrics are intentionally minimal and avoid per-request network I/O.
They are suitable for pod-level scraping and short-lived operational counters.
"""
from __future__ import annotations

import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Iterable

from django.db import connections


PROCESS_START_TIME = time.time()
DEFAULT_HISTOGRAM_BUCKETS = (
    0.001,
    0.005,
    0.01,
    0.025,
    0.05,
    0.1,
    0.25,
    0.5,
    1.0,
    2.5,
    5.0,
    10.0,
)

_REGISTRY_LOCK = threading.Lock()
_METRIC_DEFINITIONS: dict[str, tuple[str, str]] = {}
_COUNTERS: dict[tuple[str, tuple[tuple[str, str], ...]], float] = {}
_GAUGES: dict[tuple[str, tuple[tuple[str, str], ...]], float] = {}
_HISTOGRAMS: dict[tuple[str, tuple[tuple[str, str], ...]], "_HistogramState"] = {}


def _normalize_labels(labels: dict[str, str] | None) -> tuple[tuple[str, str], ...]:
    if not labels:
        return ()
    return tuple(
        sorted((str(key), str(value)) for key, value in labels.items())
    )


def _labels_to_text(labels: tuple[tuple[str, str], ...]) -> str:
    if not labels:
        return ""
    serialized = ",".join(f'{key}="{value}"' for key, value in labels)
    return f"{{{serialized}}}"


def _register_metric(name: str, metric_type: str, description: str) -> None:
    with _REGISTRY_LOCK:
        existing = _METRIC_DEFINITIONS.get(name)
        if existing is None:
            _METRIC_DEFINITIONS[name] = (metric_type, description)
            return
        existing_type, existing_description = existing
        if existing_type != metric_type:
            raise ValueError(f"Metric {name!r} already registered as {existing_type!r}")
        if not existing_description and description:
            _METRIC_DEFINITIONS[name] = (metric_type, description)


def inc_counter(
    name: str,
    amount: float = 1.0,
    *,
    labels: dict[str, str] | None = None,
    description: str = "",
) -> None:
    metric_key = (name, _normalize_labels(labels))
    _register_metric(name, "counter", description)
    with _REGISTRY_LOCK:
        _COUNTERS[metric_key] = _COUNTERS.get(metric_key, 0.0) + float(amount)


def set_gauge(
    name: str,
    value: float,
    *,
    labels: dict[str, str] | None = None,
    description: str = "",
) -> None:
    metric_key = (name, _normalize_labels(labels))
    _register_metric(name, "gauge", description)
    with _REGISTRY_LOCK:
        _GAUGES[metric_key] = float(value)


@dataclass
class _HistogramState:
    buckets: tuple[float, ...]
    bucket_counts: dict[float, float] = field(default_factory=dict)
    total_count: float = 0.0
    total_sum: float = 0.0

    def observe(self, value: float) -> None:
        self.total_count += 1.0
        self.total_sum += value
        for bucket in self.buckets:
            if value <= bucket:
                self.bucket_counts[bucket] = self.bucket_counts.get(bucket, 0.0) + 1.0


def observe_histogram(
    name: str,
    value: float,
    *,
    labels: dict[str, str] | None = None,
    description: str = "",
    buckets: Iterable[float] | None = None,
) -> None:
    metric_labels = _normalize_labels(labels)
    metric_key = (name, metric_labels)
    normalized_buckets = tuple(sorted(float(bucket) for bucket in (buckets or DEFAULT_HISTOGRAM_BUCKETS)))
    _register_metric(name, "histogram", description)

    with _REGISTRY_LOCK:
        state = _HISTOGRAMS.get(metric_key)
        if state is None:
            state = _HistogramState(buckets=normalized_buckets)
            _HISTOGRAMS[metric_key] = state
        elif state.buckets != normalized_buckets:
            raise ValueError(f"Histogram {name!r} bucket definition changed for labels {metric_labels!r}")
        state.observe(float(value))


@contextmanager
def measure_duration(
    name: str,
    *,
    labels: dict[str, str] | None = None,
    description: str = "",
    buckets: Iterable[float] | None = None,
):
    start = time.perf_counter()
    try:
        yield
    finally:
        observe_histogram(
            name,
            time.perf_counter() - start,
            labels=labels,
            description=description,
            buckets=buckets,
        )


class _QueryCounter:
    def __init__(self):
        self.count = 0

    def __call__(self, execute, sql, params, many, context):
        self.count += 1
        return execute(sql, params, many, context)


@contextmanager
def track_query_count(using: str = "default"):
    """
    Count SQL statements executed through Django's connection wrapper.

    This works in production without enabling DEBUG query logging.
    """
    tracker = _QueryCounter()
    with connections[using].execute_wrapper(tracker):
        yield tracker


def render_prometheus_metrics(extra_lines: list[str] | None = None) -> str:
    with _REGISTRY_LOCK:
        definitions = dict(_METRIC_DEFINITIONS)
        counters = dict(_COUNTERS)
        gauges = dict(_GAUGES)
        histograms = {
            key: _HistogramState(
                buckets=value.buckets,
                bucket_counts=dict(value.bucket_counts),
                total_count=value.total_count,
                total_sum=value.total_sum,
            )
            for key, value in _HISTOGRAMS.items()
        }

    lines = [
        "# HELP process_start_time_seconds Unix time when this process started.",
        "# TYPE process_start_time_seconds gauge",
        f"process_start_time_seconds {PROCESS_START_TIME:.6f}",
    ]

    for metric_name, (metric_type, description) in sorted(definitions.items()):
        help_text = description or metric_name.replace("_", " ")
        lines.append(f"# HELP {metric_name} {help_text}")
        lines.append(f"# TYPE {metric_name} {metric_type}")

        if metric_type == "counter":
            for (name, labels), value in sorted(counters.items()):
                if name != metric_name:
                    continue
                lines.append(f"{name}{_labels_to_text(labels)} {value}")
        elif metric_type == "gauge":
            for (name, labels), value in sorted(gauges.items()):
                if name != metric_name:
                    continue
                lines.append(f"{name}{_labels_to_text(labels)} {value}")
        elif metric_type == "histogram":
            for (name, labels), state in sorted(histograms.items()):
                if name != metric_name:
                    continue
                cumulative = 0.0
                for bucket in state.buckets:
                    cumulative = state.bucket_counts.get(bucket, cumulative)
                    bucket_labels = labels + (("le", str(bucket)),)
                    lines.append(
                        f"{name}_bucket{_labels_to_text(bucket_labels)} {cumulative}"
                    )
                inf_labels = labels + (("le", "+Inf"),)
                lines.append(
                    f"{name}_bucket{_labels_to_text(inf_labels)} {state.total_count}"
                )
                lines.append(f"{name}_sum{_labels_to_text(labels)} {state.total_sum}")
                lines.append(f"{name}_count{_labels_to_text(labels)} {state.total_count}")

    if extra_lines:
        lines.extend(extra_lines)
    return "\n".join(lines) + "\n"
