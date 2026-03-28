"""
Seed deterministic smoke-test data for frontend E2E runs.
"""
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from apps.core.models import Facility
from apps.users.identifiers import generate_unique_mrn
from apps.users.models import PatientProfile


class Command(BaseCommand):
    help = "Seed deterministic admin/facility/patient data for Playwright smoke tests."

    def add_arguments(self, parser):
        parser.add_argument(
            "--patient-email",
            default="smoke.patient@hms.test",
            help="Smoke patient email address.",
        )
        parser.add_argument(
            "--patient-first-name",
            default="Smoke",
            help="Smoke patient first name.",
        )
        parser.add_argument(
            "--patient-last-name",
            default="Patient",
            help="Smoke patient last name.",
        )

    def handle(self, *args, **options):
        User = get_user_model()
        default_code = (getattr(settings, "DEFAULT_FACILITY_CODE", "") or "").strip().upper()
        if not default_code:
            raise CommandError("DEFAULT_FACILITY_CODE must be set before seeding smoke data.")

        facility = Facility.objects.filter(code=default_code).first()
        if facility is None:
            raise CommandError(
                f"Facility with code {default_code!r} was not found. "
                "Run provision_default_facility first."
            )

        admin_user = User.objects.filter(is_superuser=True).order_by("date_joined").first()
        if admin_user is None:
            raise CommandError("No superuser found. Run ensure_admin before seeding smoke data.")

        patient_email = options["patient_email"].strip().lower()
        first_name = options["patient_first_name"].strip() or "Smoke"
        last_name = options["patient_last_name"].strip() or "Patient"
        username = patient_email.split("@", 1)[0]

        patient_user, _created = User.objects.get_or_create(
            email=patient_email,
            defaults={
                "username": username,
                "first_name": first_name,
                "last_name": last_name,
                "user_type": "patient",
                "is_active": True,
                "primary_facility": facility,
                "gender": "O",
            },
        )

        user_updates = []
        if patient_user.username != username:
            patient_user.username = username
            user_updates.append("username")
        if patient_user.first_name != first_name:
            patient_user.first_name = first_name
            user_updates.append("first_name")
        if patient_user.last_name != last_name:
            patient_user.last_name = last_name
            user_updates.append("last_name")
        if patient_user.user_type != "patient":
            patient_user.user_type = "patient"
            user_updates.append("user_type")
        if patient_user.primary_facility_id != facility.id:
            patient_user.primary_facility = facility
            user_updates.append("primary_facility")
        if not patient_user.is_active:
            patient_user.is_active = True
            user_updates.append("is_active")
        if user_updates:
            patient_user.save(update_fields=user_updates)
        patient_user.facilities.add(facility)

        patient_profile, profile_created = PatientProfile.objects.get_or_create(
            user=patient_user,
            defaults={
                "facility": facility,
                "medical_record_number": generate_unique_mrn(facility),
                "created_by": admin_user,
                "updated_by": admin_user,
            },
        )

        profile_updates = []
        if patient_profile.facility_id != facility.id:
            patient_profile.facility = facility
            profile_updates.append("facility")
        if not patient_profile.medical_record_number:
            patient_profile.medical_record_number = generate_unique_mrn(facility)
            profile_updates.append("medical_record_number")
        if patient_profile.created_by_id is None:
            patient_profile.created_by = admin_user
            profile_updates.append("created_by")
        if patient_profile.updated_by_id != admin_user.id:
            patient_profile.updated_by = admin_user
            profile_updates.append("updated_by")
        if profile_updates:
            patient_profile.save(update_fields=profile_updates)

        self.stdout.write(
            self.style.SUCCESS(
                "Smoke E2E data ready: "
                f"patient={patient_user.get_full_name()} "
                f"mrn={patient_profile.medical_record_number} "
                f"id={patient_profile.id} "
                f"created={profile_created}"
            )
        )
