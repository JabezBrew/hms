#!/usr/bin/env python
"""
Dedicated migration runner for Railway pre-deploy jobs.
Runs strict preflight checks, migrations, and ensure_admin with advisory locking.
"""
import os
import sys
import time
import uuid
from datetime import datetime, timezone

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


def ensure_default_facility_seed(connection, default_code):
    """
    Seed a bootstrap facility when core_facility exists but has no rows.

    This is needed for first deploys where strict preflight requires
    DEFAULT_FACILITY_CODE to exist before facility-backfill migrations run.
    """
    if not default_code:
        return

    normalized_code = str(default_code).strip().upper()
    if not normalized_code:
        return

    table_names = set(connection.introspection.table_names())
    if "core_facility" not in table_names:
        return

    with connection.cursor() as cursor:
        cursor.execute("SELECT COUNT(*) FROM core_facility")
        facility_count = int(cursor.fetchone()[0])

        cursor.execute(
            "SELECT 1 FROM core_facility WHERE UPPER(code) = %s LIMIT 1",
            [normalized_code],
        )
        facility_exists = cursor.fetchone() is not None

        if facility_exists:
            log(f"DEFAULT_FACILITY_CODE {normalized_code} already exists.")
            return

        if facility_count > 0:
            raise RuntimeError(
                f"DEFAULT_FACILITY_CODE={normalized_code!r} does not match existing facilities. "
                "Set it to a valid code before running migrations."
            )

        now = datetime.now(timezone.utc)
        available_columns = {
            column.name
            for column in connection.introspection.get_table_description(cursor, "core_facility")
        }

        values_by_column = {
            "id": uuid.uuid4(),
            "code": normalized_code,
            "name": f"{normalized_code} Facility",
            "facility_type": "hospital",
            "address": "Bootstrap Address",
            "city": "Bootstrap City",
            "region": "",
            "country": "Ghana",
            "postal_code": "",
            "latitude": None,
            "longitude": None,
            "phone": "+0000000000",
            "email": f"{normalized_code.lower()}@example.invalid",
            "website": "",
            "timezone": "UTC",
            "currency": "GHS",
            "tax_id": "",
            "license_number": "",
            "status": "ready",
            "is_active": True,
            "is_headquarters": True,
            "provisioned_at": now,
            "created_at": now,
            "updated_at": now,
            "created_by_id": None,
            "updated_by_id": None,
            "parent_facility_id": None,
        }

        insert_columns = [key for key in values_by_column if key in available_columns]
        placeholders = ", ".join(["%s"] * len(insert_columns))
        sql = (
            f"INSERT INTO core_facility ({', '.join(insert_columns)}) "
            f"VALUES ({placeholders})"
        )
        params = [values_by_column[column] for column in insert_columns]
        cursor.execute(sql, params)
        log(f"Bootstrapped facility {normalized_code} in empty core_facility table.")


def main():
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "hms_backend.settings")

    import django

    django.setup()

    from django.conf import settings
    from django.core.management import call_command
    from django.db import connection

    wait_for_database(connection)
    ensure_default_facility_seed(connection, getattr(settings, "DEFAULT_FACILITY_CODE", None))
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
