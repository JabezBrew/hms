"""
API-driven staging data seeder for connected end-to-end HMS workflows.

This command intentionally uses API endpoints for operational data creation
so serializer/view/business rules execute as they do in production.

Non-API bootstrap fallback is used only for entities that do not currently
have create endpoints (Facility + core Department).
"""
from __future__ import annotations

import json
import random
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Any

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from rest_framework.test import APIClient

from apps.appointments.models import AppointmentType, RecurringSchedule
from apps.clinical_notes.models import NoteTemplate
from apps.core.models import Department, Facility
from apps.encounters.models import Encounter
from apps.laboratory.models import LabSpecimen, LabTestCatalog
from apps.organization.models import ClinicalUnit, Clinic, ClinicSchedule, StaffAssignmentTypeConfig, UnitTypeConfig
from apps.users.models import PatientProfile, PractitionerProfile, Staff

User = get_user_model()


PROFILE_CONFIGS: dict[str, dict[str, int]] = {
    "smoke": {
        "facilities": 1,
        "patients_per_facility": 8,
    },
    "standard": {
        "facilities": 2,
        "patients_per_facility": 30,
    },
    "large": {
        "facilities": 3,
        "patients_per_facility": 80,
    },
}


ROLE_SPECS: dict[str, dict[str, Any]] = {
    "doctor": {
        "first_name": "Ari",
        "last_name": "Mensah",
        "user_type": "doctor",
        "department": "Outpatient Care",
        "position": "Consultant Physician",
        "license_number": "DOC-{FAC}-001",
        "specialization": "General Medicine",
        "qualification": "MBChB, FWACP",
    },
    "nurse": {
        "first_name": "Esi",
        "last_name": "Boadu",
        "user_type": "nurse",
        "department": "Outpatient Care",
        "position": "Senior Registered Nurse",
        "license_number": "NUR-{FAC}-001",
        "specialization": "General Nursing",
        "qualification": "BSc Nursing, RN",
    },
    "receptionist": {
        "first_name": "Kojo",
        "last_name": "Owusu",
        "user_type": "receptionist",
        "department": "Front Desk",
        "position": "Front Desk Officer",
    },
    "lab_technician": {
        "first_name": "Naa",
        "last_name": "Akoto",
        "user_type": "lab_technician",
        "department": "Laboratory",
        "position": "Medical Laboratory Scientist",
    },
    "pharmacist": {
        "first_name": "Yaw",
        "last_name": "Sarpong",
        "user_type": "pharmacist",
        "department": "Pharmacy",
        "position": "Clinical Pharmacist",
    },
}


LAB_TEST_SPECS: list[dict[str, Any]] = [
    {
        "code": "STG-FBC",
        "name": "Staging Full Blood Count",
        "short_name": "FBC",
        "category": "hematology",
        "specimen_type": "Whole Blood",
        "container_type": "EDTA",
        "reference_ranges": {"adult": {"low": 4.0, "high": 11.0, "unit": "K/uL"}},
        "unit": "K/uL",
        "tat_hours": 6,
        "price": "45.00",
    },
    {
        "code": "STG-GLU",
        "name": "Staging Random Glucose",
        "short_name": "RBG",
        "category": "chemistry",
        "specimen_type": "Serum",
        "container_type": "SST",
        "reference_ranges": {"adult": {"low": 3.9, "high": 7.8, "unit": "mmol/L"}},
        "unit": "mmol/L",
        "tat_hours": 4,
        "price": "25.00",
    },
    {
        "code": "STG-CRP",
        "name": "Staging C-Reactive Protein",
        "short_name": "CRP",
        "category": "chemistry",
        "specimen_type": "Serum",
        "container_type": "SST",
        "reference_ranges": {"adult": {"low": 0.0, "high": 5.0, "unit": "mg/L"}},
        "unit": "mg/L",
        "tat_hours": 8,
        "price": "55.00",
    },
]


NOTE_TEMPLATE_TITLE = "Staging Connected SOAP"


@dataclass
class RoleContext:
    user: User
    staff: Staff
    practitioner: PractitionerProfile | None = None


class FacilityApi:
    """Thin wrapper around DRF APIClient with facility-scoped headers."""

    def __init__(self, facility_code: str):
        self.facility_code = facility_code
        self.client = APIClient()
        self.http_host = self._resolve_http_host()

    @staticmethod
    def _resolve_http_host() -> str:
        hosts = [str(host).strip() for host in getattr(settings, "ALLOWED_HOSTS", []) if str(host).strip()]

        concrete_hosts = [host for host in hosts if not host.startswith(".") and host not in {"*", ""}]
        if concrete_hosts:
            return concrete_hosts[0]

        dotted_hosts = [host for host in hosts if host.startswith(".")]
        if dotted_hosts:
            return f"seed{dotted_hosts[0]}"

        return "testserver"

    def _request(
        self,
        method: str,
        path: str,
        *,
        user: User,
        data: dict[str, Any] | None = None,
        expected: tuple[int, ...] = (200, 201, 202),
    ) -> Any:
        self.client.force_authenticate(user=user)
        method_name = method.lower()
        fn = getattr(self.client, method_name)
        kwargs = {
            "HTTP_X_FACILITY_CODE": self.facility_code,
            "HTTP_HOST": self.http_host,
            "secure": True,
        }
        if method_name in {"post", "put", "patch"}:
            response = fn(path, data=data or {}, format="json", **kwargs)
        else:
            response = fn(path, data=data or {}, **kwargs)

        payload = getattr(response, "data", None)
        if response.status_code not in expected:
            details = payload if payload is not None else response.content.decode("utf-8", errors="ignore")
            raise CommandError(
                f"API {method.upper()} {path} failed with {response.status_code}: {details}"
            )
        return payload

    def get(self, path: str, *, user: User, params: dict[str, Any] | None = None) -> Any:
        return self._request("get", path, user=user, data=params, expected=(200,))

    def post(self, path: str, *, user: User, data: dict[str, Any], expected: tuple[int, ...] = (200, 201, 202)) -> Any:
        return self._request("post", path, user=user, data=data, expected=expected)

    def patch(self, path: str, *, user: User, data: dict[str, Any]) -> Any:
        return self._request("patch", path, user=user, data=data, expected=(200,))


