#!/usr/bin/env python3
"""
Diagnostic script to check nursing module setup and user permissions.
This helps identify why users might be getting 403 errors on nursing endpoints.
"""

import os
import sys
import django

# Setup Django environment
sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'hms_backend.settings')
django.setup()

from django.contrib.auth import get_user_model
from apps.wards.models import Admission, Ward, Bed
from apps.nursing.models import VitalSigns, NursingAlert, NursingTask, MedicationAdministration

User = get_user_model()


def check_nursing_module():
    """Check if nursing module is properly set up."""
    print("=" * 60)
    print("NURSING MODULE DIAGNOSTIC REPORT")
    print("=" * 60)
    print()

    # Check database tables
    print("1. DATABASE TABLES")
    print("-" * 60)
    try:
        vital_signs_count = VitalSigns.objects.count()
        alerts_count = NursingAlert.objects.count()
        tasks_count = NursingTask.objects.count()
        meds_count = MedicationAdministration.objects.count()

        print(f"✓ VitalSigns table exists: {vital_signs_count} records")
        print(f"✓ NursingAlert table exists: {alerts_count} records")
        print(f"✓ NursingTask table exists: {tasks_count} records")
        print(f"✓ MedicationAdministration table exists: {meds_count} records")
    except Exception as e:
        print(f"✗ Error accessing nursing tables: {e}")
        print("  Run migrations: python manage.py migrate nursing")
    print()

    # Check admitted patients
    print("2. ADMITTED PATIENTS")
    print("-" * 60)
    try:
        admissions_count = Admission.objects.filter(status='admitted').count()
        print(f"Current admitted patients: {admissions_count}")

        if admissions_count == 0:
            print("⚠ No patients currently admitted")
            print("  The nursing dashboard will show 'No patients found'")
        else:
            print("✓ Patients are admitted and should appear on dashboard")
    except Exception as e:
        print(f"✗ Error checking admissions: {e}")
    print()

    # Check users and their roles
    print("3. USER ROLES")
    print("-" * 60)
    users = User.objects.all()[:10]  # Check first 10 users

    if users.count() == 0:
        print("⚠ No users found in database")
    else:
        for user in users:
            roles = []

            # Check if user is superuser/staff
            if user.is_superuser:
                roles.append("Superuser")
            if user.is_staff:
                roles.append("Staff")

            # Check for practitioner profile
            if hasattr(user, 'practitioner_profile'):
                prac = user.practitioner_profile
                roles.append(f"Practitioner ({prac.role})")

            # Check for staff profile
            if hasattr(user, 'staff_profile'):
                staff = user.staff_profile
                roles.append(f"Staff Profile ({staff.role})")

            # Check for patient profile
            if hasattr(user, 'patient_profile'):
                roles.append("Patient")

            role_str = ", ".join(roles) if roles else "No roles"

            # Check if user has nursing access
            has_nursing_access = False
            if user.is_superuser or user.is_staff:
                has_nursing_access = True
            elif hasattr(user, 'practitioner_profile'):
                prac = user.practitioner_profile
                if prac.role in ['nurse', 'head_nurse', 'nurse_practitioner']:
                    has_nursing_access = True
            elif hasattr(user, 'staff_profile'):
                staff = user.staff_profile
                if staff.role in ['nurse', 'head_nurse', 'nurse_practitioner']:
                    has_nursing_access = True

            access_indicator = "✓" if has_nursing_access else "✗"
            print(f"{access_indicator} {user.username} ({user.email}): {role_str}")
    print()

    # Check wards and beds
    print("4. WARD CONFIGURATION")
    print("-" * 60)
    try:
        wards_count = Ward.objects.count()
        beds_count = Bed.objects.count()
        available_beds = Bed.objects.filter(status='available').count()

        print(f"Total wards: {wards_count}")
        print(f"Total beds: {beds_count}")
        print(f"Available beds: {available_beds}")

        if wards_count == 0:
            print("⚠ No wards configured")
        else:
            print("✓ Wards are configured")
    except Exception as e:
        print(f"✗ Error checking wards: {e}")
    print()

    # Recommendations
    print("5. RECOMMENDATIONS")
    print("-" * 60)

    recommendations = []

    # Check if there are users with nursing access
    nursing_users = []
    for user in User.objects.all():
        if user.is_superuser or user.is_staff:
            nursing_users.append(user.username)
            continue
        if hasattr(user, 'practitioner_profile'):
            if user.practitioner_profile.role in ['nurse', 'head_nurse', 'nurse_practitioner']:
                nursing_users.append(user.username)
        elif hasattr(user, 'staff_profile'):
            if user.staff_profile.role in ['nurse', 'head_nurse', 'nurse_practitioner']:
                nursing_users.append(user.username)

    if not nursing_users:
        recommendations.append(
            "⚠ No users have nursing access. Assign nurse role to at least one user.\n"
            "  You can do this by creating/updating a PractitionerProfile with role='nurse'"
        )
    else:
        print(f"✓ {len(nursing_users)} user(s) have nursing access: {', '.join(nursing_users[:5])}")

    if Admission.objects.filter(status='admitted').count() == 0:
        recommendations.append(
            "⚠ No admitted patients. Admit at least one patient to test the nursing dashboard."
        )

    if not recommendations:
        print("✓ No critical issues found!")
        print("  If you're still seeing errors, check:")
        print("  - Network tab in browser DevTools for API errors")
        print("  - Django server logs for backend errors")
        print("  - User is logged in with proper credentials")
    else:
        for rec in recommendations:
            print(rec)

    print()
    print("=" * 60)
    print("END OF REPORT")
    print("=" * 60)


if __name__ == '__main__':
    check_nursing_module()
