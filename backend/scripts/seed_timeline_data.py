"""
Seed script to populate timeline data (SOAP notes, vitals, prescriptions)
for Christie Tow and Naa Ama patients, authored by Dr. Isabella Asamoah.

Run with: python manage.py shell < scripts/seed_timeline_data.py
"""

import os
import sys
import django
from datetime import datetime, timedelta
from decimal import Decimal
import uuid

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'hms_backend.settings')
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
django.setup()

from django.utils import timezone
from apps.users.models import PatientProfile, PractitionerProfile, User
from apps.clinical_notes.models import NoteTemplate, NoteEntry, Prescription
from apps.nursing.models import VitalSigns

# ============================================
# Configuration - IDs from database
# ============================================

PATIENT_IDS = {
    'christie': 'b34d1453-63ea-4758-8b65-986909b27d99',
    'naa_ama': 'd2744d3a-e048-4ebf-a370-813bf417bd1e',
}

PRACTITIONER_ID = '29ec428c-4b71-4a86-8722-71b6fbb043e4'  # Dr. Isabella Asamoah
NURSE_ID = '5a400e5b-1200-438b-938c-6626d6671b65'  # Stella Amankwah (for vitals)

SOAP_TEMPLATE_ID = 'e7eee790-6ad9-46e0-ad2e-0107f51f9dbc'

# ============================================
# Mock SOAP Note Data for Christie Tow
# ============================================

CHRISTIE_SOAP_NOTE = {
    "subjective": {
        "chief_complaint": "Persistent headache and dizziness for 5 days",
        "history_of_present_illness": "45-year-old female presents with frontal headache rated 7/10 that started 5 days ago. Describes it as throbbing, worse in the morning. Associated with dizziness when standing quickly and mild nausea. No visual changes, no neck stiffness. Has been taking paracetamol with minimal relief. Reports increased stress at work and poor sleep (4-5 hours/night). No recent head trauma.",
        "review_of_systems": "Constitutional: Fatigue, poor sleep. No fever or weight changes. Neurological: Headache and dizziness as described. No weakness, numbness, or vision changes. Cardiovascular: Occasional palpitations. No chest pain or leg swelling.",
        "current_medications": "Paracetamol 1g PRN, Multivitamins daily",
        "allergies": "No known drug allergies",
        "social_history": "Non-smoker. Occasional alcohol (1-2 glasses wine on weekends). Works as a bank manager. Married with 3 children.",
        "family_history": "Mother: Hypertension, Migraines. Father: Type 2 DM. Sister: Migraines."
    },
    "objective": {
        "vital_signs": {
            "blood_pressure": "148/92",
            "heart_rate": 82,
            "respiratory_rate": 16,
            "temperature": 36.8,
            "oxygen_saturation": 98,
            "weight": 72,
            "height": 165
        },
        "physical_exam": {
            "general": "Alert, oriented, appears tired but in no acute distress.",
            "heent": "Normocephalic. Pupils equal and reactive. No papilledema on fundoscopy. Mild tenderness over frontal sinuses. Oropharynx clear.",
            "neck": "Supple, full range of motion. No meningismus. No lymphadenopathy.",
            "cardiovascular": "Regular rate and rhythm. Normal S1, S2. No murmurs.",
            "respiratory": "Clear to auscultation bilaterally.",
            "neurological": "Alert and oriented x3. Cranial nerves II-XII intact. Motor strength 5/5 all extremities. Sensation intact. Negative Romberg. Gait steady."
        },
        "investigations": "No acute investigations today. Will order routine bloods."
    },
    "assessment": {
        "primary_diagnosis": "Tension-type headache, likely related to stress and sleep deprivation",
        "differential_diagnoses": [
            "Migraine without aura",
            "Hypertensive headache (BP elevated)",
            "Sinusitis",
            "Cervicogenic headache"
        ],
        "secondary_findings": [
            "Elevated blood pressure - Stage 1 hypertension",
            "Sleep disturbance",
            "Work-related stress"
        ],
        "clinical_reasoning": "Patient's presentation with bilateral, non-pulsatile headache worsened by stress and improved partially with rest is consistent with tension-type headache. Elevated BP noted which could be contributing. No red flags for secondary causes (no fever, no focal neuro deficits, no thunderclap onset)."
    },
    "plan": {
        "medications": [
            "Ibuprofen 400mg PO TID with food for 5 days",
            "Amitriptyline 10mg PO at bedtime for headache prophylaxis"
        ],
        "investigations": [
            "FBC, UEC, Fasting lipids, Fasting glucose",
            "Ambulatory BP monitoring if office BP remains elevated"
        ],
        "non_pharmacological": [
            "Sleep hygiene counseling - aim for 7-8 hours",
            "Stress management techniques discussed",
            "Regular exercise - 30 min walking 5 days/week",
            "Reduce caffeine intake",
            "Ergonomic workstation assessment"
        ],
        "patient_education": [
            "Explained tension headache and triggers",
            "Discussed importance of lifestyle modifications",
            "Warning signs to return: severe sudden headache, fever, neck stiffness, vision changes, weakness"
        ],
        "follow_up": "Return in 2 weeks for BP check and headache reassessment. Earlier if symptoms worsen.",
        "referrals": "Consider neurology referral if no improvement in 4-6 weeks"
    }
}