class Command(BaseCommand):
    help = (
        "Seed connected staging data through API workflows "
        "(patient registration -> appointments -> encounters -> notes/vitals/labs)."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--profile",
            choices=sorted(PROFILE_CONFIGS.keys()),
            default="standard",
            help="Seed profile size.",
        )
        parser.add_argument(
            "--facilities",
            type=int,
            help="Override number of facilities.",
        )
        parser.add_argument(
            "--patients-per-facility",
            type=int,
            help="Override number of patients per facility.",
        )
        parser.add_argument(
            "--facility-codes",
            type=str,
            default="",
            help="Comma-separated facility codes to seed (overrides --facilities).",
        )
        parser.add_argument(
            "--seed",
            type=int,
            default=20260212,
            help="Deterministic random seed.",
        )
        parser.add_argument(
            "--append-events",
            action="store_true",
            help="Create additional journey events for existing seeded patients.",
        )
        parser.add_argument(
            "--skip-bootstrap",
            action="store_true",
            help="Skip catalog/bootstrap command steps.",
        )
        parser.add_argument(
            "--admin-email",
            type=str,
            default="staging.admin@hms.local",
            help="Seeder admin email.",
        )
        parser.add_argument(
            "--admin-password",
            type=str,
            default="Admin123!ChangeMe",
            help="Seeder admin password.",
        )
        parser.add_argument(
            "--admin-first-name",
            type=str,
            default="Platform",
            help="Seeder admin first name.",
        )
        parser.add_argument(
            "--admin-last-name",
            type=str,
            default="Administrator",
            help="Seeder admin last name.",
        )
        parser.add_argument(
            "--confirm-staging",
            action="store_true",
            help="Required when DEBUG is false.",
        )
        parser.add_argument(
            "--allow-production",
            action="store_true",
            help="Allow execution when environment hints production.",
        )

    def handle(self, *args, **options):
        self.verbosity = int(options.get("verbosity", 1))
        self.random = random.Random(options["seed"])
        self.append_events = bool(options["append_events"])

        self._preflight(options)
        profile = self._resolve_profile(options)

        self.stdout.write(self.style.MIGRATE_HEADING("Connected staging seeding started"))
        self.stdout.write(
            f"Profile={options['profile']} "
            f"facilities={profile['facilities']} "
            f"patients_per_facility={profile['patients_per_facility']} "
            f"seed={options['seed']}"
        )

        if not options["skip_bootstrap"]:
            self._bootstrap_catalogs()

        admin_user = self._ensure_admin(
            email=options["admin_email"].strip().lower(),
            password=options["admin_password"],
            first_name=options["admin_first_name"].strip() or "Platform",
            last_name=options["admin_last_name"].strip() or "Administrator",
        )

        facilities = self._ensure_facilities(options, profile["facilities"])
        for facility in facilities:
            admin_user.facilities.add(facility)
            if not admin_user.primary_facility_id:
                admin_user.primary_facility = facility
                admin_user.save(update_fields=["primary_facility"])

        summary: dict[str, dict[str, int]] = {}
        for index, facility in enumerate(facilities, start=1):
            self.stdout.write(self.style.MIGRATE_LABEL(f"[{index}/{len(facilities)}] {facility.code}"))
            result = self._seed_facility(
                facility=facility,
                admin_user=admin_user,
                patient_count=profile["patients_per_facility"],
            )
            summary[facility.code] = result

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS("Connected staging seeding complete."))
        self.stdout.write(json.dumps(summary, indent=2, sort_keys=True))

    def _preflight(self, options: dict[str, Any]) -> None:
        if not settings.DEBUG and not options["confirm_staging"]:
            raise CommandError(
                "Refusing to run with DEBUG=False without --confirm-staging."
            )

        env_hint = str(getattr(settings, "ENVIRONMENT", "") or "").strip().lower()
        if "prod" in env_hint and not options["allow_production"]:
            raise CommandError(
                "Environment appears production. Use --allow-production to run explicitly."
            )

    def _resolve_profile(self, options: dict[str, Any]) -> dict[str, int]:
        profile = dict(PROFILE_CONFIGS[options["profile"]])
        if options.get("facilities"):
            profile["facilities"] = max(1, int(options["facilities"]))
        if options.get("patients_per_facility"):
            profile["patients_per_facility"] = max(1, int(options["patients_per_facility"]))
        return profile

    def _bootstrap_catalogs(self) -> None:
        self.stdout.write("Bootstrapping base catalogs...")
        call_command("seed_organization")
        call_command("seed_bed_amenities")

    def _ensure_admin(self, *, email: str, password: str, first_name: str, last_name: str) -> User:
        call_command(
            "ensure_admin",
            email=email,
            password=password,
            first_name=first_name,
            last_name=last_name,
        )

        admin = User.objects.filter(email=email).first()
        if not admin:
            admin = User.objects.filter(is_superuser=True).order_by("date_joined").first()
        if not admin:
            raise CommandError("Failed to resolve admin user after ensure_admin.")

        updates: list[str] = []
        if admin.user_type != "admin":
            admin.user_type = "admin"
            updates.append("user_type")
        if not admin.is_staff:
            admin.is_staff = True
            updates.append("is_staff")
        if admin.first_name != first_name:
            admin.first_name = first_name
            updates.append("first_name")
        if admin.last_name != last_name:
            admin.last_name = last_name
            updates.append("last_name")
        if updates:
            admin.save(update_fields=updates)

        self.stdout.write(f"Admin in use: {admin.email} ({admin.first_name} {admin.last_name})")
        return admin

    def _ensure_facilities(self, options: dict[str, Any], default_count: int) -> list[Facility]:
        explicit_codes = [
            code.strip().upper()
            for code in str(options.get("facility_codes") or "").split(",")
            if code.strip()
        ]
        codes = explicit_codes or self._build_facility_codes(default_count)
        facilities: list[Facility] = []

        for idx, code in enumerate(codes, start=1):
            defaults = {
                "name": f"Staging Facility {idx}",
                "facility_type": "hospital",
                "address": f"{100 + idx} Staging Avenue",
                "city": "Accra",
                "region": "Greater Accra",
                "country": "Ghana",
                "postal_code": f"STG{idx:03d}",
                "phone": f"+2333000{idx:04d}",
                "email": f"{code.lower()}@staging.hms.local",
                "timezone": "Africa/Accra",
                "currency": "GHS",
                "status": "ready",
                "is_active": True,
                "is_headquarters": idx == 1,
            }
            facility, created = Facility.objects.get_or_create(code=code, defaults=defaults)
            if created:
                self.stdout.write(self.style.SUCCESS(f"  Created facility {facility.code}"))
            else:
                self.stdout.write(f"  Reusing facility {facility.code}")
            facilities.append(facility)

        return facilities

    def _build_facility_codes(self, count: int) -> list[str]:
        count = max(1, count)
        default_code = str(getattr(settings, "DEFAULT_FACILITY_CODE", "MAIN")).strip().upper() or "MAIN"
        codes = [default_code]
        serial = 1
        while len(codes) < count:
            candidate = f"STG{serial:02d}"
            if candidate not in codes:
                codes.append(candidate)
            serial += 1
        return codes

    def _seed_facility(self, *, facility: Facility, admin_user: User, patient_count: int) -> dict[str, int]:
        api = FacilityApi(facility.code)
        stats = {
            "patients_created": 0,
            "patients_reused": 0,
            "appointments_created": 0,
            "encounters_created": 0,
            "vitals_created": 0,
            "notes_created": 0,
            "prescriptions_created": 0,
            "lab_orders_created": 0,
            "lab_results_created": 0,
        }

        core_departments = self._ensure_core_departments(facility)
        units = self._ensure_units(api=api, admin_user=admin_user, facility=facility, core_departments=core_departments)
        clinic = self._ensure_clinic_and_schedule(api=api, admin_user=admin_user, facility=facility, units=units)
        appointment_type = self._ensure_appointment_type(api=api, admin_user=admin_user)
        roles = self._ensure_roles(api=api, admin_user=admin_user, facility=facility)
        self._ensure_staff_assignments(
            api=api,
            admin_user=admin_user,
            units=units,
            roles=roles,
        )
        self._ensure_doctor_schedule(api=api, admin_user=admin_user, facility=facility, doctor=roles["doctor"])
        note_template = self._ensure_note_template(api=api, admin_user=admin_user, facility=facility)
        lab_tests = self._ensure_lab_tests(api=api, admin_user=admin_user, facility=facility)

        for patient_index in range(1, patient_count + 1):
            journey_type = "emergency" if self.random.random() < 0.2 else "outpatient"
            patient, created = self._ensure_patient(
                api=api,
                receptionist=roles["receptionist"].user,
                facility=facility,
                units=units,
                clinic=clinic,
                patient_index=patient_index,
                journey_type=journey_type,
            )
            if created:
                stats["patients_created"] += 1
            else:
                stats["patients_reused"] += 1
                if not self.append_events:
                    continue

            journey_stats = self._seed_patient_journey(
                api=api,
                patient=patient,
                clinic=clinic,
                units=units,
                appointment_type=appointment_type,
                roles=roles,
                template=note_template,
                lab_tests=lab_tests,
                patient_index=patient_index,
            )
            for key, value in journey_stats.items():
                stats[key] += value

        return stats

    def _ensure_core_departments(self, facility: Facility) -> dict[str, Department]:
        specs = [
            ("OPD", "Outpatient Department", "clinical", True),
            ("EMR", "Emergency Department", "emergency", True),
            ("IPD", "Inpatient Department", "clinical", True),
            ("LAB", "Laboratory", "laboratory", False),
        ]
        departments: dict[str, Department] = {}
        for code, name, dept_type, is_clinical in specs:
            dept, _created = Department.objects.get_or_create(
                facility=facility,
                code=code,
                defaults={
                    "name": name,
                    "department_type": dept_type,
                    "is_active": True,
                    "is_clinical": is_clinical,
                    "accepts_referrals": True,
                },
            )
            departments[code] = dept
        return departments

    def _ensure_units(
        self,
        *,
        api: FacilityApi,
        admin_user: User,
        facility: Facility,
        core_departments: dict[str, Department],
    ) -> dict[str, ClinicalUnit]:
        facility_type = UnitTypeConfig.objects.filter(code="facility", is_active=True).first()
        department_type = UnitTypeConfig.objects.filter(code="department", is_active=True).first()
        team_type = (
            UnitTypeConfig.objects.filter(code="team", is_active=True).first()
            or UnitTypeConfig.objects.filter(code="division", is_active=True).first()
        )
        if not facility_type or not department_type or not team_type:
            raise CommandError("Required organization unit types are missing. Run seed_organization first.")

        root = ClinicalUnit.objects.filter(parent__isnull=True, code=facility.code).first()
        if not root:
            payload = {
                "code": facility.code,
                "name": facility.name,
                "unit_type": str(facility_type.id),
                "parent": None,
                "staffing_mode": "mixed",
                "unit_category": "clinical",
                "is_active": True,
                "accepts_admissions": False,
            }
            data = api.post("/api/organization/units/", user=admin_user, data=payload, expected=(201,))
            root = ClinicalUnit.objects.get(id=data["id"])

        def ensure_department_unit(code: str, name: str, core_dept: Department) -> ClinicalUnit:
            unit = ClinicalUnit.objects.filter(parent=root, code=code).first()
            if unit:
                if unit.core_department_id != core_dept.id:
                    api.patch(
                        f"/api/organization/units/{unit.id}/",
                        user=admin_user,
                        data={"core_department": str(core_dept.id)},
                    )
                    unit.refresh_from_db()
                return unit
            payload = {
                "code": code,
                "name": name,
                "unit_type": str(department_type.id),
                "parent": str(root.id),
                "core_department": str(core_dept.id),
                "staffing_mode": "mixed",
                "unit_category": "clinical",
                "is_active": True,
                "accepts_admissions": True,
            }
            data = api.post("/api/organization/units/", user=admin_user, data=payload, expected=(201,))
            return ClinicalUnit.objects.get(id=data["id"])

        def ensure_team_unit(code: str, name: str, parent_unit: ClinicalUnit) -> ClinicalUnit:
            unit = ClinicalUnit.objects.filter(parent=parent_unit, code=code).first()
            if unit:
                return unit
            payload = {
                "code": code,
                "name": name,
                "unit_type": str(team_type.id),
                "parent": str(parent_unit.id),
                "staffing_mode": "clinical_only",
                "unit_category": "clinical",
                "is_active": True,
                "accepts_admissions": True,
            }
            data = api.post("/api/organization/units/", user=admin_user, data=payload, expected=(201,))
            return ClinicalUnit.objects.get(id=data["id"])

        opd_department = ensure_department_unit("OPD", "Outpatient Unit", core_departments["OPD"])
        emr_department = ensure_department_unit("EMR", "Emergency Unit", core_departments["EMR"])

        opd_team = ensure_team_unit("OPD-T1", "OPD Team Alpha", opd_department)
        emr_team = ensure_team_unit("EMR-T1", "Emergency Team Alpha", emr_department)

        return {
            "root": root,
            "opd_department": opd_department,
            "emr_department": emr_department,
            "opd_team": opd_team,
            "emr_team": emr_team,
        }

    def _ensure_clinic_and_schedule(
        self,
        *,
        api: FacilityApi,
        admin_user: User,
        facility: Facility,
        units: dict[str, ClinicalUnit],
    ) -> Clinic:
        clinic = Clinic.objects.filter(facility=facility, code="OPD-GEN").first()
        if not clinic:
            payload = {
                "department": str(units["opd_department"].id),
                "code": "OPD-GEN",
                "name": "General OPD Clinic",
                "description": "Primary ambulatory clinic for staging workflow journeys.",
                "operating_hours_start": "00:00:00",
                "operating_hours_end": "23:59:00",
                "operates_24_hours": False,
                "accepts_walk_ins": True,
                "booking_mode": "practitioner_direct",
                "assignment_timing": "booking",
                "waitlist_enabled": True,
                "overbook_percent": 0,
                "overbook_hard_cap": 0,
            }
            data = api.post("/api/organization/clinics/", user=admin_user, data=payload, expected=(201,))
            clinic = Clinic.objects.get(id=data["id"])

        for day in range(0, 7):
            exists = ClinicSchedule.objects.filter(
                facility=facility,
                clinic=clinic,
                department=units["opd_department"],
                day_of_week=day,
                start_time=time(0, 0),
                end_time=time(23, 59),
                is_active=True,
            ).exists()
            if exists:
                continue
            payload = {
                "facility": str(facility.id),
                "department": str(units["opd_department"].id),
                "clinic": str(clinic.id),
                "day_of_week": day,
                "start_time": "00:00:00",
                "end_time": "23:59:00",
                "is_active": True,
            }
            api.post("/api/organization/clinic-schedules/", user=admin_user, data=payload, expected=(201,))

        return clinic

    def _ensure_appointment_type(self, *, api: FacilityApi, admin_user: User) -> AppointmentType:
        appointment_type = AppointmentType.objects.filter(name__iexact="General Consultation").first()
        if appointment_type:
            return appointment_type
        payload = {
            "name": "General Consultation",
            "description": "Standard outpatient review/consultation",
            "duration_minutes": 30,
            "color": "#176b87",
            "is_active": True,
            "category": "in_person",
        }
        data = api.post("/api/appointments/types/", user=admin_user, data=payload, expected=(201,))
        return AppointmentType.objects.get(id=data["id"])

    def _ensure_roles(self, *, api: FacilityApi, admin_user: User, facility: Facility) -> dict[str, RoleContext]:
        role_contexts: dict[str, RoleContext] = {}
        for role_key, spec in ROLE_SPECS.items():
            email = f"staging.{facility.code.lower()}.{role_key}@hms.local"
            user = User.objects.filter(email=email).first()
            if user and hasattr(user, "staff_profile"):
                staff = user.staff_profile
                practitioner = PractitionerProfile.objects.filter(staff=staff).first()
                role_contexts[role_key] = RoleContext(user=user, staff=staff, practitioner=practitioner)
                continue

            payload = {
                "email": email,
                "first_name": spec["first_name"],
                "last_name": spec["last_name"],
                "phone_number": f"+23324{self.random.randint(1000000, 9999999)}",
                "date_of_birth": date(1980 + self.random.randint(0, 15), self.random.randint(1, 12), self.random.randint(1, 28)).isoformat(),
                "user_type": spec["user_type"],
                "department": spec["department"],
                "position": spec["position"],
                "hire_date": date(2019 + self.random.randint(0, 5), self.random.randint(1, 12), self.random.randint(1, 28)).isoformat(),
            }
            if spec.get("license_number"):
                payload["license_number"] = str(spec["license_number"]).replace("{FAC}", facility.code)
                payload["specialization"] = spec["specialization"]
                payload["qualification"] = spec["qualification"]

            try:
                api.post("/api/users/staff/register/", user=admin_user, data=payload, expected=(201,))
            except CommandError as exc:
                # Recover idempotently if user already exists with active staff profile.
                if "already in use by an active staff member" not in str(exc):
                    raise

            user = User.objects.filter(email=email).first()
            if not user or not hasattr(user, "staff_profile"):
                raise CommandError(f"Failed to resolve staff profile for {email}")
            staff = user.staff_profile
            practitioner = PractitionerProfile.objects.filter(staff=staff).first()
            role_contexts[role_key] = RoleContext(user=user, staff=staff, practitioner=practitioner)

        return role_contexts

    def _ensure_staff_assignments(
        self,
        *,
        api: FacilityApi,
        admin_user: User,
        units: dict[str, ClinicalUnit],
        roles: dict[str, RoleContext],
    ) -> None:
        assignment_type = (
            StaffAssignmentTypeConfig.objects.filter(code="single", is_active=True).first()
            or StaffAssignmentTypeConfig.objects.filter(is_active=True).order_by("name").first()
        )
        if not assignment_type:
            raise CommandError("No active staff assignment type found.")

        doctor = roles["doctor"].practitioner
        nurse = roles["nurse"].practitioner
        if not doctor or not nurse:
            raise CommandError("Doctor and nurse practitioners are required for assignment seeding.")

        assignment_specs = [
            (doctor, units["opd_team"], True, False, "OPD primary physician"),
            (nurse, units["opd_team"], True, False, "OPD primary nurse"),
            (doctor, units["emr_team"], False, True, "Emergency coverage physician"),
            (nurse, units["emr_team"], False, True, "Emergency coverage nurse"),
        ]

        today_iso = timezone.localdate().isoformat()
        for practitioner, unit, is_primary, is_secondary, role_description in assignment_specs:
            exists = unit.staff_assignments.filter(practitioner=practitioner, is_active=True).exists()
            if exists:
                continue
            payload = {
                "unit": str(unit.id),
                "practitioner": str(practitioner.id),
                "assignment_type": str(assignment_type.id),
                "is_primary": is_primary,
                "is_secondary": is_secondary,
                "effective_from": today_iso,
                "role_description": role_description,
                "is_active": True,
            }
            api.post("/api/organization/staff-assignments/", user=admin_user, data=payload, expected=(201,))

    def _ensure_doctor_schedule(
        self,
        *,
        api: FacilityApi,
        admin_user: User,
        facility: Facility,
        doctor: RoleContext,
    ) -> None:
        practitioner = doctor.practitioner
        if not practitioner:
            raise CommandError("Doctor practitioner profile not found.")

        exists = RecurringSchedule.objects.filter(
            facility=facility,
            practitioner=practitioner,
            is_active=True,
            days_of_week__overlap=[0, 1, 2, 3, 4],
        ).exists()
        if exists:
            return

        payload = {
            "name": "Staging OPD Availability",
            "practitioner": str(practitioner.id),
            "days_of_week": [0, 1, 2, 3, 4, 5, 6],
            "start_time": "08:00:00",
            "end_time": "17:00:00",
            "slot_duration": 30,
            "active_from": timezone.localdate().isoformat(),
            "breaks": [],
            "is_active": True,
        }
        api.post("/api/appointments/recurring-schedules/", user=admin_user, data=payload, expected=(201,))

    def _ensure_note_template(self, *, api: FacilityApi, admin_user: User, facility: Facility) -> NoteTemplate:
        template = NoteTemplate.objects.filter(facility=facility, title=NOTE_TEMPLATE_TITLE).first()
        if template:
            return template

        payload = {
            "title": NOTE_TEMPLATE_TITLE,
            "description": "Structured SOAP template for connected staging workflow seeding.",
            "is_active": True,
            "visibility": "public",
            "category": "soap",
            "icon": "clipboard",
            "estimated_steps": 4,
            "is_public": True,
            "structure": {
                "sections": [
                    {"name": "Subjective", "type": "text", "required": True},
                    {"name": "Objective", "type": "text", "required": True},
                    {"name": "Assessment", "type": "text", "required": True},
                    {"name": "Plan", "type": "text", "required": True},
                ]
            },
        }
        data = api.post("/api/clinical-notes/templates/", user=admin_user, data=payload, expected=(201,))
        return NoteTemplate.objects.get(id=data["id"])

    def _ensure_lab_tests(self, *, api: FacilityApi, admin_user: User, facility: Facility) -> list[LabTestCatalog]:
        created_or_existing: list[LabTestCatalog] = []

        for spec in LAB_TEST_SPECS:
            test = LabTestCatalog.objects.filter(facility=facility, code=spec["code"]).first()
            if test:
                created_or_existing.append(test)
                continue

            payload = {
                "code": spec["code"],
                "name": spec["name"],
                "short_name": spec["short_name"],
                "category": spec["category"],
                "description": "Staging-only seeded test catalog entry",
                "specimen_type": spec["specimen_type"],
                "container_type": spec["container_type"],
                "volume_required": "5 mL",
                "special_instructions": "",
                "reference_ranges": spec["reference_ranges"],
                "unit": spec["unit"],
                "tat_hours": spec["tat_hours"],
                "price": spec["price"],
                "is_active": True,
            }
            data = api.post("/api/laboratory/tests/", user=admin_user, data=payload, expected=(201,))
            created_test = None
            if isinstance(data, dict):
                created_id = data.get("id")
                if created_id:
                    created_test = LabTestCatalog.objects.filter(id=created_id, facility=facility).first()
            if created_test is None:
                created_test = LabTestCatalog.objects.filter(
                    facility=facility,
                    code=spec["code"],
                ).first()
            if created_test is None:
                raise CommandError(
                    f"Failed to resolve created lab test for code={spec['code']} in facility={facility.code}."
                )
            created_or_existing.append(created_test)

        return created_or_existing

    def _ensure_patient(
        self,
        *,
        api: FacilityApi,
        receptionist: User,
        facility: Facility,
        units: dict[str, ClinicalUnit],
        clinic: Clinic,
        patient_index: int,
        journey_type: str,
    ) -> tuple[PatientProfile, bool]:
        email = f"staging.patient.{facility.code.lower()}.{patient_index:05d}@hms.local"
        existing = PatientProfile.objects.filter(user__email=email, facility=facility).first()
        if existing:
            return existing, False

        dob_year = 1950 + (patient_index % 55)
        dob_month = (patient_index % 12) + 1
        dob_day = (patient_index % 27) + 1
        admission_details: dict[str, Any] = {
            "type": journey_type,
            "notes": f"Staging {journey_type} intake for patient {patient_index}",
        }
        if journey_type == "outpatient":
            admission_details["department_id"] = str(units["opd_department"].id)
            admission_details["clinic_id"] = str(clinic.id)
            admission_details["primary_team_id"] = str(units["opd_team"].id)
        else:
            admission_details["department_id"] = str(units["emr_department"].id)
            admission_details["primary_team_id"] = str(units["emr_team"].id)

        payload = {
            "email": email,
            "first_name": f"Patient{patient_index:05d}",
            "last_name": facility.code,
            "phone_number": f"+23320{patient_index:07d}"[:13],
            "date_of_birth": date(dob_year, dob_month, dob_day).isoformat(),
            "nhis_id": f"NHIS-{facility.code}-{patient_index:05d}",
            "blood_group": self.random.choice(["A+", "A-", "B+", "O+", "AB+"]),
            "allergies": self.random.choice(["None", "Penicillin", "Seafood", "Dust"]),
            "emergency_contact_name": f"Contact {patient_index:05d}",
            "emergency_contact_phone": f"+23324{patient_index:07d}"[:13],
            "emergency_contact_relationship": self.random.choice(["Spouse", "Parent", "Sibling"]),
            "admission_details": admission_details,
        }

        data = api.post("/api/patients/register/", user=receptionist, data=payload, expected=(201,))
        patient = PatientProfile.objects.get(id=data["id"])
        return patient, True

    def _seed_patient_journey(
        self,
        *,
        api: FacilityApi,
        patient: PatientProfile,
        clinic: Clinic,
        units: dict[str, ClinicalUnit],
        appointment_type: AppointmentType,
        roles: dict[str, RoleContext],
        template: NoteTemplate,
        lab_tests: list[LabTestCatalog],
        patient_index: int,
    ) -> dict[str, int]:
        stats = {
            "appointments_created": 0,
            "encounters_created": 0,
            "vitals_created": 0,
            "notes_created": 0,
            "prescriptions_created": 0,
            "lab_orders_created": 0,
            "lab_results_created": 0,
        }

        doctor = roles["doctor"]
        nurse = roles["nurse"]
        receptionist = roles["receptionist"]
        labtech = roles["lab_technician"]
        if not doctor.practitioner or not nurse.practitioner:
            raise CommandError("Doctor and nurse practitioners are required for journey seeding.")

        base_start = timezone.now().replace(hour=9, minute=0, second=0, microsecond=0)
        offset_days = (patient_index % 20) + 1
        start_time = base_start + timedelta(days=offset_days)
        end_time = start_time + timedelta(minutes=appointment_type.duration_minutes or 30)

        appointment_payload = {
            "patient": str(patient.id),
            "practitioner": str(doctor.practitioner.id),
            "clinic": str(clinic.id),
            "appointment_type": str(appointment_type.id),
            "status": "booked",
            "source": "scheduled",
            "reason": f"Routine review for patient {patient.medical_record_number}",
            "notes": "Seeded connected journey appointment",
        }
        slot_minutes = max(5, int(appointment_type.duration_minutes or 30))
        appointment_data = None
        candidate_start = start_time
        for attempt in range(0, 24):
            candidate_end = candidate_start + timedelta(minutes=slot_minutes)
            payload = {
                **appointment_payload,
                "start_time": candidate_start.isoformat(),
                "end_time": candidate_end.isoformat(),
            }
            try:
                appointment_data = api.post(
                    "/api/appointments/appointments/",
                    user=receptionist.user,
                    data=payload,
                    expected=(201,),
                )
                start_time = candidate_start
                end_time = candidate_end
                break
            except CommandError as exc:
                error_text = str(exc).lower()
                can_retry = (
                    "already has an appointment during this time" in error_text
                    or "not available for this time" in error_text
                    or "capacity reached" in error_text
                )
                if not can_retry:
                    raise
                if (attempt + 1) % 8 == 0:
                    candidate_start = (candidate_start + timedelta(days=1)).replace(hour=9, minute=0)
                else:
                    candidate_start = candidate_start + timedelta(minutes=slot_minutes)
        if not appointment_data:
            raise CommandError(
                f"Unable to book seeded appointment for patient={patient.id} after retries."
            )
        stats["appointments_created"] += 1

        encounter_payload = {
            "patient_id": str(patient.id),
            "practitioner_id": str(doctor.practitioner.id),
            "clinic_id": str(clinic.id),
            "department_id": str(units["opd_department"].id),
            "primary_team_id": str(units["opd_team"].id),
            "appointment_id": str(appointment_data["id"]),
            "encounter_type": "outpatient",
            "status": "in-progress",
            "start_time": start_time.isoformat(),
            "reason": "Connected staging consultation",
            "service_type": "Outpatient consultation",
            "location": clinic.name,
        }
        encounter_data = api.post("/api/encounters/", user=doctor.user, data=encounter_payload, expected=(201,))
        encounter_id = encounter_data.get("id") if isinstance(encounter_data, dict) else None
        if not encounter_id:
            encounter_id = (
                Encounter.objects.filter(
                    appointment_id=appointment_data.get("id"),
                    patient_id=patient.id,
                )
                .order_by("-created_at")
                .values_list("id", flat=True)
                .first()
            )
        if not encounter_id:
            raise CommandError(
                f"Failed to resolve encounter id for patient={patient.id} appointment={appointment_data.get('id')}"
            )
        stats["encounters_created"] += 1

        vitals_payload = {
            "patient": str(patient.id),
            "recorded_by": str(nurse.practitioner.id),
            "encounter": str(encounter_id),
            "temperature": round(self.random.uniform(36.4, 38.1), 1),
            "heart_rate": self.random.randint(68, 108),
            "blood_pressure_systolic": self.random.randint(108, 142),
            "blood_pressure_diastolic": self.random.randint(66, 92),
            "respiratory_rate": self.random.randint(12, 22),
            "oxygen_saturation": self.random.randint(94, 100),
            "pain_level": self.random.randint(0, 7),
            "recorded_at": (start_time + timedelta(minutes=8)).isoformat(),
            "notes": "Seeded triage and nursing observations",
        }
        api.post("/api/nursing/vital-signs/", user=nurse.user, data=vitals_payload, expected=(201,))
        stats["vitals_created"] += 1

        note_payload = {
            "template": str(template.id),
            "patient": str(patient.id),
            "encounter": str(encounter_id),
            "data": self._build_note_data(template=template, patient=patient),
        }
        api.post("/api/clinical-notes/entries/", user=doctor.user, data=note_payload, expected=(201,))
        stats["notes_created"] += 1

        prescription_payload = {
            "patient": str(patient.id),
            "encounter": str(encounter_id),
            "medication_name": self.random.choice(["Paracetamol", "Amoxicillin", "Omeprazole", "Metformin"]),
            "dosage": self.random.choice(["500mg", "1g", "250mg"]),
            "route": "oral",
            "frequency": self.random.choice(["daily", "bid", "tid"]),
            "duration_days": self.random.randint(3, 14),
            "start_date": timezone.localdate().isoformat(),
            "instructions": "Take after meals unless otherwise directed.",
            "reason": "Seeded treatment plan.",
        }
        api.post("/api/clinical-notes/prescriptions/", user=doctor.user, data=prescription_payload, expected=(201,))
        stats["prescriptions_created"] += 1

        order_payload = {
            "patient": str(patient.id),
            "encounter": str(encounter_id),
            "ordering_provider": str(doctor.practitioner.id),
            "test_ids": [str(test.id) for test in lab_tests[:2]],
            "priority": self.random.choice(["routine", "urgent"]),
            "clinical_notes": "Seeded diagnostics workup",
            "fasting_required": False,
        }
        order_data = api.post("/api/laboratory/orders/", user=doctor.user, data=order_payload, expected=(201,))
        order_id = str(order_data["id"])
        stats["lab_orders_created"] += 1

        api.post(f"/api/laboratory/orders/{order_id}/submit/", user=doctor.user, data={}, expected=(200,))

        specimen_payload = {
            "order": order_id,
            "specimen_type": "Serum",
            "container_type": "SST",
            "volume_collected": "5 mL",
            "collection_site": "Phlebotomy Room 1",
            "collected_at": (start_time + timedelta(minutes=30)).isoformat(),
        }
        specimen_data = api.post("/api/laboratory/specimens/", user=labtech.user, data=specimen_payload, expected=(201,))
        specimen_id = specimen_data.get("id") if isinstance(specimen_data, dict) else None
        if not specimen_id:
            specimen_id = (
                LabSpecimen.objects.filter(order_id=order_id)
                .order_by("-created_at")
                .values_list("id", flat=True)
                .first()
            )
        if not specimen_id:
            raise CommandError(f"Failed to resolve specimen id for lab order {order_id}")
        specimen_id = str(specimen_id)

        api.post(f"/api/laboratory/orders/{order_id}/collect/", user=labtech.user, data={}, expected=(200,))
        api.post(
            f"/api/laboratory/specimens/{specimen_id}/receive/",
            user=labtech.user,
            data={"storage_location": "Bench A", "is_rejected": False},
            expected=(200,),
        )
        api.post(f"/api/laboratory/orders/{order_id}/receive/", user=labtech.user, data={}, expected=(200,))
        api.post(f"/api/laboratory/orders/{order_id}/start_processing/", user=labtech.user, data={}, expected=(200,))

        expanded_order = api.get(
            f"/api/laboratory/orders/{order_id}/",
            user=labtech.user,
            params={"expand": "tests"},
        )
        order_tests = expanded_order.get("order_tests", []) if isinstance(expanded_order, dict) else []
        if not order_tests:
            raise CommandError(f"No order tests returned for lab order {order_id}")

        bulk_results_payload = {
            "order_id": order_id,
            "specimen_id": specimen_id,
            "performed_at": (start_time + timedelta(minutes=90)).isoformat(),
            "results": [],
        }
        for order_test in order_tests:
            test = order_test.get("test", {})
            reference_ranges = test.get("reference_ranges") or {}
            range_sample = next(iter(reference_ranges.values()), {}) if isinstance(reference_ranges, dict) else {}
            low = float(range_sample.get("low", 1.0))
            high = float(range_sample.get("high", 10.0))
            midpoint = round((low + high) / 2, 2)
            bulk_results_payload["results"].append(
                {
                    "order_test_id": str(order_test["id"]),
                    "value": str(midpoint),
                    "unit": test.get("unit") or "",
                    "reference_low": low,
                    "reference_high": high,
                    "flag": "normal",
                    "interpretation": "Within expected range for seeded test data.",
                }
            )

        created_count = 0
        try:
            bulk_result_data = api.post(
                "/api/laboratory/results/bulk/",
                user=labtech.user,
                data=bulk_results_payload,
                expected=(201,),
            )
            created_count = int(bulk_result_data.get("created_count", 0)) if isinstance(bulk_result_data, dict) else 0
        except Exception as exc:
            error_text = str(exc).lower()
            if "laboratory_labresult" not in error_text or "facility_id" not in error_text:
                raise

            # Fallback path for environments where bulk result create does not
            # populate facility_id server-side.
            for item in bulk_results_payload["results"]:
                api.post(
                    "/api/laboratory/results/",
                    user=labtech.user,
                    data={
                        "order_test": item["order_test_id"],
                        "specimen": specimen_id,
                        "value": item["value"],
                        "unit": item["unit"],
                        "reference_low": item["reference_low"],
                        "reference_high": item["reference_high"],
                        "flag": item["flag"],
                        "interpretation": item["interpretation"],
                        "performed_at": bulk_results_payload["performed_at"],
                    },
                    expected=(201,),
                )
                created_count += 1
        stats["lab_results_created"] += created_count

        api.post(
            "/api/laboratory/results/bulk-verify/",
            user=labtech.user,
            data={"order_id": order_id, "verification_notes": "Seeded batch verification."},
            expected=(200,),
        )

        return stats

    def _build_note_data(self, *, template: NoteTemplate, patient: PatientProfile) -> dict[str, Any]:
        structure = template.structure
        sections: list[dict[str, Any]]
        if isinstance(structure, dict):
            sections = structure.get("sections", [])
        elif isinstance(structure, list):
            sections = structure
        else:
            sections = []

        data: dict[str, Any] = {}
        for section in sections:
            name = section.get("name") or section.get("section")
            if not name:
                continue
            section_type = str(section.get("type") or "").lower()
            if section_type == "structured":
                subsections = section.get("subsections", []) or []
                nested: dict[str, str] = {}
                for sub in subsections:
                    sub_name = sub.get("name") or sub.get("section")
                    if not sub_name:
                        continue
                    nested[sub_name] = (
                        f"{sub_name}: seeded detail for {patient.user.get_full_name()} "
                        f"({patient.medical_record_number})."
                    )
                data[name] = nested if nested else f"Seeded structured content for {name}."
            elif section_type in {"checkbox", "multiselect"}:
                data[name] = []
            else:
                data[name] = (
                    f"Seeded {name.lower()} narrative for {patient.user.get_full_name()} "
                    f"({patient.medical_record_number})."
                )
        return data
