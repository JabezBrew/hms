"""
Tests for audit stats endpoint.
"""
import secrets
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.audit.models import AuditLog, AuditAction, AuditCategory
from apps.users.models import UserSession
from apps.core.tests.factories import DefaultFacilityFactory
from apps.users.tests.factories import AdminUserFactory


@pytest.mark.tier1
class TestAuditStats:
    def test_stats_includes_active_sessions(self, db):
        facility = DefaultFacilityFactory(code='STAT')
        other_facility = DefaultFacilityFactory(code='OTHER')
        admin = AdminUserFactory(primary_facility=facility)

        AuditLog.objects.create(
            facility=facility,
            user=admin,
            user_email=admin.email,
            user_type=admin.user_type,
            action=AuditAction.LOGIN,
            category=AuditCategory.AUTHENTICATION,
            resource_type='User',
            resource_id=str(admin.id),
            resource_name=admin.email,
            description='Login for stats test',
            ip_address='127.0.0.1',
        )

        now = timezone.now()
        UserSession.objects.create(
            user=admin,
            refresh_jti=secrets.token_hex(16),
            facility_code=facility.code,
            ip_hash='x' * 64,
            user_agent_hash='y' * 64,
            expires_at=now + timedelta(days=1),
            last_seen_at=now,
        )
        UserSession.objects.create(
            user=admin,
            refresh_jti=secrets.token_hex(16),
            facility_code=other_facility.code,
            ip_hash='x' * 64,
            user_agent_hash='y' * 64,
            expires_at=now + timedelta(days=1),
            last_seen_at=now,
        )
        UserSession.objects.create(
            user=admin,
            refresh_jti=secrets.token_hex(16),
            facility_code='',
            ip_hash='x' * 64,
            user_agent_hash='y' * 64,
            expires_at=now + timedelta(days=1),
            last_seen_at=now,
        )
        UserSession.objects.create(
            user=admin,
            refresh_jti=secrets.token_hex(16),
            facility_code=facility.code,
            ip_hash='x' * 64,
            user_agent_hash='y' * 64,
            expires_at=now - timedelta(days=1),
            last_seen_at=now - timedelta(days=2),
        )
        UserSession.objects.create(
            user=admin,
            refresh_jti=secrets.token_hex(16),
            facility_code=facility.code,
            ip_hash='x' * 64,
            user_agent_hash='y' * 64,
            expires_at=now + timedelta(days=1),
            last_seen_at=now,
            revoked_at=now - timedelta(hours=1),
        )

        client = APIClient()
        refresh = RefreshToken.for_user(admin)
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
        response = client.get(
            '/api/admin/audit-logs/stats/',
            HTTP_X_FACILITY_CODE=facility.code,
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.data['active_sessions'] == 1
