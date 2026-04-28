"""Security regressions for WebSocket JWT transport."""

from unittest.mock import AsyncMock, patch

from asgiref.sync import async_to_sync
from django.contrib.auth.models import AnonymousUser
import pytest
from rest_framework_simplejwt.tokens import RefreshToken

from apps.users.tests.factories import DoctorUserFactory
from hms_backend.websocket_auth import JWTAuthMiddleware


pytestmark = [
    pytest.mark.django_db,
    pytest.mark.tier1,
]


async def _noop_receive():
    return {}


async def _noop_send(message):
    return None


def test_websocket_auth_accepts_subprotocol_jwt():
    user = DoctorUserFactory()
    access_token = str(RefreshToken.for_user(user).access_token)
    captured = {}

    async def inner(scope, receive, send):
        captured["scope"] = dict(scope)

    middleware = JWTAuthMiddleware(inner)

    with patch(
        "hms_backend.websocket_auth.get_user_from_token",
        new=AsyncMock(
            return_value=(
                user,
                {"facility_code": user.primary_facility.code, "user_type": user.user_type},
            )
        ),
    ) as mock_get_user:
        async_to_sync(middleware)(
            {
                "type": "websocket",
                "query_string": b"",
                "subprotocols": ["hms.jwt", access_token],
            },
            _noop_receive,
            _noop_send,
        )

    mock_get_user.assert_awaited_once_with(access_token)
    assert captured["scope"]["user"] == user
    assert captured["scope"]["jwt_claims"]["facility_code"] == user.primary_facility.code
    assert captured["scope"]["facility_code"] == user.primary_facility.code


def test_websocket_auth_rejects_query_string_jwt():
    user = DoctorUserFactory()
    access_token = str(RefreshToken.for_user(user).access_token)
    captured = {}

    async def inner(scope, receive, send):
        captured["scope"] = dict(scope)

    middleware = JWTAuthMiddleware(inner)

    with patch(
        "hms_backend.websocket_auth.get_user_from_token",
        new=AsyncMock(return_value=(user, {"facility_code": user.primary_facility.code})),
    ) as mock_get_user:
        async_to_sync(middleware)(
            {
                "type": "websocket",
                "query_string": f"token={access_token}".encode(),
                "subprotocols": [],
            },
            _noop_receive,
            _noop_send,
        )

    mock_get_user.assert_not_awaited()
    assert isinstance(captured["scope"]["user"], AnonymousUser)
    assert captured["scope"]["user"].is_authenticated is False
    assert captured["scope"]["jwt_claims"] == {}
    assert "facility_code" not in captured["scope"]
