"""
Database router for read replica configuration.

This router directs read queries to the replica database and write queries
to the primary database, enabling horizontal scaling of read operations.

Usage:
    - Set DATABASE_ROUTERS = ['hms_backend.db_router.ReadReplicaRouter'] in settings.py
    - Configure 'replica' database in DATABASES setting
    - Use @force_primary decorator or .using('default') for operations that must read from primary

For operations that require reading their own writes (e.g., create then immediately read),
use the `using('default')` method or the `@force_primary` decorator to bypass the router.
"""

import random
from functools import wraps

# Models that should always use primary for reads (e.g., for consistency)
ALWAYS_PRIMARY_MODELS = [
    # Add model names here if they need strong consistency
    # Example: 'NursingAlert', 'VitalSigns'
]

# Thread-local storage for forcing primary
import threading
_force_primary = threading.local()


def force_primary(func):
    """
    Decorator to force a function to use the primary database for all operations.
    Useful for operations that need to read their own writes.

    Usage:
        @force_primary
        def create_and_read_patient():
            patient = Patient.objects.create(...)
            return Patient.objects.get(id=patient.id)  # Will read from primary
    """
    @wraps(func)
    def wrapper(*args, **kwargs):
        _force_primary.active = True
        try:
            return func(*args, **kwargs)
        finally:
            _force_primary.active = False
    return wrapper


def is_force_primary():
    """Check if force_primary is currently active."""
    return getattr(_force_primary, 'active', False)


class ReadReplicaRouter:
    """
    A database router that:
    - Routes read operations to replica database(s)
    - Routes write operations to the primary database
    - Supports forced primary reads via decorator
    - Handles migrations on primary only
    """

    def db_for_read(self, model, **hints):
        """
        Route read queries to the replica database.

        Falls back to 'default' if:
        - force_primary is active
        - Model is in ALWAYS_PRIMARY_MODELS
        - 'replica' database is not configured
        """
        # Check if force_primary is active
        if is_force_primary():
            return 'default'

        # Check if model requires primary
        model_name = model.__name__
        if model_name in ALWAYS_PRIMARY_MODELS:
            return 'default'

        # Check if instance hint suggests primary (for consistency after write)
        if hints.get('instance'):
            # If we're reading related objects right after a write,
            # we might want to use primary to avoid replication lag
            pass  # For now, still use replica

        # Return replica if configured, otherwise default
        from django.conf import settings
        if 'replica' in settings.DATABASES:
            return 'replica'
        return 'default'

    def db_for_write(self, model, **hints):
        """
        Route all write operations to the primary database.
        """
        return 'default'

    def allow_relation(self, obj1, obj2, **hints):
        """
        Allow relations between objects in primary and replica databases.

        Since both databases contain the same data (just with replication lag),
        relations should be allowed.
        """
        db_set = {'default', 'replica'}
        if obj1._state.db in db_set and obj2._state.db in db_set:
            return True
        return None

    def allow_migrate(self, db, app_label, model_name=None, **hints):
        """
        Block migrations on read replicas only.

        Multi-database deployments (control-plane + facility DBs) still need
        migrations, but replicas should never be migrated directly.
        """
        from django.conf import settings
        replica_names = set(getattr(settings, 'DATABASE_REPLICA_NAMES', []) or [])
        if 'replica' in settings.DATABASES:
            replica_names.add('replica')
        return db not in replica_names


class RandomReplicaRouter(ReadReplicaRouter):
    """
    Extended router that supports multiple read replicas with random selection.

    Configure multiple replicas in settings:
        DATABASES = {
            'default': {...},
            'replica_1': {...},
            'replica_2': {...},
        }
        DATABASE_REPLICA_NAMES = ['replica_1', 'replica_2']
    """

    def db_for_read(self, model, **hints):
        """Route reads to a random replica from the pool."""
        # Check if force_primary is active
        if is_force_primary():
            return 'default'

        # Check if model requires primary
        model_name = model.__name__
        if model_name in ALWAYS_PRIMARY_MODELS:
            return 'default'

        # Get list of replicas
        from django.conf import settings
        replica_names = getattr(settings, 'DATABASE_REPLICA_NAMES', None)

        if replica_names:
            return random.choice(replica_names)
        elif 'replica' in settings.DATABASES:
            return 'replica'

        return 'default'
