from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.core.models import Facility
from apps.core.provisioning import ensure_organization_config, ensure_facility_root_unit


class Command(BaseCommand):
    help = "Create a facility record in the shared database."

    def add_arguments(self, parser):
        parser.add_argument('--code', required=True, help="Facility code (e.g., MAIN)")
        parser.add_argument('--name', required=True, help="Facility name")
        parser.add_argument('--facility-type', default='hospital', help="Facility type")
        parser.add_argument('--address', required=True, help="Street address")
        parser.add_argument('--city', required=True, help="City")
        parser.add_argument('--region', default='', help="Region/state/province")
        parser.add_argument('--country', default='Ghana', help="Country")
        parser.add_argument('--postal-code', default='', help="Postal code")
        parser.add_argument('--phone', required=True, help="Contact phone")
        parser.add_argument('--email', required=True, help="Contact email")
        parser.add_argument('--timezone', default='Africa/Accra', help="Timezone")
        parser.add_argument('--currency', default='GHS', help="Currency code")
        parser.add_argument('--parent-code', default='', help="Parent facility code")
        parser.add_argument('--headquarters', action='store_true', help="Mark as headquarters")
        parser.add_argument('--inactive', action='store_true', help="Create facility as inactive")

    @transaction.atomic
    def handle(self, *args, **options):
        code = options['code'].strip().upper()
        if Facility.objects.filter(code=code).exists():
            raise CommandError(f"Facility with code {code} already exists.")

        facility_type = options['facility_type'].strip().lower()
        valid_types = {key for key, _ in Facility.FACILITY_TYPE_CHOICES}
        if facility_type not in valid_types:
            raise CommandError(
                f"Invalid facility type {facility_type}. Valid types: {', '.join(sorted(valid_types))}"
            )

        parent = None
        parent_code = options['parent_code'].strip().upper()
        if parent_code:
            parent = Facility.objects.filter(code=parent_code).first()
            if not parent:
                raise CommandError(f"Parent facility {parent_code} not found.")

        facility = Facility.objects.create(
            code=code,
            name=options['name'].strip(),
            facility_type=facility_type,
            address=options['address'].strip(),
            city=options['city'].strip(),
            region=options['region'].strip(),
            country=options['country'].strip(),
            postal_code=options['postal_code'].strip(),
            phone=options['phone'].strip(),
            email=options['email'].strip().lower(),
            timezone=options['timezone'].strip(),
            currency=options['currency'].strip().upper(),
            parent_facility=parent,
            is_headquarters=bool(options['headquarters']),
            is_active=not bool(options['inactive']),
        )
        ensure_organization_config()
        root_unit, root_created, _root_updated = ensure_facility_root_unit(facility)

        self.stdout.write(self.style.SUCCESS(
            f"Facility created: {facility.name} ({facility.code}); "
            f"root organization unit {'created' if root_created else 'ensured'} ({root_unit.id})."
        ))
