"""
Logging helpers for production-safe structured logs.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone


SAFE_EXTRA_FIELDS = {
    "duration_seconds",
    "event",
    "http_method",
    "http_path",
    "http_route",
    "remote_addr",
    "request_id",
    "response_size_bytes",
    "server_hostname",
    "status_class",
    "status_code",
}


class JsonLogFormatter(logging.Formatter):
    """
    Emit single-line JSON logs for stdout collectors.

    The formatter intentionally keeps the schema small and excludes request bodies
    or arbitrary record attributes that could contain PHI.
    """

    def format(self, record: logging.LogRecord) -> str:
        event = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
            "line": record.lineno,
            "process": record.process,
            "thread": record.thread,
        }

        if record.exc_info:
            event["exc_info"] = self.formatException(record.exc_info)

        if record.stack_info:
            event["stack_info"] = self.formatStack(record.stack_info)

        for field in sorted(SAFE_EXTRA_FIELDS):
            if hasattr(record, field):
                event[field] = getattr(record, field)

        return json.dumps(event, ensure_ascii=True, separators=(",", ":"))
