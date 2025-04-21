"""
Test script to manually trigger the Celery task for generating slots.
This is useful for testing the task before relying on the scheduled execution.

Usage:
    python test_celery_task.py
"""
import os
import django

# Set up Django environment
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'hms_backend.settings')
django.setup()

from apps.appointments.tasks import generate_slots_weekly

if __name__ == "__main__":
    print("Manually triggering the generate_slots_weekly task...")
    result = generate_slots_weekly.delay(14)
    print(f"Task triggered with ID: {result.id}")
    print("Check Celery logs for task execution details.")
    print("You can also check the task status with:")
    print(f"  result = generate_slots_weekly.AsyncResult('{result.id}')")
    print("  print(result.status)")