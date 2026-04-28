from collections import OrderedDict

from django.core.management.base import BaseCommand, CommandError
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


class Command(BaseCommand):
    help = "Report pending Django migrations and optionally fail when any are found."

    def add_arguments(self, parser):
        parser.add_argument(
            '--fail-on-pending',
            action='store_true',
            help='Exit with an error when pending migrations exist.',
        )

    @staticmethod
    def _get_pending_migrations():
        executor = MigrationExecutor(connection)
        plan = executor.migration_plan(executor.loader.graph.leaf_nodes())
        ordered = OrderedDict()
        for migration, _rollback in plan:
            ordered[(migration.app_label, migration.name)] = None
        return list(ordered.keys())

    def handle(self, *args, **options):
        pending = self._get_pending_migrations()
        if not pending:
            self.stdout.write(self.style.SUCCESS('No pending migrations detected.'))
            return

        preview = ', '.join(f'{app}.{name}' for app, name in pending[:10])
        if len(pending) > 10:
            preview = f'{preview}, ...'

        message = f'{len(pending)} pending migration(s) detected: {preview}'
        if options['fail_on_pending']:
            raise CommandError(message)
        self.stdout.write(self.style.WARNING(message))
