"""
Load WHO ICD-10 codes from a ClaML XML release file.

Usage:
    python manage.py load_who_icd10 --file /path/to/icd10-2019-en.xml \\
        --release WHO-ICD10-2019

The ClaML format is the WHO standard: each code is a `<Class kind="category">`
with a `<Rubric kind="preferred"><Label>` child for the display name.

Idempotent — re-running upserts by (code_system, code).
"""
import xml.etree.ElementTree as ET
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.problems.models import CodeSystem, ProblemCategory, ProblemCode


def _label_text(class_node):
    """Extract the preferred-rubric label text from a ClaML <Class> node."""
    for rubric in class_node.findall('Rubric'):
        if rubric.get('kind') == 'preferred':
            label = rubric.find('Label')
            if label is not None:
                return ''.join(label.itertext()).strip()
    return ''


def _parent_code(class_node):
    parent = class_node.find('SuperClass')
    return parent.get('code', '') if parent is not None else ''


def _category_for_code(code: str) -> str:
    """ICD-10 chapter heuristics. Most codes are diagnoses; map a few special cases."""
    if not code:
        return ProblemCategory.OTHER
    first = code[0].upper()
    if first == 'Z':
        return ProblemCategory.SOCIAL
    if first in ('R',):
        return ProblemCategory.SYMPTOM
    return ProblemCategory.DIAGNOSIS


class Command(BaseCommand):
    help = 'Load WHO ICD-10 codes from a ClaML XML release file.'

    def add_arguments(self, parser):
        parser.add_argument('--file', required=True, help='Path to ClaML XML file.')
        parser.add_argument(
            '--release',
            default='WHO-ICD10',
            help='Release tag stored on each row (e.g. WHO-ICD10-2019).',
        )
        parser.add_argument(
            '--limit',
            type=int,
            default=None,
            help='Optional max rows (for smoke tests).',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Parse only; do not write to DB.',
        )

    def handle(self, *args, **opts):
        path = Path(opts['file'])
        if not path.exists():
            raise CommandError(f"File not found: {path}")

        release = opts['release']
        limit = opts['limit']
        dry_run = opts['dry_run']

        self.stdout.write(f"Parsing {path} (release={release})...")

        try:
            tree = ET.parse(path)
        except ET.ParseError as e:
            raise CommandError(f"XML parse error: {e}")

        root = tree.getroot()
        # ClaML wraps all classes; we accept either 'Class' anywhere or under root.
        class_nodes = root.findall('.//Class')
        if not class_nodes:
            raise CommandError("No <Class> nodes found — is this a ClaML file?")

        rows = []
        for node in class_nodes:
            kind = node.get('kind')
            # ICD-10 categories are leaf-level; we also keep blocks for hierarchy nav.
            if kind not in ('category', 'block', 'subcategory'):
                continue
            code = (node.get('code') or '').strip()
            if not code:
                continue
            display = _label_text(node)
            if not display:
                continue
            rows.append(
                {
                    'code': code,
                    'display': display,
                    'parent_code': _parent_code(node),
                    'category': _category_for_code(code),
                }
            )
            if limit and len(rows) >= limit:
                break

        self.stdout.write(f"Parsed {len(rows)} codes.")

        if dry_run:
            self.stdout.write(self.style.WARNING("Dry run — no DB writes."))
            return

        created = 0
        updated = 0
        with transaction.atomic():
            for row in rows:
                obj, was_created = ProblemCode.objects.update_or_create(
                    code_system=CodeSystem.ICD10_WHO,
                    code=row['code'],
                    defaults={
                        'display': row['display'],
                        'category': row['category'],
                        'parent_code': row['parent_code'],
                        'source_release': release,
                        'is_active': True,
                    },
                )
                if was_created:
                    created += 1
                else:
                    updated += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Done. Created: {created}, updated: {updated}, total: {len(rows)}."
            )
        )
