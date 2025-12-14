"""
Idempotency key implementation for preventing duplicate operations.

Usage in views:
    from apps.core.idempotency import idempotent

    class PaymentViewSet(viewsets.ModelViewSet):
        @idempotent(timeout=86400)  # 24 hours
        def create(self, request, *args, **kwargs):
            # ... payment logic

Usage in services/engines:
    from apps.core.idempotency import ensure_idempotent

    @transaction.atomic
    def complete_admission(workflow, data, idempotency_key=None):
        if idempotency_key:
            cached = ensure_idempotent(idempotency_key, 'admission_complete')
            if cached:
                return cached
        # ... admission logic
        if idempotency_key:
            store_idempotent_result(idempotency_key, 'admission_complete', result)
        return result
"""
import hashlib
import json
import logging
from functools import wraps
from typing import Any, Optional, Tuple

from django.conf import settings
from django.core.cache import cache
from rest_framework.response import Response

logger = logging.getLogger(__name__)


# Import model from models.py to avoid circular imports
# The IdempotencyRecord model is defined in models.py


def _get_cache_key(idempotency_key: str, operation_type: str) -> str:
    """Generate cache key for idempotency lookup."""
    return f"idempotent:{operation_type}:{idempotency_key}"


def _hash_request_body(body: dict) -> str:
    """Create a deterministic hash of the request body."""
    if not body:
        return ""
    serialized = json.dumps(body, sort_keys=True, default=str)
    return hashlib.sha256(serialized.encode()).hexdigest()


def get_idempotent_result(
    idempotency_key: str,
    operation_type: str,
    request_body: Optional[dict] = None
) -> Optional[Tuple[int, Any]]:
    """
    Check if an operation with this idempotency key has already been processed.

    Args:
        idempotency_key: The client-provided idempotency key
        operation_type: Type of operation (for namespacing)
        request_body: Optional request body to validate against stored hash

    Returns:
        Tuple of (status_code, response_data) if found, None otherwise
    """
    cache_key = _get_cache_key(idempotency_key, operation_type)

    # Try cache first (fast path)
    cached = cache.get(cache_key)
    if cached:
        logger.debug(f"Idempotency cache HIT: {operation_type}:{idempotency_key[:16]}")
        # Validate request body hash if provided
        if request_body:
            current_hash = _hash_request_body(request_body)
            if cached.get('request_hash') and cached['request_hash'] != current_hash:
                logger.warning(
                    f"Idempotency key reused with different body: {idempotency_key[:16]}"
                )
                # Return 409 Conflict for mismatched request bodies
                return (409, {
                    'error': 'idempotency_key_mismatch',
                    'detail': 'This idempotency key was used with a different request body'
                })
        return (cached['status'], cached['body'])

    # Fall back to database (in case cache was evicted)
    from django.utils import timezone
    from apps.core.models import IdempotencyRecord
    try:
        record = IdempotencyRecord.objects.filter(
            key=idempotency_key,
            operation_type=operation_type,
            expires_at__gt=timezone.now()
        ).first()

        if record:
            logger.debug(f"Idempotency DB HIT: {operation_type}:{idempotency_key[:16]}")
            # Re-populate cache
            cache_data = {
                'status': record.response_status,
                'body': record.response_body,
                'request_hash': record.request_hash
            }
            ttl = int((record.expires_at - timezone.now()).total_seconds())
            if ttl > 0:
                cache.set(cache_key, cache_data, timeout=ttl)

            # Validate request body hash
            if request_body:
                current_hash = _hash_request_body(request_body)
                if record.request_hash and record.request_hash != current_hash:
                    return (409, {
                        'error': 'idempotency_key_mismatch',
                        'detail': 'This idempotency key was used with a different request body'
                    })

            return (record.response_status, record.response_body)
    except Exception as e:
        logger.error(f"Error checking idempotency record: {e}")

    return None


