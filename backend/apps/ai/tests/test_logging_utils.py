import logging

from apps.ai.logging_utils import AIPrivacyLogFilter, redact_text, sanitize_payload


def test_redact_text_masks_email_and_phone():
    text = 'Patient email jane.doe@example.com phone +1 555 123 4567'
    redacted = redact_text(text)

    assert 'example.com' not in redacted
    assert '+1 555' not in redacted


def test_sanitize_payload_redacts_sensitive_keys_and_ids():
    payload = {
        'prompt': 'Patient MRN MRN12345678 has severe pain',
        'meta': {'ticket': 'ABCD-12345', 'safe': 'hello'},
    }

    sanitized = sanitize_payload(payload)

    assert sanitized['prompt'] == '<redacted>'
    assert sanitized['meta']['ticket'] == '<redacted-id>'


def test_ai_privacy_log_filter_redacts_record_message():
    logger = logging.getLogger('test.apps.ai.redaction')
    record = logging.LogRecord(
        name='test.apps.ai.redaction',
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg='Contact patient@example.com at +1 555 123 8888',
        args=(),
        exc_info=None,
    )

    redaction_filter = AIPrivacyLogFilter()
    accepted = redaction_filter.filter(record)

    assert accepted is True
    assert 'patient@example.com' not in record.msg
