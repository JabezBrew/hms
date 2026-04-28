from django.core.management.base import BaseCommand

from apps.core.provisioning import provision_default_facility_structure


class Command(BaseCommand):
    help = "Provision the deployment's default facility and root organization unit."

    def handle(self, *args, **options):
        result = provision_default_facility_structure()
        if result is None:
            self.stdout.write(
                self.style.WARNING(
                    "Skipping default facility provisioning because DEFAULT_FACILITY_CODE is not set."
                )
            )
            return

        facility_state = "created" if result.facility_created else (
            "updated" if result.facility_updated else "unchanged"
        )
        root_state = "created" if result.root_created else (
            "updated" if result.root_updated else "unchanged"
        )

        self.stdout.write(
            self.style.SUCCESS(
                "Default facility provisioned: "
                f"{result.facility.code} facility={facility_state}, root_unit={root_state}."
            )
        )
