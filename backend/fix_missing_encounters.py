import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'hms_backend.settings')
django.setup()

from apps.wards.models import Admission
from apps.encounters.proxies import EncounterProxy

# Get all active admissions without FHIR encounters
admissions_without_encounters = Admission.objects.filter(
    status='admitted',
    fhir_encounter_id__isnull=True
)

print(f"Found {admissions_without_encounters.count()} admissions without FHIR encounters")

for admission in admissions_without_encounters:
    print(f"\nProcessing admission {admission.id}:")
    print(f"  Patient: {admission.patient}")
    print(f"  Bed: {admission.bed.bed_number} in {admission.bed.ward.name}")
    print(f"  Admission date: {admission.admission_date}")
    
    try:
        # Get practitioner ID if available
        practitioner_id = None
        if admission.admitting_doctor and admission.admitting_doctor.fhir_practitioner_id:
            practitioner_id = admission.admitting_doctor.fhir_practitioner_id
            print(f"  Practitioner ID: {practitioner_id}")
        else:
            print(f"  No practitioner assigned")
        
        # Create FHIR Encounter
        fhir_encounter = EncounterProxy.create(
            patient_id=admission.patient.fhir_patient_id,
            practitioner_id=practitioner_id,
            encounter_type="inpatient",
            status="in-progress",
            start_time=admission.admission_date,
            service_type=f"Admission to {admission.bed.ward.name}",
            location=admission.bed.ward.name
        )
        
        # Update the admission with the FHIR encounter ID
        admission.fhir_encounter_id = fhir_encounter["id"]
        admission.save()
        
        print(f"  ✓ Created FHIR encounter: {fhir_encounter['id']}")
        
    except Exception as e:
        print(f"  ✗ Error creating encounter: {str(e)}")

print("\nDone!")
