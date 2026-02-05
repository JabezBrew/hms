"""
WebSocket consumer for referral notifications.
"""
import logging
from datetime import datetime

from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.contrib.auth.models import AnonymousUser

logger = logging.getLogger(__name__)


class ReferralNotificationConsumer(AsyncJsonWebsocketConsumer):
    """
    WebSocket consumer for in-app referral notifications.

    Client connection example:
        const ws = new WebSocket('ws://host/ws/notifications/?token=<jwt>');
    """

    async def connect(self):
        self.user = self.scope.get('user', AnonymousUser())

        if not self.user.is_authenticated:
            logger.warning("Unauthenticated notification WebSocket connection")
            await self.close(code=4001)
            return

        self.group_name = f'notifications_user_{self.user.id}'
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

        await self.send_json({
            'type': 'connection.established',
            'message': 'Connected to referral notifications',
            'group': self.group_name,
            'timestamp': datetime.utcnow().isoformat(),
        })

    async def disconnect(self, close_code):
        if hasattr(self, 'group_name'):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def notification_new(self, event):
        await self.send_json({
            'type': 'notification.new',
            'notification': event['notification'],
            'timestamp': datetime.utcnow().isoformat(),
        })
