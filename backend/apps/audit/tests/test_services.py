"""Tests for audit service sanitization."""

from unittest.mock import patch

import pytest

from apps.audit.models import AuditAction, AuditCategory
from apps.audit.services import AuditService
from apps.users.tests.factories import AdminUserFactory, DoctorUserFactory


pytestmark = [
    pytest.mark.django_db,
    pytest.mark.tier1,
]


def test_log_minimizes_sensitive_clinical_audit_entries():
    user = DoctorUserFactory()

    with patch("apps.audit.services.log_audit_async.delay") as mock_delay:
        AuditService.log(
            request=None,
            action=AuditAction.NOTE_UPDATE,
            category=AuditCategory.CLINICAL,
            resource_type="ClinicalNote",
            resource_id="123",
            description="Updated diagnosis for Jane Doe",
            user=user,
            resource_name="Jane Doe SOAP note",
            changes={"diagnosis": "Asthma", "notes": "Severe wheezing"},
            facility=user.primary_facility,
        )

    mock_delay.assert_called_once()
    kwargs = mock_delay.call_args.kwargs
    assert kwargs["description"] == "CLINICAL NOTE_UPDATE recorded for ClinicalNote. Sensitive details redacted."
    assert kwargs["resource_name"] == "ClinicalNote:123"
    assert kwargs["changes"] is None


def test_log_redacts_sensitive_change_fields_for_non_clinical_audits():
    user = AdminUserFactory()

    with patch("apps.audit.services.log_audit_async.delay") as mock_delay:
        AuditService.log(
            request=None,
            action=AuditAction.USER_UPDATE,
            category=AuditCategory.ADMIN,
            resource_type="User",
            resource_id="456",
            description="Updated user account settings",
            user=user,
            resource_name="staff-user",
            changes={
                "email": "staff@test.com",
                "status": "active",
                "nested": {"token": "secret-value", "role": "nurse"},
            },
            facility=user.primary_facility,
        )

    mock_delay.assert_called_once()
    kwargs = mock_delay.call_args.kwargs
    assert kwargs["description"] == "Updated user account settings"
    assert kwargs["resource_name"] == "staff-user"
    assert kwargs["changes"] == {
        "email": "<redacted>",
        "status": "active",
        "nested": {"token": "<redacted>", "role": "nurse"},
    }
