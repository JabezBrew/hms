from django.core.management.base import BaseCommand, CommandError

from apps.core.models import Facility
from apps.users.models import User


class Command(BaseCommand):
    help = "Create an admin user assigned to a facility."

    def add_arguments(self, parser):
        parser.add_argument('--facility', required=True, help="Facility code")
        parser.add_argument('--email', required=True, help="Admin email")
        parser.add_argument('--password', required=True, help="Admin password")
        parser.add_argument('--first-name', default='System', help="First name")
        parser.add_argument('--last-name', default='Administrator', help="Last name")

    def handle(self, *args, **options):
        facility_code = options['facility'].strip().upper()
        facility = Facility.objects.filter(code=facility_code).first()
        if not facility:
            raise CommandError(f"Facility {facility_code} not found.")

        email = options['email'].strip().lower()
        if User.objects.filter(email=email).exists():
            raise CommandError(f"User {email} already exists.")

        username = email.split('@')[0]
        user = User.objects.create_superuser(
            username=username,
            email=email,
            password=options['password'],
            first_name=options['first_name'].strip(),
            last_name=options['last_name'].strip(),
            user_type='admin',
        )

        user.primary_facility = facility
        user.save(update_fields=['primary_facility'])
        user.facilities.add(facility)

        self.stdout.write(self.style.SUCCESS(
            f"Admin created: {user.email} (facility {facility.code})"
        ))
