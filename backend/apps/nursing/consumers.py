"""
WebSocket consumers for real-time nursing alerts and vital signs.

These consumers handle WebSocket connections for:
- AlertConsumer: Real-time nursing alerts (global or ward-specific)
- VitalSignsConsumer: Real-time vital signs updates for a patient

Messages are broadcast via Django Channels using Redis as the channel layer.
"""

import json
import logging
from datetime import datetime

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.contrib.auth.models import AnonymousUser
from rest_framework.exceptions import PermissionDenied

from apps.core.security import (
    can_use_cross_facility_access,
    get_user_facility_codes,
    check_clinical_access,
    normalize_facility_code,
)
from apps.users.models import PatientProfile, PractitionerProfile
from apps.wards.models import Ward, WardStaffAssignment

logger = logging.getLogger(__name__)


@database_sync_to_async
def _can_access_patient(user, patient_id):
    if not user or not getattr(user, 'is_authenticated', False):
        return False
    patient = PatientProfile.objects.select_related('facility').filter(id=patient_id).first()
    if not patient:
        return False
    allowed_codes = get_user_facility_codes(user)
    allow_cross_facility = can_use_cross_facility_access(user)
    if allowed_codes and patient.facility:
        if patient.facility.code not in allowed_codes and not allow_cross_facility:
            return False
    try:
        check_clinical_access(user, patient)
        return True
    except PermissionDenied:
        return False


@database_sync_to_async
def _has_ward_access(user, ward_id):
    if not user or not getattr(user, 'is_authenticated', False):
        return False
    ward = Ward.objects.select_related('department', 'department__facility').filter(id=ward_id).first()
    if not ward:
        return False

    ward_facility_code = normalize_facility_code(getattr(getattr(ward, 'facility', None), 'code', None))
    allowed_codes = get_user_facility_codes(user)
    if ward_facility_code and allowed_codes and ward_facility_code not in allowed_codes:
        if not can_use_cross_facility_access(user):
            return False

    if user.user_type == 'admin':
        return True
    practitioner = PractitionerProfile.objects.filter(staff__user=user).first()
    if not practitioner:
        return False
    return WardStaffAssignment.objects.filter(
        ward_id=ward_id,
        practitioner=practitioner,
        is_active=True
    ).exists()


