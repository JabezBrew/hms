"""
Custom SendGrid email backend using the Web API.
"""
import base64
from django.conf import settings
from django.core.mail.backends.base import BaseEmailBackend
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import (
    Mail, Attachment, FileContent, FileName, FileType, Disposition
)


class SendGridEmailBackend(BaseEmailBackend):
    """
    Django email backend that uses SendGrid Web API.
    """

    def __init__(self, fail_silently=False, **kwargs):
        super().__init__(fail_silently=fail_silently, **kwargs)
        self.api_key = getattr(settings, 'SENDGRID_API_KEY', None)
        if not self.api_key:
            raise ValueError("SENDGRID_API_KEY setting is required")
        self.client = SendGridAPIClient(self.api_key)

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
            except Exception as e:
                if not self.fail_silently:
                    raise
        return num_sent

    def _send(self, message):
        """
        Send a single EmailMessage using SendGrid API.
        """
        if not message.recipients():
            return False

        # Build the SendGrid Mail object
        mail = Mail(
            from_email=message.from_email or settings.DEFAULT_FROM_EMAIL,
            to_emails=message.to,
            subject=message.subject,
        )

        # Handle HTML and plain text content
        if hasattr(message, 'alternatives') and message.alternatives:
            # This is an EmailMultiAlternatives with HTML content
            mail.add_content(message.body, 'text/plain')
            for content, mimetype in message.alternatives:
                if mimetype == 'text/html':
                    mail.add_content(content, 'text/html')
        else:
            # Plain text only
            content_type = getattr(message, 'content_subtype', 'plain')
            mail.add_content(message.body, f'text/{content_type}')

        # Add CC recipients
        if message.cc:
            for cc_email in message.cc:
                mail.add_cc(cc_email)

        # Add BCC recipients
        if message.bcc:
            for bcc_email in message.bcc:
                mail.add_bcc(bcc_email)

        # Handle attachments
        if message.attachments:
            for attachment in message.attachments:
                if isinstance(attachment, tuple):
                    filename, content, mimetype = attachment
                    if isinstance(content, str):
                        content = content.encode('utf-8')
                    encoded = base64.b64encode(content).decode()
                    mail.add_attachment(Attachment(
                        FileContent(encoded),
                        FileName(filename),
                        FileType(mimetype or 'application/octet-stream'),
                        Disposition('attachment')
                    ))

        # Send via SendGrid API
        response = self.client.send(mail)
        return response.status_code in [200, 201, 202]
