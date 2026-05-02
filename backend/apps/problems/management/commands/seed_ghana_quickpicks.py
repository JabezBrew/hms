"""
Seed Ghana common-condition quick-picks into ProblemCode.

Reads apps/problems/seed_data/ghana_quickpicks.json. Each entry is upserted as an
ICD-10 (WHO) ProblemCode with is_quick_pick=True and needs_clinical_review=True
(must be reviewed by a Ghana-licensed clinician before going live).

Usage:
    python manage.py seed_ghana_quickpicks
    python manage.py seed_ghana_quickpicks --confirm-reviewed   # clears review flag
"""
import json
from pathlib import Path

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.problems.models import CodeSystem, ProblemCategory, ProblemCode

SEED_PATH = Path(__file__).resolve().parents[2] / 'seed_data' / 'ghana_quickpicks.json'

SOURCE_RELEASE = 'GH-QUICKPICKS-2026-05'

CATEGORY_MAP = {
    'diagnosis': ProblemCategory.DIAGNOSIS,
    'symptom': ProblemCategory.SYMPTOM,
    'finding': ProblemCategory.FINDING,
    'social': ProblemCategory.SOCIAL,
}


class Command(BaseCommand):
    help = 'Seed Ghana common-condition quick-picks (ICD-10 WHO).'

    def add_arguments(self, parser):
        parser.add_argument(
            '--confirm-reviewed',
            action='store_true',
            help='Mark all seeded entries as clinically reviewed (clears needs_clinical_review).',
        )

    def handle(self, *args, **opts):
        if not SEED_PATH.exists():
            self.stderr.write(f"Seed file missing: {SEED_PATH}")
            return

        with SEED_PATH.open('r', encoding='utf-8') as f:
            entries = json.load(f)

        confirm_reviewed = opts['confirm_reviewed']

        created = 0
        updated = 0
        with transaction.atomic():
            for entry in entries:
                code = entry['code']
                category = CATEGORY_MAP.get(entry.get('category', 'diagnosis'), ProblemCategory.DIAGNOSIS)

                obj, was_created = ProblemCode.objects.update_or_create(
                    code_system=CodeSystem.ICD10_WHO,
                    code=code,
                    defaults={
                        'display': entry['display'],
                        'category': category,
                        'is_chronic_default': bool(entry.get('chronic', False)),
                        'is_quick_pick': True,
                        'quick_pick_rank': int(entry.get('rank', 0)),
                        'is_active': True,
                        'needs_clinical_review': not confirm_reviewed,
                        'source_release': SOURCE_RELEASE,
                    },
                )
                if was_created:
                    created += 1
                else:
                    updated += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Ghana quick-picks: created {created}, updated {updated}, total {len(entries)}."
            )
        )
        if not confirm_reviewed:
            self.stdout.write(
                self.style.WARNING(
                    "All entries flagged needs_clinical_review=True. "
                    "Re-run with --confirm-reviewed once a Ghana-licensed clinician signs off."
                )
            )
