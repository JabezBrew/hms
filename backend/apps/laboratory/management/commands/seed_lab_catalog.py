"""
Seed lab test catalog with comprehensive tests and panels.

Supports facility customization:
- System tests are marked with is_system_default=True
- Original values are stored in system_defaults for reset capability
- Facilities can modify prices, reference ranges, and TAT
- Custom facility tests can be added without affecting system defaults

Usage:
    # Seed all tests and panels (skips existing)
    python manage.py seed_lab_catalog

    # Update existing tests with new system values (preserves facility modifications)
    python manage.py seed_lab_catalog --update

    # Seed specific categories only
    python manage.py seed_lab_catalog --category hematology --category chemistry

    # Reset all facility modifications to system defaults
    python manage.py seed_lab_catalog --reset

    # Clear all tests and start fresh (DESTRUCTIVE)
    python manage.py seed_lab_catalog --clear

    # List available categories
    python manage.py seed_lab_catalog --list-categories
"""

from django.core.management.base import BaseCommand
from django.db import transaction
from decimal import Decimal

from apps.laboratory.models import LabTestCatalog, LabPanel


from apps.laboratory.seed_data import (
    get_all_tests,
    get_tests_by_category,
    get_all_panels,
    HEMATOLOGY_TESTS,
    CHEMISTRY_TESTS,
    LIVER_FUNCTION_TESTS,
    RENAL_FUNCTION_TESTS,
    LIPID_TESTS,
    THYROID_TESTS,
    CARDIAC_TESTS,
    COAGULATION_TESTS,
    URINALYSIS_TESTS,
    DIABETES_TESTS,
    ELECTROLYTE_TESTS,
    INFECTIOUS_DISEASE_TESTS,
)


AVAILABLE_CATEGORIES = [
    'hematology',
    'chemistry',
    'liver',
    'renal',
    'lipid',
    'thyroid',
    'cardiac',
    'coagulation',
    'urinalysis',
    'diabetes',
    'electrolytes',
    'infectious',
]


