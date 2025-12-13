
import os
import django
import sys

# Setup Django environment
sys.path.append('/Users/jebre/Desktop/hms/backend')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from apps.fhir_client.client import fhir_client
from apps.users.models import PatientProfile

def check_patient():
    try:
        # Get the patient we used earlier
        patient = PatientProfile.objects.get(id='d2744d3a-e048-4ebf-a370-813bf417bd1e')
        print(f"Checking FHIR patient ID: {patient.fhir_patient_id}")
        
        try:
            resource = fhir_client.get_resource('Patient', patient.fhir_patient_id)
            if resource:
                print("Patient FOUND in FHIR store.")
            else:
                print("Patient NOT FOUND in FHIR store (empty response).")
        except Exception as e:
            print(f"Error fetching patient from FHIR: {e}")

    except PatientProfile.DoesNotExist:
        print("Local patient not found.")

if __name__ == '__main__':
    check_patient()
