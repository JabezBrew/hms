from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model

User = get_user_model()

class Command(BaseCommand):
    help = 'Resets passwords for test users to a specific value'

    def add_arguments(self, parser):
        parser.add_argument(
            '--password',
            type=str,
            default='Admin123!',
            help='The password to set for all test users'
        )

    def handle(self, *args, **options):
        password = options['password']
        
        test_emails = [
            'admin@hms.com',
            'doctor@hms.com',
            'nurse@hms.com',
            'receptionist@hms.com',
            'lab_tech@hms.com',
            'pharmacist@hms.com',
            'billing@hms.com'
        ]

        self.stdout.write('Resetting passwords for test users...')

        for email in test_emails:
            try:
                user = User.objects.get(email=email)
                user.set_password(password)
                user.save()
                self.stdout.write(self.style.SUCCESS(f'Successfully reset password for {email}'))
            except User.DoesNotExist:
                self.stdout.write(self.style.WARNING(f'User {email} not found'))

        self.stdout.write(self.style.SUCCESS('Password reset complete'))