class AlertConsumer(AsyncJsonWebsocketConsumer):
    """
    WebSocket consumer for real-time nursing alerts.

    Supports:
    - Global alerts (/ws/alerts/) - receives all alerts
    - Ward-specific alerts (/ws/alerts/ward/<ward_id>/) - receives ward alerts only

    Authentication:
    - Requires valid JWT token in WebSocket subprotocols
    - User must be a practitioner (nurse, doctor, etc.)

    Message types sent to client:
    - alert.new: New alert created
    - alert.acknowledged: Alert was acknowledged
    - alert.escalated: Alert severity increased

    Example client connection:
        const ws = new WebSocket('ws://host/ws/alerts/', ['hms.jwt', '<jwt>']);
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'alert.new') {
                showNotification(data.alert);
            }
        };
    """

    async def connect(self):
        """Handle WebSocket connection."""
        self.user = self.scope.get('user', AnonymousUser())

        # Reject unauthenticated connections
        if not self.user.is_authenticated:
            logger.warning("Unauthenticated WebSocket connection attempt")
            await self.close(code=4001)
            return

        if self.user.user_type not in ['admin', 'doctor', 'nurse']:
            await self.close(code=4003)
            return

        self.facility_code = normalize_facility_code(self.scope.get('facility_code'))
        if not self.facility_code:
            await self.close(code=4003)
            return

        # Get ward_id from URL if provided
        self.ward_id = self.scope['url_route']['kwargs'].get('ward_id')

        # Determine which groups to join
        self.groups = []

        if self.ward_id:
            # Ward-specific alerts
            if not await _has_ward_access(self.user, self.ward_id):
                await self.close(code=4003)
                return
            self.groups.append(f'alerts_ward_{self.ward_id}')
        else:
            # Global alerts - subscribe to user-specific and role-based groups
            self.groups.append(f'alerts_user_{self.user.id}')

            # Add role-based group
            user_type = getattr(self.user, 'user_type', None)
            if user_type:
                self.groups.append(f'alerts_role_{user_type}')

        # Critical alerts are facility-scoped; cross-facility global delivery leaks PHI.
        self.groups.append(f'alerts_critical_{self.facility_code}')

        # Join all groups
        for group in self.groups:
            await self.channel_layer.group_add(group, self.channel_name)

        subprotocol = None
        for offered in self.scope.get('subprotocols', []) or []:
            if str(offered).lower() == 'hms.jwt':
                subprotocol = offered
                break
        if subprotocol:
            await self.accept(subprotocol=subprotocol)
        else:
            await self.accept()

        # Send connection confirmation
        await self.send_json({
            'type': 'connection.established',
            'message': 'Connected to alert notifications',
            'groups': self.groups,
            'timestamp': datetime.utcnow().isoformat(),
        })

    async def disconnect(self, close_code):
        """Handle WebSocket disconnection."""
        # Leave all groups
        for group in getattr(self, 'groups', []):
            await self.channel_layer.group_discard(group, self.channel_name)

    async def receive_json(self, content):
        """
        Handle incoming messages from client.

        Supported message types:
        - ping: Keep-alive ping, responds with pong
        - subscribe_ward: Subscribe to additional ward alerts
        - unsubscribe_ward: Unsubscribe from ward alerts
        """
        message_type = content.get('type', '')

        if message_type == 'ping':
            await self.send_json({
                'type': 'pong',
                'timestamp': datetime.utcnow().isoformat(),
            })

        elif message_type == 'subscribe_ward':
            ward_id = content.get('ward_id')
            if ward_id:
                if not await _has_ward_access(self.user, ward_id):
                    await self.send_json({
                        'type': 'subscription.denied',
                        'ward_id': ward_id,
                    })
                    return
                group = f'alerts_ward_{ward_id}'
                await self.channel_layer.group_add(group, self.channel_name)
                self.groups.append(group)
                await self.send_json({
                    'type': 'subscription.added',
                    'ward_id': ward_id,
                })

        elif message_type == 'unsubscribe_ward':
            ward_id = content.get('ward_id')
            if ward_id:
                group = f'alerts_ward_{ward_id}'
                await self.channel_layer.group_discard(group, self.channel_name)
                if group in self.groups:
                    self.groups.remove(group)
                await self.send_json({
                    'type': 'subscription.removed',
                    'ward_id': ward_id,
                })

    # Message handlers for channel layer broadcasts

    async def alert_new(self, event):
        """Handle new alert broadcast."""
        await self.send_json({
            'type': 'alert.new',
            'alert': event['alert'],
            'timestamp': datetime.utcnow().isoformat(),
        })

    async def alert_acknowledged(self, event):
        """Handle alert acknowledgment broadcast."""
        await self.send_json({
            'type': 'alert.acknowledged',
            'alert_id': event['alert_id'],
            'acknowledged_by': event.get('acknowledged_by'),
            'timestamp': datetime.utcnow().isoformat(),
        })

    async def alert_escalated(self, event):
        """Handle alert escalation broadcast."""
        await self.send_json({
            'type': 'alert.escalated',
            'alert': event['alert'],
            'previous_severity': event.get('previous_severity'),
            'timestamp': datetime.utcnow().isoformat(),
        })


