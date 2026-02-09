"""
JWT Authentication middleware for WebSocket connections.

Authenticates WebSocket connections using JWT access tokens passed via query
parameters or WebSocket subprotocols.

Why subprotocols?
- WebSocket clients cannot set arbitrary HTTP headers in browsers.
- Query-string tokens can be logged by proxies and tooling.

Usage:
    Query param:
        ws://host/ws/alerts/?token=<jwt_access_token>

    Subprotocols (preferred):
        new WebSocket('ws://host/ws/alerts/', ['hms.jwt', '<jwt_access_token>'])
"""

import logging
from urllib.parse import parse_qs
from typing import List, Optional

from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser
from apps.core.security import normalize_facility_code
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.tokens import AccessToken

logger = logging.getLogger(__name__)
User = get_user_model()


@database_sync_to_async
def get_user_from_token(token_str):
    """
    Validate JWT token and return the associated user.

    Args:
        token_str: JWT access token string

    Returns:
        (User instance, token claims) if valid, (AnonymousUser, None) otherwise
    """
    try:
        # Validate the token
        token = AccessToken(token_str)
        user_id = token.payload.get('user_id')

        if not user_id:
            logger.warning("JWT token missing user_id claim")
            return AnonymousUser(), None

        # Get the user
        user = User.objects.select_related('staff_profile__practitioner_profile').get(id=user_id)

        if not user.is_active:
            logger.warning(f"Inactive user {user_id} attempted WebSocket connection")
            return AnonymousUser(), None

        token_user_type = token.payload.get('user_type')
        if token_user_type and token_user_type != user.user_type:
            logger.warning("JWT user_type mismatch in WebSocket auth")
            return AnonymousUser(), None

        return user, token.payload

    except (InvalidToken, TokenError) as e:
        logger.warning(f"Invalid JWT token for WebSocket: {e}")
        return AnonymousUser(), None
    except User.DoesNotExist:
        logger.warning(f"User from JWT token does not exist")
        return AnonymousUser(), None
    except Exception as e:
        logger.error(f"Unexpected error validating WebSocket JWT: {e}")
        return AnonymousUser(), None


def _looks_like_jwt(value: str) -> bool:
    if not value or not isinstance(value, str):
        return False
    parts = value.split('.')
    return len(parts) == 3 and all(parts)


def _extract_token_from_subprotocols(subprotocols: Optional[List[str]]) -> Optional[str]:
    if not subprotocols:
        return None

    lowered = [str(p).lower() for p in subprotocols]

    # Preferred: ['hms.jwt', '<jwt>']
    if 'hms.jwt' in lowered:
        idx = lowered.index('hms.jwt')
        if idx + 1 < len(subprotocols) and _looks_like_jwt(subprotocols[idx + 1]):
            return subprotocols[idx + 1]
        for candidate in reversed(subprotocols):
            if _looks_like_jwt(candidate):
                return candidate

    # Accept: ['bearer', '<jwt>'] (RFC-compliant token list, no spaces).
    if 'bearer' in lowered:
        idx = lowered.index('bearer')
        if idx + 1 < len(subprotocols) and _looks_like_jwt(subprotocols[idx + 1]):
            return subprotocols[idx + 1]

    # Legacy (non-RFC token strings): 'bearer <jwt>' / 'bearer,<jwt>'
    for protocol in subprotocols:
        lowered_protocol = str(protocol).lower()
        if lowered_protocol.startswith('bearer '):
            candidate = str(protocol).split(' ', 1)[1].strip()
            if _looks_like_jwt(candidate):
                return candidate
        if lowered_protocol.startswith('bearer,'):
            candidate = str(protocol).split(',', 1)[1].strip()
            if _looks_like_jwt(candidate):
                return candidate

    return None


class JWTAuthMiddleware(BaseMiddleware):
    """
    Middleware to authenticate WebSocket connections using JWT.

    Extracts the token from the query string and attaches the user to the scope.
    If authentication fails, an AnonymousUser is attached instead.

    Query parameters:
        token: JWT access token

    Example connection URL:
        ws://localhost:8001/ws/alerts/?token=eyJhbGciOiJIUzI1NiIs...
    """

    async def __call__(self, scope, receive, send):
        # Parse query string
        query_string = scope.get('query_string', b'').decode('utf-8')
        query_params = parse_qs(query_string)

        # Extract token
        token_list = query_params.get('token', [])
        token = token_list[0] if token_list else None

        # Fallback to subprotocols for safer token transport
        if not token:
            token = _extract_token_from_subprotocols(scope.get('subprotocols', []) or [])

        if token:
            # Authenticate with JWT
            user, claims = await get_user_from_token(token)
            scope['user'] = user
            scope['jwt_claims'] = claims or {}
            facility_code = normalize_facility_code((claims or {}).get('facility_code'))
            if facility_code:
                scope['facility_code'] = facility_code
        else:
            # No token provided
            scope['user'] = AnonymousUser()
            scope['jwt_claims'] = {}

        return await super().__call__(scope, receive, send)


class JWTAuthMiddlewareStack:
    """
    Convenience wrapper for applying JWT auth middleware.

    Usage in asgi.py:
        from hms_backend.websocket_auth import JWTAuthMiddlewareStack

        application = ProtocolTypeRouter({
            "websocket": JWTAuthMiddlewareStack(URLRouter(websocket_urlpatterns)),
        })
    """

    def __init__(self, inner):
        self.inner = JWTAuthMiddleware(inner)

    def __call__(self, scope, receive, send):
        return self.inner(scope, receive, send)
