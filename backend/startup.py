import os
import sys
import time
import django
from django.conf import settings
from django.db import connection
from django.core.management import call_command

def wait_for_db():
    """Wait for the database to be available."""
    print("Waiting for database...")
    for i in range(30):
        try:
            connection.ensure_connection()
            print("Database is ready!")
            return True
        except Exception:
            print(f"Database not ready yet, retrying ({i+1}/30)...")
            time.sleep(2)
    return False

def run_migrations():
    """Run migrations with advisory lock to prevent race conditions."""
    print("Attempting to acquire migration lock...")
    try:
        with connection.cursor() as cursor:
            # Try to acquire advisory lock (non-blocking)
            # Lock ID 1 is used for migrations
            cursor.execute('SELECT pg_try_advisory_lock(1)')
            acquired = cursor.fetchone()[0]

            if acquired:
                print('Lock acquired - running migrations...')
                try:
                    call_command('migrate', '--noinput')
                    
                    # We run ensure_admin if it exists
                    try:
                        call_command('ensure_admin')
                    except Exception as e:
                        # If command doesn't exist or fails, just log it
                        print(f'ensure_admin skipped or failed: {e}')
                        
                except Exception as e:
                    print(f"Migration failed: {e}")
                    # Release lock even if migration fails
                    raise e
                finally:
                    cursor.execute('SELECT pg_advisory_unlock(1)')
                    print('Lock released.')
            else:
                print('Another instance is running migrations, waiting...')
                # Wait for lock (blocking) then immediately release
                cursor.execute('SELECT pg_advisory_lock(1)')
                cursor.execute('SELECT pg_advisory_unlock(1)')
                print('Migrations completed by another instance.')
    except Exception as e:
        print(f"Error during migration lock handling: {e}")
        # We don't exit here, we let the app try to start, 
        # though it might fail if migrations didn't run.
        raise e

def verify_settings():
    """Print key settings for debugging."""
    print("=== Verifying Django configuration ===")
    print(f"ALLOWED_HOSTS: {settings.ALLOWED_HOSTS}")
    print(f"CORS_ALLOWED_ORIGINS: {getattr(settings, 'CORS_ALLOWED_ORIGINS', 'Not Set')}")
    print(f"DEBUG: {settings.DEBUG}")
    
    # Check DB host safely
    db_settings = settings.DATABASES.get("default", {})
    print(f"Database Host: {db_settings.get('HOST', 'Unknown')}")

if __name__ == "__main__":
    # Initialize Django
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "hms_backend.settings")
    django.setup()

    if not wait_for_db():
        print("Could not connect to database. Exiting.")
        sys.exit(1)

    run_migrations()
    verify_settings()
