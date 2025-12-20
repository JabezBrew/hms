"""
Management command to clean up audit logs created by test users.

Usage:
    python manage.py cleanup_test_audit_logs           # Dry run (shows what would be deleted)
    python manage.py cleanup_test_audit_logs --confirm # Actually delete
"""
from django.core.management.base import BaseCommand
from apps.audit.models import AuditLog


class Command(BaseCommand):
    help = 'Clean up audit logs created by test users (emails matching *@test.com)'

    def add_arguments(self, parser):
        parser.add_argument(
            '--confirm',
            action='store_true',
            help='Actually delete the logs (default is dry run)',
        )

    def handle(self, *args, **options):
        confirm = options['confirm']

        # Find audit logs for test users (user_XXX@test.com pattern)
        test_logs = AuditLog.objects.filter(
            resource_name__endswith='@test.com'
        )

        count = test_logs.count()

        if count == 0:
            self.stdout.write(self.style.SUCCESS('No test user audit logs found.'))
            return

        if not confirm:
            self.stdout.write(f'Found {count} audit logs for test users:')
            for log in test_logs[:10]:
                self.stdout.write(f'  - {log.description} ({log.timestamp})')
            if count > 10:
                self.stdout.write(f'  ... and {count - 10} more')
            self.stdout.write('')
            self.stdout.write(self.style.WARNING(
                'Run with --confirm to delete these logs.'
            ))
            return

        # Delete the logs
        deleted, _ = test_logs.delete()
        self.stdout.write(self.style.SUCCESS(f'Deleted {deleted} test user audit logs.'))
