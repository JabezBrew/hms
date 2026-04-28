"""
Distributed locking utilities using Redis cache.

Prevents race conditions in concurrent operations like bed assignment,
medication administration, and inventory updates.

Usage:
    from apps.core.distributed_lock import distributed_lock, acquire_lock

    # Context manager usage
    with distributed_lock(f'bed_assignment:{bed_id}'):
        bed.assign_patient(patient)

    # Decorator usage
    @with_distributed_lock('patient_admission')
    def admit_patient(patient, bed):
        # ... admission logic

    # Manual usage
    lock = acquire_lock(f'bed:{bed_id}', timeout=30)
    if lock:
        try:
            bed.assign_patient(patient)
        finally:
            release_lock(f'bed:{bed_id}')
"""
import logging
import threading
import time
import uuid
from contextlib import contextmanager
from functools import wraps
from typing import Callable, Optional

from django.core.cache import cache

logger = logging.getLogger(__name__)

_RELEASE_IF_OWNER_SCRIPT = """
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
end
return 0
"""

_EXTEND_IF_OWNER_SCRIPT = """
if redis.call('get', KEYS[1]) ~= ARGV[1] then
    return 0
end
local ttl = redis.call('pttl', KEYS[1])
if ttl < 0 then
    ttl = 0
end
local extension_ms = tonumber(ARGV[2])
redis.call('pexpire', KEYS[1], ttl + extension_ms)
return 1
"""


class LockNotAcquiredError(Exception):
    """Raised when a lock cannot be acquired."""

    def __init__(self, lock_name: str, message: str = None):
        self.lock_name = lock_name
        self.message = message or f"Could not acquire lock: {lock_name}"
        super().__init__(self.message)


class LockTimeoutError(Exception):
    """Raised when waiting for a lock times out."""

    def __init__(self, lock_name: str, wait_time: float):
        self.lock_name = lock_name
        self.wait_time = wait_time
        super().__init__(f"Lock '{lock_name}' not acquired after {wait_time}s")


def _get_lock_key(name: str) -> str:
    """Generate cache key for a lock."""
    return f"lock:{name}"


def _get_lock_value() -> str:
    """Generate a unique value for this lock holder."""
    return f"{threading.current_thread().ident}:{uuid.uuid4().hex[:8]}"


def _get_redis_lock_client():
    """
    Return the low-level Redis client when the configured cache backend supports it.
    """
    cache_client = getattr(cache, '_cache', None)
    get_client = getattr(cache_client, 'get_client', None)
    if not callable(get_client):
        return None
    try:
        return get_client(None, write=True)
    except Exception:
        return None


def acquire_lock(
    name: str,
    timeout: int = 30,
    blocking: bool = False,
    blocking_timeout: float = 10.0,
    retry_interval: float = 0.1
) -> Optional[str]:
    """
    Acquire a distributed lock.

    Args:
        name: Unique name for the lock
        timeout: How long the lock should be held (auto-release safety)
        blocking: If True, wait for the lock to become available
        blocking_timeout: Max time to wait when blocking
        retry_interval: Time between retry attempts when blocking

    Returns:
        Lock token if acquired, None if not acquired (non-blocking)

    Raises:
        LockTimeoutError: If blocking and lock not acquired within timeout
    """
    lock_key = _get_lock_key(name)
    lock_value = _get_lock_value()

    if blocking:
        start_time = time.time()
        while True:
            # Try to acquire
            if cache.add(lock_key, lock_value, timeout=timeout):
                logger.debug(f"Acquired lock: {name}")
                return lock_value

            # Check if we've exceeded the blocking timeout
            elapsed = time.time() - start_time
            if elapsed >= blocking_timeout:
                raise LockTimeoutError(name, elapsed)

            # Wait before retrying
            time.sleep(retry_interval)
    else:
        # Non-blocking: try once
        if cache.add(lock_key, lock_value, timeout=timeout):
            logger.debug(f"Acquired lock: {name}")
            return lock_value
        return None


def release_lock(name: str, token: Optional[str] = None) -> bool:
    """
    Release a distributed lock.

    Args:
        name: The lock name
        token: Optional token from acquire_lock (for ownership verification)

    Returns:
        True if lock was released, False otherwise
    """
    lock_key = _get_lock_key(name)

    # If token provided, verify ownership before releasing
    if token:
        redis_client = _get_redis_lock_client()
        if redis_client is not None:
            released = bool(
                redis_client.eval(
                    _RELEASE_IF_OWNER_SCRIPT,
                    1,
                    cache.make_key(lock_key),
                    token,
                )
            )
            if not released:
                logger.warning(f"Lock '{name}' not owned by this process (token mismatch)")
                return False
            logger.debug(f"Released lock: {name}")
            return True

        current_value = cache.get(lock_key)
        if current_value != token:
            logger.warning(f"Lock '{name}' not owned by this process (token mismatch)")
            return False

    cache.delete(lock_key)
    logger.debug(f"Released lock: {name}")
    return True


