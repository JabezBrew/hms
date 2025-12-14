#!/usr/bin/env python3
"""
Script to create test users in production via API.
Run: python scripts/seed_prod_test_users.py
"""
import requests
import json
from datetime import date

# Production API
BASE_URL = 'https://backend-staging-8afc.up.railway.app/api'

# Admin credentials
ADMIN_EMAIL = 'admin@hms.com'
ADMIN_PASSWORD = 'Admin123!'

# Test users to create
TEST_USERS = [
    {
        'email': 'doctor@hms.com',
        'first_name': 'Test',
        'last_name': 'Doctor',
        'phone_number': '+1234567890',
        'date_of_birth': '1985-01-15',
        'user_type': 'doctor',
        'department': 'Internal Medicine',
        'position': 'Attending Physician',
        'hire_date': '2020-01-15',
        'license_number': 'MD-TEST-001',
        'specialization': 'Internal Medicine',
        'qualification': 'MD, MBBS',
    },
    {
        'email': 'nurse@hms.com',
        'first_name': 'Test',
        'last_name': 'Nurse',
        'phone_number': '+1234567891',
        'date_of_birth': '1990-03-20',
        'user_type': 'nurse',
        'department': 'Medical Ward',
        'position': 'Registered Nurse',
        'hire_date': '2021-03-01',
        'license_number': 'RN-TEST-001',
        'specialization': 'Medical-Surgical Nursing',
        'qualification': 'BSN, RN',
    },
    {
        'email': 'receptionist@hms.com',
        'first_name': 'Test',
        'last_name': 'Receptionist',
        'phone_number': '+1234567892',
        'date_of_birth': '1992-06-10',
        'user_type': 'receptionist',
        'department': 'Front Desk',
        'position': 'Senior Receptionist',
        'hire_date': '2022-06-15',
    },
    {
        'email': 'lab_tech@hms.com',
        'first_name': 'Test',
        'last_name': 'LabTech',
        'phone_number': '+1234567893',
        'date_of_birth': '1988-09-05',
        'user_type': 'lab_technician',
        'department': 'Laboratory',
        'position': 'Lab Technician',
        'hire_date': '2021-09-01',
    },
    {
        'email': 'pharmacist@hms.com',
        'first_name': 'Test',
        'last_name': 'Pharmacist',
        'phone_number': '+1234567894',
        'date_of_birth': '1987-11-25',
        'user_type': 'pharmacist',
        'department': 'Pharmacy',
        'position': 'Clinical Pharmacist',
        'hire_date': '2020-11-15',
    },
]


def login():
    """Login as admin and get JWT token."""
    print(f"Logging in as {ADMIN_EMAIL}...")
    response = requests.post(
        f'{BASE_URL}/auth/login/',
        json={'email': ADMIN_EMAIL, 'password': ADMIN_PASSWORD},
        headers={'Content-Type': 'application/json'}
    )

    if response.status_code == 200:
        data = response.json()
        print("Login successful!")
        return data.get('access')
    else:
        print(f"Login failed: {response.status_code}")
        print(response.text)
        return None


def create_staff(token, staff_data):
    """Create a staff member via API."""
    headers = {
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json'
    }

    response = requests.post(
        f'{BASE_URL}/users/staff/register/',
        json=staff_data,
        headers=headers
    )

    return response


def main():
    # Login
    token = login()
    if not token:
        print("Failed to login. Exiting.")
        return

    print("\n" + "="*50)
    print("Creating test users...")
    print("="*50 + "\n")

    created = 0
    skipped = 0
    failed = 0

    for user_data in TEST_USERS:
        email = user_data['email']
        print(f"Creating {email}...", end=" ")

        response = create_staff(token, user_data)

        if response.status_code == 201:
            print("SUCCESS")
            created += 1
        elif response.status_code == 400:
            error = response.json()
            if 'email' in str(error).lower() and 'already' in str(error).lower():
                print("SKIPPED (already exists)")
                skipped += 1
            else:
                print(f"FAILED: {error}")
                failed += 1
        else:
            print(f"FAILED: {response.status_code} - {response.text[:200]}")
            failed += 1

    print("\n" + "="*50)
    print(f"Results: {created} created, {skipped} skipped, {failed} failed")
    print("="*50)
    print("\nNote: Passwords are auto-generated and emailed to each user.")


if __name__ == '__main__':
    main()
