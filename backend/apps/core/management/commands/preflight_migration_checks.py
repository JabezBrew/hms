from __future__ import annotations

from collections import OrderedDict
from typing import List, Sequence, Tuple

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


MigrationKey = Tuple[str, str]


FACILITY_FALLBACK_MIGRATIONS: Sequence[MigrationKey] = (
    ("appointments", "0007_facility_scoping"),
    ("billing", "0011_facility_scoping"),
    ("clinical_notes", "0011_facility_scoping"),
    ("drug_safety", "0002_facility_scoping"),
    ("encounters", "0002_add_facility_scoping"),
    ("inventory", "0002_facility_scoping"),
    ("inventory", "0003_stock_movement_facility"),
    ("laboratory", "0005_facility_scoping"),
    ("nursing", "0010_facility_scoping"),
    ("patients", "0002_facility_scoping"),
    ("referrals", "0003_facility_scoping"),
    ("users", "0016_patient_facility"),
    ("wards", "0017_facility_scoping"),
)


class Command(BaseCommand):
    help = (
        "Checks migration prerequisites for production deployments. "
        "Fails early when known facility backfill migrations are pending "
        "without a safe fallback configuration."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--strict",
            action="store_true",
            help=(
                "Require DEFAULT_FACILITY_CODE for multi-facility datasets "
                "when risky backfill migrations are pending."
            ),
        )

    def handle(self, *args, **options):
        strict = bool(options.get("strict"))
        pending = self._get_pending_migrations()

        if not pending:
            self.stdout.write(self.style.SUCCESS("Migration preflight passed: no pending migrations."))
            return

        pending_set = set(pending)
        risky_pending = [key for key in FACILITY_FALLBACK_MIGRATIONS if key in pending_set]
        if not risky_pending:
            self.stdout.write(
                self.style.SUCCESS(
                    f"Migration preflight passed: {len(pending)} pending migrations, none require facility fallback checks."
                )
            )
            return

        facility_table_exists = self._facility_table_exists()
        facility_count = self._count_facilities()
        default_code = self._get_default_facility_code()
        default_facility_exists = (
            self._default_facility_exists(default_code)
            if (default_code and facility_table_exists)
            else False
        )
        fallback_available = (facility_count == 1) or default_facility_exists

        errors: List[str] = []
        if default_code and facility_table_exists and not default_facility_exists:
            errors.append(
                f"DEFAULT_FACILITY_CODE={default_code!r} does not match any Facility.code."
            )

        unresolved_users_0016 = 0
        if ("users", "0016_patient_facility") in pending_set:
            unresolved_users_0016 = self._count_users_0016_unresolved_patients()
            if unresolved_users_0016 > 0 and not fallback_available:
                errors.append(
                    "users.0016_patient_facility is pending and has "
                    f"{unresolved_users_0016} PatientProfile rows without creator/staff primary_facility. "
                    "Set DEFAULT_FACILITY_CODE to a valid facility code or reduce dataset to a single facility "
                    "before running migrations."
                )

        if strict and facility_count > 1 and not default_code:
            errors.append(
                "DEFAULT_FACILITY_CODE is required in strict mode for multi-facility deployments "
                "when facility fallback migrations are pending."
            )

        if errors:
            pending_labels = ", ".join(f"{app}.{name}" for app, name in risky_pending)
            raise CommandError(
                "Migration preflight failed.\n"
                f"Pending risky migrations: {pending_labels}\n"
                + "\n".join(f"- {line}" for line in errors)
            )

        self.stdout.write(
            self.style.SUCCESS(
                "Migration preflight passed: risky backfill prerequisites satisfied."
            )
        )
        if unresolved_users_0016:
            self.stdout.write(
                f"users.0016 unresolved PatientProfile rows requiring fallback: {unresolved_users_0016}"
            )

    def _get_pending_migrations(self) -> List[MigrationKey]:
        executor = MigrationExecutor(connection)
        plan = executor.migration_plan(executor.loader.graph.leaf_nodes())

        ordered: "OrderedDict[MigrationKey, None]" = OrderedDict()
        for migration, _rollback in plan:
            key = (migration.app_label, migration.name)
            ordered[key] = None
        return list(ordered.keys())

    def _count_facilities(self) -> int:
        if not self._facility_table_exists():
            return 0
        with connection.cursor() as cursor:
            cursor.execute("SELECT COUNT(*) FROM core_facility")
            return int(cursor.fetchone()[0])

    def _facility_table_exists(self) -> bool:
        return "core_facility" in connection.introspection.table_names()

    def _get_default_facility_code(self) -> str | None:
        code = getattr(settings, "DEFAULT_FACILITY_CODE", None)
        if not code:
            return None
        normalized = str(code).strip().upper()
        return normalized or None

    def _default_facility_exists(self, code: str) -> bool:
        if not self._facility_table_exists():
            return False
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1 FROM core_facility WHERE UPPER(code) = %s LIMIT 1", [code])
            return cursor.fetchone() is not None

    def _count_users_0016_unresolved_patients(self) -> int:
        required_tables = {
            "users_patientprofile",
            "users_user",
            "users_staff",
        }
        available_tables = set(connection.introspection.table_names())
        if not required_tables.issubset(available_tables):
            return 0

        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT COUNT(*)
                FROM users_patientprofile p
                LEFT JOIN users_user u
                    ON p.created_by_id = u.id
                LEFT JOIN users_staff s
                    ON p.created_by_id = s.user_id
                WHERE COALESCE(u.primary_facility_id, s.primary_facility_id) IS NULL
                """
            )
            return int(cursor.fetchone()[0])
