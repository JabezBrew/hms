import json
import logging
import re
from typing import Any

_SENSITIVE_KEYS = {
    'prompt',
    'response',
    'transcript',
    'note',
    'text',
    'audio',
    'body',
    'content',
    'message',
    'raw',
    'input',
    'output',
}

_REDACTION_PATTERNS = [
    (re.compile(r'\b[A-Z]{2,5}-?\d{4,}\b'), '<redacted-id>'),
    (re.compile(r'\b\d{8,}\b'), '<redacted-number>'),
    (re.compile(r'\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b'), '<redacted-email>'),
    (re.compile(r'\b(?:\+?\d{1,3})?[\s.-]?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}\b'), '<redacted-phone>'),
]


def redact_text(value: Any) -> Any:
    if not isinstance(value, str):
        return value

    redacted = value
    for pattern, replacement in _REDACTION_PATTERNS:
        redacted = pattern.sub(replacement, redacted)
    return redacted


def sanitize_payload(payload: Any) -> Any:
    if isinstance(payload, dict):
        sanitized = {}
        for key, value in payload.items():
            if str(key).strip().lower() in _SENSITIVE_KEYS:
                sanitized[key] = '<redacted>'
            else:
                sanitized[key] = sanitize_payload(value)
        return sanitized
    if isinstance(payload, (list, tuple, set)):
        return [sanitize_payload(item) for item in payload]
    if isinstance(payload, str):
        return redact_text(payload)
    return payload


class AIPrivacyLogFilter(logging.Filter):
    """
    Redacts likely PHI/token-like values from AI log messages.

    This filter is defensive; endpoint handlers should still avoid logging raw prompt
    or response payloads in the first place.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            if isinstance(record.msg, dict):
                record.msg = json.dumps(sanitize_payload(record.msg), sort_keys=True, default=str)
                record.args = ()
                return True

            rendered = record.getMessage()
            record.msg = redact_text(rendered)
            record.args = ()
        except Exception:
            record.msg = '[ai-log-redaction-failed]'
            record.args = ()
        return True


def safe_ai_log(logger: logging.Logger, level: int, event: str, payload: dict | None = None) -> None:
    redacted_payload = sanitize_payload(payload or {})
    logger.log(level, '%s %s', event, json.dumps(redacted_payload, sort_keys=True, default=str))
