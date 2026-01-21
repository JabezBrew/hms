#!/usr/bin/env python
"""
Seed script for development environment.
Creates a realistic hospital setup with MPTT-based organizational hierarchy.
"""
import os
import sys
import django
from datetime import date, time

# Setup Django
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'hms_backend.settings')
django.setup()

from django.contrib.auth import get_user_model
from apps.core.models import Facility, Department
from apps.organization.models import (
    UnitTypeConfig, LeadershipRoleConfig, StaffAssignmentTypeConfig,
    ClinicalUnit, Clinic
)
from apps.users.models import Staff, PractitionerProfile
from apps.users.tasks import send_welcome_credentials_email
from apps.wards.models import Ward, Bed

User = get_user_model()


def create_unit_type_configs():
    """Create unit type configurations."""
    print("Creating unit type configurations...")

    configs = [
        {
            "code": "facility",
            "name": "Facility",
            "can_be_root": True,
            "depth_level": 0,
            "can_have_wards": True,
            "can_admit_patients": False,
            "can_consult": False,
            "can_have_budget": True,
        },
        {
            "code": "department",
            "name": "Department",
            "can_be_root": False,
            "depth_level": 1,
            "can_have_wards": True,
            "can_admit_patients": False,
            "can_consult": False,
            "can_have_budget": True,
        },
        {
            "code": "division",
            "name": "Division",
            "can_be_root": False,
            "depth_level": 2,
            "can_have_wards": True,
            "can_admit_patients": True,
            "can_consult": True,
            "can_have_budget": False,
        },
        {
            "code": "team",
            "name": "Clinical Team",
            "can_be_root": False,
            "depth_level": 3,
            "can_have_wards": False,
            "can_admit_patients": True,
            "can_consult": True,
            "can_have_budget": False,
        },
    ]

    created = {}
    for data in configs:
        config, _ = UnitTypeConfig.objects.get_or_create(
            code=data["code"],
            defaults=data
        )
        created[data["code"]] = config
        print(f"  Created unit type: {config.name}")

    # Set allowed parent types
    created["department"].allowed_parent_types.add(created["facility"])
    created["division"].allowed_parent_types.add(created["department"])
    created["team"].allowed_parent_types.add(created["division"], created["department"])

    return created


def create_leadership_roles():
    """Create leadership role configurations."""
    print("Creating leadership roles...")

    roles = [
        {"code": "head", "name": "Department Head", "is_primary_leader": True, "can_approve": True, "can_manage_staff": True},
        {"code": "deputy", "name": "Deputy Head", "is_primary_leader": False, "can_approve": True, "can_manage_staff": False},
        {"code": "nurse_manager", "name": "Nurse Manager", "is_primary_leader": False, "can_approve": True, "can_manage_staff": True},
        {"code": "team_lead", "name": "Team Lead", "is_primary_leader": True, "can_approve": False, "can_manage_staff": False},
    ]

    created = {}
    for data in roles:
        role, _ = LeadershipRoleConfig.objects.get_or_create(
            code=data["code"],
            defaults=data
        )
        created[data["code"]] = role
        print(f"  Created leadership role: {role.name}")

    return created


def create_staff_assignment_types():
    """Create staff assignment type configurations."""
    print("Creating staff assignment types...")

    types = [
        {
            "code": "primary",
            "name": "Primary Assignment",
            "requires_primary": True,
            "allows_secondary": False,
            "allows_multiple_primary": False,
            "supports_date_ranges": False,
        },
        {
            "code": "primary_secondary",
            "name": "Primary with Secondary",
            "requires_primary": True,
            "allows_secondary": True,
            "allows_multiple_primary": False,
            "supports_date_ranges": False,
        },
        {
            "code": "rotational",
            "name": "Rotational",
            "requires_primary": False,
            "allows_secondary": False,
            "allows_multiple_primary": True,
            "supports_date_ranges": True,
        },
    ]

    created = {}
    for data in types:
        config, _ = StaffAssignmentTypeConfig.objects.get_or_create(
            code=data["code"],
            defaults=data
        )
        created[data["code"]] = config
        print(f"  Created assignment type: {config.name}")

    return created


