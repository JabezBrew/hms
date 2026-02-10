#!/usr/bin/env python
"""
Railway production startup script.
Handles database waiting, migrations with advisory locks, and config verification.
"""
import os
import sys
import time

# Force unbuffered output
os.environ['PYTHONUNBUFFERED'] = '1'

def log(msg):
    """Print with immediate flush to stderr for visibility."""
    print(f"[startup.py] {msg}", file=sys.stderr, flush=True)

def main():
    log("Starting...")

    # Set Django settings before importing Django
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "hms_backend.settings")

    log("Importing Django...")
    try:
        import django
        log(f"Django version: {django.__version__}")
    except Exception as e:
        log(f"ERROR importing Django: {e}")
        return 1

    log("Running django.setup()...")
    try:
        django.setup()
        log("Django setup complete")
    except Exception as e:
        log(f"ERROR in django.setup(): {e}")
        import traceback
        traceback.print_exc()
        return 1

    # Now import Django components
    from django.conf import settings
    from django.db import connection
    from django.core.management import call_command

    # Wait for database
    log("Waiting for database...")
    for i in range(30):
        try:
            connection.ensure_connection()
            log("Database connection successful!")
            break
        except Exception as e:
            log(f"Database not ready ({i+1}/30): {e}")
            time.sleep(2)
    else:
        log("ERROR: Could not connect to database after 30 attempts")
        return 1

    # Run migrations with advisory lock
    log("Attempting to acquire migration lock...")
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
                log("Migrations completed by another instance")
    except Exception as e:
        log(f"ERROR during migrations: {e}")
        import traceback
        traceback.print_exc()
        return 1

    # Verify settings
    log("=== Configuration ===")
    log(f"DEBUG: {settings.DEBUG}")
    log(f"ALLOWED_HOSTS: {settings.ALLOWED_HOSTS}")

    db_host = settings.DATABASES.get('default', {}).get('HOST', 'unknown')
    log(f"Database host: {db_host}")

    cors_origins = getattr(settings, 'CORS_ALLOWED_ORIGINS', [])
    log(f"CORS origins: {cors_origins}")

    log("Startup complete - ready for ASGI web server")
    return 0

if __name__ == "__main__":
    try:
        exit_code = main()
        sys.exit(exit_code)
    except Exception as e:
        log(f"FATAL ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
