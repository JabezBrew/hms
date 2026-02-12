#!/usr/bin/env python
"""
Combined startup and ASGI launcher.
Bypasses bash to ensure we see all output in Railway logs.
"""
import os
import sys
import time
import uuid
from collections import OrderedDict
from datetime import datetime, timezone

# Force unbuffered output IMMEDIATELY
sys.stdout = sys.stderr  # Send all output to stderr
os.environ['PYTHONUNBUFFERED'] = '1'


TRUE_VALUES = {"1", "true", "yes", "on"}


def log(msg):
    print(f"[startup] {msg}", flush=True)


def parse_bool(raw_value, default):
    if raw_value is None:
        return default
    return str(raw_value).strip().lower() in TRUE_VALUES


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
    log("ERROR: Could not connect to database")
    sys.exit(1)


def get_pending_migrations(db_connection):
    from django.db.migrations.executor import MigrationExecutor

    executor = MigrationExecutor(db_connection)
    plan = executor.migration_plan(executor.loader.graph.leaf_nodes())
    ordered = OrderedDict()
    for migration, _rollback in plan:
        ordered[(migration.app_label, migration.name)] = None
    return list(ordered.keys())


def ensure_default_facility_seed(connection, default_code):
    """
    Seed a bootstrap facility when core_facility exists but has no rows.

    This keeps startup migration mode aligned with run_migrations.py behavior.
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


def run_migrations_with_lock(db_connection, call_command, default_facility_code):
    log("Attempting to acquire migration advisory lock...")
    with db_connection.cursor() as cursor:
        cursor.execute("SELECT pg_try_advisory_lock(1)")
        acquired = bool(cursor.fetchone()[0])

    if acquired:
        log("Migration lock acquired.")
    else:
        log("Another instance is handling migrations. Waiting for lock...")
        with db_connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_lock(1)")
        log("Migration lock acquired after wait.")

    pending = []
    log("Running migration preflight checks...")
    try:
        pending = get_pending_migrations(db_connection)
        if pending:
            preview = ", ".join(f"{app}.{name}" for app, name in pending[:5])
            if len(pending) > 5:
                preview = f"{preview}, ..."
            log(f"{len(pending)} pending migration(s) detected: {preview}")
        else:
            log("No pending migrations detected once lock acquired.")

        ensure_default_facility_seed(db_connection, default_facility_code)
        call_command("preflight_migration_checks", strict=True)
        log("Migration preflight checks passed")

        if pending:
            log("Running migrations...")
            call_command("migrate", interactive=False, verbosity=1)
            log("Migrations complete")
        else:
            log("Skipping migrate command; schema is already up to date.")

        try:
            call_command("ensure_admin")
            log("ensure_admin complete")
        except Exception as exc:
            log(f"ensure_admin skipped: {exc}")
    finally:
        with db_connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_unlock(1)")
            lock_released = bool(cursor.fetchone()[0])
        if lock_released:
            log("Migration lock released")
        else:
            log("WARNING: Migration advisory lock was not held at release time.")


log("=" * 50)
log("HMS Backend Starting")
log("=" * 50)
log(f"Python: {sys.version}")
log(f"PORT: {os.environ.get('PORT', 'NOT SET')}")
log(f"PWD: {os.getcwd()}")
log(f"USER: {os.getuid()}")

run_migrations_only = parse_bool(os.environ.get("RUN_MIGRATIONS_ONLY"), default=False)
if run_migrations_only:
    log("RUN_MIGRATIONS_ONLY=True detected. Delegating to run_migrations.py and exiting.")
    os.execvp(sys.executable, [sys.executable, "/app/run_migrations.py"])

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

wait_for_database(connection)

migrate_on_startup = parse_bool(
    os.environ.get("MIGRATE_ON_STARTUP"),
    default=True,
)
fail_on_pending = parse_bool(
    os.environ.get("FAIL_ON_PENDING_MIGRATIONS"),
    default=not bool(settings.DEBUG),
)

log(
    "Startup migration mode: "
    f"MIGRATE_ON_STARTUP={migrate_on_startup}, "
    f"FAIL_ON_PENDING_MIGRATIONS={fail_on_pending}"
)

try:
    if migrate_on_startup:
        run_migrations_with_lock(
            connection,
            call_command,
            getattr(settings, "DEFAULT_FACILITY_CODE", None),
        )
    else:
        pending = get_pending_migrations(connection)
        if pending:
            preview = ", ".join(f"{app}.{name}" for app, name in pending[:5])
            if len(pending) > 5:
                preview = f"{preview}, ..."
            message = (
                f"{len(pending)} pending migration(s) detected while MIGRATE_ON_STARTUP is disabled: "
                f"{preview}. Run a dedicated migrator job before serving this release."
            )
            if fail_on_pending:
                log(f"ERROR: {message}")
                sys.exit(1)
            log(f"WARNING: {message}")
        else:
            log("No pending migrations detected.")
except Exception as e:
    log(f"ERROR during startup migration stage: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

# Start Daphne (ASGI server for HTTP + WebSocket support)
port = os.environ.get('PORT', '8000')
log(f"Starting Daphne on port {port}...")
log("=" * 50)

# Use os.execvp to replace this process with daphne
os.execvp('daphne', [
    'daphne',
    '--bind', '0.0.0.0',
    '--port', str(port),
    '--proxy-headers',
    '--access-log', '-',
    '--websocket_timeout', '-1',
    'hms_backend.asgi:application',
])
