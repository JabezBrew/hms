#!/usr/bin/env python
"""
Combined startup and Gunicorn launcher.
Bypasses bash to ensure we see all output in Railway logs.
"""
import os
import sys
import time
import subprocess

# Force unbuffered output IMMEDIATELY
sys.stdout = sys.stderr  # Send all output to stderr
os.environ['PYTHONUNBUFFERED'] = '1'

def log(msg):
    print(f"[startup] {msg}", flush=True)

log("=" * 50)
log("HMS Backend Starting")
log("=" * 50)
log(f"Python: {sys.version}")
log(f"PORT: {os.environ.get('PORT', 'NOT SET')}")
log(f"PWD: {os.getcwd()}")
log(f"USER: {os.getuid()}")

# Check critical env vars
secret_key = os.environ.get('SECRET_KEY')
if not secret_key:
    log("ERROR: SECRET_KEY environment variable is not set!")
    log("Available env vars: " + ", ".join(sorted(os.environ.keys())))
    sys.exit(1)
else:
    log(f"SECRET_KEY: {'*' * 8}... (set, length={len(secret_key)})")

database_url = os.environ.get('DATABASE_URL')
if not database_url:
    log("WARNING: DATABASE_URL is not set")
else:
    # Mask password in URL for logging
    log(f"DATABASE_URL: {database_url[:30]}...")

# Setup Django
log("Setting up Django...")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "hms_backend.settings")

try:
    import django
    log(f"Django version: {django.__version__}")
    django.setup()
    log("Django setup complete")
except Exception as e:
    log(f"ERROR during Django setup: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

# Import Django components
from django.conf import settings
from django.db import connection
from django.core.management import call_command

# Log settings
log(f"DEBUG: {settings.DEBUG}")
log(f"ALLOWED_HOSTS: {settings.ALLOWED_HOSTS}")

# Wait for database
log("Waiting for database...")
for attempt in range(30):
    try:
        connection.ensure_connection()
        log("Database connected!")
        break
    except Exception as e:
        log(f"DB attempt {attempt + 1}/30: {e}")
        time.sleep(2)
else:
    log("ERROR: Could not connect to database")
    sys.exit(1)

# Run migrations with advisory lock
log("Running migrations with advisory lock...")
try:
    with connection.cursor() as cursor:
        cursor.execute('SELECT pg_try_advisory_lock(1)')
        acquired = cursor.fetchone()[0]

        if acquired:
            log("Lock acquired - running migrations...")
            try:
                call_command('migrate', '--noinput', verbosity=1)
                log("Migrations complete")

                try:
                    call_command('ensure_admin')
                    log("ensure_admin complete")
                except Exception as e:
                    log(f"ensure_admin skipped: {e}")
            finally:
                cursor.execute('SELECT pg_advisory_unlock(1)')
                log("Lock released")
        else:
            log("Another instance running migrations, waiting...")
            cursor.execute('SELECT pg_advisory_lock(1)')
            cursor.execute('SELECT pg_advisory_unlock(1)')
            log("Migrations done by other instance")
except Exception as e:
    log(f"ERROR during migrations: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

# Start Gunicorn
port = os.environ.get('PORT', '8000')
log(f"Starting Gunicorn on port {port}...")
log("=" * 50)

# Use os.execvp to replace this process with gunicorn
os.execvp('gunicorn', [
    'gunicorn',
    'hms_backend.wsgi:application',
    '--bind', f'0.0.0.0:{port}',
    '--workers', '8',
    '--threads', '8',
    '--timeout', '30',
    '--access-logfile', '-',
    '--error-logfile', '-',
    '--capture-output',
    '--log-level', 'info',
])