class Command(BaseCommand):
    help = 'Seed lab test catalog with comprehensive tests and panels'

    def add_arguments(self, parser):
        parser.add_argument(
            '--update',
            action='store_true',
            help='Update existing system tests with new values (preserves facility modifications)'
        )
        parser.add_argument(
            '--category',
            action='append',
            choices=AVAILABLE_CATEGORIES,
            help='Seed only specific categories (can be used multiple times)'
        )
        parser.add_argument(
            '--reset',
            action='store_true',
            help='Reset all facility-modified tests to system defaults'
        )
        parser.add_argument(
            '--clear',
            action='store_true',
            help='Clear ALL tests and panels before seeding (DESTRUCTIVE)'
        )
        parser.add_argument(
            '--list-categories',
            action='store_true',
            help='List available categories and exit'
        )
        parser.add_argument(
            '--no-panels',
            action='store_true',
            help='Skip panel creation'
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show what would be done without making changes'
        )

    def handle(self, *args, **options):
        if options['list_categories']:
            self.list_categories()
            return

        dry_run = options['dry_run']
        if dry_run:
            self.stdout.write(self.style.WARNING('DRY RUN - No changes will be made'))

        if options['reset']:
            self.reset_to_defaults(dry_run)
            return

        if options['clear']:
            if not dry_run:
                self.clear_all()
            else:
                self.stdout.write('Would clear all tests and panels')

        # Determine which tests to seed
        if options['category']:
            tests_data = []
            for cat in options['category']:
                tests_data.extend(get_tests_by_category(cat))
            self.stdout.write(f'Seeding categories: {", ".join(options["category"])}')
        else:
            tests_data = get_all_tests()
            self.stdout.write('Seeding all categories')

        with transaction.atomic():
            # Seed tests
            stats = self.seed_tests(tests_data, options['update'], dry_run)
            self.stdout.write(self.style.SUCCESS(
                f'Tests: {stats["created"]} created, {stats["updated"]} updated, {stats["skipped"]} skipped'
            ))

            # Seed panels
            if not options['no_panels'] and not options['category']:
                panel_stats = self.seed_panels(get_all_panels(), options['update'], dry_run)
                self.stdout.write(self.style.SUCCESS(
                    f'Panels: {panel_stats["created"]} created, {panel_stats["updated"]} updated, {panel_stats["skipped"]} skipped'
                ))

        self.stdout.write(self.style.SUCCESS('Lab catalog seeding complete!'))

    def list_categories(self):
        """List available categories with test counts."""
        self.stdout.write('\nAvailable categories:')
        self.stdout.write('-' * 40)

        category_data = [
            ('hematology', HEMATOLOGY_TESTS, 'Hematology (CBC, blood cells)'),
            ('chemistry', CHEMISTRY_TESTS, 'General Chemistry'),
            ('liver', LIVER_FUNCTION_TESTS, 'Liver Function Tests'),
            ('renal', RENAL_FUNCTION_TESTS, 'Renal/Kidney Function'),
            ('lipid', LIPID_TESTS, 'Lipid Panel'),
            ('thyroid', THYROID_TESTS, 'Thyroid Function'),
            ('cardiac', CARDIAC_TESTS, 'Cardiac Markers'),
            ('coagulation', COAGULATION_TESTS, 'Coagulation Studies'),
            ('urinalysis', URINALYSIS_TESTS, 'Urinalysis'),
            ('diabetes', DIABETES_TESTS, 'Diabetes Tests'),
            ('electrolytes', ELECTROLYTE_TESTS, 'Electrolytes'),
            ('infectious', INFECTIOUS_DISEASE_TESTS, 'Infectious Disease'),
        ]

        total = 0
        for code, tests, description in category_data:
            count = len(tests)
            total += count
            self.stdout.write(f'  {code:15} {count:3} tests - {description}')

        self.stdout.write('-' * 40)
        self.stdout.write(f'  {"TOTAL":15} {total:3} tests')
        self.stdout.write(f'\n  Panels: {len(get_all_panels())}')

    def clear_all(self):
        """Clear all tests and panels."""
        self.stdout.write(self.style.WARNING('Clearing all lab tests and panels...'))
        LabPanel.objects.all().delete()
        LabTestCatalog.objects.all().delete()
        self.stdout.write(self.style.SUCCESS('All tests and panels cleared'))

    def reset_to_defaults(self, dry_run=False):
        """Reset all facility-modified tests to system defaults."""
        modified_tests = LabTestCatalog.objects.filter(
            is_system_default=True,
            is_facility_modified=True
        )
        count = modified_tests.count()

        if count == 0:
            self.stdout.write('No facility-modified tests to reset')
            return

        if dry_run:
            self.stdout.write(f'Would reset {count} tests to system defaults')
            return

        reset_count = 0
        for test in modified_tests:
            if test.reset_to_system_defaults():
                reset_count += 1

        self.stdout.write(self.style.SUCCESS(f'Reset {reset_count} tests to system defaults'))

        # Reset panels too
        modified_panels = LabPanel.objects.filter(
            is_system_default=True,
            is_facility_modified=True
        )
        panel_count = 0
        for panel in modified_panels:
            if panel.reset_to_system_defaults():
                panel_count += 1

        if panel_count > 0:
            self.stdout.write(self.style.SUCCESS(f'Reset {panel_count} panels to system defaults'))

    def seed_tests(self, tests_data, update=False, dry_run=False):
        """Seed tests from data list."""
        stats = {'created': 0, 'updated': 0, 'skipped': 0}

        for data in tests_data:
            code = data['code']
            existing = LabTestCatalog.objects.filter(code=code).first()

            if existing:
                if update and existing.is_system_default:
                    if dry_run:
                        self.stdout.write(f'  Would update: {code}')
                        stats['updated'] += 1
                    else:
                        self._update_test(existing, data)
                        stats['updated'] += 1
                else:
                    stats['skipped'] += 1
            else:
                if dry_run:
                    self.stdout.write(f'  Would create: {code}')
                    stats['created'] += 1
                else:
                    self._create_test(data)
                    stats['created'] += 1

        return stats

    def _create_test(self, data):
        """Create a new test with system defaults stored."""
        # Store customizable fields in system_defaults
        system_defaults = {
            'price': float(data['price']),
            'reference_ranges': data['reference_ranges'],
            'tat_hours': data['tat_hours'],
        }

        LabTestCatalog.objects.create(
            code=data['code'],
            loinc_code=data.get('loinc_code'),
            name=data['name'],
            short_name=data['short_name'],
            category=data['category'],
            description=data.get('description', ''),
            specimen_type=data['specimen_type'],
            container_type=data['container_type'],
            volume_required=data.get('volume_required', ''),
            special_instructions=data.get('special_instructions', ''),
            reference_ranges=data['reference_ranges'],
            unit=data['unit'],
            tat_hours=data['tat_hours'],
            price=Decimal(str(data['price'])),
            is_active=True,
            is_system_default=True,
            is_facility_modified=False,
            system_defaults=system_defaults,
        )

    def _update_test(self, test, data):
        """Update an existing system test (preserves facility modifications if not modified)."""
        # Update system_defaults with new values
        test.system_defaults = {
            'price': float(data['price']),
            'reference_ranges': data['reference_ranges'],
            'tat_hours': data['tat_hours'],
        }

        # Update non-customizable fields
        test.loinc_code = data.get('loinc_code')
        test.name = data['name']
        test.short_name = data['short_name']
        test.category = data['category']
        test.description = data.get('description', '')
        test.specimen_type = data['specimen_type']
        test.container_type = data['container_type']
        test.volume_required = data.get('volume_required', '')
        test.special_instructions = data.get('special_instructions', '')
        test.unit = data['unit']

        # Only update customizable fields if not facility-modified
        if not test.is_facility_modified:
            test.price = Decimal(str(data['price']))
            test.reference_ranges = data['reference_ranges']
            test.tat_hours = data['tat_hours']

        test.save()

    def seed_panels(self, panels_data, update=False, dry_run=False):
        """Seed panels from data list."""
        stats = {'created': 0, 'updated': 0, 'skipped': 0}

        for data in panels_data:
            code = data['code']
            existing = LabPanel.objects.filter(code=code).first()

            if existing:
                if update and existing.is_system_default:
                    if dry_run:
                        self.stdout.write(f'  Would update panel: {code}')
                        stats['updated'] += 1
                    else:
                        self._update_panel(existing, data)
                        stats['updated'] += 1
                else:
                    stats['skipped'] += 1
            else:
                if dry_run:
                    self.stdout.write(f'  Would create panel: {code}')
                    stats['created'] += 1
                else:
                    self._create_panel(data)
                    stats['created'] += 1

        return stats

    def _create_panel(self, data):
        """Create a new panel with system defaults stored."""
        system_defaults = {
            'price': float(data['price']),
        }

        panel = LabPanel.objects.create(
            code=data['code'],
            name=data['name'],
            description=data.get('description', ''),
            price=Decimal(str(data['price'])),
            is_active=True,
            is_system_default=True,
            is_facility_modified=False,
            system_defaults=system_defaults,
        )

        # Link tests to panel
        test_codes = data.get('test_codes', [])
        tests = LabTestCatalog.objects.filter(code__in=test_codes)
        panel.tests.set(tests)

        # Warn about missing tests
        found_codes = set(tests.values_list('code', flat=True))
        missing = set(test_codes) - found_codes
        if missing:
            self.stdout.write(self.style.WARNING(
                f'  Panel {data["code"]}: Missing tests: {", ".join(missing)}'
            ))

    def _update_panel(self, panel, data):
        """Update an existing system panel."""
        panel.system_defaults = {
            'price': float(data['price']),
        }

        panel.name = data['name']
        panel.description = data.get('description', '')

        if not panel.is_facility_modified:
            panel.price = Decimal(str(data['price']))

        panel.save()

        # Update test links
        test_codes = data.get('test_codes', [])
        tests = LabTestCatalog.objects.filter(code__in=test_codes)
        panel.tests.set(tests)
