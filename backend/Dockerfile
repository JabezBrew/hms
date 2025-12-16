# Backend Dockerfile for Railway deployment
# Multi-stage build: builds dependencies, then runs Django with Gunicorn
#
# This Dockerfile is designed to be built from the backend/ directory

# Build stage
FROM python:3.11-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt gunicorn

# Production image
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DJANGO_SETTINGS_MODULE=hms_backend.settings

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --shell /bin/bash appuser

# Copy Python packages from builder
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Copy application code
COPY . .

# Create startup script with PostgreSQL advisory lock to prevent migration race conditions
RUN cat > /start.sh << 'SCRIPT'
#!/bin/bash
set -e

echo "=== HMS Backend Startup ==="

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
python << 'PYTHON'
import django
django.setup()
from django.db import connection
from django.core.management import call_command

with connection.cursor() as cursor:
    # Try to acquire advisory lock (non-blocking)
    cursor.execute("SELECT pg_try_advisory_lock(1)")
    acquired = cursor.fetchone()[0]

    if acquired:
        print("Lock acquired - running migrations...")
        try:
            call_command('migrate', '--noinput')
            call_command('collectstatic', '--noinput', verbosity=0)
            try:
                call_command('ensure_admin')
            except Exception as e:
                print(f"ensure_admin skipped: {e}")
        finally:
            cursor.execute("SELECT pg_advisory_unlock(1)")
            print("Lock released.")
    else:
        print("Another instance is running migrations, waiting...")
        # Wait for lock (blocking) then immediately release
        cursor.execute("SELECT pg_advisory_lock(1)")
        cursor.execute("SELECT pg_advisory_unlock(1)")
        print("Migrations completed by another instance.")
PYTHON

echo "=== Starting Gunicorn on port ${PORT:-8000} ==="
exec gunicorn hms_backend.wsgi:application \
    --bind 0.0.0.0:${PORT:-8000} \
    --workers 16 \
    --threads 16 \
    --timeout 30 \
    --access-logfile - \
    --error-logfile -
SCRIPT
RUN chmod +x /start.sh

# Create logs directory and set permissions
RUN mkdir -p /app/logs && chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Expose port (Railway sets PORT env var)
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:${PORT:-8000}/api/health/ || exit 1

# Start the application
CMD ["/start.sh"]