def store_idempotent_result(
    idempotency_key: str,
    operation_type: str,
    status_code: int,
    response_data: Any,
    request_path: str = "",
    request_body: Optional[dict] = None,
    ttl_seconds: int = 86400  # 24 hours default
) -> None:
    """
    Store the result of an idempotent operation.

    Args:
        idempotency_key: The client-provided idempotency key
        operation_type: Type of operation
        status_code: HTTP status code
        response_data: Response data to cache
        request_path: API endpoint path
        request_body: Request body (for hash validation)
        ttl_seconds: How long to keep the record
    """
    from django.utils import timezone
    from datetime import timedelta
    from apps.core.models import IdempotencyRecord

    cache_key = _get_cache_key(idempotency_key, operation_type)
    request_hash = _hash_request_body(request_body) if request_body else ""
    expires_at = timezone.now() + timedelta(seconds=ttl_seconds)

    # Store in cache (fast path for subsequent requests)
    cache_data = {
        'status': status_code,
        'body': response_data,
        'request_hash': request_hash
    }
    cache.set(cache_key, cache_data, timeout=ttl_seconds)

    # Store in database (durable, survives cache eviction)
    try:
        IdempotencyRecord.objects.update_or_create(
            key=idempotency_key,
            operation_type=operation_type,
            defaults={
                'request_path': request_path,
                'request_hash': request_hash,
                'response_status': status_code,
                'response_body': response_data,
                'expires_at': expires_at
            }
        )
        logger.debug(f"Stored idempotency record: {operation_type}:{idempotency_key[:16]}")
    except Exception as e:
        logger.error(f"Error storing idempotency record: {e}")


def idempotent(operation_type: str = None, timeout: int = 86400):
    """
    Decorator for making DRF view methods idempotent.

    Clients should send an 'Idempotency-Key' header with a unique value
    for each logical operation. If the same key is sent again within the
    timeout period, the cached response is returned.

    Args:
        operation_type: Name of the operation (defaults to view name)
        timeout: How long to cache results in seconds (default: 24 hours)

    Example:
        class PaymentViewSet(viewsets.ModelViewSet):
            @action(detail=False, methods=['post'])
            @idempotent(operation_type='create_payment', timeout=86400)
            def process_payment(self, request):
                # ... payment logic
    """
    def decorator(func):
        @wraps(func)
        def wrapper(self, request, *args, **kwargs):
            # Get idempotency key from header
            idempotency_key = request.headers.get('Idempotency-Key') or \
                              request.headers.get('X-Idempotency-Key')

            if not idempotency_key:
                # No key provided, proceed normally (not idempotent)
                return func(self, request, *args, **kwargs)

            # Determine operation type
            op_type = operation_type or f"{self.__class__.__name__}.{func.__name__}"

            # Check for existing result
            request_body = request.data if hasattr(request, 'data') else None
            existing = get_idempotent_result(idempotency_key, op_type, request_body)

            if existing:
                status_code, response_data = existing
                logger.info(f"Returning cached response for idempotency key: {idempotency_key[:16]}")
                return Response(response_data, status=status_code)

            # Execute the actual operation
            response = func(self, request, *args, **kwargs)

            # Only store successful responses (2xx) and client errors (4xx)
            # Don't cache server errors (5xx) as they may be transient
            if 200 <= response.status_code < 500:
                store_idempotent_result(
                    idempotency_key=idempotency_key,
                    operation_type=op_type,
                    status_code=response.status_code,
                    response_data=response.data,
                    request_path=request.path,
                    request_body=request_body,
                    ttl_seconds=timeout
                )

            return response

        return wrapper
    return decorator


def cleanup_expired_idempotency_records():
    """
    Remove expired idempotency records from the database.

    Should be called periodically via Celery beat or management command.
    """
    from django.utils import timezone
    from apps.core.models import IdempotencyRecord

    deleted_count, _ = IdempotencyRecord.objects.filter(
        expires_at__lt=timezone.now()
    ).delete()

    if deleted_count > 0:
        logger.info(f"Cleaned up {deleted_count} expired idempotency records")

    return deleted_count
