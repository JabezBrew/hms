"""
Circuit Breaker pattern implementation for external service calls.

Prevents cascading failures when external services (like FHIR API) are unavailable
by failing fast after a threshold of failures is reached.

States:
    CLOSED: Normal operation, requests pass through
    OPEN: Circuit tripped, requests fail immediately
    HALF_OPEN: Testing if service has recovered

Usage:
    from apps.core.circuit_breaker import CircuitBreaker, circuit_breaker

    # Class-based usage
    fhir_breaker = CircuitBreaker(
        name='fhir_api',
        failure_threshold=5,
        reset_timeout=60,
        half_open_max_calls=3
    )

    try:
        result = fhir_breaker.call(fhir_client.create_patient, patient_data)
    except CircuitOpenError:
        # Handle service unavailable gracefully
        logger.warning("FHIR service unavailable, using local fallback")

    # Decorator usage
    @circuit_breaker('fhir_api', failure_threshold=5, reset_timeout=60)
    def sync_patient_to_fhir(patient):
        return fhir_client.create_patient(patient.to_fhir())
"""
import logging
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass
from enum import Enum
from functools import wraps
from typing import Any, Callable, Dict, Optional, Set, Type

from django.core.cache import cache

logger = logging.getLogger(__name__)


class CircuitState(Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


class CircuitOpenError(Exception):
    """Raised when the circuit is open and requests cannot proceed."""

    def __init__(self, name: str, message: str = None):
        self.name = name
        self.message = message or f"Circuit breaker '{name}' is open"
        super().__init__(self.message)


@dataclass
class CircuitStats:
    """Statistics for a circuit breaker."""
    failures: int = 0
    successes: int = 0
    rejected: int = 0
    last_failure_time: Optional[float] = None
    last_success_time: Optional[float] = None
    state_changed_at: Optional[float] = None


class CircuitBreaker:
    """
    Circuit Breaker implementation with thread-safe state management.

    Supports both local state (for single-process deployments) and
    distributed state via Redis cache (for multi-process deployments).
    """

    # Registry of all circuit breakers for monitoring
    _instances: Dict[str, 'CircuitBreaker'] = {}
    _lock = threading.Lock()

    def __init__(
        self,
        name: str,
        failure_threshold: int = 5,
        reset_timeout: int = 60,
        half_open_max_calls: int = 3,
        excluded_exceptions: Optional[Set[Type[Exception]]] = None,
        use_distributed_state: bool = True
    ):
        """
        Initialize a circuit breaker.

        Args:
            name: Unique identifier for this circuit
            failure_threshold: Number of failures before opening circuit
            reset_timeout: Seconds to wait before attempting recovery
            half_open_max_calls: Max test calls allowed in half-open state
            excluded_exceptions: Exceptions that don't count as failures
            use_distributed_state: Use Redis for state (recommended for multiple workers)
        """
        self.name = name
        self.failure_threshold = failure_threshold
        self.reset_timeout = reset_timeout
        self.half_open_max_calls = half_open_max_calls
        self.excluded_exceptions = excluded_exceptions or set()
        self.use_distributed_state = use_distributed_state

        # Local state (thread-safe)
        self._local_lock = threading.Lock()
        self._state = CircuitState.CLOSED
        self._failure_count = 0
        self._success_count = 0
        self._half_open_calls = 0
        self._last_failure_time: Optional[float] = None
        self._stats = CircuitStats()

        # Register instance
        with CircuitBreaker._lock:
            CircuitBreaker._instances[name] = self

    @property
    def _cache_key(self) -> str:
        return f"circuit_breaker:{self.name}"

    def _get_distributed_state(self) -> Optional[dict]:
        """Get state from Redis cache."""
        if not self.use_distributed_state:
            return None
        return cache.get(self._cache_key)

    def _set_distributed_state(self, state_data: dict) -> None:
        """Set state in Redis cache."""
        if not self.use_distributed_state:
            return
        # Use a long TTL; state is explicitly managed
        cache.set(self._cache_key, state_data, timeout=86400)

    @property
    def state(self) -> CircuitState:
        """Get current circuit state, checking for timeout-based transitions."""
        # Check distributed state first
        if self.use_distributed_state:
            dist_state = self._get_distributed_state()
            if dist_state:
                current_state = CircuitState(dist_state.get('state', 'closed'))
                last_failure = dist_state.get('last_failure_time')

                # Check if OPEN circuit should transition to HALF_OPEN
                if current_state == CircuitState.OPEN and last_failure:
                    if time.time() - last_failure >= self.reset_timeout:
                        self._transition_to(CircuitState.HALF_OPEN)
                        return CircuitState.HALF_OPEN
                return current_state

        # Fall back to local state
        with self._local_lock:
            if self._state == CircuitState.OPEN and self._last_failure_time:
                if time.time() - self._last_failure_time >= self.reset_timeout:
                    self._state = CircuitState.HALF_OPEN
                    self._half_open_calls = 0
                    self._stats.state_changed_at = time.time()
                    logger.info(f"Circuit '{self.name}' transitioning to HALF_OPEN")
            return self._state

    def _transition_to(self, new_state: CircuitState) -> None:
        """Transition to a new state with logging."""
        old_state = self._state
        self._state = new_state
        self._stats.state_changed_at = time.time()

        if new_state == CircuitState.HALF_OPEN:
            self._half_open_calls = 0

        if self.use_distributed_state:
            self._set_distributed_state({
                'state': new_state.value,
                'failure_count': self._failure_count,
                'last_failure_time': self._last_failure_time,
                'half_open_calls': self._half_open_calls
            })

        logger.info(f"Circuit '{self.name}' state: {old_state.value} -> {new_state.value}")

    def _on_success(self) -> None:
        """Handle successful call."""
        with self._local_lock:
            self._stats.successes += 1
            self._stats.last_success_time = time.time()

            if self._state == CircuitState.HALF_OPEN:
                self._success_count += 1
                # After enough successes in half-open, close the circuit
                if self._success_count >= self.half_open_max_calls:
                    self._failure_count = 0
                    self._success_count = 0
                    self._transition_to(CircuitState.CLOSED)
                    logger.info(f"Circuit '{self.name}' recovered, now CLOSED")
            elif self._state == CircuitState.CLOSED:
                # Reset failure count on success
                self._failure_count = 0

    def _on_failure(self, exception: Exception) -> None:
        """Handle failed call."""
        # Check if this exception should be excluded
        if type(exception) in self.excluded_exceptions:
            logger.debug(f"Circuit '{self.name}': Excluded exception {type(exception).__name__}")
            return

        with self._local_lock:
            self._failure_count += 1
            self._last_failure_time = time.time()
            self._stats.failures += 1
            self._stats.last_failure_time = time.time()

            if self._state == CircuitState.HALF_OPEN:
                # Any failure in half-open immediately opens circuit
                self._transition_to(CircuitState.OPEN)
                logger.warning(f"Circuit '{self.name}' failed recovery test, now OPEN")

            elif self._state == CircuitState.CLOSED:
                if self._failure_count >= self.failure_threshold:
                    self._transition_to(CircuitState.OPEN)
                    logger.warning(
                        f"Circuit '{self.name}' opened after {self._failure_count} failures"
                    )

    def call(self, func: Callable, *args, **kwargs) -> Any:
        """
        Execute a function with circuit breaker protection.

        Args:
            func: The function to call
            *args, **kwargs: Arguments to pass to the function

        Returns:
            The function's return value

        Raises:
            CircuitOpenError: If the circuit is open
            Exception: Any exception from the wrapped function
        """
        current_state = self.state

        if current_state == CircuitState.OPEN:
            self._stats.rejected += 1
            raise CircuitOpenError(
                self.name,
                f"Circuit '{self.name}' is open. Retry after {self.reset_timeout}s"
            )

        if current_state == CircuitState.HALF_OPEN:
            with self._local_lock:
                if self._half_open_calls >= self.half_open_max_calls:
                    self._stats.rejected += 1
                    raise CircuitOpenError(
                        self.name,
                        f"Circuit '{self.name}' is in half-open state, max test calls reached"
                    )
                self._half_open_calls += 1

        try:
            result = func(*args, **kwargs)
            self._on_success()
            return result
        except Exception as e:
            self._on_failure(e)
            raise

    @contextmanager
    def protect(self):
        """
        Context manager for circuit breaker protection.

        Usage:
            with fhir_breaker.protect():
                result = fhir_client.create_patient(data)
        """
        current_state = self.state

        if current_state == CircuitState.OPEN:
            self._stats.rejected += 1
            raise CircuitOpenError(self.name)

        if current_state == CircuitState.HALF_OPEN:
            with self._local_lock:
                if self._half_open_calls >= self.half_open_max_calls:
                    self._stats.rejected += 1
                    raise CircuitOpenError(self.name)
                self._half_open_calls += 1

        try:
            yield
            self._on_success()
        except Exception as e:
            self._on_failure(e)
            raise

    def get_stats(self) -> dict:
        """Get circuit breaker statistics."""
        return {
            'name': self.name,
            'state': self.state.value,
            'failure_count': self._failure_count,
            'failure_threshold': self.failure_threshold,
            'stats': {
                'total_failures': self._stats.failures,
                'total_successes': self._stats.successes,
                'total_rejected': self._stats.rejected,
                'last_failure': self._stats.last_failure_time,
                'last_success': self._stats.last_success_time,
            }
        }

    def reset(self) -> None:
        """Manually reset the circuit breaker to closed state."""
        with self._local_lock:
            self._state = CircuitState.CLOSED
            self._failure_count = 0
            self._success_count = 0
            self._half_open_calls = 0
            self._last_failure_time = None

            if self.use_distributed_state:
                cache.delete(self._cache_key)

            logger.info(f"Circuit '{self.name}' manually reset to CLOSED")

    @classmethod
    def get_all_stats(cls) -> Dict[str, dict]:
        """Get statistics for all circuit breakers."""
        return {name: cb.get_stats() for name, cb in cls._instances.items()}

    @classmethod
    def get_circuit(cls, name: str) -> Optional['CircuitBreaker']:
        """Get a circuit breaker by name."""
        return cls._instances.get(name)


# Pre-configured circuit breakers for common services
fhir_circuit_breaker = CircuitBreaker(
    name='fhir_api',
    failure_threshold=5,
    reset_timeout=60,
    half_open_max_calls=3,
    excluded_exceptions={KeyboardInterrupt, SystemExit}
)


def circuit_breaker(
    name: str,
    failure_threshold: int = 5,
    reset_timeout: int = 60,
    half_open_max_calls: int = 3,
    fallback: Optional[Callable] = None
):
    """
    Decorator for wrapping functions with circuit breaker protection.

    Args:
        name: Circuit breaker name
        failure_threshold: Failures before opening
        reset_timeout: Seconds before recovery attempt
        half_open_max_calls: Test calls in half-open state
        fallback: Optional fallback function to call when circuit is open

    Example:
        @circuit_breaker('external_api', fallback=lambda *args: None)
        def call_external_service(data):
            return external_api.post(data)
    """
    # Get or create circuit breaker
    cb = CircuitBreaker.get_circuit(name)
    if not cb:
        cb = CircuitBreaker(
            name=name,
            failure_threshold=failure_threshold,
            reset_timeout=reset_timeout,
            half_open_max_calls=half_open_max_calls
        )

    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(*args, **kwargs):
            try:
                return cb.call(func, *args, **kwargs)
            except CircuitOpenError:
                if fallback:
                    logger.warning(f"Circuit '{name}' open, using fallback")
                    return fallback(*args, **kwargs)
                raise

        return wrapper
    return decorator