def create_facility():
    """Create main facility."""
    print("Creating facility...")

    facility = Facility.objects.create(
        name="City General Hospital",
        code="CGH",
        facility_type="hospital",
        address="123 Healthcare Avenue",
        city="Metropolis",
        country="Country",
        phone="+1-555-100-0000",
        email="info@citygeneral.local",
        is_active=True,
    )
    print(f"  Created: {facility.name} ({facility.code})")

    return facility


def create_core_departments(facility):
    """Create core.Department records for wards."""
    print("Creating core departments...")

    dept_data = [
        {"code": "MED", "name": "Internal Medicine", "department_type": "clinical"},
        {"code": "SUR", "name": "Surgery", "department_type": "surgical"},
        {"code": "PED", "name": "Pediatrics", "department_type": "clinical"},
        {"code": "OBG", "name": "Obstetrics & Gynecology", "department_type": "clinical"},
        {"code": "EMR", "name": "Emergency", "department_type": "emergency"},
        {"code": "RAD", "name": "Radiology", "department_type": "radiology"},
        {"code": "LAB", "name": "Laboratory", "department_type": "laboratory"},
        {"code": "PHR", "name": "Pharmacy", "department_type": "pharmacy"},
        {"code": "ADM", "name": "Administration", "department_type": "administrative"},
    ]

    departments = {}
    for data in dept_data:
        dept = Department.objects.create(
            facility=facility,
            code=data["code"],
            name=data["name"],
            department_type=data["department_type"],
            is_active=True,
        )
        departments[data["code"]] = dept
        print(f"  Created core department: {dept.name}")

    return departments


def create_organizational_hierarchy(facility, unit_types):
    """Create MPTT-based organizational hierarchy."""
    print("Creating organizational hierarchy...")

    # Create facility-level root unit
    root_unit = ClinicalUnit.objects.create(
        code="CGH",
        name="City General Hospital",
        unit_type=unit_types["facility"],
        parent=None,
        location="Main Campus",
        timezone="America/New_York",
        currency="USD",
        operates_24_hours=True,
    )
    root_unit.root_unit = root_unit
    root_unit.save()
    print(f"  Created root unit: {root_unit.name}")

    # Create departments
    departments = {}
    dept_data = [
        {"code": "MED", "name": "Internal Medicine", "staffing_mode": "clinical_only"},
        {"code": "SUR", "name": "Surgery", "staffing_mode": "clinical_only"},
        {"code": "PED", "name": "Pediatrics", "staffing_mode": "clinical_only"},
        {"code": "OBG", "name": "Obstetrics & Gynecology", "staffing_mode": "clinical_only"},
        {"code": "EMR", "name": "Emergency", "staffing_mode": "clinical_only"},
        {"code": "RAD", "name": "Radiology", "staffing_mode": "mixed"},
        {"code": "LAB", "name": "Laboratory", "staffing_mode": "mixed"},
        {"code": "PHR", "name": "Pharmacy", "staffing_mode": "mixed"},
        {"code": "ADM", "name": "Administration", "staffing_mode": "ops_only"},
    ]

    for data in dept_data:
        dept = ClinicalUnit.objects.create(
            code=data["code"],
            name=data["name"],
            unit_type=unit_types["department"],
            parent=root_unit,
            root_unit=root_unit,
            staffing_mode=data["staffing_mode"],
        )
        departments[data["code"]] = dept
        print(f"    Created department: {dept.name}")

    # Create divisions under Internal Medicine
    divisions = {}
    division_data = [
        {"code": "CARD", "name": "Cardiology", "parent": "MED"},
        {"code": "PULM", "name": "Pulmonology", "parent": "MED"},
        {"code": "GI", "name": "Gastroenterology", "parent": "MED"},
        {"code": "GENMED", "name": "General Medicine", "parent": "MED"},
    ]

    for data in division_data:
        div = ClinicalUnit.objects.create(
            code=data["code"],
            name=data["name"],
            unit_type=unit_types["division"],
            parent=departments[data["parent"]],
            root_unit=root_unit,
            staffing_mode="clinical_only",
            accepts_admissions=True,
            accepts_referrals=True,
        )
        divisions[data["code"]] = div
        print(f"      Created division: {div.name}")

    return root_unit, departments, divisions


