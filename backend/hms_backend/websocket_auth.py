"""
JWT Authentication middleware for WebSocket connections.

Authenticates WebSocket connections using JWT tokens passed as query parameters.
This is necessary because WebSocket connections cannot use HTTP headers for auth.

Usage:
    Connect with: ws://host/ws/alerts/?token=<jwt_access_token>
"""

import logging
from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser
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
        User instance if valid, AnonymousUser otherwise
    """
    try:
        # Validate the token
        token = AccessToken(token_str)
        user_id = token.payload.get('user_id')

        if not user_id:
            logger.warning("JWT token missing user_id claim")
            return AnonymousUser()

        # Get the user
        user = User.objects.select_related('practitioner_profile').get(id=user_id)

        if not user.is_active:
            logger.warning(f"Inactive user {user_id} attempted WebSocket connection")
            return AnonymousUser()

        return user

    except (InvalidToken, TokenError) as e:
        logger.warning(f"Invalid JWT token for WebSocket: {e}")
        return AnonymousUser()
    except User.DoesNotExist:
        logger.warning(f"User from JWT token does not exist")
        return AnonymousUser()
    except Exception as e:
        logger.error(f"Unexpected error validating WebSocket JWT: {e}")
        return AnonymousUser()


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

        if token:
            # Authenticate with JWT
            scope['user'] = await get_user_from_token(token)
        else:
            # No token provided
            scope['user'] = AnonymousUser()

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
