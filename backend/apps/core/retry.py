"""
Retry utilities for Celery tasks.

Provides standardized exponential backoff with jitter for all async tasks.

Usage in Celery tasks:
    from apps.core.retry import get_retry_countdown, RetryConfig

    @shared_task(bind=True, max_retries=5)
    def my_task(self, data):
        try:
            # ... task logic
        except TransientError as e:
            raise self.retry(
                exc=e,
                countdown=get_retry_countdown(self.request.retries)
            )

    # Or with custom config:
    config = RetryConfig(base_delay=30, max_delay=1800)

    @shared_task(bind=True, max_retries=config.max_retries)
    def my_critical_task(self, data):
        try:
            # ... task logic
        except TransientError as e:
            raise self.retry(
                exc=e,
                countdown=config.get_countdown(self.request.retries)
            )
"""
import random
from dataclasses import dataclass
from typing import Optional


@dataclass
class RetryConfig:
    """
    Configuration for retry behavior with exponential backoff.

    Attributes:
        base_delay: Initial delay in seconds (default: 60)
        max_delay: Maximum delay cap in seconds (default: 3600 = 1 hour)
        max_retries: Maximum number of retry attempts (default: 5)
        jitter: Random jitter range in seconds (default: 10)
        exponential_base: Base for exponential calculation (default: 2)
    """
    base_delay: int = 60
    max_delay: int = 3600
    max_retries: int = 5
    jitter: int = 10
    exponential_base: int = 2

    def get_countdown(self, attempt: int) -> int:
        """
        Calculate the retry countdown for a given attempt number.

        Uses exponential backoff with jitter:
        delay = min(base_delay * (exponential_base ** attempt) + jitter, max_delay)

        Args:
            attempt: Current retry attempt number (0-indexed)

        Returns:
            Countdown in seconds until next retry
        """
        delay = self.base_delay * (self.exponential_base ** attempt)
        delay = min(delay, self.max_delay)
        # Add random jitter to prevent thundering herd
        delay += random.uniform(0, self.jitter)
        return int(delay)


# Default configuration for standard tasks
DEFAULT_CONFIG = RetryConfig(
    base_delay=60,      # 1 minute initial delay
    max_delay=3600,     # 1 hour max delay
    max_retries=5,      # 5 retries total
    jitter=10           # Up to 10 seconds random jitter
)

# Configuration for critical tasks (faster initial retry, longer max)
CRITICAL_CONFIG = RetryConfig(
    base_delay=30,      # 30 seconds initial delay
    max_delay=7200,     # 2 hours max delay
    max_retries=7,      # More retries for critical tasks
    jitter=5            # Less jitter for predictability
)

# Configuration for email tasks (longer delays, fewer retries)
EMAIL_CONFIG = RetryConfig(
    base_delay=120,     # 2 minutes initial delay
    max_delay=3600,     # 1 hour max delay
    max_retries=3,      # 3 retries for emails
    jitter=30           # More jitter to spread email load
)

# Configuration for external API tasks (aggressive retries)
EXTERNAL_API_CONFIG = RetryConfig(
    base_delay=15,      # 15 seconds initial delay
    max_delay=900,      # 15 minutes max delay
    max_retries=5,      # 5 retries
    jitter=5            # Low jitter
)


def get_retry_countdown(
    attempt: int,
    base_delay: int = 60,
    max_delay: int = 3600,
    jitter: int = 10
) -> int:
    """
    Calculate retry countdown with exponential backoff.

    Convenience function for simple use cases. For more control,
    use RetryConfig directly.

    Args:
        attempt: Current retry attempt number (0-indexed)
        base_delay: Base delay in seconds
        max_delay: Maximum delay cap in seconds
        jitter: Random jitter range in seconds

    Returns:
        Countdown in seconds until next retry

    Example:
        # In Celery task
        raise self.retry(
            exc=e,
            countdown=get_retry_countdown(self.request.retries)
        )
    """
    delay = base_delay * (2 ** attempt)
    delay = min(delay, max_delay)
    delay += random.uniform(0, jitter)
    return int(delay)


def should_retry(
    exception: Exception,
    retryable_exceptions: Optional[tuple] = None,
    non_retryable_exceptions: Optional[tuple] = None
) -> bool:
    """
    Determine if an exception should trigger a retry.

    Args:
        exception: The exception that was raised
        retryable_exceptions: Tuple of exception types that should be retried
        non_retryable_exceptions: Tuple of exception types that should NOT be retried

    Returns:
        True if the exception should trigger a retry

    Example:
        from requests.exceptions import Timeout, ConnectionError

        if should_retry(e, retryable_exceptions=(Timeout, ConnectionError)):
            raise self.retry(exc=e, countdown=get_retry_countdown(self.request.retries))
        else:
            raise e
    """
    # If non-retryable is specified and matches, don't retry
    if non_retryable_exceptions and isinstance(exception, non_retryable_exceptions):
        return False

    # If retryable is specified, only retry if it matches
    if retryable_exceptions:
        return isinstance(exception, retryable_exceptions)

    # Default: retry all exceptions
    return True
