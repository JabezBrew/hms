#!/bin/bash
# Railway production entrypoint script
# Handles database migration with advisory locks to prevent race conditions
set -e

echo "=== HMS Backend Startup ==="
echo "PORT: ${PORT:-8000}"
echo "DJANGO_SETTINGS_MODULE: ${DJANGO_SETTINGS_MODULE:-not set}"
echo "Working directory: $(pwd)"

# Wait for database to be ready
echo "Waiting for database..."
until python -c "
import django
django.setup()
from django.db import connection
connection.ensure_connection()
" 2>/dev/null; do
    echo "Database not ready, waiting..."
    sleep 2
done
echo "Database is ready!"

# Run migrations with advisory lock to prevent race conditions
# Lock ID 1 is used for migrations - only one instance can hold it
echo "Attempting to acquire migration lock..."

python -c "
import django
django.setup()
from django.db import connection
from django.core.management import call_command

with connection.cursor() as cursor:
    # Try to acquire advisory lock (non-blocking)
    cursor.execute('SELECT pg_try_advisory_lock(1)')
    acquired = cursor.fetchone()[0]

    if acquired:
        print('Lock acquired - running migrations...')
        try:
            call_command('migrate', '--noinput')
            call_command('collectstatic', '--noinput', verbosity=0)
            try:
                call_command('ensure_admin')
            except Exception as e:
                print(f'ensure_admin skipped: {e}')
        finally:
            cursor.execute('SELECT pg_advisory_unlock(1)')
            print('Lock released.')
    else:
        print('Another instance is running migrations, waiting...')
        # Wait for lock (blocking) then immediately release
        cursor.execute('SELECT pg_advisory_lock(1)')
        cursor.execute('SELECT pg_advisory_unlock(1)')
        print('Migrations completed by another instance.')
"

# Verify Django settings before starting
echo "=== Verifying Django configuration ==="
python -c "
import django
django.setup()
from django.conf import settings
print(f'ALLOWED_HOSTS: {settings.ALLOWED_HOSTS}')
print(f'DEBUG: {settings.DEBUG}')
print(f'Database: {settings.DATABASES[\"default\"][\"HOST\"]}')
"

echo "=== Starting Gunicorn on port ${PORT:-8000} ==="
exec gunicorn hms_backend.wsgi:application \
    --bind 0.0.0.0:${PORT:-8000} \
    --workers 8 \
    --threads 8 \
    --timeout 30 \
    --access-logfile - \
    --error-logfile -
