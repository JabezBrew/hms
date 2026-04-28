"""
Tests for audit serializers.
"""
import pytest

from apps.audit.models import AuditLog, AuditAction, AuditCategory
from apps.audit.serializers import AuditLogSerializer


@pytest.mark.tier1
class TestAuditLogSerializer:
    def test_includes_user_agent_summary(self, db):
        log = AuditLog.objects.create(
            user_email='auditor@test.com',
            user_type='admin',
            action=AuditAction.LOGIN,
            category=AuditCategory.AUTHENTICATION,
            resource_type='User',
            resource_id='123',
            description='Login event',
            user_agent=(
                'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) '
                'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 '
                'Mobile/15E148 Safari/604.1'
            ),
        )

        data = AuditLogSerializer(log).data
        assert data['user_agent_summary'] == 'Safari on iOS'

    def test_user_agent_summary_is_null_for_missing_user_agent(self, db):
        log = AuditLog.objects.create(
            user_email='auditor@test.com',
            user_type='admin',
            action=AuditAction.LOGIN,
            category=AuditCategory.AUTHENTICATION,
            resource_type='User',
            resource_id='123',
            description='Login event',
            user_agent='',
        )

        data = AuditLogSerializer(log).data
        assert data['user_agent_summary'] is None