# ============================================
# Mock SOAP Note Data for Naa Ama
# ============================================

NAA_AMA_SOAP_NOTE = {
    "subjective": {
        "chief_complaint": "Cough and fever for 3 days",
        "history_of_present_illness": "32-year-old female presents with productive cough (yellowish sputum) for 3 days, associated with fever (self-measured max 38.5°C), and mild shortness of breath on exertion. Reports body aches and fatigue. Denies chest pain, hemoptysis, or night sweats. No sick contacts known, but works in a busy market. No recent travel.",
        "review_of_systems": "Constitutional: Fever, fatigue, myalgia. Respiratory: Cough with sputum, mild dyspnea on exertion. No wheezing. ENT: Mild sore throat, nasal congestion. GI: Decreased appetite. No nausea, vomiting, or diarrhea.",
        "current_medications": "None regularly. Has been taking herbal remedies for cough.",
        "allergies": "Penicillin - causes skin rash",
        "social_history": "Non-smoker. No alcohol. Works as a trader at Makola Market. Single, lives with parents.",
        "family_history": "Father: Asthma. Mother: Healthy. No family history of TB."
    },
    "objective": {
        "vital_signs": {
            "blood_pressure": "118/76",
            "heart_rate": 96,
            "respiratory_rate": 20,
            "temperature": 38.2,
            "oxygen_saturation": 96,
            "weight": 65,
            "height": 160
        },
        "physical_exam": {
            "general": "Alert, febrile, mild respiratory distress at rest.",
            "heent": "Pharynx mildly erythematous. No tonsillar exudates. Nasal mucosa congested.",
            "neck": "Supple. Mild anterior cervical lymphadenopathy, tender.",
            "cardiovascular": "Tachycardic but regular rhythm. No murmurs.",
            "respiratory": "Decreased breath sounds at right base. Crackles heard in right lower zone. No wheezing. Dullness to percussion right base.",
            "abdomen": "Soft, non-tender. Normal bowel sounds."
        },
        "investigations_results": {
            "chest_xray": "Right lower lobe consolidation consistent with pneumonia. No pleural effusion.",
            "labs": {
                "wbc": "14.2 x10^9/L (elevated)",
                "neutrophils": "82%",
                "hemoglobin": "12.8 g/dL",
                "crp": "85 mg/L (elevated)"
            }
        }
    },
    "assessment": {
        "primary_diagnosis": "Community-acquired pneumonia (CAP) - Right lower lobe",
        "severity": "CURB-65 Score: 1 (tachypnea) - Low to moderate severity, suitable for outpatient treatment",
        "differential_diagnoses": [
            "Acute bronchitis",
            "Influenza with secondary bacterial infection",
            "COVID-19 (less likely given presentation)",
            "Pulmonary tuberculosis (keep in differential given endemic area)"
        ],
        "clinical_reasoning": "Productive cough, fever, and focal findings on examination (crackles, dullness) with radiological confirmation of consolidation confirm community-acquired pneumonia. Low CURB-65 score allows for outpatient management. Penicillin allergy noted - will use alternative antibiotic."
    },
    "plan": {
        "medications": [
            "Azithromycin 500mg PO daily for 5 days (Day 1: 500mg, Days 2-5: 250mg)",
            "Paracetamol 1g PO QID PRN for fever",
            "Guaifenesin 200mg PO TID for cough",
            "Oral rehydration - encourage 2-3L fluids daily"
        ],
        "investigations": [
            "Sputum culture and sensitivity (if no improvement in 48-72 hours)",
            "COVID-19 rapid test",
            "Repeat CXR in 6 weeks to confirm resolution"
        ],
        "non_pharmacological": [
            "Rest at home for at least 5 days",
            "Isolation precautions until afebrile for 24 hours",
            "Deep breathing exercises",
            "Humidified air for comfort"
        ],
        "patient_education": [
            "Explained pneumonia diagnosis and treatment",
            "Importance of completing antibiotic course",
            "Signs of deterioration: increasing breathlessness, chest pain, confusion, unable to keep fluids down",
            "Call or return immediately if symptoms worsen"
        ],
        "follow_up": "Phone call in 48 hours to assess response. Return visit in 5-7 days. Earlier if worsening.",
        "disposition": "Outpatient management. Gave sick note for 1 week."
    }
}

