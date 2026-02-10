#!/usr/bin/env python
"""
Dedicated migration runner for Railway pre-deploy jobs.
Runs strict preflight checks, migrations, and ensure_admin with advisory locking.
"""
import os
import sys
import time

os.environ["PYTHONUNBUFFERED"] = "1"


def log(msg):
    print(f"[migrator] {msg}", file=sys.stderr, flush=True)


def wait_for_database(db_connection, max_attempts=30, sleep_seconds=2):
    log("Waiting for database...")
    for attempt in range(max_attempts):
        try:
            db_connection.ensure_connection()
            log("Database connected!")
            return
        except Exception as exc:
            log(f"DB attempt {attempt + 1}/{max_attempts}: {exc}")
            time.sleep(sleep_seconds)
    raise RuntimeError("Could not connect to database")


def main():
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "hms_backend.settings")

    import django

    django.setup()

    from django.core.management import call_command
    from django.db import connection

    wait_for_database(connection)
    call_command("preflight_migration_checks", strict=True)

    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_try_advisory_lock(1)")
        acquired = cursor.fetchone()[0]
        if not acquired:
            log("Another process is migrating. Waiting for lock release...")
            cursor.execute("SELECT pg_advisory_lock(1)")
            cursor.execute("SELECT pg_advisory_unlock(1)")
            log("Migration lock released by peer process.")
            return 0

        try:
            call_command("migrate", "--noinput", verbosity=1)
            call_command("ensure_admin")
        finally:
            cursor.execute("SELECT pg_advisory_unlock(1)")
            log("Migration lock released.")

    log("Migration run complete.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        log(f"Migration runner failed: {exc}")
        import traceback

        traceback.print_exc()
        sys.exit(1)