def extend_lock(name: str, token: str, additional_time: int = 30) -> bool:
    """
    Extend the timeout of an existing lock.

    Args:
        name: The lock name
        token: Token from acquire_lock (required for ownership verification)
        additional_time: Additional seconds to extend the lock

    Returns:
        True if extended, False if lock not owned or expired
    """
    lock_key = _get_lock_key(name)

    redis_client = _get_redis_lock_client()
    if redis_client is not None:
        extended = bool(
            redis_client.eval(
                _EXTEND_IF_OWNER_SCRIPT,
                1,
                cache.make_key(lock_key),
                token,
                int(additional_time * 1000),
            )
        )
        if not extended:
            logger.warning(f"Cannot extend lock '{name}': not owned (token mismatch)")
            return False
        logger.debug(f"Extended lock '{name}' by {additional_time}s")
        return True

    current_value = cache.get(lock_key)
    if current_value != token:
        logger.warning(f"Cannot extend lock '{name}': not owned (token mismatch)")
        return False

    ttl = cache.ttl(lock_key) if hasattr(cache, 'ttl') else 0
    new_timeout = max(ttl, 0) + additional_time
    cache.set(lock_key, token, timeout=new_timeout)
    logger.debug(f"Extended lock '{name}' by {additional_time}s")
    return True


def is_locked(name: str) -> bool:
    """Check if a lock is currently held."""
    lock_key = _get_lock_key(name)
    return cache.get(lock_key) is not None


@contextmanager
def distributed_lock(
    name: str,
    timeout: int = 30,
    blocking: bool = True,
    blocking_timeout: float = 10.0,
    raise_on_failure: bool = True
):
    """
    Context manager for distributed locking.

    Args:
        name: Unique name for the lock
        timeout: How long the lock should be held
        blocking: If True, wait for the lock to become available
        blocking_timeout: Max time to wait when blocking
        raise_on_failure: If True, raise exception when lock not acquired

    Yields:
        Lock token if acquired, None if not acquired and raise_on_failure=False

    Raises:
        LockNotAcquiredError: If lock cannot be acquired and raise_on_failure=True

    Example:
        with distributed_lock(f'bed_assignment:{bed.id}'):
            bed.assign_patient(patient)
    """
    token = None
    try:
        if blocking:
            token = acquire_lock(
                name,
                timeout=timeout,
                blocking=True,
                blocking_timeout=blocking_timeout
            )
        else:
            token = acquire_lock(name, timeout=timeout, blocking=False)

        if token is None and raise_on_failure:
            raise LockNotAcquiredError(name)

        yield token

    finally:
        if token:
            release_lock(name, token)


def with_distributed_lock(
    lock_name_template: str,
    timeout: int = 30,
    blocking: bool = True,
    blocking_timeout: float = 10.0,
    key_arg: str = None
):
    """
    Decorator for methods that need distributed locking.

    Args:
        lock_name_template: Lock name template (can include {arg} placeholders)
        timeout: Lock timeout
        blocking: Whether to wait for lock
        blocking_timeout: Max wait time
        key_arg: Argument name to use for lock key (for dynamic locks)

    Example:
        @with_distributed_lock('bed_assignment:{bed_id}', key_arg='bed_id')
        def assign_patient_to_bed(patient, bed_id):
            # ... assignment logic

        # Or with static lock name
        @with_distributed_lock('inventory_update')
        def update_inventory():
            # ... inventory logic
    """
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(*args, **kwargs):
            # Determine lock name
            if key_arg and key_arg in kwargs:
                lock_name = lock_name_template.format(**{key_arg: kwargs[key_arg]})
            elif '{' in lock_name_template:
                # Try to format with all kwargs
                lock_name = lock_name_template.format(**kwargs)
            else:
                lock_name = lock_name_template

            with distributed_lock(
                lock_name,
                timeout=timeout,
                blocking=blocking,
                blocking_timeout=blocking_timeout
            ):
                return func(*args, **kwargs)

        return wrapper
    return decorator


class DistributedLock:
    """
    Class-based distributed lock for more complex use cases.

    Supports lock extension and status checking.

    Example:
        lock = DistributedLock(f'patient_admission:{patient.id}')
        if lock.acquire(blocking=True, blocking_timeout=5):
            try:
                # ... critical section
                if needs_more_time:
                    lock.extend(30)
            finally:
                lock.release()
    """

    def __init__(self, name: str, timeout: int = 30):
        self.name = name
        self.timeout = timeout
        self._token: Optional[str] = None

    @property
    def is_held(self) -> bool:
        """Check if this instance holds the lock."""
        return self._token is not None

    def acquire(
        self,
        blocking: bool = False,
        blocking_timeout: float = 10.0
    ) -> bool:
        """
        Acquire the lock.

        Returns:
            True if acquired, False otherwise
        """
        if self._token:
            logger.warning(f"Lock '{self.name}' already held by this instance")
            return True

        try:
            self._token = acquire_lock(
                self.name,
                timeout=self.timeout,
                blocking=blocking,
                blocking_timeout=blocking_timeout
            )
            return self._token is not None
        except LockTimeoutError:
            return False

    def release(self) -> bool:
        """Release the lock."""
        if not self._token:
            return False

        result = release_lock(self.name, self._token)
        if result:
            self._token = None
        return result

    def extend(self, additional_time: int = 30) -> bool:
        """Extend the lock timeout."""
        if not self._token:
            return False
        return extend_lock(self.name, self._token, additional_time)

    def __enter__(self):
        """Context manager entry."""
        if not self.acquire(blocking=True):
            raise LockNotAcquiredError(self.name)
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit."""
        self.release()
        return False
