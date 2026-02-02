from datetime import date

from django.core.management.base import BaseCommand
from django.db import connection


TABLES = [
    {"table": "nursing_vitalsigns", "timestamp_col": "recorded_at"},
    {"table": "charts_chartentry", "timestamp_col": "observation_datetime"},
    {"table": "laboratory_labresult", "timestamp_col": "performed_at"},
    {"table": "audit_logs", "timestamp_col": "timestamp"},
]


def _add_months(source_date, months):
    month = source_date.month - 1 + months
    year = source_date.year + month // 12
    month = month % 12 + 1
    return date(year, month, 1)


class Command(BaseCommand):
    help = "Create monthly partitions for time-series tables (PostgreSQL only)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--future-months",
            type=int,
            default=2,
            help="How many future months (in addition to current) to create partitions for.",
        )
        parser.add_argument(
            "--include-previous",
            action="store_true",
            help="Also create a partition for the previous month.",
        )

    def handle(self, *args, **options):
        if connection.vendor != "postgresql":
            self.stdout.write(self.style.WARNING("Partitioning skipped: not a PostgreSQL database."))
            return

        months = list(range(0, options["future_months"] + 1))
        if options["include_previous"]:
            months = [-1] + months

        with connection.cursor() as cursor:
            for table in TABLES:
                table_name = table["table"]

                cursor.execute("SELECT to_regclass(%s)", [table_name])
                exists = cursor.fetchone()[0]
                if not exists:
                    self.stdout.write(self.style.WARNING(f"Table {table_name} does not exist."))
                    continue

                cursor.execute(
                    """
                    SELECT EXISTS (
                        SELECT 1
                        FROM pg_partitioned_table p
                        JOIN pg_class c ON c.oid = p.partrelid
                        WHERE c.relname = %s
                    )
                    """,
                    [table_name],
                )
                is_partitioned = cursor.fetchone()[0]
                if not is_partitioned:
                    self.stdout.write(
                        self.style.WARNING(
                            f"Table {table_name} is not partitioned. Skipping."
                        )
                    )
                    continue

                for offset in months:
                    start = _add_months(date.today().replace(day=1), offset)
                    end = _add_months(start, 1)
                    partition_name = f"{table_name}_p{start.strftime('%Y%m')}"

                    cursor.execute(
                        f"""
                        CREATE TABLE IF NOT EXISTS {partition_name}
                        PARTITION OF {table_name}
                        FOR VALUES FROM (%s) TO (%s)
                        """,
                        [start.isoformat(), end.isoformat()],
                    )

                self.stdout.write(self.style.SUCCESS(f"Partitions ensured for {table_name}."))