# ============================================
# Additional SOAP notes (historical)
# ============================================

CHRISTIE_HISTORICAL_NOTES = [
    {
        "created_days_ago": 14,
        "data": {
            "subjective": {
                "chief_complaint": "Annual health screening",
                "history_of_present_illness": "45-year-old female here for routine annual checkup. No acute complaints. Generally feels well. Reports occasional mild headaches 1-2x per week, usually resolves with rest. Sleep has been irregular due to work demands."
            },
            "objective": {
                "vital_signs": {"blood_pressure": "138/88", "heart_rate": 76, "temperature": 36.6},
                "physical_exam": {"general": "Well-appearing, no distress", "cardiovascular": "RRR, no murmurs", "respiratory": "CTA bilaterally"}
            },
            "assessment": {"primary_diagnosis": "Annual wellness visit. Borderline elevated BP noted."},
            "plan": {"recommendations": ["Lifestyle modifications for BP", "Recheck BP in 2 weeks", "Continue healthy diet"]}
        }
    },
    {
        "created_days_ago": 45,
        "data": {
            "subjective": {
                "chief_complaint": "Upper respiratory infection",
                "history_of_present_illness": "Presents with runny nose, sore throat, and mild cough for 2 days. No fever. No sick contacts."
            },
            "objective": {
                "vital_signs": {"blood_pressure": "124/82", "heart_rate": 72, "temperature": 37.0},
                "physical_exam": {"general": "Mild nasal congestion", "throat": "Mildly erythematous, no exudates"}
            },
            "assessment": {"primary_diagnosis": "Viral upper respiratory infection"},
            "plan": {"medications": ["Symptomatic treatment with decongestants", "Warm fluids", "Rest"]}
        }
    }
]

NAA_AMA_HISTORICAL_NOTES = [
    {
        "created_days_ago": 30,
        "data": {
            "subjective": {
                "chief_complaint": "Menstrual cramps",
                "history_of_present_illness": "32-year-old female with dysmenorrhea. Reports crampy lower abdominal pain during first 2 days of menses, rated 6/10. Regular cycles every 28 days. No intermenstrual bleeding."
            },
            "objective": {
                "vital_signs": {"blood_pressure": "116/74", "heart_rate": 78, "temperature": 36.7},
                "physical_exam": {"abdomen": "Soft, mild suprapubic tenderness. No masses."}
            },
            "assessment": {"primary_diagnosis": "Primary dysmenorrhea"},
            "plan": {"medications": ["Ibuprofen 400mg TID during menses", "Heat application"], "follow_up": "PRN"}
        }
    }
]

# ============================================
# Vitals Data
# ============================================

CHRISTIE_VITALS = [
    {"days_ago": 0, "temperature": 36.8, "heart_rate": 82, "bp_sys": 148, "bp_dia": 92, "rr": 16, "spo2": 98, "pain": 7},
    {"days_ago": 1, "temperature": 36.7, "heart_rate": 78, "bp_sys": 142, "bp_dia": 88, "rr": 16, "spo2": 99, "pain": 6},
    {"days_ago": 3, "temperature": 36.9, "heart_rate": 80, "bp_sys": 145, "bp_dia": 90, "rr": 15, "spo2": 98, "pain": 5},
    {"days_ago": 7, "temperature": 36.6, "heart_rate": 76, "bp_sys": 138, "bp_dia": 86, "rr": 16, "spo2": 99, "pain": 3},
]