def create_clinics(facility, departments, root_unit):
    """Create outpatient clinics."""
    print("Creating clinics...")

    clinics_data = [
        {"code": "GEN-OPD", "name": "General Outpatient Clinic", "department": "MED", "accepts_walk_ins": True},
        {"code": "CARD-OPD", "name": "Cardiology Clinic", "department": "MED", "accepts_walk_ins": False},
        {"code": "SURG-OPD", "name": "Surgical Consultation Clinic", "department": "SUR", "accepts_walk_ins": False},
        {"code": "PED-OPD", "name": "Pediatric Clinic", "department": "PED", "accepts_walk_ins": True},
        {"code": "EMR-OPD", "name": "Emergency Clinic", "department": "EMR", "accepts_walk_ins": True},
    ]

    clinics = []
    for data in clinics_data:
        clinic = Clinic.objects.create(
            facility=facility,
            department=departments[data["department"]],
            code=data["code"],
            name=data["name"],
            accepts_walk_ins=data["accepts_walk_ins"],
            operating_hours_start=time(8, 0),
            operating_hours_end=time(17, 0),
            is_active=True,
        )
        clinics.append(clinic)
        print(f"  Created clinic: {clinic.name}")

    return clinics


def create_wards(facility, core_departments):
    """Create hospital wards with beds."""
    print("Creating wards...")

    wards_data = [
        {"name": "Medical Ward 1", "department": "MED", "ward_type": "general", "total_beds": 20, "bed_prefix": "M1"},
        {"name": "Surgical Ward", "department": "SUR", "ward_type": "general", "total_beds": 16, "bed_prefix": "S1"},
        {"name": "Pediatric Ward", "department": "PED", "ward_type": "pediatric", "total_beds": 12, "bed_prefix": "P1"},
        {"name": "Intensive Care Unit", "department": "MED", "ward_type": "icu", "total_beds": 8, "bed_prefix": "ICU"},
        {"name": "Maternity Ward", "department": "OBG", "ward_type": "maternity", "total_beds": 10, "bed_prefix": "MAT"},
    ]

    wards = []
    for data in wards_data:
        ward = Ward.objects.create(
            department=core_departments[data["department"]],
            name=data["name"],
            ward_type=data["ward_type"],
            total_beds=data["total_beds"],
            base_rate_per_night=100.00,
            is_active=True,
        )

        # Create beds
        for i in range(1, data["total_beds"] + 1):
            Bed.objects.create(
                ward=ward,
                facility=facility,
                bed_number=f"{data['bed_prefix']}-{i:02d}",
                status="available",
            )

        wards.append(ward)
        print(f"  Created ward: {ward.name} with {data['total_beds']} beds")

    return wards


