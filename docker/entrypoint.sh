#!/bin/bash
# Backend entrypoint script
# Validates dependencies and migration state before starting the application.

set -e

echo "=== HMS Backend Startup ==="

# Wait for database to be ready
echo "Waiting for database..."
while ! python -c "
import django
django.setup()
from django.db import connection
connection.ensure_connection()
" 2>/dev/null; do
    echo "Database not ready, waiting..."
    sleep 2
done
echo "Database is ready!"

echo "Running startup preflight checks..."
python manage.py preflight_migration_checks --strict

FAIL_ON_PENDING_MIGRATIONS="${FAIL_ON_PENDING_MIGRATIONS:-true}"
if [ "${FAIL_ON_PENDING_MIGRATIONS}" = "true" ] || [ "${FAIL_ON_PENDING_MIGRATIONS}" = "1" ]; then
    python manage.py check_pending_migrations --fail-on-pending
else
    python manage.py check_pending_migrations
fi

echo "=== Starting application ==="

# Execute the main command (passed as arguments)
exec "$@"
