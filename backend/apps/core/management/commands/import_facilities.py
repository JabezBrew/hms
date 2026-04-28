import csv
from datetime import datetime

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.core.models import Facility
from apps.core.provisioning import ensure_organization_config, ensure_facility_root_unit


def _parse_bool(value, default=False):
    if value is None:
        return default
    normalized = str(value).strip().lower()
    if normalized in {'1', 'true', 'yes', 'y', 'on'}:
        return True
    if normalized in {'0', 'false', 'no', 'n', 'off'}:
        return False
    return default


class Command(BaseCommand):
    help = "Import facilities from a CSV file."

    def add_arguments(self, parser):
        parser.add_argument('path', help="Path to CSV file")
        parser.add_argument(
            '--update',
            action='store_true',
            help="Update existing facilities if the code already exists"
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help="Validate and report without writing to the database"
        )

    @transaction.atomic
    def handle(self, *args, **options):
        path = options['path']
        update = bool(options['update'])
        dry_run = bool(options['dry_run'])

        try:
            with open(path, newline='', encoding='utf-8') as handle:
                rows = list(csv.DictReader(handle))
        except FileNotFoundError as exc:
            raise CommandError(f"CSV file not found: {path}") from exc
        except csv.Error as exc:
            raise CommandError(f"Invalid CSV file: {exc}") from exc

        if not rows:
            raise CommandError("CSV file is empty or missing headers.")

        required_fields = {'code', 'name', 'address', 'city', 'phone', 'email'}
        missing = required_fields - set(rows[0].keys())
        if missing:
            raise CommandError(f"Missing required columns: {', '.join(sorted(missing))}")

        valid_types = {key for key, _ in Facility.FACILITY_TYPE_CHOICES}
        existing = {facility.code: facility for facility in Facility.objects.all()}

        created = 0
        updated = 0
        pending_parents = []
        provision_targets = []

        for row in rows:
            code = (row.get('code') or '').strip().upper()
            if not code:
                raise CommandError("Facility code is required for every row.")

            facility_type = (row.get('facility_type') or 'hospital').strip().lower()
            if facility_type not in valid_types:
                raise CommandError(
                    f"Invalid facility type {facility_type} for {code}. "
                    f"Valid types: {', '.join(sorted(valid_types))}"
                )

            status = (row.get('status') or 'ready').strip().lower()
            if status not in {key for key, _ in Facility.FACILITY_STATUS_CHOICES}:
                raise CommandError(f"Invalid status {status} for {code}.")

            parent_code = (row.get('parent_code') or '').strip().upper()
            if parent_code:
                pending_parents.append((code, parent_code))

            payload = {
                'code': code,
                'name': (row.get('name') or '').strip(),
                'facility_type': facility_type,
                'address': (row.get('address') or '').strip(),
                'city': (row.get('city') or '').strip(),
                'region': (row.get('region') or '').strip(),
                'country': (row.get('country') or 'Ghana').strip(),
                'postal_code': (row.get('postal_code') or '').strip(),
                'phone': (row.get('phone') or '').strip(),
                'email': (row.get('email') or '').strip().lower(),
                'timezone': (row.get('timezone') or 'Africa/Accra').strip(),
                'currency': (row.get('currency') or 'GHS').strip().upper(),
                'status': status,
                'is_active': _parse_bool(row.get('is_active'), default=True),
                'is_headquarters': _parse_bool(row.get('is_headquarters'), default=False),
            }

            provisioned_at = row.get('provisioned_at')
            if provisioned_at:
                try:
                    payload['provisioned_at'] = datetime.fromisoformat(
                        provisioned_at.strip()
                    )
                except ValueError as exc:
                    raise CommandError(f"Invalid provisioned_at for {code}.") from exc
            elif status == 'ready':
                payload['provisioned_at'] = timezone.now()

            existing_facility = existing.get(code)
            if existing_facility:
                if not update:
                    self.stdout.write(
                        self.style.WARNING(f"Skipping existing facility {code}.")
                    )
                    provision_targets.append(existing_facility)
                    continue
                if not dry_run:
                    for field, value in payload.items():
                        setattr(existing_facility, field, value)
                    existing_facility.save()
                    provision_targets.append(existing_facility)
                updated += 1
            else:
                if not dry_run:
                    existing_facility = Facility.objects.create(**payload)
                    existing[code] = existing_facility
                    provision_targets.append(existing_facility)
                created += 1

        for child_code, parent_code in pending_parents:
            child = existing.get(child_code)
            parent = existing.get(parent_code)
            if not child or not parent:
                raise CommandError(
                    f"Parent facility {parent_code} for {child_code} not found."
                )
            if child.parent_facility_id != parent.id:
                if not dry_run:
                    child.parent_facility = parent
                    child.save(update_fields=['parent_facility'])

        if not dry_run and provision_targets:
            ensure_organization_config()
            for facility in provision_targets:
                ensure_facility_root_unit(facility)

        if dry_run:
            self.stdout.write(self.style.SUCCESS(
                f"Validated {len(rows)} rows. {created} new, {updated} updates (dry run)."
            ))
        else:
            self.stdout.write(self.style.SUCCESS(
                f"Imported facilities. {created} new, {updated} updated."
            ))
