from django.core.management.base import BaseCommand

from apps.patients.search_index import rebuild_patient_search_index


class Command(BaseCommand):
    help = "Rebuild the compact patient search projection table."

    def add_arguments(self, parser):
        parser.add_argument(
            '--facility-id',
            default=None,
            help='Limit the rebuild to a single facility id.',
        )
        parser.add_argument(
            '--chunk-size',
            type=int,
            default=500,
            help='Number of patient rows to upsert per batch.',
        )

    def handle(self, *args, **options):
        indexed = rebuild_patient_search_index(
            facility_id=options['facility_id'],
            chunk_size=options['chunk_size'],
        )
        self.stdout.write(
            self.style.SUCCESS(f"Patient search index rebuilt for {indexed} patient record(s).")
        )
