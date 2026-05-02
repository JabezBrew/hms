"""
Django email backend for Unosend's REST API.
"""
import base64

import requests
from django.conf import settings
from django.core.mail.backends.base import BaseEmailBackend


class UnosendEmailError(Exception):
    """Raised when Unosend rejects or cannot process an email request."""


class UnosendEmailBackend(BaseEmailBackend):
    """
    Django email backend that sends messages through Unosend.
    """

    def __init__(self, fail_silently=False, **kwargs):
        super().__init__(fail_silently=fail_silently, **kwargs)
        self.api_key = getattr(settings, 'UNOSEND_API_KEY', None)
        if not self.api_key:
            raise ValueError("UNOSEND_API_KEY setting is required")

        base_url = getattr(settings, 'UNOSEND_API_BASE_URL', 'https://api.unosend.co')
        self.endpoint_url = f"{base_url.rstrip('/')}/emails"
        self.timeout = getattr(settings, 'UNOSEND_REQUEST_TIMEOUT_SECONDS', 10)

    def send_messages(self, email_messages):
        """
        Send one or more EmailMessage objects and return the number sent.
        """
        if not email_messages:
            return 0

        num_sent = 0
        for message in email_messages:
            try:
                if self._send(message):
                    num_sent += 1
            except Exception:
                if not self.fail_silently:
                    raise
        return num_sent

    def _send(self, message):
        """
        Send a single EmailMessage using Unosend's email API.
        """
        if not message.recipients():
            return False

        payload = self._build_payload(message)
        headers = {
            'Authorization': f'Bearer {self.api_key}',
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        }

        response = requests.post(
            self.endpoint_url,
            json=payload,
            headers=headers,
            timeout=self.timeout,
        )

        if 200 <= response.status_code < 300:
            return True

        raise UnosendEmailError(f"Unosend API returned HTTP {response.status_code}")

    def _build_payload(self, message):
        payload = {
            'from': message.from_email or settings.DEFAULT_FROM_EMAIL,
            'to': list(message.to),
            'subject': message.subject,
        }

        text_body, html_body = self._extract_bodies(message)
        if html_body:
            payload['html'] = html_body
        if text_body:
            payload['text'] = text_body

        if message.cc:
            payload['cc'] = list(message.cc)
        if message.bcc:
            payload['bcc'] = list(message.bcc)
        if getattr(message, 'reply_to', None):
            payload['reply_to'] = message.reply_to[0]
        if message.extra_headers:
            payload['headers'] = dict(message.extra_headers)

        attachments = self._build_attachments(message)
        if attachments:
            payload['attachments'] = attachments

        return payload

    def _extract_bodies(self, message):
        content_subtype = getattr(message, 'content_subtype', 'plain')
        text_body = message.body if content_subtype == 'plain' else ''
        html_body = message.body if content_subtype == 'html' else ''

        for content, mimetype in getattr(message, 'alternatives', []) or []:
            if mimetype == 'text/html':
                html_body = content
            elif mimetype == 'text/plain' and not text_body:
                text_body = content

        return text_body, html_body

    def _build_attachments(self, message):
        attachments = []
        for attachment in message.attachments:
            normalized = self._normalize_attachment(attachment)
            if normalized:
                attachments.append(normalized)
        return attachments

    def _normalize_attachment(self, attachment):
        if isinstance(attachment, tuple):
            filename, content, mimetype = attachment
        else:
            filename = attachment.get_filename()
            content = attachment.get_payload(decode=True)
            mimetype = attachment.get_content_type()

        if not filename or content is None:
            return None

        if isinstance(content, str):
            content = content.encode('utf-8')

        return {
            'filename': filename,
            'content': base64.b64encode(content).decode('ascii'),
            'content_type': mimetype or 'application/octet-stream',
        }