class VitalSignsConsumer(AsyncJsonWebsocketConsumer):
    """
    WebSocket consumer for real-time vital signs updates.

    Subscribes to updates for a specific patient.
    Useful for patient detail views showing live vitals.

    Message types sent to client:
    - vitals.new: New vital signs recorded
    - vitals.critical: Critical vital signs detected

    Example client connection:
        const ws = new WebSocket('ws://host/ws/vitals/<patient_id>/', ['hms.jwt', '<jwt>']);
    """

    async def connect(self):
        """Handle WebSocket connection."""
        self.user = self.scope.get('user', AnonymousUser())

        # Reject unauthenticated connections
        if not self.user.is_authenticated:
            await self.close(code=4001)
            return

        # Get patient_id from URL
        self.patient_id = self.scope['url_route']['kwargs'].get('patient_id')

        if not self.patient_id:
            await self.close(code=4000)
            return

        if not await _can_access_patient(self.user, self.patient_id):
            await self.close(code=4003)
            return

        # Join patient-specific vitals group
        self.group_name = f'vitals_patient_{self.patient_id}'
        await self.channel_layer.group_add(self.group_name, self.channel_name)

        subprotocol = None
        for offered in self.scope.get('subprotocols', []) or []:
            if str(offered).lower() == 'hms.jwt':
                subprotocol = offered
                break
        if subprotocol:
            await self.accept(subprotocol=subprotocol)
        else:
            await self.accept()

        await self.send_json({
            'type': 'connection.established',
            'patient_id': self.patient_id,
            'timestamp': datetime.utcnow().isoformat(),
        })

    async def disconnect(self, close_code):
        """Handle WebSocket disconnection."""
        if hasattr(self, 'group_name'):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive_json(self, content):
        """Handle incoming messages (ping/pong only)."""
        if content.get('type') == 'ping':
            await self.send_json({
                'type': 'pong',
                'timestamp': datetime.utcnow().isoformat(),
            })

    async def vitals_new(self, event):
        """Handle new vital signs broadcast."""
        await self.send_json({
            'type': 'vitals.new',
            'vitals': event['vitals'],
            'timestamp': datetime.utcnow().isoformat(),
        })

    async def vitals_critical(self, event):
        """Handle critical vital signs broadcast."""
        await self.send_json({
            'type': 'vitals.critical',
            'vitals': event['vitals'],
            'alert': event.get('alert'),
            'timestamp': datetime.utcnow().isoformat(),
        })


# Helper functions for broadcasting from Django views/signals

def get_channel_layer():
    """Get the channel layer for broadcasting."""
    from channels.layers import get_channel_layer as _get_channel_layer
    return _get_channel_layer()


async def broadcast_alert(alert_data, ward_id=None, is_critical=False, facility_code=None):
    """
    Broadcast an alert to relevant WebSocket groups.

    Args:
        alert_data: Dict containing alert information
        ward_id: Optional ward ID to target specific ward
        is_critical: If True, also broadcast to critical alerts group
    """
    channel_layer = get_channel_layer()

    if ward_id:
        # Send to ward-specific group
        await channel_layer.group_send(
            f'alerts_ward_{ward_id}',
            {
                'type': 'alert.new',
                'alert': alert_data,
            }
        )

    if is_critical:
        resolved_facility_code = normalize_facility_code(
            facility_code or (alert_data or {}).get('facility_code')
        )
        if not resolved_facility_code:
            logger.warning("Dropped critical alert broadcast without facility context.")
            return
        # Send to facility-scoped critical alerts group.
        await channel_layer.group_send(
            f'alerts_critical_{resolved_facility_code}',
            {
                'type': 'alert.new',
                'alert': alert_data,
            }
        )


async def broadcast_vitals(patient_id, vitals_data, is_critical=False):
    """
    Broadcast vital signs to relevant WebSocket groups.

    Args:
        patient_id: Patient ID
        vitals_data: Dict containing vital signs information
        is_critical: If True, send as critical vitals
    """
    channel_layer = get_channel_layer()

    message_type = 'vitals.critical' if is_critical else 'vitals.new'

    await channel_layer.group_send(
        f'vitals_patient_{patient_id}',
        {
            'type': message_type.replace('.', '_'),
            'vitals': vitals_data,
        }
    )
