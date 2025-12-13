from django.core.management.base import BaseCommand
from apps.wards.models import BedAmenity


class Command(BaseCommand):
    help = 'Seed default bed amenities'

    def handle(self, *args, **options):
        self.stdout.write('Seeding bed amenities...')

        amenities = [
            {
                'code': 'oxygen',
                'name': 'Oxygen Supply',
                'description': 'Bedside oxygen supply',
                'icon': 'wind',
                'category': 'medical',
                'additional_rate': 0.00
            },
            {
                'code': 'suction',
                'name': 'Suction',
                'description': 'Suction equipment',
                'icon': 'droplets',
                'category': 'medical',
                'additional_rate': 0.00
            },
            {
                'code': 'cardiac_monitor',
                'name': 'Cardiac Monitor',
                'description': 'Cardiac monitoring equipment',
                'icon': 'heart-pulse',
                'category': 'medical',
                'additional_rate': 50.00
            },
            {
                'code': 'ventilator',
                'name': 'Ventilator Access',
                'description': 'Ventilator connection',
                'icon': 'activity',
                'category': 'medical',
                'additional_rate': 200.00
            },
            {
                'code': 'private_bathroom',
                'name': 'Private Bathroom',
                'description': 'Private ensuite bathroom',
                'icon': 'bath',
                'category': 'comfort',
                'additional_rate': 100.00
            },
            {
                'code': 'tv',
                'name': 'TV/Entertainment',
                'description': 'Television and entertainment system',
                'icon': 'tv',
                'category': 'comfort',
                'additional_rate': 25.00
            },
            {
                'code': 'window',
                'name': 'Window View',
                'description': 'Room with window view',
                'icon': 'sun',
                'category': 'comfort',
                'additional_rate': 30.00
            },
            {
                'code': 'wheelchair_accessible',
                'name': 'Wheelchair Accessible',
                'description': 'Wheelchair accessible room',
                'icon': 'accessibility',
                'category': 'accessibility',
                'additional_rate': 0.00
            },
            {
                'code': 'nurse_call',
                'name': 'Nurse Call System',
                'description': 'Bedside nurse call button',
                'icon': 'bell',
                'category': 'safety',
                'additional_rate': 0.00
            },
            {
                'code': 'fall_prevention',
                'name': 'Fall Prevention Rails',
                'description': 'Safety rails for fall prevention',
                'icon': 'shield',
                'category': 'safety',
                'additional_rate': 0.00
            },
            {
                'code': 'recliner',
                'name': 'Reclining Chair',
                'description': 'Comfortable reclining chair for visitors',
                'icon': 'armchair',
                'category': 'comfort',
                'additional_rate': 15.00
            },
            {
                'code': 'refrigerator',
                'name': 'Refrigerator',
                'description': 'Personal refrigerator in room',
                'icon': 'refrigerator',
                'category': 'comfort',
                'additional_rate': 20.00
            },
        ]

        created_count = 0
        updated_count = 0
        skipped_count = 0

        for amenity_data in amenities:
            amenity, created = BedAmenity.objects.update_or_create(
                code=amenity_data['code'],
                defaults={
                    'name': amenity_data['name'],
                    'description': amenity_data.get('description', ''),
                    'icon': amenity_data.get('icon', ''),
                    'category': amenity_data['category'],
                    'additional_rate': amenity_data['additional_rate'],
                    'is_active': True,
                }
            )

            if created:
                created_count += 1
                self.stdout.write(
                    self.style.SUCCESS(f'✓ Created: {amenity.name}')
                )
            else:
                updated_count += 1
                self.stdout.write(
                    self.style.WARNING(f'↻ Updated: {amenity.name}')
                )

        self.stdout.write(
            self.style.SUCCESS(
                f'\nCompleted! Created: {created_count}, Updated: {updated_count}'
            )
        )
