import time
from urllib.parse import urlparse

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

from redis import Redis

from hms_backend.celery import app as celery_app
from .metrics import set_gauge


CELERY_OPERABILITY_CACHE_KEY = "observability:celery_operability:v1"
CELERY_OPERABILITY_STALE_CACHE_KEY = f"{CELERY_OPERABILITY_CACHE_KEY}:stale"


def _empty_celery_operability(*, stale=True, error="not_collected"):
    return {
        "ok": False,
        "stale": stale,
        "error": error,
        "collected_at": None,
        "collection_duration_seconds": 0.0,
        "worker_count": 0,
        "workers": {},
        "queue_depths": {},
        "aggregates": {
            "active_tasks": 0,
            "scheduled_tasks": 0,
            "reserved_tasks": 0,
            "queue_depth_total": 0,
        },
    }


def _redis_queue_depths():
    broker_url = getattr(settings, "CELERY_BROKER_URL", "")
    parsed = urlparse(broker_url)
    if parsed.scheme not in {"redis", "rediss"}:
        return {}

    client = Redis.from_url(
        broker_url,
        socket_timeout=getattr(settings, "CELERY_OPERABILITY_REDIS_TIMEOUT_SECONDS", 0.25),
        socket_connect_timeout=getattr(settings, "CELERY_OPERABILITY_REDIS_TIMEOUT_SECONDS", 0.25),
    )
    queue_names = []
    for queue in getattr(settings, "CELERY_TASK_QUEUES", ()) or ():
        queue_name = getattr(queue, "name", None)
        if queue_name:
            queue_names.append(queue_name)

    default_queue = getattr(settings, "CELERY_TASK_DEFAULT_QUEUE", None) or "celery"
    if default_queue not in queue_names:
        queue_names.append(default_queue)

    return {queue_name: int(client.llen(queue_name)) for queue_name in queue_names}


def _inspect_mapping(inspector, method_name, errors):
    try:
        return getattr(inspector, method_name)() or {}
    except Exception as exc:
        errors.append(f"{method_name}:{exc.__class__.__name__}")
        return {}


def collect_celery_operability():
    timeout = getattr(settings, "CELERY_OPERABILITY_INSPECT_TIMEOUT_SECONDS", 0.5)
    started = time.perf_counter()
    inspector = celery_app.control.inspect(timeout=timeout)
    errors = []

    stats = _inspect_mapping(inspector, "stats", errors)
    active = _inspect_mapping(inspector, "active", errors)
    scheduled = _inspect_mapping(inspector, "scheduled", errors)
    reserved = _inspect_mapping(inspector, "reserved", errors)

    try:
        queue_depths = _redis_queue_depths()
    except Exception as exc:
        errors.append(f"queue_depths:{exc.__class__.__name__}")
        queue_depths = {}

    workers = {}
    worker_names = set(stats) | set(active) | set(scheduled) | set(reserved)
    for worker_name in sorted(worker_names):
        worker_stats = stats.get(worker_name) or {}
        workers[worker_name] = {
            "active_count": len(active.get(worker_name) or []),
            "scheduled_count": len(scheduled.get(worker_name) or []),
            "reserved_count": len(reserved.get(worker_name) or []),
            "pool_max_concurrency": ((worker_stats.get("pool") or {}).get("max-concurrency")),
            "uptime_seconds": worker_stats.get("uptime"),
            "processed_total": sum((worker_stats.get("total") or {}).values()),
        }

    return {
        "ok": not errors,
        "stale": False,
        "error": ",".join(errors),
        "collected_at": timezone.now().isoformat(),
        "collection_duration_seconds": round(time.perf_counter() - started, 6),
        "worker_count": len(workers),
        "workers": workers,
        "queue_depths": queue_depths,
        "aggregates": {
            "active_tasks": sum(worker["active_count"] for worker in workers.values()),
            "scheduled_tasks": sum(worker["scheduled_count"] for worker in workers.values()),
            "reserved_tasks": sum(worker["reserved_count"] for worker in workers.values()),
            "queue_depth_total": sum(queue_depths.values()),
        },
    }


def cache_celery_operability(payload):
    ttl = getattr(settings, "CELERY_OPERABILITY_CACHE_TTL_SECONDS", 90)
    stale_ttl = getattr(settings, "CELERY_OPERABILITY_STALE_CACHE_TTL_SECONDS", 600)
    cache.set(CELERY_OPERABILITY_CACHE_KEY, payload, timeout=ttl)
    cache.set(CELERY_OPERABILITY_STALE_CACHE_KEY, payload, timeout=stale_ttl)


def refresh_celery_operability_cache():
    payload = collect_celery_operability()
    cache_celery_operability(payload)
    return payload


def get_cached_celery_operability():
    payload = cache.get(CELERY_OPERABILITY_CACHE_KEY)
    if payload is not None:
        return payload

    stale_payload = cache.get(CELERY_OPERABILITY_STALE_CACHE_KEY)
    if stale_payload is not None:
        stale_payload = dict(stale_payload)
        stale_payload["stale"] = True
        return stale_payload

    return _empty_celery_operability()


def publish_celery_operability_metrics(payload):
    payload = payload or _empty_celery_operability()
    set_gauge(
        "hms_celery_operability_cache_stale",
        1 if payload.get("stale") else 0,
        description="Whether Celery operability metrics are stale or unavailable.",
    )
    set_gauge(
        "hms_celery_operability_collection_duration_seconds",
        float(payload.get("collection_duration_seconds") or 0.0),
        description="Duration of the last background Celery operability collection.",
    )
    set_gauge(
        "hms_celery_workers",
        int(payload.get("worker_count") or 0),
        description="Number of Celery workers visible during the last background collection.",
    )

    aggregates = payload.get("aggregates") or {}
    for metric_name, value in {
        "hms_celery_active_tasks": aggregates.get("active_tasks", 0),
        "hms_celery_scheduled_tasks": aggregates.get("scheduled_tasks", 0),
        "hms_celery_reserved_tasks": aggregates.get("reserved_tasks", 0),
    }.items():
        set_gauge(metric_name, int(value or 0), description=metric_name.replace("_", " "))

    for queue_name, depth in (payload.get("queue_depths") or {}).items():
        set_gauge(
            "hms_celery_queue_depth",
            int(depth),
            labels={"queue": queue_name},
            description="Current Redis-backed Celery queue depth from background collection.",
        )