def create_staff(facility, departments):
    """Create staff members with proper assignments."""
    print("Creating staff members...")

    staff_data = [
        # Doctors
        {"username": "dr.okonkwo", "email": "v2tui.doctor1@inbox.testmail.app", "first_name": "Chidi", "last_name": "Okonkwo",
         "role": "doctor", "department": "MED", "specialization": "Internal Medicine", "license": "MD-001"},
        {"username": "dr.mensah", "email": "v2tui.doctor2@inbox.testmail.app", "first_name": "Ama", "last_name": "Mensah",
         "role": "doctor", "department": "MED", "specialization": "Cardiology", "license": "MD-002"},
        {"username": "dr.nkosi", "email": "v2tui.doctor3@inbox.testmail.app", "first_name": "Thabo", "last_name": "Nkosi",
         "role": "doctor", "department": "SUR", "specialization": "General Surgery", "license": "MD-003"},
        {"username": "dr.adeyemi", "email": "v2tui.doctor4@inbox.testmail.app", "first_name": "Funke", "last_name": "Adeyemi",
         "role": "doctor", "department": "PED", "specialization": "Pediatrics", "license": "MD-004"},
        {"username": "dr.kimani", "email": "v2tui.doctor5@inbox.testmail.app", "first_name": "James", "last_name": "Kimani",
         "role": "doctor", "department": "EMR", "specialization": "Emergency Medicine", "license": "MD-005"},
        # Nurses
        {"username": "nurse.achieng", "email": "v2tui.nurse1@inbox.testmail.app", "first_name": "Grace", "last_name": "Achieng",
         "role": "nurse", "department": "MED", "specialization": "Medical Nursing", "license": "RN-001"},
        {"username": "nurse.dlamini", "email": "v2tui.nurse2@inbox.testmail.app", "first_name": "Nomvula", "last_name": "Dlamini",
         "role": "nurse", "department": "SUR", "specialization": "Surgical Nursing", "license": "RN-002"},
        {"username": "nurse.banda", "email": "v2tui.nurse3@inbox.testmail.app", "first_name": "Chikondi", "last_name": "Banda",
         "role": "nurse", "department": "EMR", "specialization": "Emergency Nursing", "license": "RN-003"},
        {"username": "nurse.mbeki", "email": "v2tui.nurse4@inbox.testmail.app", "first_name": "Lindiwe", "last_name": "Mbeki",
         "role": "nurse", "department": "PED", "specialization": "Pediatric Nursing", "license": "RN-004"},
        # Receptionists
        {"username": "reception.okello", "email": "v2tui.receptionist1@inbox.testmail.app", "first_name": "Peter", "last_name": "Okello",
         "role": "receptionist", "department": "ADM"},
        {"username": "reception.moyo", "email": "v2tui.receptionist2@inbox.testmail.app", "first_name": "Tendai", "last_name": "Moyo",
         "role": "receptionist", "department": "ADM"},
        # Lab Technicians
        {"username": "lab.kamau", "email": "v2tui.labtech@inbox.testmail.app", "first_name": "Samuel", "last_name": "Kamau",
         "role": "lab_technician", "department": "LAB"},
        # Pharmacists
        {"username": "pharm.nyong", "email": "v2tui.pharmacist@inbox.testmail.app", "first_name": "Aisha", "last_name": "Nyong'o",
         "role": "pharmacist", "department": "PHR"},
        # Admin
        {"username": "admin.mwangi", "email": "v2tui.admin@inbox.testmail.app", "first_name": "Daniel", "last_name": "Mwangi",
         "role": "admin", "department": "ADM"},
    ]

    staff_members = []
    for data in staff_data:
        # Create user
        user = User.objects.create_user(
            username=data["username"],
            email=data["email"],
            password="password123",
            first_name=data["first_name"],
            last_name=data["last_name"],
            user_type=data["role"],
            primary_facility=facility,
        )
        user.facilities.add(facility)

        # Create staff record
        staff = Staff.objects.create(
            user=user,
            employee_id=f"EMP-{data['username'].upper().replace('.', '-')}",
            department=departments[data["department"]].name,
            position=data["role"].replace("_", " ").title(),
            hire_date=date.today(),
            primary_facility=facility,
        )
        staff_members.append(staff)

        # Create practitioner profile for clinical staff
        if data["role"] in ["doctor", "nurse"] and "license" in data:
            PractitionerProfile.objects.create(
                staff=staff,
                license_number=data["license"],
                specialization=data.get("specialization", ""),
                qualification="MD" if data["role"] == "doctor" else "RN",
            )

        # Send welcome email with credentials
        send_welcome_credentials_email.delay(
            user_email=data["email"],
            user_name=user.get_full_name(),
            password="password123",
            employee_id=staff.employee_id,
            department=staff.department,
            position=staff.position,
        )

        print(f"  Created staff: {user.get_full_name()} ({data['role']})")

    return staff_members