NAA_AMA_VITALS = [
    {"days_ago": 0, "temperature": 38.2, "heart_rate": 96, "bp_sys": 118, "bp_dia": 76, "rr": 20, "spo2": 96, "pain": 4},
    {"days_ago": 1, "temperature": 38.5, "heart_rate": 102, "bp_sys": 116, "bp_dia": 72, "rr": 22, "spo2": 95, "pain": 5},
    {"days_ago": 2, "temperature": 37.8, "heart_rate": 88, "bp_sys": 120, "bp_dia": 78, "rr": 18, "spo2": 97, "pain": 3},
]

# ============================================
# Prescriptions Data
# ============================================

CHRISTIE_PRESCRIPTIONS = [
    {
        "medication_name": "Ibuprofen",
        "dosage": "400mg",
        "route": "oral",
        "frequency": "tid",
        "duration_days": 5,
        "instructions": "Take with food to protect stomach",
        "reason": "Tension headache management"
    },
    {
        "medication_name": "Amitriptyline",
        "dosage": "10mg",
        "route": "oral",
        "frequency": "qhs",
        "duration_days": 30,
        "instructions": "Take at bedtime. May cause drowsiness.",
        "reason": "Headache prophylaxis"
    }
]

NAA_AMA_PRESCRIPTIONS = [
    {
        "medication_name": "Azithromycin",
        "dosage": "500mg",
        "route": "oral",
        "frequency": "daily",
        "duration_days": 5,
        "instructions": "Take 500mg on day 1, then 250mg days 2-5. Complete the full course.",
        "reason": "Community-acquired pneumonia"
    },
    {
        "medication_name": "Paracetamol",
        "dosage": "1g",
        "route": "oral",
        "frequency": "qid",
        "duration_days": 5,
        "instructions": "Take every 6 hours as needed for fever. Do not exceed 4g per day.",
        "reason": "Fever management"
    },
    {
        "medication_name": "Guaifenesin",
        "dosage": "200mg",
        "route": "oral",
        "frequency": "tid",
        "duration_days": 7,
        "instructions": "Take with plenty of water to help loosen mucus.",
        "reason": "Productive cough - expectorant"
    }
]

# ============================================
# Seed Functions
# ============================================

def create_note_entry(patient_id, practitioner_id, template_id, data, created_at=None):
    """Create a clinical note entry."""
    patient = PatientProfile.objects.get(id=patient_id)
    practitioner = PractitionerProfile.objects.get(id=practitioner_id)
    template = NoteTemplate.objects.get(id=template_id)

    note = NoteEntry.objects.create(
        template=template,
        encounter_id=f"ENC-{uuid.uuid4().hex[:8].upper()}",
        practitioner=practitioner,
        data=data
    )

    if created_at:
        NoteEntry.objects.filter(id=note.id).update(created_at=created_at)
        note.refresh_from_db()

    return note


def create_vital_signs(patient_id, practitioner_id, vitals_data, recorded_at=None):
    """Create vital signs entry."""
    patient = PatientProfile.objects.get(id=patient_id)
    practitioner = PractitionerProfile.objects.get(id=practitioner_id)

    vital = VitalSigns.objects.create(
        patient=patient,
        recorded_by=practitioner,
        temperature=Decimal(str(vitals_data.get('temperature', 36.8))),
        heart_rate=vitals_data.get('heart_rate'),
        blood_pressure_systolic=vitals_data.get('bp_sys'),
        blood_pressure_diastolic=vitals_data.get('bp_dia'),
        respiratory_rate=vitals_data.get('rr'),
        oxygen_saturation=vitals_data.get('spo2'),
        pain_level=vitals_data.get('pain'),
        recorded_at=recorded_at or timezone.now()
    )

    return vital


def create_prescription(patient_id, practitioner_id, rx_data, created_at=None):
    """Create a prescription."""
    patient = PatientProfile.objects.get(id=patient_id)
    practitioner = PractitionerProfile.objects.get(id=practitioner_id)

    start_date = (created_at or timezone.now()).date()

    prescription = Prescription.objects.create(
        patient=patient,
        prescribed_by=practitioner,
        medication_name=rx_data['medication_name'],
        dosage=rx_data['dosage'],
        route=rx_data['route'],
        frequency=rx_data['frequency'],
        duration_days=rx_data.get('duration_days'),
        start_date=start_date,
        instructions=rx_data.get('instructions', ''),
        reason=rx_data.get('reason', ''),
        status='active'
    )

    if created_at:
        Prescription.objects.filter(id=prescription.id).update(created_at=created_at)
        prescription.refresh_from_db()

    return prescription


