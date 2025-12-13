#!/bin/bash
# Backend entrypoint script
# Runs migrations and seeds before starting the application

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

# Run migrations
echo "Running migrations..."
python manage.py migrate --noinput

# Seed data (only if tables are empty or users don't exist)
echo "Checking seed data..."

# Seed test users if admin doesn't exist
python manage.py shell -c "
from apps.users.models import User
if not User.objects.filter(email='admin@hms.local').exists():
    print('Seeding test users...')
    exit(1)
else:
    print('Test users already exist, skipping seed.')
    exit(0)
" || python manage.py seed_test_users

# Seed other data
python manage.py seed_default_templates 2>/dev/null || echo "Note: seed_default_templates skipped or already done"
python manage.py seed_lab_catalog 2>/dev/null || echo "Note: seed_lab_catalog skipped or already done"
python manage.py seed_bed_amenities 2>/dev/null || echo "Note: seed_bed_amenities skipped or already done"

echo "=== Starting application ==="

# Execute the main command (passed as arguments)
exec "$@"