def create_sample_patients(facility):
    """Create sample patients for testing."""
    print("Creating sample patients...")

    from apps.users.models import PatientProfile

    patients_data = [
        {"username": "patient.doe", "email": "john.doe@email.local", "first_name": "John", "last_name": "Doe",
         "date_of_birth": "1985-03-15", "gender": "M", "phone_number": "+1-555-0101"},
        {"username": "patient.smith", "email": "jane.smith@email.local", "first_name": "Jane", "last_name": "Smith",
         "date_of_birth": "1990-07-22", "gender": "F", "phone_number": "+1-555-0102"},
        {"username": "patient.wilson", "email": "bob.wilson@email.local", "first_name": "Bob", "last_name": "Wilson",
         "date_of_birth": "1978-11-08", "gender": "M", "phone_number": "+1-555-0103"},
        {"username": "patient.johnson", "email": "mary.johnson@email.local", "first_name": "Mary", "last_name": "Johnson",
         "date_of_birth": "1995-01-30", "gender": "F", "phone_number": "+1-555-0104"},
        {"username": "patient.brown", "email": "james.brown@email.local", "first_name": "James", "last_name": "Brown",
         "date_of_birth": "1960-09-12", "gender": "M", "phone_number": "+1-555-0105"},
    ]

    patients = []
    for i, data in enumerate(patients_data, start=1):
        user = User.objects.create_user(
            username=data["username"],
            email=data["email"],
            password="patient123",
            first_name=data["first_name"],
            last_name=data["last_name"],
            user_type="patient",
            gender=data["gender"],
            date_of_birth=data["date_of_birth"],
            phone_number=data["phone_number"],
        )

        patient = PatientProfile.objects.create(
            user=user,
            facility=facility,
            medical_record_number=f"MRN-{facility.code}-{i:05d}",
        )
        patients.append(patient)
        print(f"  Created patient: {user.get_full_name()} ({patient.medical_record_number})")

    return patients


def fix_admin_user(facility):
    """Fix the default admin superuser to have proper user_type and facility."""
    print("Fixing admin superuser...")

    # Check if the default 'admin' user exists
    admin_user = User.objects.filter(username='admin').first()
    if admin_user:
        # Fix user_type if it's not 'admin'
        if admin_user.user_type != 'admin':
            admin_user.user_type = 'admin'
            print(f"  Fixed user_type to 'admin'")

        # Fix primary_facility if not set
        if not admin_user.primary_facility:
            admin_user.primary_facility = facility
            print(f"  Set primary_facility to {facility.name}")

        admin_user.save()

        # Add to facilities M2M if not already present
        if not admin_user.facilities.filter(id=facility.id).exists():
            admin_user.facilities.add(facility)
            print(f"  Added to facilities: {facility.code}")

        print(f"  Admin user '{admin_user.username}' updated successfully")
    else:
        print("  No 'admin' user found to fix")


def main():
    print("\n" + "=" * 60)
    print("HMS Development Database Seed Script")
    print("=" * 60 + "\n")

    # Create configuration
    unit_types = create_unit_type_configs()
    print()
    leadership_roles = create_leadership_roles()
    print()
    assignment_types = create_staff_assignment_types()
    print()

    # Create facility
    facility = create_facility()
    print()

    # Create core departments (for wards)
    core_departments = create_core_departments(facility)
    print()

    # Create organizational hierarchy (MPTT ClinicalUnits)
    root_unit, org_departments, divisions = create_organizational_hierarchy(facility, unit_types)
    print()

    # Create clinics
    clinics = create_clinics(facility, org_departments, root_unit)
    print()

    # Create wards (use core_departments)
    wards = create_wards(facility, core_departments)
    print()

    # Create staff (use org_departments for display names)
    staff_members = create_staff(facility, org_departments)
    print()

    # Create sample patients
    patients = create_sample_patients(facility)
    print()

    # Fix admin superuser if it exists
    fix_admin_user(facility)
    print()

    print("=" * 60)
    print("Seed completed successfully!")
    print("=" * 60)
    print("\nLogin credentials:")
    print("  Superadmin:  admin / [your admin password]")
    print("  Admin:       admin.mwangi / password123")
    print("  Staff:       [username] / password123")
    print("  Patients:    [username] / patient123")
    print(f"\nFacility code: {facility.code}")
    print()


if __name__ == "__main__":
    main()
