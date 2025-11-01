import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'hms_backend.settings')
django.setup()

from apps.wards.models import Admission, Bed

# Get all active admissions
active_admissions = Admission.objects.filter(status='admitted')

print(f"Found {active_admissions.count()} active admissions")

for admission in active_admissions:
    bed = admission.bed
    print(f"Admission {admission.id}: Patient on bed {bed.bed_number}, current status: {bed.status}")
    
    if bed.status != 'occupied':
        print(f"  -> Updating bed {bed.bed_number} to 'occupied'")
        bed.status = 'occupied'
        bed.save()
        print(f"  -> Bed updated successfully")
    else:
        print(f"  -> Bed already marked as occupied")

print("\nDone!")