def run_seed():
    """Main seed function."""
    print("=" * 60)
    print("Starting Timeline Data Seed")
    print("=" * 60)

    now = timezone.now()

    # ============================================
    # Seed Christie Tow's data
    # ============================================
    print("\n📋 Seeding Christie Tow's data...")

    # Current SOAP note
    note1 = create_note_entry(
        PATIENT_IDS['christie'],
        PRACTITIONER_ID,
        SOAP_TEMPLATE_ID,
        CHRISTIE_SOAP_NOTE
    )
    print(f"  ✓ Created SOAP note: {note1.id}")

    # Historical notes
    for hist_note in CHRISTIE_HISTORICAL_NOTES:
        created_at = now - timedelta(days=hist_note['created_days_ago'])
        note = create_note_entry(
            PATIENT_IDS['christie'],
            PRACTITIONER_ID,
            SOAP_TEMPLATE_ID,
            hist_note['data'],
            created_at=created_at
        )
        print(f"  ✓ Created historical note ({hist_note['created_days_ago']} days ago): {note.id}")

    # Vitals
    for vitals_data in CHRISTIE_VITALS:
        recorded_at = now - timedelta(days=vitals_data['days_ago'])
        vital = create_vital_signs(
            PATIENT_IDS['christie'],
            NURSE_ID,
            vitals_data,
            recorded_at=recorded_at
        )
        print(f"  ✓ Created vitals ({vitals_data['days_ago']} days ago): {vital.id}")

    # Prescriptions
    for rx_data in CHRISTIE_PRESCRIPTIONS:
        rx = create_prescription(
            PATIENT_IDS['christie'],
            PRACTITIONER_ID,
            rx_data
        )
        print(f"  ✓ Created prescription: {rx.medication_name} - {rx.id}")

    # ============================================
    # Seed Naa Ama's data
    # ============================================
    print("\n📋 Seeding Naa Ama's data...")

    # Current SOAP note
    note2 = create_note_entry(
        PATIENT_IDS['naa_ama'],
        PRACTITIONER_ID,
        SOAP_TEMPLATE_ID,
        NAA_AMA_SOAP_NOTE
    )
    print(f"  ✓ Created SOAP note: {note2.id}")

    # Historical notes
    for hist_note in NAA_AMA_HISTORICAL_NOTES:
        created_at = now - timedelta(days=hist_note['created_days_ago'])
        note = create_note_entry(
            PATIENT_IDS['naa_ama'],
            PRACTITIONER_ID,
            SOAP_TEMPLATE_ID,
            hist_note['data'],
            created_at=created_at
        )
        print(f"  ✓ Created historical note ({hist_note['created_days_ago']} days ago): {note.id}")

    # Vitals
    for vitals_data in NAA_AMA_VITALS:
        recorded_at = now - timedelta(days=vitals_data['days_ago'])
        vital = create_vital_signs(
            PATIENT_IDS['naa_ama'],
            NURSE_ID,
            vitals_data,
            recorded_at=recorded_at
        )
        print(f"  ✓ Created vitals ({vitals_data['days_ago']} days ago): {vital.id}")

    # Prescriptions
    for rx_data in NAA_AMA_PRESCRIPTIONS:
        rx = create_prescription(
            PATIENT_IDS['naa_ama'],
            PRACTITIONER_ID,
            rx_data
        )
        print(f"  ✓ Created prescription: {rx.medication_name} - {rx.id}")

    # ============================================
    # Summary
    # ============================================
    print("\n" + "=" * 60)
    print("✅ Seed completed successfully!")
    print("=" * 60)

    # Count totals
    christie_notes = NoteEntry.objects.count()
    christie_vitals = VitalSigns.objects.filter(patient_id=PATIENT_IDS['christie']).count()
    christie_rx = Prescription.objects.filter(patient_id=PATIENT_IDS['christie']).count()

    naa_ama_vitals = VitalSigns.objects.filter(patient_id=PATIENT_IDS['naa_ama']).count()
    naa_ama_rx = Prescription.objects.filter(patient_id=PATIENT_IDS['naa_ama']).count()

    print(f"\nChristie Tow:")
    print(f"  - Vitals: {christie_vitals}")
    print(f"  - Prescriptions: {christie_rx}")

    print(f"\nNaa Ama:")
    print(f"  - Vitals: {naa_ama_vitals}")
    print(f"  - Prescriptions: {naa_ama_rx}")

    print(f"\nTotal Note Entries: {christie_notes}")


if __name__ == "__main__":
    run_seed()
