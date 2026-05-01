"""
seed_production_dataset.py
Comprehensive production data seeder for HMS.

Creates thousands of interconnected, realistic patients, staff, clinical journeys,
and billing records across multiple facilities. All data is archetype-driven so
every patient's labs, vitals, medications, and billing are medically coherent.

Usage:
    python manage.py seed_production_dataset
    python manage.py seed_production_dataset --profile staging --facility-code MAIN
    python manage.py seed_production_dataset --profile large
    python manage.py seed_production_dataset --facilities 3 --patients 10000 --years 5
    python manage.py seed_production_dataset --chunk 0-2000   # seed patients 0-1999
    python manage.py seed_production_dataset --resume --batch-size 2000
    python manage.py seed_production_dataset --dry-run
    python manage.py seed_production_dataset --rollback --manifest /tmp/seed_manifest.json

Architecture:
    - Direct ORM + bulk_create (no HTTP overhead); ~10-20 min for 10k patients
    - Archetype-driven: each patient's entire history flows from one archetype
    - Transactions per configurable patient batch; safe to interrupt and resume with --chunk/--resume
    - Manifest JSON records every created PK; --rollback deletes them in safe order
    - Tagged: seed engine admin user (seed_engine@hms.local) as created_by on all records
"""
from __future__ import annotations

import json
import random
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Optional

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.admissions.models import AdmissionCase, AdmissionTask, BedReservation
from apps.appointments.models import Appointment, AppointmentType
from apps.billing.models import (
    Claim,
    InsurancePlan,
    InsuranceProvider,
    Invoice,
    InvoiceItem,
    NHISClaimBatch,
    PatientInsurance,
    Payment,
    Service,
    ServiceCategory,
)
from apps.clinical_notes.models import NoteEntry, NoteTemplate, Prescription
from apps.core.features import feature_enabled
from apps.core.models import Department, Facility
from apps.discharge.models import DischargeCase, DischargeTask
from apps.encounters.models import Encounter, EncounterCareTeam, OutpatientVisit
from apps.inventory.models import (
    InventoryCategory,
    InventoryItem,
    LocationStock,
    StorageLocation,
)
from apps.laboratory.models import (
    LabOrder, LabOrderSequence, LabOrderTest, LabResult, LabSpecimen, LabTestCatalog,
)
from apps.nursing.models import (
    FluidBalance,
    MedicationAdministration,
    NursingAlert,
    NursingTask,
    ShiftHandoff,
    SupplyRequest,
    TreatmentSheetEntry,
    VitalSigns,
)
from apps.organization.models import (
    ClinicalUnit,
    Clinic,
    ClinicSchedule,
    DepartmentDutyType,
    RosterEntry,
    StaffAssignmentTypeConfig,
    StaffUnitAssignment,
    UnitMemberAssignment,
    UnitTypeConfig,
    UnitWardAllocation,
)
from apps.patients.models import PatientSearchIndex
from apps.users.identifiers import generate_unique_employee_id, generate_unique_mrn
from apps.users.models import PatientProfile, PractitionerProfile, Staff
from apps.wards.models import Admission, Bed, BedAllocationLog, StaffRole, Ward, WardStaffAssignment

User = get_user_model()

# ============================================================================
# SEED PROFILES
# ============================================================================

PROFILES = {
    "smoke":  {"facilities": 1, "patients": 50,     "years": 1},
    "staging": {"facilities": 1, "patients": 150,    "years": 1},
    "small":  {"facilities": 1, "patients": 500,    "years": 2},
    "medium": {"facilities": 2, "patients": 2_000,  "years": 3},
    "large":  {"facilities": 3, "patients": 10_000, "years": 5},
}

# ============================================================================
# GHANAIAN DATA CONSTANTS
# ============================================================================

MALE_FIRST = [
    "Kwame", "Kofi", "Yaw", "Kweku", "Fiifi", "Nii", "Kojo", "Kwesi", "Nana",
    "Ebo", "Ato", "Tetteh", "Kwei", "Emmanuel", "Samuel", "Michael", "Daniel",
    "Joseph", "James", "John", "Isaac", "Benjamin", "Solomon", "Abraham",
    "Moses", "David", "Peter", "Paul", "Philip", "Richard", "Robert", "William",
    "Henry", "Edward", "George", "Patrick", "Anthony", "Francis", "Stephen",
]
FEMALE_FIRST = [
    "Ama", "Akua", "Abena", "Adjoa", "Afia", "Adwoa", "Efua", "Naa", "Akosua",
    "Esi", "Maame", "Aba", "Mansa", "Afua", "Ekua", "Grace", "Patience",
    "Mercy", "Comfort", "Felicia", "Naomi", "Ruth", "Mary", "Sarah", "Esther",
    "Miriam", "Elizabeth", "Dorothy", "Beatrice", "Alice", "Agnes", "Florence",
    "Helen", "Joyce", "Linda", "Margaret", "Cecilia", "Perpetua", "Veronica",
]
SURNAMES = [
    "Mensah", "Owusu", "Asante", "Boateng", "Darko", "Agyei", "Amponsah",
    "Frimpong", "Adusei", "Appiah", "Ofori", "Acheampong", "Addai", "Nyarko",
    "Tetteh", "Quartey", "Quaye", "Ankrah", "Nkrumah", "Aidoo", "Asamoah",
    "Bonsu", "Gyasi", "Osei", "Opoku", "Adomako", "Asiedu", "Baah", "Domfeh",
    "Duah", "Danso", "Antwi", "Afriyie", "Agyemang", "Amankwah", "Boadu",
    "Boakye", "Bediako", "Baffoe", "Bentil", "Berko", "Asare", "Annan",
    "Atta", "Yeboah", "Wireko", "Twumasi", "Wiredu", "Buabeng", "Safo",
]
BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"]
BLOOD_WEIGHTS = [30, 5, 25, 5, 38, 7, 5, 3]

GH_CITIES = ["Accra", "Kumasi", "Tamale", "Cape Coast", "Takoradi", "Sunyani", "Koforidua"]

# ============================================================================
# FACILITIES CONFIG
# ============================================================================

FACILITIES_CONFIG = [
    {"code": "KBTH", "name": "Korle-Bu Teaching Hospital",
     "address": "Korle-Bu, Accra", "city": "Accra", "region": "Greater Accra"},
    {"code": "KATH", "name": "Komfo Anokye Teaching Hospital",
     "address": "Hospital Road, Kumasi", "city": "Kumasi", "region": "Ashanti"},
    {"code": "GARH", "name": "Greater Accra Regional Hospital",
     "address": "Ridge, Accra", "city": "Accra", "region": "Greater Accra"},
]

DEPARTMENTS_CONFIG = [
    "General Outpatient", "Internal Medicine", "Surgery",
    "Obstetrics & Gynaecology", "Paediatrics", "Emergency Medicine",
    "Laboratory Services", "Pharmacy", "Administration",
]

WARDS_CONFIG = [
    {"name": "Medical Ward A",  "type": "general",   "beds": 30, "rate": "150.00", "dept": "Internal Medicine"},
    {"name": "Medical Ward B",  "type": "general",   "beds": 28, "rate": "150.00", "dept": "Internal Medicine"},
    {"name": "Surgical Ward",   "type": "general",   "beds": 25, "rate": "180.00", "dept": "Surgery"},
    {"name": "Women's Ward",    "type": "general",   "beds": 25, "rate": "150.00", "dept": "Obstetrics & Gynaecology"},
    {"name": "Children's Ward", "type": "pediatric", "beds": 20, "rate": "120.00", "dept": "Paediatrics"},
    {"name": "Emergency Ward",  "type": "emergency", "beds": 15, "rate": "200.00", "dept": "Emergency Medicine"},
    {"name": "ICU",             "type": "icu",       "beds": 8,  "rate": "800.00", "dept": "Internal Medicine"},
    {"name": "Maternity Ward",  "type": "maternity", "beds": 20, "rate": "180.00", "dept": "Obstetrics & Gynaecology"},
    {"name": "Private Ward",    "type": "private",   "beds": 12, "rate": "500.00", "dept": "Internal Medicine"},
]

# Staff specs: (user_type, department_name, specialization, position, qualification, count_per_facility)
STAFF_SPECS = [
    ("doctor",         "Internal Medicine",        "General Medicine",          "Consultant Physician",     "MBChB, FWACP",           3),
    ("doctor",         "Internal Medicine",        "Cardiology",                "Consultant Cardiologist",  "MBChB, FWACP",           1),
    ("doctor",         "Surgery",                  "General Surgery",           "Consultant Surgeon",       "MBChB, FWACS",           2),
    ("doctor",         "Obstetrics & Gynaecology", "Obstetrics & Gynaecology", "Consultant OB/GYN",        "MBChB, FWACS (O&G)",     2),
    ("doctor",         "Paediatrics",              "Paediatrics",               "Consultant Paediatrician", "MBChB, FWACP (Paeds)",   2),
    ("doctor",         "Emergency Medicine",       "Emergency Medicine",        "Emergency Physician",      "MBChB, FGCS",            2),
    ("nurse",          "Internal Medicine",        "General Nursing",           "Registered Nurse",         "BSc Nursing, RN",        6),
    ("nurse",          "Surgery",                  "Surgical Nursing",          "Registered Nurse",         "BSc Nursing, RN",        3),
    ("nurse",          "Obstetrics & Gynaecology", "Midwifery",                 "Midwife",                  "BSc Midwifery",          3),
    ("nurse",          "Paediatrics",              "Paediatric Nursing",        "Registered Nurse",         "BSc Nursing, RN",        2),
    ("nurse",          "Emergency Medicine",       "Emergency Nursing",         "Emergency Nurse",          "BSc Nursing, RN",        2),
    ("lab_technician", "Laboratory Services",      "Medical Laboratory Sci.",   "Med. Lab. Scientist",      "BSc MLS",                3),
    ("pharmacist",     "Pharmacy",                 "Clinical Pharmacy",         "Clinical Pharmacist",      "BPharm",                 2),
    ("receptionist",   "Administration",           "",                          "Front Desk Officer",       "HND Administration",     2),
]

# ============================================================================
# LAB TESTS CATALOG
# ============================================================================

LAB_TESTS_CONFIG = [
    {"code": "FBC",   "name": "Full Blood Count",          "short": "FBC",    "cat": "hematology",   "spec": "Whole Blood",    "cont": "EDTA",        "unit": "K/uL",    "low": 4.0,   "high": 11.0, "tat": 4,  "price": "40.00"},
    {"code": "RBG",   "name": "Random Blood Glucose",      "short": "RBG",    "cat": "chemistry",    "spec": "Serum",          "cont": "SST",         "unit": "mmol/L",  "low": 3.9,   "high": 7.8,  "tat": 2,  "price": "25.00"},
    {"code": "FBS",   "name": "Fasting Blood Sugar",       "short": "FBS",    "cat": "chemistry",    "spec": "Serum",          "cont": "SST",         "unit": "mmol/L",  "low": 3.9,   "high": 5.6,  "tat": 2,  "price": "25.00"},
    {"code": "HBA1C", "name": "Haemoglobin A1c",           "short": "HbA1c",  "cat": "chemistry",    "spec": "Whole Blood",    "cont": "EDTA",        "unit": "%",       "low": 0.0,   "high": 5.7,  "tat": 24, "price": "85.00"},
    {"code": "U&E",   "name": "Urea and Electrolytes",     "short": "U&E",    "cat": "chemistry",    "spec": "Serum",          "cont": "SST",         "unit": "mmol/L",  "low": 2.5,   "high": 7.1,  "tat": 4,  "price": "55.00"},
    {"code": "CRE",   "name": "Creatinine",                "short": "CRE",    "cat": "chemistry",    "spec": "Serum",          "cont": "SST",         "unit": "umol/L",  "low": 44.0,  "high": 97.0, "tat": 4,  "price": "35.00"},
    {"code": "LFT",   "name": "Liver Function Tests",      "short": "LFT",    "cat": "chemistry",    "spec": "Serum",          "cont": "SST",         "unit": "U/L",     "low": 5.0,   "high": 40.0, "tat": 8,  "price": "70.00"},
    {"code": "LIPID", "name": "Lipid Profile",             "short": "Lipid",  "cat": "chemistry",    "spec": "Serum",          "cont": "SST",         "unit": "mmol/L",  "low": 0.0,   "high": 5.2,  "tat": 6,  "price": "65.00"},
    {"code": "TSH",   "name": "Thyroid Stimulating Horm.", "short": "TSH",    "cat": "endocrine",    "spec": "Serum",          "cont": "SST",         "unit": "mIU/L",   "low": 0.4,   "high": 4.0,  "tat": 24, "price": "75.00"},
    {"code": "MP",    "name": "Malaria Parasite",          "short": "MP",     "cat": "microbiology", "spec": "Whole Blood",    "cont": "EDTA",        "unit": "/uL",     "low": 0.0,   "high": 0.0,  "tat": 2,  "price": "30.00"},
    {"code": "WIDAL", "name": "Widal Test",                "short": "Widal",  "cat": "serology",     "spec": "Serum",          "cont": "SST",         "unit": "titre",   "low": 0.0,   "high": 80.0, "tat": 4,  "price": "40.00"},
    {"code": "HBS",   "name": "Hepatitis B Surface Ag.",   "short": "HBsAg",  "cat": "serology",     "spec": "Serum",          "cont": "SST",         "unit": "react",   "low": 0.0,   "high": 0.0,  "tat": 4,  "price": "45.00"},
    {"code": "HIV",   "name": "HIV Screening",             "short": "HIV Ab", "cat": "serology",     "spec": "Serum",          "cont": "SST",         "unit": "react",   "low": 0.0,   "high": 0.0,  "tat": 4,  "price": "35.00"},
    {"code": "URE",   "name": "Urinalysis",                "short": "URE",    "cat": "urinalysis",   "spec": "Urine",          "cont": "Sterile Cup", "unit": "various", "low": 0.0,   "high": 0.0,  "tat": 2,  "price": "20.00"},
    {"code": "GS",    "name": "Group and Screen",          "short": "G&S",    "cat": "hematology",   "spec": "Whole Blood",    "cont": "EDTA",        "unit": "group",   "low": 0.0,   "high": 0.0,  "tat": 2,  "price": "35.00"},
    {"code": "CRP",   "name": "C-Reactive Protein",        "short": "CRP",    "cat": "chemistry",    "spec": "Serum",          "cont": "SST",         "unit": "mg/L",    "low": 0.0,   "high": 5.0,  "tat": 6,  "price": "50.00"},
    {"code": "COAG",  "name": "Coagulation Screen",        "short": "Coag",   "cat": "coagulation",  "spec": "Citrated Plasma","cont": "Blue Top",    "unit": "seconds", "low": 11.0,  "high": 15.0, "tat": 6,  "price": "60.00"},
    {"code": "AFB",   "name": "AFB Smear (TB Screen)",     "short": "AFB",    "cat": "microbiology", "spec": "Sputum",         "cont": "Sterile Cup", "unit": "pos/neg", "low": 0.0,   "high": 0.0,  "tat": 24, "price": "40.00"},
]

SERVICE_CATEGORIES_CONFIG = [
    "Consultations", "Laboratory", "Procedures", "Ward Charges", "Medications", "Radiology", "Emergency",
]

SERVICES_CONFIG = [
    {"name": "General Consultation",           "code": "CONS-GEN",   "cat": "Consultations", "price": "80.00"},
    {"name": "Specialist Consultation",        "code": "CONS-SPEC",  "cat": "Consultations", "price": "150.00"},
    {"name": "Emergency Consultation",         "code": "CONS-EMRG",  "cat": "Consultations", "price": "200.00"},
    {"name": "ANC Visit",                      "code": "CONS-ANC",   "cat": "Consultations", "price": "60.00"},
    {"name": "Paediatric Consultation",        "code": "CONS-PED",   "cat": "Consultations", "price": "80.00"},
    {"name": "Laboratory Package",             "code": "LAB-PKG",    "cat": "Laboratory",    "price": "120.00"},
    {"name": "Dressing and Wound Care",        "code": "PROC-DRESS", "cat": "Procedures",    "price": "30.00"},
    {"name": "IV Cannulation",                 "code": "PROC-IVC",   "cat": "Procedures",    "price": "25.00"},
    {"name": "Surgical Procedure",             "code": "PROC-SURG",  "cat": "Procedures",    "price": "500.00"},
    {"name": "General Ward Bed (per night)",   "code": "WARD-GEN",   "cat": "Ward Charges",  "price": "150.00"},
    {"name": "Private Ward Bed (per night)",   "code": "WARD-PRIV",  "cat": "Ward Charges",  "price": "500.00"},
    {"name": "ICU Bed (per night)",            "code": "WARD-ICU",   "cat": "Ward Charges",  "price": "800.00"},
    {"name": "Drugs and Medications",          "code": "MED-GEN",    "cat": "Medications",   "price": "50.00"},
    {"name": "Chest X-Ray",                    "code": "RAD-CXR",    "cat": "Radiology",     "price": "120.00"},
    {"name": "Ultrasound (Abdomen/Pelvis)",    "code": "RAD-USS",    "cat": "Radiology",     "price": "180.00"},
    {"name": "Emergency Fee",                  "code": "EMRG-FEE",   "cat": "Emergency",     "price": "100.00"},
]

SOAP_TEMPLATE_STRUCTURE = {
    "sections": [
        {"id": "subjective", "title": "Subjective (History)",     "type": "textarea", "required": True},
        {"id": "objective",  "title": "Objective (Examination)",  "type": "textarea", "required": True},
        {"id": "assessment", "title": "Assessment (Diagnosis)",   "type": "textarea", "required": True},
        {"id": "plan",       "title": "Plan (Management)",        "type": "textarea", "required": True},
    ]
}

# ============================================================================
# ARCHETYPE CONFIG
# ============================================================================

ARCHETYPE_WEIGHTS = {
    "healthy_adult":   25,
    "hypertensive":    20,
    "diabetic":        15,
    "chronic_complex": 10,
    "respiratory":      8,
    "surgical":         7,
    "maternity":        7,
    "pediatric":        5,
    "infectious":       3,
}

# Keys: outpatient_per_year, admission_prob, icd10s, labs, bp_range (sys, dias), hr_range, temp_range, spo2_min, gender
ARCHETYPE = {
    "healthy_adult":   {"op": (1, 3),  "adm": 0.05, "icd": ["Z00.0", "J06.9", "K29.7", "M54.5"],    "labs": ["FBC", "RBG", "URE"],                  "sbp": (100, 130), "dbp": (60, 85),  "hr": (60, 90),   "temp": (36.2, 37.2), "spo2": 96, "gender": None},
    "hypertensive":    {"op": (4, 8),  "adm": 0.25, "icd": ["I10", "I25.1", "N18.3", "I63.9"],       "labs": ["FBC", "U&E", "CRE", "LFT", "LIPID"],  "sbp": (140, 190), "dbp": (90, 120), "hr": (60, 90),   "temp": (36.2, 37.0), "spo2": 94, "gender": None},
    "diabetic":        {"op": (4, 8),  "adm": 0.25, "icd": ["E11.9", "E11.65", "N18.3"],             "labs": ["FBS", "HBA1C", "U&E", "CRE", "LIPID"], "sbp": (120, 155), "dbp": (75, 100), "hr": (60, 95),   "temp": (36.2, 37.3), "spo2": 93, "gender": None},
    "chronic_complex": {"op": (6, 12), "adm": 0.6,  "icd": ["I10", "E11.9", "N18.3", "I50.9"],       "labs": ["FBC", "U&E", "CRE", "LFT", "HBA1C", "CRP"], "sbp": (145, 200), "dbp": (90, 125), "hr": (65, 105),  "temp": (36.2, 37.5), "spo2": 88, "gender": None},
    "respiratory":     {"op": (3, 7),  "adm": 0.35, "icd": ["J45.9", "J18.9", "A15.0", "J44.1"],     "labs": ["FBC", "CRP", "AFB"],                   "sbp": (100, 140), "dbp": (60, 90),  "hr": (70, 115),  "temp": (36.5, 39.0), "spo2": 82, "gender": None},
    "surgical":        {"op": (2, 5),  "adm": 1.5,  "icd": ["K80.2", "K35.9", "K40.9", "K57.3"],     "labs": ["FBC", "U&E", "CRE", "LFT", "COAG", "GS"], "sbp": (110, 140), "dbp": (65, 90),  "hr": (65, 100),  "temp": (36.5, 38.5), "spo2": 92, "gender": None},
    "maternity":       {"op": (6, 12), "adm": 1.0,  "icd": ["Z34.0", "O80", "O14.1", "O20.0"],       "labs": ["FBC", "GS", "HBS", "HIV", "URE"],      "sbp": (100, 140), "dbp": (60, 90),  "hr": (70, 95),   "temp": (36.2, 37.5), "spo2": 95, "gender": "F"},
    "pediatric":       {"op": (3, 8),  "adm": 0.35, "icd": ["B54", "J18.9", "A09", "E43"],            "labs": ["FBC", "MP", "RBG"],                    "sbp": (80, 110),  "dbp": (50, 75),  "hr": (80, 130),  "temp": (36.5, 40.0), "spo2": 88, "gender": None},
    "infectious":      {"op": (2, 5),  "adm": 0.5,  "icd": ["B54", "A01.0", "B15.9", "A09"],          "labs": ["FBC", "MP", "WIDAL", "LFT"],           "sbp": (100, 135), "dbp": (60, 85),  "hr": (70, 115),  "temp": (37.5, 40.5), "spo2": 90, "gender": None},
}

ARCHETYPE_COMPLAINTS = {
    "healthy_adult":   ["Routine check-up. No acute complaints.", "Mild fatigue for 2 weeks.", "Headache and body aches for 3 days.", "Sore throat and runny nose."],
    "hypertensive":    ["Known hypertensive. Presents for BP review.", "Headache and dizziness. BP elevated.", "Chest tightness and exertional dyspnoea.", "Routine hypertension follow-up."],
    "diabetic":        ["Known diabetic. Routine review.", "Increased thirst and polyuria for 1 week.", "Blood glucose poorly controlled.", "HbA1c monitoring visit."],
    "chronic_complex": ["Multi-morbidity review (HTN + DM + CKD).", "Worsening pedal oedema, recent weight gain.", "Shortness of breath on exertion.", "Annual metabolic workup."],
    "respiratory":     ["Wheeze and shortness of breath.", "Productive cough for 3 weeks, night sweats.", "Daily use of rescue inhaler.", "Cough, fever, and pleuritic chest pain."],
    "surgical":        ["Right iliac fossa pain with guarding.", "Epigastric pain, fatty food intolerance.", "Groin swelling, reducible, intermittent pain.", "Post-operative wound review."],
    "maternity":       ["First ANC visit. LMP 8 weeks ago.", "Routine ANC at 24 weeks.", "Contractions every 5 minutes, term pregnancy.", "Postnatal visit. Breastfeeding well."],
    "pediatric":       ["Fever and rigors for 2 days.", "Diarrhoea and vomiting, reduced urine output.", "Cough and difficulty breathing.", "Routine immunisation and growth check."],
    "infectious":      ["High grade fever for 3 days. Chills.", "Fever, abdominal pain, loose stools for 5 days.", "Jaundice and reduced appetite for 1 week.", "Body pains, headache, and vomiting."],
}

WARD_BY_ARCHETYPE = {
    "healthy_adult":   ["Medical Ward A", "Medical Ward B"],
    "hypertensive":    ["Medical Ward A", "Medical Ward B"],
    "diabetic":        ["Medical Ward A", "Medical Ward B"],
    "chronic_complex": ["Medical Ward A", "Medical Ward B", "ICU"],
    "respiratory":     ["Medical Ward A", "Medical Ward B"],
    "surgical":        ["Surgical Ward"],
    "maternity":       ["Maternity Ward", "Women's Ward"],
    "pediatric":       ["Children's Ward"],
    "infectious":      ["Medical Ward A", "Medical Ward B"],
}

PAYMENT_METHODS = ["cash", "mobile_money", "bank_transfer", "credit_card", "insurance"]
PAYMENT_WEIGHTS = [50, 30, 10, 5, 5]

MEDICATION_CATALOG = [
    {
        "key": "paracetamol",
        "name": "Paracetamol",
        "dosage": "1g",
        "route": "oral",
        "frequency": "tid",
        "unit_cost": Decimal("0.20"),
        "selling_price": Decimal("0.50"),
    },
    {
        "key": "amoxicillin",
        "name": "Amoxicillin",
        "dosage": "500mg",
        "route": "oral",
        "frequency": "tid",
        "unit_cost": Decimal("0.80"),
        "selling_price": Decimal("1.50"),
    },
    {
        "key": "ceftriaxone",
        "name": "Ceftriaxone",
        "dosage": "1g",
        "route": "iv",
        "frequency": "daily",
        "unit_cost": Decimal("8.00"),
        "selling_price": Decimal("15.00"),
    },
    {
        "key": "metformin",
        "name": "Metformin",
        "dosage": "500mg",
        "route": "oral",
        "frequency": "bid",
        "unit_cost": Decimal("0.30"),
        "selling_price": Decimal("0.75"),
    },
]

ARCHETYPE_DEPARTMENT = {
    "hypertensive": "Internal Medicine",
    "diabetic": "Internal Medicine",
    "chronic_complex": "Internal Medicine",
    "respiratory": "Internal Medicine",
    "surgical": "Surgery",
    "maternity": "Obstetrics & Gynaecology",
    "pediatric": "Paediatrics",
    "infectious": "Emergency Medicine",
}

# ============================================================================
# HELPERS
# ============================================================================

_rng = random.Random()  # isolated RNG, re-seeded per run


def _rnd_name(gender: Optional[str] = None) -> tuple[str, str, str]:
    g = gender or _rng.choice(["M", "F"])
    first = _rng.choice(MALE_FIRST if g == "M" else FEMALE_FIRST)
    last = _rng.choice(SURNAMES)
    return first, last, g


def _rnd_phone() -> str:
    prefix = _rng.choice(["024", "054", "055", "059", "020", "050", "026", "027"])
    return f"{prefix}{_rng.randint(1000000, 9999999)}"


def _rnd_dob(archetype: str) -> date:
    today = date.today()
    if archetype == "pediatric":
        age_days = _rng.randint(30, 15 * 365)
    elif archetype == "maternity":
        age_days = _rng.randint(18 * 365, 42 * 365)
    else:
        age_days = _rng.randint(20 * 365, 80 * 365)
    return today - timedelta(days=age_days)


def _rnd_vitals(archetype: str) -> dict:
    cfg = ARCHETYPE[archetype]
    sbp = _rng.randint(*cfg["sbp"])
    dbp = _rng.randint(*cfg["dbp"])
    # Ensure diastolic < systolic
    dbp = min(dbp, sbp - 10)
    return {
        "temperature": round(_rng.uniform(*cfg["temp"]), 1),
        "heart_rate": _rng.randint(*cfg["hr"]),
        "blood_pressure_systolic": sbp,
        "blood_pressure_diastolic": dbp,
        "respiratory_rate": _rng.randint(12, 24),
        "oxygen_saturation": _rng.randint(cfg["spo2"], 100),
        "pain_level": _rng.randint(0, 5),
        "is_critical": sbp > 180 or cfg["spo2"] < 90,
    }


def _rnd_lab_value(test_cfg: dict) -> tuple[str, str]:
    """Return (value_str, flag) for a lab test."""
    low, high = test_cfg["low"], test_cfg["high"]
    if low == 0 and high == 0:
        # Qualitative test
        is_positive = _rng.random() < 0.15
        return ("Reactive" if is_positive else "Non-Reactive"), ("abnormal" if is_positive else "normal")
    # Quantitative: generate slightly outside range 20% of the time
    noise = (high - low) * 0.3
    value = _rng.uniform(low - noise, high + noise)
    value = max(0, value)
    flag = "normal"
    if value < low:
        flag = "critical_low" if value < low * 0.7 else "low"
    elif value > high:
        flag = "critical_high" if value > high * 1.5 else "high"
    return str(round(value, 2)), flag


def _past_dt(days_ago_max: int, days_ago_min: int = 0) -> "datetime":
    from django.utils import timezone
    days = _rng.randint(days_ago_min, days_ago_max)
    hours = _rng.randint(7, 18)
    return timezone.now() - timedelta(days=days, hours=hours)


def _license(facility_code: str, user_type: str, n: int) -> str:
    prefix = {"doctor": "DOC", "nurse": "NUR", "pharmacist": "PHAR", "lab_technician": "LAB"}.get(user_type, "STF")
    return f"{prefix}-{facility_code}-{n:04d}"


# ============================================================================
# MANIFEST (for rollback)
# ============================================================================

class SeedManifest:
    """Tracks created PKs per model for safe rollback."""

    def __init__(self, path: str):
        self.path = Path(path)
        self.data: dict[str, list[str]] = {}
        self.meta: dict[str, list[dict[str, object]]] = {"batches": []}
        if self.path.exists():
            payload = json.loads(self.path.read_text())
            if "records" in payload or "meta" in payload:
                self.data = {
                    model: list(dict.fromkeys(str(pk) for pk in pks))
                    for model, pks in payload.get("records", {}).items()
                }
                self.meta = payload.get("meta", {"batches": []})
            else:
                self.data = {
                    model: list(dict.fromkeys(str(pk) for pk in pks))
                    for model, pks in payload.items()
                }
        self.meta.setdefault("batches", [])

    def add(self, model: str, pk) -> None:
        value = str(pk)
        bucket = self.data.setdefault(model, [])
        if value not in bucket:
            bucket.append(value)

    def add_bulk(self, model: str, pks) -> None:
        for pk in pks:
            self.add(model, pk)

    def start_batch(self, *, facility_code: str, patient_start: int, patient_end: int) -> str:
        batch_id = str(uuid.uuid4())
        self.meta["batches"].append({
            "id": batch_id,
            "facility_code": facility_code,
            "patient_start": patient_start,
            "patient_end": patient_end,
            "status": "started",
        })
        return batch_id

    def complete_batch(self, batch_id: str) -> None:
        for batch in self.meta["batches"]:
            if batch.get("id") == batch_id:
                batch["status"] = "completed"
                return

    def discard_batch(self, batch_id: str) -> None:
        self.meta["batches"] = [
            batch for batch in self.meta["batches"]
            if batch.get("id") != batch_id
        ]

    def pending_batches(self) -> list[dict[str, object]]:
        return [
            batch for batch in self.meta["batches"]
            if batch.get("status") != "completed"
        ]

    def save(self) -> None:
        payload = {
            "records": self.data,
            "meta": self.meta,
        }
        self.path.write_text(json.dumps(payload, indent=2))

    def total(self) -> int:
        return sum(len(v) for v in self.data.values())


# ============================================================================
# SEEDER CONTEXT (shared state per facility)
# ============================================================================

@dataclass
class FacilityContext:
    facility: object
    departments: dict        # name -> Department
    clinical_units: dict     # name -> ClinicalUnit
    root_unit: object
    department_units: dict   # name -> department ClinicalUnit
    team_units: dict         # name -> primary team ClinicalUnit
    ward_teams: dict         # ward pk -> owning team ClinicalUnit
    clinics: list
    wards: dict              # name -> Ward
    beds: list               # all Bed objects
    appointment_type: object
    note_template: object
    lab_tests: dict          # code -> LabTestCatalog
    services: dict           # code -> Service
    doctors: list            # PractitionerProfile objects
    nurses: list
    lab_techs: list          # Staff objects
    pharmacists: list        # Staff objects
    support_staff: list      # Staff objects without PractitionerProfile
    admin_user: object       # User
    seed_user: object        # seed engine user
    nhis_plan: object = None
    inventory_items: dict = field(default_factory=dict)
    storage_locations: dict = field(default_factory=dict)
    occupied_bed_ids: set = field(default_factory=set)
    has_seeded_active_admission: bool = False


# ============================================================================
# COMMAND
# ============================================================================

class Command(BaseCommand):
    help = "Seed production environment with thousands of realistic, interconnected patient records."

    def add_arguments(self, parser):
        parser.add_argument("--profile", choices=list(PROFILES), default="large",
                            help="Preset profile (smoke|staging|small|medium|large)")
        parser.add_argument("--facilities", type=int, default=None,
                            help="Override number of facilities to create")
        parser.add_argument("--facility-code", type=str, default=None,
                            help="Seed one explicit facility code, e.g. MAIN for staging")
        parser.add_argument("--facility-name", type=str, default=None,
                            help="Facility display name when --facility-code creates a new facility")
        parser.add_argument("--patients", type=int, default=None,
                            help="Override total number of patients")
        parser.add_argument("--years", type=int, default=None,
                            help="Override years of clinical history to generate")
        parser.add_argument("--chunk", type=str, default=None,
                            help="Seed patient range only, e.g. --chunk 0-2000")
        parser.add_argument("--batch-size", type=int, default=1000,
                            help="Patients per DB batch and auto-resume window (default: 1000)")
        parser.add_argument("--resume", action="store_true",
                            help="Seed the next unseeded patient batch from the manifest")
        parser.add_argument("--dry-run", action="store_true",
                            help="Print estimated counts without writing any data")
        parser.add_argument("--rollback", action="store_true",
                            help="Delete all records listed in the manifest file")
        parser.add_argument("--manifest", type=str,
                            default="/tmp/hms_seed_manifest.json",
                            help="Path to manifest JSON file (default: /tmp/hms_seed_manifest.json)")
        parser.add_argument("--seed", type=int, default=42,
                            help="Random seed for reproducibility (default: 42)")

    # ------------------------------------------------------------------
    def handle(self, *args, **options):
        _rng.seed(options["seed"])

        profile = PROFILES[options["profile"]]
        n_facilities = options["facilities"] or profile["facilities"]
        n_patients   = options["patients"]   or profile["patients"]
        n_years      = options["years"]      or profile["years"]
        batch_size   = options["batch_size"]

        manifest = SeedManifest(options["manifest"])

        if options["rollback"]:
            self._rollback(manifest)
            return

        if options["dry_run"]:
            self._dry_run(n_facilities, n_patients, n_years)
            return

        fac_configs = self._resolve_facility_configs(
            n_facilities=n_facilities,
            facility_code=options["facility_code"],
            facility_name=options["facility_name"],
        )
        patients_per_fac = self._distribute(n_patients, n_facilities)

        self._ensure_manifest_run_config(
            manifest,
            profile_name=options["profile"],
            fac_configs=fac_configs,
            n_patients=n_patients,
            n_years=n_years,
        )
        self._reconcile_pending_batches(manifest)
        chunk_start, chunk_end = self._resolve_patient_range(
            manifest=manifest,
            fac_configs=fac_configs,
            patients_per_fac=patients_per_fac,
            n_patients=n_patients,
            chunk=options["chunk"],
            resume=options["resume"],
            batch_size=batch_size,
        )
        if chunk_start >= chunk_end:
            self.stdout.write(self.style.SUCCESS(
                f"\nNo remaining patients to seed for manifest {options['manifest']}."
            ))
            return

        mode_label = "resume" if options["resume"] else "manual" if options["chunk"] else "full"

        self.stdout.write(self.style.SUCCESS(
            f"\n{'='*60}\n"
            f"  HMS Production Seeder\n"
            f"  Profile: {options['profile']} | Facilities: {n_facilities} | Patients: {n_patients} | Years: {n_years}\n"
            f"  Mode: {mode_label} | Chunk: {chunk_start}–{chunk_end} | Batch size: {batch_size}\n"
            f"  Manifest: {options['manifest']}\n"
            f"{'='*60}\n"
        ))

        # Step 1: Seed engine admin user (created_by anchor)
        seed_user, created = self._get_or_create_seed_user()
        if created:
            manifest.add("User", seed_user.pk)
            manifest.save()

        # Step 2: Seed facilities & infrastructure
        facility_contexts: list[FacilityContext] = []

        for i, fac_cfg in enumerate(fac_configs):
            self.stdout.write(f"\n[Facility {i+1}/{n_facilities}] {fac_cfg['name']}")
            with transaction.atomic():
                ctx = self._seed_facility(fac_cfg, seed_user, manifest)
            facility_contexts.append(ctx)
            manifest.save()
            self.stdout.write(self.style.SUCCESS(f"  ✓ Infrastructure seeded"))

        # Step 3: Distribute patients across facilities
        for fac_idx, (ctx, n_fac_patients) in enumerate(zip(facility_contexts, patients_per_fac)):
            fac_start = sum(patients_per_fac[:fac_idx])
            fac_end   = fac_start + n_fac_patients

            # Intersect with chunk
            local_start = max(chunk_start, fac_start) - fac_start
            local_end   = min(chunk_end,   fac_end)   - fac_start
            if local_start >= local_end:
                continue

            self.stdout.write(f"\n[Facility {fac_idx+1}] Seeding patients {local_start}–{local_end} ({local_end - local_start} patients)...")

            # Process in batches
            for batch_start in range(local_start, local_end, batch_size):
                batch_end = min(batch_start + batch_size, local_end)
                batch_id = manifest.start_batch(
                    facility_code=ctx.facility.code,
                    patient_start=batch_start + 1,
                    patient_end=batch_end,
                )
                manifest.save()
                with transaction.atomic():
                    self._seed_patient_batch(
                        ctx, batch_start, batch_end,
                        n_years, seed_user, manifest
                    )
                manifest.complete_batch(batch_id)
                manifest.save()
                done = batch_end - local_start
                total = local_end - local_start
                pct = int(done / total * 100)
                self.stdout.write(f"  [{pct:3d}%] {done}/{total} patients seeded (manifest: {manifest.total():,} records)")

        manifest.save()
        self.stdout.write(self.style.SUCCESS(
            f"\n{'='*60}\n"
            f"  Seeding complete! Total records: {manifest.total():,}\n"
            f"  Manifest saved to: {options['manifest']}\n"
            f"  To rollback: python manage.py seed_production_dataset --rollback --manifest {options['manifest']}\n"
            f"{'='*60}\n"
        ))

    # ------------------------------------------------------------------
    # FACILITY INFRASTRUCTURE
    # ------------------------------------------------------------------

    def _get_or_create_seed_user(self) -> tuple[User, bool]:
        user, created = User.objects.get_or_create(
            email="seed_engine@hms.local",
            defaults={
                "username": "seed_engine",
                "first_name": "Seed",
                "last_name": "Engine",
                "user_type": "admin",
                "is_active": False,
                "is_staff": False,
                "is_superuser": False,
            }
        )
        updated_fields = []
        if user.username != "seed_engine":
            user.username = "seed_engine"
            updated_fields.append("username")
        if user.first_name != "Seed":
            user.first_name = "Seed"
            updated_fields.append("first_name")
        if user.last_name != "Engine":
            user.last_name = "Engine"
            updated_fields.append("last_name")
        if user.user_type != "admin":
            user.user_type = "admin"
            updated_fields.append("user_type")
        if user.is_active:
            user.is_active = False
            updated_fields.append("is_active")
        if user.is_staff:
            user.is_staff = False
            updated_fields.append("is_staff")
        if user.is_superuser:
            user.is_superuser = False
            updated_fields.append("is_superuser")
        if user.has_usable_password():
            user.set_unusable_password()
            updated_fields.append("password")
        if updated_fields:
            user.save(update_fields=updated_fields)
        if created:
            self.stdout.write("  Created non-login seed engine user (seed_engine@hms.local)")
        return user, created

    def _resolve_facility_configs(
        self,
        *,
        n_facilities: int,
        facility_code: Optional[str],
        facility_name: Optional[str],
    ) -> list[dict]:
        if n_facilities < 1:
            raise CommandError("--facilities must be greater than 0")
        if n_facilities > len(FACILITIES_CONFIG) and not facility_code:
            raise CommandError(
                f"--facilities cannot exceed {len(FACILITIES_CONFIG)} without --facility-code"
            )

        if not facility_code:
            return [dict(cfg) for cfg in FACILITIES_CONFIG[:n_facilities]]

        if n_facilities != 1:
            raise CommandError("--facility-code can only be used with one facility")

        normalized_code = facility_code.strip().upper()
        if not normalized_code:
            raise CommandError("--facility-code cannot be blank")

        existing = Facility.objects.filter(code__iexact=normalized_code).first()
        template = dict(FACILITIES_CONFIG[0])
        template["code"] = normalized_code
        template["name"] = facility_name or getattr(existing, "name", None) or f"{normalized_code} Hospital"
        if existing:
            template["address"] = existing.address or template["address"]
            template["city"] = existing.city or template["city"]
            template["region"] = existing.region or template["region"]
        return [template]

    def _ensure_manifest_run_config(
        self,
        manifest: SeedManifest,
        *,
        profile_name: str,
        fac_configs: list[dict],
        n_patients: int,
        n_years: int,
    ) -> None:
        current_config = {
            "profile": profile_name,
            "facilities": len(fac_configs),
            "facility_codes": [cfg["code"] for cfg in fac_configs],
            "patients": n_patients,
            "years": n_years,
        }
        existing_config = manifest.meta.get("run_config")
        if existing_config is None:
            manifest.meta["run_config"] = current_config
            manifest.save()
            return
        if existing_config != current_config:
            raise CommandError(
                "Manifest dataset shape does not match this run. "
                f"Expected {existing_config}, received {current_config}. "
                "Use the original profile/patients/facilities/years values or a new manifest."
            )

    def _resolve_patient_range(
        self,
        *,
        manifest: SeedManifest,
        fac_configs: list[dict],
        patients_per_fac: list[int],
        n_patients: int,
        chunk: Optional[str],
        resume: bool,
        batch_size: int,
    ) -> tuple[int, int]:
        if batch_size <= 0:
            raise CommandError("--batch-size must be greater than 0")
        if chunk and resume:
            raise CommandError("--chunk and --resume cannot be used together")
        if chunk:
            try:
                parts = chunk.split("-")
                chunk_start, chunk_end = int(parts[0]), int(parts[1])
            except (ValueError, IndexError):
                raise CommandError("--chunk must be in format START-END, e.g. --chunk 0-2000")
            if chunk_start < 0 or chunk_end <= chunk_start or chunk_end > n_patients:
                raise CommandError(
                    f"--chunk must satisfy 0 <= START < END <= {n_patients}"
                )
            return chunk_start, chunk_end
        if not resume:
            return 0, n_patients
        return self._resolve_resume_range(
            manifest=manifest,
            fac_configs=fac_configs,
            patients_per_fac=patients_per_fac,
            n_patients=n_patients,
            batch_size=batch_size,
        )

    def _resolve_resume_range(
        self,
        *,
        manifest: SeedManifest,
        fac_configs: list[dict],
        patients_per_fac: list[int],
        n_patients: int,
        batch_size: int,
    ) -> tuple[int, int]:
        facility_windows = self._facility_windows(fac_configs, patients_per_fac)
        completed_intervals = self._completed_global_intervals(manifest, facility_windows)

        next_start = 0
        for interval_start, interval_end in completed_intervals:
            if interval_start > next_start:
                break
            next_start = max(next_start, interval_end)

        if next_start >= n_patients:
            return n_patients, n_patients
        return next_start, min(next_start + batch_size, n_patients)

    def _facility_windows(
        self,
        fac_configs: list[dict],
        patients_per_fac: list[int],
    ) -> dict[str, tuple[int, int]]:
        windows: dict[str, tuple[int, int]] = {}
        start = 0
        for fac_cfg, count in zip(fac_configs, patients_per_fac):
            end = start + count
            windows[fac_cfg["code"]] = (start, end)
            start = end
        return windows

    def _completed_global_intervals(
        self,
        manifest: SeedManifest,
        facility_windows: dict[str, tuple[int, int]],
    ) -> list[tuple[int, int]]:
        intervals: list[tuple[int, int]] = []
        for batch in manifest.meta.get("batches", []):
            if batch.get("status") != "completed":
                continue

            facility_code = str(batch["facility_code"])
            if facility_code not in facility_windows:
                raise CommandError(
                    f"Manifest batch references unknown facility code {facility_code}."
                )

            patient_start = int(batch["patient_start"])
            patient_end = int(batch["patient_end"])
            facility_start, facility_end = facility_windows[facility_code]
            facility_count = facility_end - facility_start
            if patient_start < 1 or patient_end < patient_start or patient_end > facility_count:
                raise CommandError(
                    "Manifest batch range is outside the configured patient distribution. "
                    f"Facility {facility_code} has {facility_count} patients, "
                    f"but batch recorded {patient_start}-{patient_end}."
                )

            intervals.append((
                facility_start + patient_start - 1,
                facility_start + patient_end,
            ))

        intervals.sort()
        merged: list[list[int]] = []
        for interval_start, interval_end in intervals:
            if not merged or interval_start > merged[-1][1]:
                merged.append([interval_start, interval_end])
                continue
            merged[-1][1] = max(merged[-1][1], interval_end)
        return [(start, end) for start, end in merged]

    def _patient_seed_email(self, facility_code: str, patient_number: int) -> str:
        return f"seed.patient.{facility_code.lower()}.{patient_number:07d}@hms.local"

    def _patient_seed_username(self, facility_code: str, patient_number: int) -> str:
        return f"seed_patient_{facility_code.lower()}_{patient_number:07d}"

    def _record_existing_patient_graph(self, patient: PatientProfile, manifest: SeedManifest) -> None:
        manifest.add("User", patient.user_id)
        manifest.add("PatientProfile", patient.pk)
        if PatientSearchIndex.objects.filter(patient_profile=patient).exists():
            manifest.add("PatientSearchIndex", patient.pk)

        manifest.add_bulk("Appointment", Appointment.objects.filter(patient=patient).values_list("pk", flat=True))
        manifest.add_bulk("OutpatientVisit", OutpatientVisit.objects.filter(appointment__patient=patient).values_list("pk", flat=True).distinct())
        manifest.add_bulk("Encounter", Encounter.objects.filter(patient=patient).values_list("pk", flat=True))
        manifest.add_bulk("EncounterCareTeam", EncounterCareTeam.objects.filter(encounter__patient=patient).values_list("pk", flat=True).distinct())
        manifest.add_bulk("Admission", Admission.objects.filter(patient=patient).values_list("pk", flat=True))
        manifest.add_bulk("AdmissionCase", AdmissionCase.objects.filter(patient=patient).values_list("pk", flat=True))
        manifest.add_bulk("AdmissionTask", AdmissionTask.objects.filter(case__patient=patient).values_list("pk", flat=True).distinct())
        manifest.add_bulk("BedReservation", BedReservation.objects.filter(case__patient=patient).values_list("pk", flat=True).distinct())
        manifest.add_bulk("DischargeCase", DischargeCase.objects.filter(patient=patient).values_list("pk", flat=True))
        manifest.add_bulk("DischargeTask", DischargeTask.objects.filter(case__patient=patient).values_list("pk", flat=True).distinct())
        manifest.add_bulk("BedAllocationLog", BedAllocationLog.objects.filter(admission__patient=patient).values_list("pk", flat=True).distinct())
        manifest.add_bulk("VitalSigns", VitalSigns.objects.filter(patient=patient).values_list("pk", flat=True))
        manifest.add_bulk("NursingTask", NursingTask.objects.filter(patient=patient).values_list("pk", flat=True))
        manifest.add_bulk("NursingAlert", NursingAlert.objects.filter(patient=patient).values_list("pk", flat=True))
        manifest.add_bulk("MedicationAdministration", MedicationAdministration.objects.filter(patient=patient).values_list("pk", flat=True))
        manifest.add_bulk("ShiftHandoff", ShiftHandoff.objects.filter(patient=patient).values_list("pk", flat=True))
        manifest.add_bulk("TreatmentSheetEntry", TreatmentSheetEntry.objects.filter(patient=patient).values_list("pk", flat=True))
        manifest.add_bulk("SupplyRequest", SupplyRequest.objects.filter(treatment_entry__patient=patient).values_list("pk", flat=True).distinct())
        manifest.add_bulk("FluidBalance", FluidBalance.objects.filter(patient=patient).values_list("pk", flat=True))
        manifest.add_bulk("NoteEntry", NoteEntry.objects.filter(patient=patient).values_list("pk", flat=True))
        manifest.add_bulk("Prescription", Prescription.objects.filter(patient=patient).values_list("pk", flat=True))
        manifest.add_bulk("LabOrder", LabOrder.objects.filter(patient=patient).values_list("pk", flat=True))
        manifest.add_bulk("LabSpecimen", LabSpecimen.objects.filter(order__patient=patient).values_list("pk", flat=True).distinct())
        manifest.add_bulk("LabOrderTest", LabOrderTest.objects.filter(order__patient=patient).values_list("pk", flat=True).distinct())
        manifest.add_bulk("LabResult", LabResult.objects.filter(order_test__order__patient=patient).values_list("pk", flat=True).distinct())
        manifest.add_bulk("PatientInsurance", PatientInsurance.objects.filter(patient=patient).values_list("pk", flat=True))
        manifest.add_bulk("Invoice", Invoice.objects.filter(patient=patient).values_list("pk", flat=True))
        manifest.add_bulk("InvoiceItem", InvoiceItem.objects.filter(invoice__patient=patient).values_list("pk", flat=True).distinct())
        manifest.add_bulk("Payment", Payment.objects.filter(invoice__patient=patient).values_list("pk", flat=True).distinct())
        manifest.add_bulk("Claim", Claim.objects.filter(invoice__patient=patient).values_list("pk", flat=True).distinct())

    def _reconcile_pending_batches(self, manifest: SeedManifest) -> None:
        pending_batches = list(manifest.pending_batches())
        if not pending_batches:
            return

        manifest_changed = False
        for batch in pending_batches:
            batch_id = str(batch["id"])
            facility_code = str(batch["facility_code"])
            patient_start = int(batch["patient_start"])
            patient_end = int(batch["patient_end"])
            expected_count = patient_end - patient_start + 1
            emails = [
                self._patient_seed_email(facility_code, patient_number)
                for patient_number in range(patient_start, patient_end + 1)
            ]
            users = list(User.objects.filter(email__in=emails).select_related("patient_profile"))

            if not users:
                manifest.discard_batch(batch_id)
                manifest_changed = True
                continue

            if len(users) != expected_count:
                raise CommandError(
                    "Seed manifest contains an incomplete committed batch. "
                    f"Expected {expected_count} patients for {facility_code} "
                    f"patients {patient_start}-{patient_end}, found {len(users)}."
                )

            for user in users:
                patient = getattr(user, "patient_profile", None)
                if patient is None or user.user_type != "patient":
                    raise CommandError(
                        f"Inconsistent seeded patient state for {user.email}; "
                        "expected a patient user with a PatientProfile."
                    )
                self._record_existing_patient_graph(patient, manifest)

            manifest.complete_batch(batch_id)
            manifest_changed = True

        if manifest_changed:
            manifest.save()

    def _pick_active_bed(self, ctx: FacilityContext, ward_names: list[str]) -> tuple[Optional[Ward], Optional[Bed]]:
        candidate_wards = [ctx.wards[name] for name in ward_names if name in ctx.wards]
        if not candidate_wards and ctx.wards:
            candidate_wards = [next(iter(ctx.wards.values()))]

        for ward in candidate_wards:
            available_beds = [
                bed for bed in ctx.beds
                if bed.ward_id == ward.pk
                and bed.status == "available"
                and bed.pk not in ctx.occupied_bed_ids
            ]
            if available_beds:
                available_beds.sort(key=lambda bed: bed.bed_number)
                return ward, available_beds[0]

        return (candidate_wards[0], None) if candidate_wards else (None, None)

    def _create_bed_allocation_log(
        self,
        *,
        bed: Bed,
        facility: Facility,
        admission: Admission,
        previous_status: str,
        new_status: str,
        notes: str,
        actor: User,
        timestamp,
        manifest: SeedManifest,
    ) -> None:
        log = BedAllocationLog.objects.create(
            bed=bed,
            facility=facility,
            previous_status=previous_status,
            new_status=new_status,
            admission=admission,
            notes=notes,
            created_by=actor,
        )
        BedAllocationLog.objects.filter(pk=log.pk).update(timestamp=timestamp)
        manifest.add("BedAllocationLog", log.pk)

    def _reserve_lab_order_number(self, order_date: date) -> str:
        with transaction.atomic():
            seq, _ = LabOrderSequence.objects.select_for_update().get_or_create(
                date=order_date,
                defaults={"last_number": 0},
            )
            seq.last_number += 1
            seq.save(update_fields=["last_number"])
            return f"LAB-{order_date.strftime('%Y%m%d')}-{seq.last_number:04d}"

    def _get_ward_charge_service(self, ctx: FacilityContext, ward: Optional[Ward]) -> Optional[Service]:
        if ward and ward.ward_type == "icu":
            return ctx.services.get("WARD-ICU")
        if ward and ward.ward_type == "private":
            return ctx.services.get("WARD-PRIV")
        return ctx.services.get("WARD-GEN")

    def _department_for_archetype(self, archetype: str) -> str:
        return ARCHETYPE_DEPARTMENT.get(archetype, "General Outpatient")

    def _care_units_for_archetype(
        self,
        ctx: FacilityContext,
        archetype: str,
        *,
        ward: Optional[Ward] = None,
    ) -> tuple[Optional[ClinicalUnit], Optional[ClinicalUnit]]:
        if ward and ward.pk in ctx.ward_teams:
            team = ctx.ward_teams[ward.pk]
            department = team.parent or ctx.department_units.get(self._department_for_archetype(archetype))
            return department, team
        dept_name = self._department_for_archetype(archetype)
        department = ctx.department_units.get(dept_name) or ctx.department_units.get("General Outpatient")
        team = ctx.team_units.get(dept_name) or ctx.team_units.get("General Outpatient") or department
        return department, team

    def _pick_practitioner_for_department(
        self,
        practitioners: list,
        department: Optional[ClinicalUnit],
    ) -> Optional[PractitionerProfile]:
        if not practitioners:
            return None
        dept_name = getattr(getattr(department, "core_department", None), "name", None)
        if dept_name:
            matches = [
                practitioner for practitioner in practitioners
                if getattr(practitioner.staff, "department", None) == dept_name
            ]
            if matches:
                return _rng.choice(matches)
        return _rng.choice(practitioners)

    def _feature_enabled(self, facility: Facility, feature_key: str) -> bool:
        try:
            return feature_enabled(feature_key, facility=facility, default=True)
        except Exception:
            return True

    def _get_or_create_unit_types(self) -> dict[str, UnitTypeConfig]:
        facility_type, _ = UnitTypeConfig.objects.get_or_create(
            code="facility",
            defaults={
                "name": "Facility",
                "can_be_root": True,
                "depth_level": 0,
                "can_have_wards": False,
                "can_admit_patients": False,
                "can_consult": False,
                "is_active": True,
            },
        )
        department_type, _ = UnitTypeConfig.objects.get_or_create(
            code="department",
            defaults={
                "name": "Department",
                "can_be_root": False,
                "depth_level": 1,
                "can_have_wards": True,
                "can_admit_patients": True,
                "can_consult": True,
                "is_active": True,
            },
        )
        team_type, _ = UnitTypeConfig.objects.get_or_create(
            code="team",
            defaults={
                "name": "Team",
                "can_be_root": False,
                "depth_level": 2,
                "can_have_wards": True,
                "can_admit_patients": True,
                "can_consult": True,
                "is_active": True,
            },
        )
        return {"facility": facility_type, "department": department_type, "team": team_type}

    def _unit_code(self, value: str, max_length: int = 30) -> str:
        return value.upper().replace(" ", "-").replace("&", "AND").replace("'", "")[:max_length]

    def _seed_clinical_unit_tree(
        self,
        *,
        facility: Facility,
        departments: dict,
        seed_user: User,
    ) -> tuple[ClinicalUnit, dict, dict, list]:
        unit_types = self._get_or_create_unit_types()
        created_units = []

        root, root_created = ClinicalUnit.objects.get_or_create(
            parent=None,
            code=facility.code,
            defaults={
                "unit_type": unit_types["facility"],
                "name": facility.name,
                "short_name": facility.code,
                "staffing_mode": "mixed",
                "unit_category": "clinical",
                "accepts_referrals": False,
                "accepts_admissions": False,
                "is_active": True,
                "created_by": seed_user,
            },
        )
        if root_created:
            created_units.append(root.pk)

        department_units = {}
        team_units = {}
        for dept_name, dept in departments.items():
            dept_code = self._unit_code(dept_name, max_length=28)
            dept_unit, dept_created = ClinicalUnit.objects.get_or_create(
                parent=root,
                code=dept_code,
                defaults={
                    "unit_type": unit_types["department"],
                    "core_department": dept,
                    "name": dept_name,
                    "short_name": dept_name[:50],
                    "staffing_mode": "mixed",
                    "unit_category": "clinical",
                    "accepts_referrals": True,
                    "accepts_admissions": True,
                    "is_active": True,
                    "created_by": seed_user,
                },
            )
            department_units[dept_name] = dept_unit
            if dept_created:
                created_units.append(dept_unit.pk)

            team_code = f"{dept_code[:24]}-T1"
            team, team_created = ClinicalUnit.objects.get_or_create(
                parent=dept_unit,
                code=team_code,
                defaults={
                    "unit_type": unit_types["team"],
                    "core_department": dept,
                    "name": f"{dept_name} Team A",
                    "short_name": f"{dept_name[:42]} A",
                    "staffing_mode": "clinical_only",
                    "unit_category": "clinical",
                    "accepts_referrals": True,
                    "accepts_admissions": True,
                    "is_active": True,
                    "created_by": seed_user,
                },
            )
            team_units[dept_name] = team
            if team_created:
                created_units.append(team.pk)

        return root, department_units, team_units, created_units

    def _seed_clinic_schedules(
        self,
        *,
        facility: Facility,
        clinics: list,
        seed_user: User,
        manifest: SeedManifest,
    ) -> None:
        for clinic in clinics:
            if clinic.operates_24_hours:
                start, end = time(0, 0), time(23, 59)
                days = range(7)
            else:
                start = clinic.operating_hours_start or time(8, 0)
                end = clinic.operating_hours_end or time(17, 0)
                days = range(5)
            for day in days:
                exists = ClinicSchedule.objects.filter(
                    facility=facility,
                    clinic=clinic,
                    department=clinic.department,
                    day_of_week=day,
                    start_time=start,
                    end_time=end,
                    is_active=True,
                ).exists()
                if exists:
                    continue
                schedule = ClinicSchedule.objects.create(
                    facility=facility,
                    clinic=clinic,
                    department=clinic.department,
                    day_of_week=day,
                    start_time=start,
                    end_time=end,
                    is_active=True,
                    created_by=seed_user,
                )
                manifest.add("ClinicSchedule", schedule.pk)

    def _get_staff_assignment_type(self) -> StaffAssignmentTypeConfig:
        assignment_type, _ = StaffAssignmentTypeConfig.objects.get_or_create(
            code="primary_secondary",
            defaults={
                "name": "Primary and Secondary",
                "requires_primary": True,
                "allows_secondary": True,
                "allows_multiple_primary": False,
                "supports_date_ranges": True,
                "applicable_user_types": ["doctor", "nurse", "pharmacist", "lab_technician", "receptionist"],
                "is_active": True,
            },
        )
        return assignment_type

    def _seed_staff_unit_assignments(
        self,
        *,
        facility: Facility,
        department_units: dict,
        team_units: dict,
        doctors: list,
        nurses: list,
        support_staff: list,
        seed_user: User,
        manifest: SeedManifest,
    ) -> None:
        assignment_type = self._get_staff_assignment_type()
        today = timezone.localdate()

        for practitioner in doctors + nurses:
            dept_name = getattr(practitioner.staff, "department", None)
            unit = team_units.get(dept_name) or department_units.get(dept_name)
            if not unit:
                unit = next(iter(team_units.values()), None)
            if not unit:
                continue
            assignment, created = StaffUnitAssignment.objects.get_or_create(
                unit=unit,
                practitioner=practitioner,
                is_active=True,
                defaults={
                    "assignment_type": assignment_type,
                    "is_primary": True,
                    "effective_from": today,
                    "role_description": practitioner.staff.position or "",
                    "assigned_by": seed_user,
                },
            )
            if created:
                manifest.add("StaffUnitAssignment", assignment.pk)

        for staff in support_staff:
            dept_name = getattr(staff, "department", None)
            unit = department_units.get(dept_name)
            if not unit:
                continue
            assignment, created = UnitMemberAssignment.objects.get_or_create(
                unit=unit,
                staff=staff,
                is_active=True,
                defaults={
                    "assignment_type": assignment_type,
                    "is_primary": True,
                    "effective_from": today,
                    "role_description": staff.position or "",
                    "assigned_by": seed_user,
                },
            )
            if created:
                manifest.add("UnitMemberAssignment", assignment.pk)

    def _seed_ward_assignments_and_rosters(
        self,
        *,
        facility: Facility,
        department_units: dict,
        team_units: dict,
        ward_teams: dict,
        wards: dict,
        doctors: list,
        nurses: list,
        appointment_type: AppointmentType,
        seed_user: User,
        manifest: SeedManifest,
    ) -> None:
        nurse_role, _ = StaffRole.objects.get_or_create(
            code="staff_nurse",
            defaults={"name": "Staff Nurse", "category": "nursing", "is_active": True},
        )
        doctor_role, _ = StaffRole.objects.get_or_create(
            code="attending_physician",
            defaults={"name": "Attending Physician", "category": "medical", "is_active": True},
        )

        for ward in wards.values():
            owning_team = ward_teams.get(ward.pk)
            dept_name = getattr(getattr(owning_team, "core_department", None), "name", None)
            ward_nurses = [n for n in nurses if getattr(n.staff, "department", None) == dept_name] or nurses[:2]
            ward_doctors = [d for d in doctors if getattr(d.staff, "department", None) == dept_name] or doctors[:1]

            for idx, nurse in enumerate(ward_nurses[:3]):
                assignment, created = WardStaffAssignment.objects.get_or_create(
                    ward=ward,
                    practitioner=nurse,
                    defaults={
                        "role": nurse_role,
                        "is_active": True,
                        "is_primary": idx == 0,
                        "assigned_by": seed_user,
                    },
                )
                if created:
                    manifest.add("WardStaffAssignment", assignment.pk)
                if idx == 0 and ward.head_nurse_id is None:
                    ward.head_nurse = nurse
                    ward.save(update_fields=["head_nurse", "updated_at"])

            for doctor in ward_doctors[:2]:
                assignment, created = WardStaffAssignment.objects.get_or_create(
                    ward=ward,
                    practitioner=doctor,
                    defaults={
                        "role": doctor_role,
                        "is_active": True,
                        "is_primary": False,
                        "assigned_by": seed_user,
                    },
                )
                if created:
                    manifest.add("WardStaffAssignment", assignment.pk)

        self._seed_department_rosters(
            facility=facility,
            department_units=department_units,
            team_units=team_units,
            appointment_type=appointment_type,
            seed_user=seed_user,
            manifest=manifest,
        )

    def _seed_department_rosters(
        self,
        *,
        facility: Facility,
        department_units: dict,
        team_units: dict,
        appointment_type: AppointmentType,
        seed_user: User,
        manifest: SeedManifest,
    ) -> None:
        if not self._feature_enabled(facility, "department_rosters"):
            return
        today = timezone.localdate()
        for dept_name, department_unit in department_units.items():
            clinic = department_unit.clinics.first()
            clinic_duty, created = DepartmentDutyType.objects.get_or_create(
                department=department_unit,
                code="CLINIC-AM",
                defaults={
                    "name": "Morning Clinic",
                    "category": "clinic",
                    "rotation_type": "none",
                    "applicable_days": [0, 1, 2, 3, 4],
                    "start_time": time(8, 0),
                    "end_time": time(13, 0),
                    "slot_duration_minutes": 30,
                    "max_patients_per_slot": 2,
                    "clinic": clinic,
                    "default_appointment_type": appointment_type,
                    "is_active": True,
                    "display_order": 10,
                },
            )
            if created:
                manifest.add("DepartmentDutyType", clinic_duty.pk)

            ward_duty, created = DepartmentDutyType.objects.get_or_create(
                department=department_unit,
                code="WARD-ROUND",
                defaults={
                    "name": "Ward Round",
                    "category": "ward",
                    "rotation_type": "none",
                    "applicable_days": [0, 1, 2, 3, 4, 5, 6],
                    "start_time": time(7, 30),
                    "end_time": time(17, 0),
                    "is_active": True,
                    "display_order": 20,
                },
            )
            if created:
                manifest.add("DepartmentDutyType", ward_duty.pk)

            team = team_units.get(dept_name)
            if not team:
                continue
            for duty in (clinic_duty, ward_duty):
                for offset in range(7):
                    entry_date = today + timedelta(days=offset)
                    entry, created = RosterEntry.objects.get_or_create(
                        department=department_unit,
                        duty_type=duty,
                        date=entry_date,
                        defaults={
                            "team": team,
                            "start_time": duty.start_time,
                            "end_time": duty.end_time,
                            "source": "generated",
                            "status": "published",
                            "created_by": seed_user,
                        },
                    )
                    if created:
                        manifest.add("RosterEntry", entry.pk)

    def _seed_billing_foundation(
        self,
        *,
        facility: Facility,
        seed_user: User,
        manifest: SeedManifest,
    ) -> Optional[InsurancePlan]:
        if not self._feature_enabled(facility, "insurance_claims"):
            return None
        provider, created = InsuranceProvider.objects.get_or_create(
            facility=facility,
            code="NHIS",
            defaults={
                "name": "National Health Insurance Scheme",
                "payer_type": "nhis",
                "is_active": True,
                "created_by": seed_user,
                "updated_by": seed_user,
            },
        )
        if created:
            manifest.add("InsuranceProvider", provider.pk)
        plan, created = InsurancePlan.objects.get_or_create(
            facility=facility,
            provider=provider,
            code="NHIS-STD",
            defaults={
                "name": "NHIS Standard Benefit",
                "coverage_percentage": Decimal("80.00"),
                "annual_limit": None,
                "is_active": True,
                "created_by": seed_user,
                "updated_by": seed_user,
            },
        )
        if created:
            manifest.add("InsurancePlan", plan.pk)
        return plan

    def _seed_inventory_foundation(
        self,
        *,
        facility: Facility,
        departments: dict,
        wards: dict,
        seed_user: User,
        manifest: SeedManifest,
    ) -> tuple[dict, dict]:
        if not self._feature_enabled(facility, "inventory"):
            return {}, {}

        storage_locations = {}
        main_store, created = StorageLocation.objects.get_or_create(
            facility=facility,
            code="MAIN-STORE",
            defaults={
                "name": "Main Medical Store",
                "location_type": "warehouse",
                "can_receive_external": True,
                "allows_controlled_substances": True,
                "is_active": True,
                "created_by": seed_user,
                "updated_by": seed_user,
            },
        )
        if created:
            manifest.add("StorageLocation", main_store.pk)
        storage_locations["main_store"] = main_store

        pharmacy, created = StorageLocation.objects.get_or_create(
            facility=facility,
            code="PHARMACY",
            defaults={
                "name": "Main Pharmacy",
                "parent": main_store,
                "location_type": "pharmacy",
                "can_dispense_to_patients": True,
                "allows_controlled_substances": True,
                "is_active": True,
                "created_by": seed_user,
                "updated_by": seed_user,
            },
        )
        if created:
            manifest.add("StorageLocation", pharmacy.pk)
        storage_locations["pharmacy"] = pharmacy

        for ward_name, ward in wards.items():
            code = f"WARD-{self._unit_code(ward_name, max_length=18)}"
            location, created = StorageLocation.objects.get_or_create(
                facility=facility,
                code=code,
                defaults={
                    "name": f"{ward.name} Store",
                    "parent": main_store,
                    "location_type": "ward_store",
                    "ward": ward,
                    "department": ward.department,
                    "is_active": True,
                    "created_by": seed_user,
                    "updated_by": seed_user,
                },
            )
            if created:
                manifest.add("StorageLocation", location.pk)
            storage_locations[f"ward:{ward.pk}"] = location

        medication_category, created = InventoryCategory.objects.get_or_create(
            facility=facility,
            name="Medications",
            defaults={"created_by": seed_user, "updated_by": seed_user},
        )
        if created:
            manifest.add("InventoryCategory", medication_category.pk)

        inventory_items = {}
        for med in MEDICATION_CATALOG:
            item, created = InventoryItem.objects.get_or_create(
                facility=facility,
                sku=f"MED-{med['key'].upper()}",
                defaults={
                    "name": med["name"],
                    "category": medication_category,
                    "item_type": "medication",
                    "inventory_class": "B",
                    "unit_of_measure": "dose",
                    "minimum_stock": 50,
                    "reorder_level": 100,
                    "reorder_quantity": 500,
                    "current_stock": 0,
                    "unit_cost": med["unit_cost"],
                    "selling_price": med["selling_price"],
                    "is_active": True,
                    "created_by": seed_user,
                    "updated_by": seed_user,
                },
            )
            if created:
                manifest.add("InventoryItem", item.pk)
            inventory_items[med["name"]] = item

            stock, created = LocationStock.objects.get_or_create(
                item=item,
                location=pharmacy,
                defaults={
                    "quantity": 500,
                    "reserved_quantity": 0,
                    "reorder_level": 100,
                    "reorder_quantity": 500,
                    "max_level": 1000,
                    "last_counted_at": timezone.now(),
                },
            )
            if created:
                manifest.add("LocationStock", stock.pk)

        return storage_locations, inventory_items

    def _seed_facility(self, cfg: dict, seed_user: User, manifest: SeedManifest) -> FacilityContext:
        # --- Facility ---
        facility, created = Facility.objects.get_or_create(
            code=cfg["code"],
            defaults={
                "name": cfg["name"],
                "facility_type": "hospital",
                "address": cfg["address"],
                "city": cfg["city"],
                "region": cfg["region"],
                "country": "Ghana",
                "phone": "+233000000000",
                "email": f"info@{cfg['code'].lower()}.hms.local",
                "status": "running",
            }
        )
        if created:
            manifest.add("Facility", facility.pk)

        # --- Departments ---
        departments = {}
        created_departments = []
        for dept_name in DEPARTMENTS_CONFIG:
            dept, created = Department.objects.get_or_create(
                name=dept_name, facility=facility,
                defaults={"code": dept_name[:10].upper().replace(" ", "-").replace("&", "AND")}
            )
            departments[dept_name] = dept
            if created:
                created_departments.append(dept.pk)
        manifest.add_bulk("Department", created_departments)

        # --- Clinical Units (facility root -> departments -> teams) ---
        root_unit, department_units, team_units, created_units = self._seed_clinical_unit_tree(
            facility=facility,
            departments=departments,
            seed_user=seed_user,
        )
        clinical_units = department_units
        manifest.add_bulk("ClinicalUnit", created_units)

        # --- Clinics ---
        clinics = []
        created_clinics = []
        clinic_depts = ["General Outpatient", "Internal Medicine", "Surgery",
                        "Obstetrics & Gynaecology", "Paediatrics", "Emergency Medicine"]
        for cd_name in clinic_depts:
            if cd_name not in clinical_units:
                continue
            cu = clinical_units[cd_name]
            code = f"{cfg['code']}-CLN-{cd_name[:6].upper().replace(' ', '')}"
            clinic, created = Clinic.objects.get_or_create(
                code=code,
                facility=facility,
                defaults={
                    "department": cu,
                    "name": f"{cd_name} Clinic",
                    "accepts_walk_ins": True,
                    "operates_24_hours": cd_name == "Emergency Medicine",
                    "operating_hours_start": None if cd_name == "Emergency Medicine" else time(8, 0),
                    "operating_hours_end": None if cd_name == "Emergency Medicine" else time(17, 0),
                    "booking_mode": "practitioner_direct",
                    "assignment_timing": "booking",
                }
            )
            clinics.append(clinic)
            if created:
                created_clinics.append(clinic.pk)
        manifest.add_bulk("Clinic", created_clinics)

        # --- Appointment Type ---
        apt, created = AppointmentType.objects.get_or_create(
            name=f"{cfg['code']} General Consultation",
            defaults={"duration_minutes": 30, "category": "in_person", "created_by": seed_user}
        )
        if created:
            manifest.add("AppointmentType", apt.pk)

        self._seed_clinic_schedules(
            facility=facility,
            clinics=clinics,
            seed_user=seed_user,
            manifest=manifest,
        )

        # --- Wards & Beds ---
        wards = {}
        ward_teams = {}
        all_beds = []
        for wc in WARDS_CONFIG:
            dept_name = wc["dept"]
            dept = departments.get(dept_name)
            if not dept:
                dept = list(departments.values())[0]

            ward, created = Ward.objects.get_or_create(
                name=f"{cfg['code']} {wc['name']}",
                department=dept,
                defaults={
                    "ward_type": wc["type"],
                    "total_beds": wc["beds"],
                    "base_rate_per_night": Decimal(wc["rate"]),
                    "is_active": True,
                    "created_by": seed_user,
                }
            )
            if created:
                manifest.add("Ward", ward.pk)
            wards[wc["name"]] = ward

            owning_team = team_units.get(dept_name) or department_units.get(dept_name)
            if owning_team:
                ward_teams[ward.pk] = owning_team
                allocation, allocation_created = UnitWardAllocation.objects.get_or_create(
                    unit=owning_team,
                    ward=ward,
                    effective_from=None,
                    defaults={
                        "allocation_type": "dedicated",
                        "allocated_beds": wc["beds"],
                        "max_beds": wc["beds"],
                        "min_beds": 1,
                        "priority": 10,
                        "is_active": True,
                        "created_by": seed_user,
                    },
                )
                if allocation_created:
                    manifest.add("UnitWardAllocation", allocation.pk)

            # Create beds
            existing_beds = set(ward.beds.values_list("bed_number", flat=True))
            new_beds = []
            for b in range(1, wc["beds"] + 1):
                bed_num = f"{b:02d}"
                if bed_num not in existing_beds:
                    new_beds.append(Bed(
                        ward=ward,
                        facility=facility,
                        bed_number=bed_num,
                        bed_type="icu" if wc["type"] == "icu" else ("maternity" if wc["type"] == "maternity" else "standard"),
                        status="available",
                        additional_rate=Decimal("0.00"),
                        created_by=seed_user,
                    ))
            if new_beds:
                created_beds = Bed.objects.bulk_create(new_beds)
                manifest.add_bulk("Bed", [b.pk for b in created_beds])

            all_beds.extend(list(ward.beds.all()))

        # --- Lab Test Catalog ---
        lab_tests = {}
        created_lab_tests = []
        for ltc in LAB_TESTS_CONFIG:
            lt, created = LabTestCatalog.objects.get_or_create(
                facility=facility, code=ltc["code"],
                defaults={
                    "name": ltc["name"],
                    "short_name": ltc["short"],
                    "category": ltc["cat"],
                    "specimen_type": ltc["spec"],
                    "container_type": ltc["cont"],
                    "unit": ltc["unit"],
                    "reference_ranges": {"adult": {"low": ltc["low"], "high": ltc["high"]}},
                    "tat_hours": ltc["tat"],
                    "price": Decimal(ltc["price"]),
                    "is_active": True,
                    "is_system_default": True,
                }
            )
            lab_tests[ltc["code"]] = lt
            if created:
                created_lab_tests.append(lt.pk)
        manifest.add_bulk("LabTestCatalog", created_lab_tests)

        # --- Service Categories & Services ---
        categories = {}
        created_categories = []
        for cat_name in SERVICE_CATEGORIES_CONFIG:
            cat, created = ServiceCategory.objects.get_or_create(
                facility=facility, name=cat_name,
                defaults={"created_by": seed_user}
            )
            categories[cat_name] = cat
            if created:
                created_categories.append(cat.pk)
        manifest.add_bulk("ServiceCategory", created_categories)

        services = {}
        created_services = []
        for svc in SERVICES_CONFIG:
            cat = categories.get(svc["cat"])
            if not cat:
                continue
            code = f"{cfg['code']}-{svc['code']}"
            s, created = Service.objects.get_or_create(
                facility=facility, code=code,
                defaults={
                    "name": svc["name"],
                    "category": cat,
                    "base_price": Decimal(svc["price"]),
                    "tax_rate": Decimal("0.00"),
                    "is_active": True,
                    "created_by": seed_user,
                }
            )
            services[svc["code"]] = s
            if created:
                created_services.append(s.pk)
        manifest.add_bulk("Service", created_services)

        # --- Note Template ---
        note_tmpl, created = NoteTemplate.objects.get_or_create(
            facility=facility, title=f"{cfg['code']} SOAP Note",
            defaults={
                "structure": SOAP_TEMPLATE_STRUCTURE,
                "category": "soap",
                "visibility": "public",
                "is_public": True,
                "is_active": True,
            }
        )
        if created:
            manifest.add("NoteTemplate", note_tmpl.pk)

        # --- Staff ---
        doctors, nurses, lab_techs, pharmacists, support_staff = self._seed_staff(
            facility, departments, seed_user, manifest, cfg["code"]
        )
        self._seed_staff_unit_assignments(
            facility=facility,
            department_units=department_units,
            team_units=team_units,
            doctors=doctors,
            nurses=nurses,
            support_staff=support_staff,
            seed_user=seed_user,
            manifest=manifest,
        )
        self._seed_ward_assignments_and_rosters(
            facility=facility,
            department_units=department_units,
            team_units=team_units,
            ward_teams=ward_teams,
            wards=wards,
            doctors=doctors,
            nurses=nurses,
            appointment_type=apt,
            seed_user=seed_user,
            manifest=manifest,
        )
        nhis_plan = self._seed_billing_foundation(
            facility=facility,
            seed_user=seed_user,
            manifest=manifest,
        )
        storage_locations, inventory_items = self._seed_inventory_foundation(
            facility=facility,
            departments=departments,
            wards=wards,
            seed_user=seed_user,
            manifest=manifest,
        )

        seed_user.primary_facility = facility
        seed_user.save(update_fields=["primary_facility"])
        seed_user.facilities.add(facility)

        return FacilityContext(
            facility=facility,
            departments=departments,
            clinical_units=clinical_units,
            root_unit=root_unit,
            department_units=department_units,
            team_units=team_units,
            ward_teams=ward_teams,
            clinics=clinics,
            wards=wards,
            beds=all_beds,
            appointment_type=apt,
            note_template=note_tmpl,
            lab_tests=lab_tests,
            services=services,
            doctors=doctors,
            nurses=nurses,
            lab_techs=lab_techs,
            pharmacists=pharmacists,
            support_staff=support_staff,
            admin_user=seed_user,
            seed_user=seed_user,
            nhis_plan=nhis_plan,
            inventory_items=inventory_items,
            storage_locations=storage_locations,
            occupied_bed_ids=set(
                Admission.objects.filter(
                    facility=facility,
                    status__in=("admitted", "pending_discharge"),
                    bed__isnull=False,
                ).values_list("bed_id", flat=True)
            ),
        )

    def _get_or_create_unit_type(self, seed_user: User) -> UnitTypeConfig:
        return self._get_or_create_unit_types()["department"]

    def _seed_staff(self, facility, departments, seed_user, manifest, fac_code):
        doctors, nurses, lab_techs, pharmacists, support_staff = [], [], [], [], []
        emp_counter = getattr(self, "_emp_counter", 0)

        for spec in STAFF_SPECS:
            user_type, dept_name, specialization, position, qualification, count = spec
            dept = departments.get(dept_name)
            if not dept:
                continue

            for i in range(count):
                emp_counter += 1
                first, last, gender = _rnd_name(gender="F" if user_type == "nurse" else None)
                email = f"seed.staff.{fac_code.lower()}.{emp_counter:04d}@hms.local"
                username = f"seed_staff_{fac_code.lower()}_{emp_counter:04d}"

                user, created = User.objects.get_or_create(
                    email=email,
                    defaults={
                        "username": username,
                        "first_name": first,
                        "last_name": last,
                        "user_type": user_type,
                        "gender": gender,
                        "primary_facility": facility,
                        "is_active": False,
                        "must_change_password": True,
                    }
                )
                updated_fields = []
                if user.is_active:
                    user.is_active = False
                    updated_fields.append("is_active")
                if not user.must_change_password:
                    user.must_change_password = True
                    updated_fields.append("must_change_password")
                if user.has_usable_password():
                    user.set_unusable_password()
                    updated_fields.append("password")
                if updated_fields:
                    user.save(update_fields=updated_fields)
                user.facilities.add(facility)
                if created:
                    manifest.add("User", user.pk)

                staff, staff_created = Staff.objects.get_or_create(
                    user=user,
                    defaults={
                        "employee_id": generate_unique_employee_id(facility),
                        "department": dept_name,
                        "position": position,
                        "hire_date": date.today() - timedelta(days=_rng.randint(365, 3650)),
                        "primary_facility": facility,
                        "created_by": seed_user,
                    }
                )
                if staff_created:
                    manifest.add("Staff", staff.pk)

                if user_type in ("doctor", "nurse"):
                    lic = _license(fac_code, user_type, emp_counter)
                    prac, prac_created = PractitionerProfile.objects.get_or_create(
                        staff=staff,
                        defaults={
                            "license_number": lic,
                            "specialization": specialization or position,
                            "qualification": qualification,
                            "created_by": seed_user,
                        }
                    )
                    if prac_created:
                        manifest.add("PractitionerProfile", prac.pk)
                    if user_type == "doctor":
                        doctors.append(prac)
                    else:
                        nurses.append(prac)
                elif user_type == "lab_technician":
                    lab_techs.append(staff)
                    support_staff.append(staff)
                elif user_type == "pharmacist":
                    pharmacists.append(staff)
                    support_staff.append(staff)
                else:
                    support_staff.append(staff)

        self._emp_counter = emp_counter
        return doctors, nurses, lab_techs, pharmacists, support_staff

    # ------------------------------------------------------------------
    # PATIENT BATCH SEEDER
    # ------------------------------------------------------------------

    def _seed_patient_batch(self, ctx: FacilityContext,
                            local_start: int, local_end: int,
                            n_years: int, seed_user: User, manifest: SeedManifest):
        """Seed patients [local_start, local_end) within a single transaction."""
        facility = ctx.facility
        fac_code = facility.code

        archetypes = list(ARCHETYPE_WEIGHTS.keys())
        weights = list(ARCHETYPE_WEIGHTS.values())

        for idx in range(local_start, local_end):
            archetype = _rng.choices(archetypes, weights=weights, k=1)[0]
            gender_override = ARCHETYPE[archetype]["gender"]
            first, last, gender = _rnd_name(gender=gender_override)
            dob = _rnd_dob(archetype)
            phone = _rnd_phone()
            patient_number = idx + 1
            email = self._patient_seed_email(fac_code, patient_number)
            existing_user = User.objects.filter(email=email).select_related("patient_profile").first()
            if existing_user is not None:
                patient = getattr(existing_user, "patient_profile", None)
                if patient is None or existing_user.user_type != "patient":
                    raise CommandError(
                        f"Existing user {email} is not a recoverable seeded patient."
                    )
                if (
                    str(existing_user.pk) not in manifest.data.get("User", [])
                    and str(patient.pk) not in manifest.data.get("PatientProfile", [])
                ):
                    raise CommandError(
                        f"Seed patient {email} already exists outside the current manifest. "
                        "Use the original manifest to resume or roll back that seeded dataset."
                    )
                self._record_existing_patient_graph(patient, manifest)
                continue

            mrn = generate_unique_mrn(facility)

            user = User(
                email=email,
                username=self._patient_seed_username(fac_code, patient_number),
                first_name=first,
                last_name=last,
                user_type="patient",
                gender=gender,
                date_of_birth=dob,
                phone_number=phone,
                primary_facility=facility,
                is_active=False,
                must_change_password=True,
            )
            user.set_unusable_password()
            user.save()
            user.facilities.add(facility)
            manifest.add("User", user.pk)

            blood_group = _rng.choices(BLOOD_GROUPS, weights=BLOOD_WEIGHTS, k=1)[0]
            patient = PatientProfile(
                user=user,
                facility=facility,
                medical_record_number=mrn,
                blood_group=blood_group,
                nhis_id=f"NHIS-{_rng.randint(10000000, 99999999)}" if _rng.random() < 0.6 else None,
                emergency_contact_name=f"{_rng.choice(SURNAMES)} {_rng.choice(MALE_FIRST if gender == 'F' else FEMALE_FIRST)}",
                emergency_contact_phone=_rnd_phone(),
                emergency_contact_relationship=_rng.choice(["Spouse", "Parent", "Sibling", "Child", "Friend"]),
                created_by=seed_user,
            )
            patient.save()
            manifest.add("PatientProfile", patient.pk)

            # Search index
            PatientSearchIndex.objects.update_or_create(
                patient_profile=patient,
                defaults={
                    "facility": facility,
                    "first_name": first,
                    "last_name": last,
                    "full_name": f"{first} {last}",
                    "medical_record_number": mrn,
                    "nhis_id": patient.nhis_id,
                    "search_document": f"{first} {last} {mrn} {patient.nhis_id or ''}",
                }
            )
            manifest.add("PatientSearchIndex", patient.pk)

            # Clinical journey
            self._seed_patient_journey(ctx, patient, archetype, n_years, seed_user, manifest)

    # ------------------------------------------------------------------
    # CLINICAL JOURNEY
    # ------------------------------------------------------------------

    def _seed_patient_journey(self, ctx: FacilityContext, patient: PatientProfile,
                               archetype: str, n_years: int,
                               seed_user: User, manifest: SeedManifest):
        """Seed complete clinical history for one patient."""
        cfg = ARCHETYPE[archetype]
        facility = ctx.facility

        # Determine number of outpatient encounters
        op_per_year_lo, op_per_year_hi = cfg["op"]
        total_op = int(_rng.uniform(op_per_year_lo, op_per_year_hi) * n_years)
        total_op = max(1, total_op)

        # Determine admissions
        adm_prob_total = cfg["adm"] * n_years
        n_admissions = 0
        while adm_prob_total >= 1:
            n_admissions += 1
            adm_prob_total -= 1
        if _rng.random() < adm_prob_total:
            n_admissions += 1

        # Pick care team members from the same department/team used by this journey.
        outpatient_department, outpatient_team = self._care_units_for_archetype(ctx, archetype)
        doctor = self._pick_practitioner_for_department(ctx.doctors, outpatient_department)
        nurse = self._pick_practitioner_for_department(ctx.nurses, outpatient_department)
        lab_tech = _rng.choice(ctx.lab_techs) if ctx.lab_techs else None
        matching_clinics = [
            clinic for clinic in ctx.clinics
            if outpatient_department and clinic.department_id == outpatient_department.pk
        ]
        clinic = _rng.choice(matching_clinics or ctx.clinics) if ctx.clinics else None
        patient_insurance = self._maybe_seed_patient_insurance(ctx, patient, seed_user, manifest)

        days_span = n_years * 365
        now = timezone.now()

        # --- OUTPATIENT ENCOUNTERS ---
        for op_idx in range(total_op):
            # Spread visits across the years (older visits first)
            days_ago = int(_rng.uniform(
                max(1, days_span - (op_idx + 1) * days_span // total_op),
                days_span - op_idx * days_span // total_op
            ))
            start_dt = _past_dt(days_ago, max(0, days_ago - 30))
            end_dt = start_dt + timedelta(minutes=_rng.randint(20, 60))
            is_finished = start_dt < timezone.now() - timedelta(hours=1)

            # Appointment
            appt = Appointment(
                facility=facility,
                patient=patient,
                practitioner=doctor,
                clinic=clinic,
                appointment_type=ctx.appointment_type,
                status="fulfilled" if is_finished else "booked",
                source=_rng.choice(["scheduled", "walk_in"]),
                start_time=start_dt,
                end_time=end_dt,
                reason=_rng.choice(ARCHETYPE_COMPLAINTS[archetype]),
                created_by=seed_user,
            )
            appt.save()
            manifest.add("Appointment", appt.pk)

            # Encounter
            enc = Encounter(
                patient=patient,
                facility=facility,
                practitioner=doctor,
                clinic=clinic,
                department=outpatient_department,
                primary_team=outpatient_team,
                appointment=appt,
                encounter_type="outpatient",
                status="finished" if is_finished else "in-progress",
                start_time=start_dt,
                end_time=end_dt if is_finished else None,
                reason=appt.reason,
                service_type="General Practice",
                created_by=seed_user,
            )
            enc.save()
            manifest.add("Encounter", enc.pk)

            # Outpatient Visit
            opv = OutpatientVisit(
                appointment=appt,
                encounter=enc,
                clinic=clinic if clinic else Clinic.objects.filter(facility=facility).first(),
                visit_status="checked_out" if is_finished else "in_progress",
                queue_number=op_idx + 1,
                checked_in_by=seed_user,
                consultation_started_at=start_dt + timedelta(minutes=15) if is_finished else None,
                consultation_ended_at=end_dt if is_finished else None,
                checked_out_at=end_dt if is_finished else None,
            )
            opv.save()
            manifest.add("OutpatientVisit", opv.pk)

            if not is_finished:
                continue

            # Vitals
            vitals_data = _rnd_vitals(archetype)
            vs = VitalSigns(
                patient=patient,
                facility=facility,
                recorded_by=nurse or doctor,
                encounter=enc,
                recorded_at=start_dt + timedelta(minutes=5),
                **vitals_data,
            )
            vs.save()
            manifest.add("VitalSigns", vs.pk)

            # Clinical Note
            complaint = appt.reason
            icd = _rng.choice(cfg["icd"])
            note_data = {
                "subjective": complaint,
                "objective": f"BP: {vitals_data['blood_pressure_systolic']}/{vitals_data['blood_pressure_diastolic']} mmHg, HR: {vitals_data['heart_rate']} bpm, Temp: {vitals_data['temperature']}°C, SpO2: {vitals_data['oxygen_saturation']}%",
                "assessment": f"ICD-10: {icd}. Consistent with {archetype.replace('_', ' ')} presentation.",
                "plan": "Continue current management. Review in 4 weeks. Labs ordered as indicated.",
            }
            if doctor:
                ne = NoteEntry(
                    template=ctx.note_template,
                    patient=patient,
                    facility=facility,
                    encounter=enc,
                    practitioner=doctor,
                    data=note_data,
                )
                ne.save()
                manifest.add("NoteEntry", ne.pk)

            # Lab Orders (70% of encounters get labs)
            if _rng.random() < 0.70 and doctor and cfg["labs"]:
                self._seed_lab_order(
                    ctx, patient, enc, doctor, lab_tech, start_dt, archetype, manifest
                )

            if doctor and _rng.random() < 0.65:
                self._seed_prescription(
                    ctx=ctx,
                    patient=patient,
                    encounter=enc,
                    doctor=doctor,
                    start_dt=start_dt,
                    manifest=manifest,
                )

            # Billing
            if ctx.services:
                cons_svc = ctx.services.get("CONS-GEN") or ctx.services.get("CONS-SPEC")
                if cons_svc:
                    self._seed_invoice(
                        ctx, patient, enc, cons_svc, start_dt, seed_user, manifest,
                        patient_insurance=patient_insurance,
                    )

        # --- INPATIENT ADMISSIONS ---
        should_leave_active_admission = (
            n_admissions > 0 and (
                not ctx.has_seeded_active_admission or _rng.random() < 0.15
            )
        )
        active_admission_idx = n_admissions - 1 if should_leave_active_admission else None
        for adm_idx in range(n_admissions):
            los = _rng.randint(2, 14)  # length of stay in days
            is_active_admission = adm_idx == active_admission_idx
            if is_active_admission:
                max_hours_ago = max(6, los * 24 - 2)
                adm_dt = now - timedelta(hours=_rng.randint(1, max_hours_ago))
                disch_dt = None
                expected_discharge_date = adm_dt + timedelta(days=los)
                status = (
                    "pending_discharge"
                    if expected_discharge_date <= now + timedelta(hours=12) and _rng.random() < 0.5
                    else "admitted"
                )
            else:
                min_days_ago = max(los + 1, 2)
                days_ago = _rng.randint(min_days_ago, max(min_days_ago, days_span))
                adm_dt = _past_dt(days_ago, max(los, days_ago - 10))
                disch_dt = adm_dt + timedelta(days=los)
                expected_discharge_date = disch_dt
                status = "discharged"

            # Pick a ward appropriate for this archetype
            ward_names = WARD_BY_ARCHETYPE.get(archetype, ["Medical Ward A"])
            if is_active_admission:
                ward, bed = self._pick_active_bed(ctx, ward_names)
            else:
                ward = next((ctx.wards[name] for name in ward_names if name in ctx.wards), None)
                if ward is None and ctx.wards:
                    ward = next(iter(ctx.wards.values()))
                ward_beds = [bed for bed in ctx.beds if ward and bed.ward_id == ward.pk]
                bed = _rng.choice(ward_beds) if ward_beds else None

            inpatient_department, inpatient_team = self._care_units_for_archetype(ctx, archetype, ward=ward)
            admission_doctor = self._pick_practitioner_for_department(ctx.doctors, inpatient_department) or doctor
            ward_nurse = self._pick_practitioner_for_department(ctx.nurses, inpatient_department) or nurse

            admission_type = "maternity" if archetype == "maternity" else (
                "emergency" if archetype in ("infectious", "respiratory", "chronic_complex") and _rng.random() < 0.4
                else "elective"
            )

            adm = Admission(
                patient=patient,
                bed=bed,
                facility=facility,
                admission_date=adm_dt,
                status=status,
                admission_type=admission_type,
                admitting_doctor=admission_doctor,
                daily_rate=Decimal(ward.base_rate_per_night if ward else "0.00"),
                admission_notes=f"Admitted with {_rng.choice(ARCHETYPE_COMPLAINTS[archetype])}",
                discharge_notes="Condition improved. Discharged in stable condition." if status == "discharged" else None,
                actual_discharge_date=disch_dt if status == "discharged" else None,
                expected_discharge_date=expected_discharge_date,
                primary_team=inpatient_team,
                created_by=seed_user,
            )
            adm.save()
            manifest.add("Admission", adm.pk)
            if is_active_admission and bed:
                ctx.occupied_bed_ids.add(bed.pk)
            if is_active_admission:
                ctx.has_seeded_active_admission = True

            # Inpatient Encounter linked to admission
            inpat_enc = Encounter(
                patient=patient,
                facility=facility,
                practitioner=admission_doctor,
                admission=adm,
                department=inpatient_department,
                encounter_type="inpatient",
                status="finished" if status == "discharged" else "in-progress",
                start_time=adm_dt,
                end_time=disch_dt if status == "discharged" else None,
                reason=_rng.choice(ARCHETYPE_COMPLAINTS[archetype]),
                admission_source="emergency" if admission_type == "emergency" else "referral",
                discharge_disposition="home" if status == "discharged" else None,
                primary_team=inpatient_team,
                admitted_by_team=inpatient_team,
                created_by=seed_user,
            )
            inpat_enc.save()
            manifest.add("Encounter", inpat_enc.pk)
            self._seed_admission_workflow(
                ctx=ctx,
                patient=patient,
                admission=adm,
                encounter=inpat_enc,
                ward=ward,
                bed=bed,
                doctor=admission_doctor,
                status=status,
                seed_user=seed_user,
                manifest=manifest,
            )
            self._seed_consulting_team(
                ctx=ctx,
                encounter=inpat_enc,
                primary_team=inpatient_team,
                archetype=archetype,
                seed_user=seed_user,
                manifest=manifest,
            )

            # Bed allocation log
            if bed:
                self._create_bed_allocation_log(
                    bed=bed,
                    facility=facility,
                    admission=adm,
                    previous_status="available",
                    new_status="occupied",
                    notes="Patient admitted",
                    actor=seed_user,
                    timestamp=adm_dt,
                    manifest=manifest,
                )
                if status == "discharged" and disch_dt is not None:
                    self._create_bed_allocation_log(
                        bed=bed,
                        facility=facility,
                        admission=adm,
                        previous_status="occupied",
                        new_status="available",
                        notes="Patient discharged",
                        actor=seed_user,
                        timestamp=disch_dt,
                        manifest=manifest,
                    )

            # Daily vitals during admission
            for day in range(min(los, 5)):
                day_dt = adm_dt + timedelta(days=day, hours=8)
                vd = _rnd_vitals(archetype)
                vs = VitalSigns(
                    patient=patient,
                    facility=facility,
                    recorded_by=ward_nurse or admission_doctor,
                    encounter=inpat_enc,
                    recorded_at=day_dt,
                    **vd,
                )
                vs.save()
                manifest.add("VitalSigns", vs.pk)

            # Admission note
            if admission_doctor:
                adm_note_data = {
                    "subjective": f"Admitted with {adm.admission_notes}",
                    "objective": "On admission: see nursing obs chart.",
                    "assessment": _rng.choice(cfg["icd"]),
                    "plan": "IV access, labs, monitoring. Specialty review as indicated.",
                }
                ne = NoteEntry(
                    template=ctx.note_template,
                    patient=patient,
                    facility=facility,
                    encounter=inpat_enc,
                    practitioner=admission_doctor,
                    data=adm_note_data,
                )
                ne.save()
                manifest.add("NoteEntry", ne.pk)

            # Labs during admission
            if admission_doctor:
                self._seed_lab_order(
                    ctx, patient, inpat_enc, admission_doctor, lab_tech, adm_dt, archetype, manifest
                )
                self._seed_inpatient_nursing_and_medication_workflow(
                    ctx=ctx,
                    patient=patient,
                    admission=adm,
                    encounter=inpat_enc,
                    doctor=admission_doctor,
                    nurse=ward_nurse,
                    start_dt=adm_dt,
                    status=status,
                    manifest=manifest,
                )
                self._seed_discharge_workflow(
                    ctx=ctx,
                    patient=patient,
                    admission=adm,
                    encounter=inpat_enc,
                    doctor=admission_doctor,
                    nurse=ward_nurse,
                    status=status,
                    seed_user=seed_user,
                    manifest=manifest,
                )

            # Inpatient billing
            if ctx.services and status == "discharged":
                ward_svc = self._get_ward_charge_service(ctx, ward)
                if ward_svc:
                    self._seed_invoice(
                        ctx,
                        patient,
                        inpat_enc,
                        ward_svc,
                        disch_dt,
                        seed_user,
                        manifest,
                        quantity=los,
                        is_admission=True,
                        admission=adm,
                        unit_price_override=adm.daily_rate,
                        patient_insurance=patient_insurance,
                    )

    # ------------------------------------------------------------------
    # OPERATIONAL WORKFLOW LINKS
    # ------------------------------------------------------------------

    def _maybe_seed_patient_insurance(
        self,
        ctx: FacilityContext,
        patient: PatientProfile,
        seed_user: User,
        manifest: SeedManifest,
    ) -> Optional[PatientInsurance]:
        if not ctx.nhis_plan or not self._feature_enabled(ctx.facility, "insurance_claims"):
            return None
        if _rng.random() > 0.35:
            return None
        policy_number = f"NHIS-{ctx.facility.code}-{str(patient.pk)[:8].upper()}"
        insurance, created = PatientInsurance.objects.get_or_create(
            patient=patient,
            plan=ctx.nhis_plan,
            policy_number=policy_number,
            defaults={
                "valid_from": timezone.localdate() - timedelta(days=365),
                "valid_until": timezone.localdate() + timedelta(days=365),
                "is_active": True,
                "created_by": seed_user,
                "updated_by": seed_user,
            },
        )
        if created:
            manifest.add("PatientInsurance", insurance.pk)
        return insurance

    def _select_medication(self) -> dict:
        return _rng.choice(MEDICATION_CATALOG)

    def _seed_prescription(
        self,
        *,
        ctx: FacilityContext,
        patient: PatientProfile,
        encounter: Encounter,
        doctor: PractitionerProfile,
        start_dt,
        manifest: SeedManifest,
        medication: Optional[dict] = None,
    ) -> Prescription:
        med = medication or self._select_medication()
        prescription = Prescription.objects.create(
            patient=patient,
            facility=ctx.facility,
            prescribed_by=doctor,
            medication_name=med["name"],
            dosage=med["dosage"],
            route=med["route"],
            frequency=med["frequency"],
            duration_days=_rng.randint(3, 14),
            start_date=start_dt.date() if hasattr(start_dt, "date") else timezone.localdate(),
            instructions="Take as prescribed. Return if symptoms worsen.",
            reason="Seeded treatment plan.",
            status="active",
            encounter=encounter,
        )
        manifest.add("Prescription", prescription.pk)
        return prescription

    def _seed_admission_workflow(
        self,
        *,
        ctx: FacilityContext,
        patient: PatientProfile,
        admission: Admission,
        encounter: Encounter,
        ward: Optional[Ward],
        bed: Optional[Bed],
        doctor: Optional[PractitionerProfile],
        status: str,
        seed_user: User,
        manifest: SeedManifest,
    ) -> None:
        if not self._feature_enabled(ctx.facility, "inpatient_admissions"):
            return
        case_status = AdmissionCase.Status.COMPLETED
        completed_at = admission.admission_date + timedelta(hours=2)
        case, created = AdmissionCase.objects.get_or_create(
            admission=admission,
            defaults={
                "facility": ctx.facility,
                "patient": patient,
                "source_encounter": encounter,
                "requested_ward": ward,
                "requested_bed": bed,
                "admitting_practitioner": doctor,
                "primary_team": admission.primary_team,
                "status": case_status,
                "admission_source": encounter.admission_source or "",
                "urgency": "urgent" if admission.admission_type == "emergency" else "routine",
                "requested_admission_type": admission.admission_type,
                "requested_for_at": admission.admission_date,
                "ready_for_activation_at": admission.admission_date - timedelta(minutes=30),
                "activated_at": admission.admission_date,
                "completed_at": completed_at,
                "requested_by": seed_user,
                "expected_length_of_stay": max(
                    1,
                    int(((admission.expected_discharge_date or admission.admission_date) - admission.admission_date).days or 1),
                ),
            },
        )
        if created:
            manifest.add("AdmissionCase", case.pk)

        if bed:
            reservation, reservation_created = BedReservation.objects.get_or_create(
                case=case,
                bed=bed,
                status=BedReservation.Status.CONSUMED,
                defaults={
                    "expires_at": admission.admission_date + timedelta(hours=4),
                    "released_at": admission.admission_date,
                    "created_by": seed_user,
                    "updated_by": seed_user,
                },
            )
            if reservation_created:
                manifest.add("BedReservation", reservation.pk)

        task_specs = [
            (AdmissionTask.TaskType.MEDICAL_ADMISSION_ORDER, AdmissionTask.Phase.PRE_ACTIVATION, "doctor", True),
            (AdmissionTask.TaskType.PLACEMENT, AdmissionTask.Phase.PRE_ACTIVATION, "bed_manager", True),
            (AdmissionTask.TaskType.NURSING_INTAKE, AdmissionTask.Phase.POST_ACTIVATION, "nurse", False),
            (AdmissionTask.TaskType.BASELINE_LAB_FOLLOWUP, AdmissionTask.Phase.POST_ACTIVATION, "lab_technician", False),
        ]
        for task_type, phase, role, blocking in task_specs:
            task_status = AdmissionTask.Status.COMPLETED
            if status in ("admitted", "pending_discharge") and task_type == AdmissionTask.TaskType.BASELINE_LAB_FOLLOWUP:
                task_status = AdmissionTask.Status.PENDING
            task, task_created = AdmissionTask.objects.get_or_create(
                case=case,
                task_type=task_type,
                defaults={
                    "phase": phase,
                    "assigned_role": role,
                    "blocking": blocking,
                    "status": task_status,
                    "notes": "Seeded admission workflow task.",
                    "completed_by": seed_user if task_status == AdmissionTask.Status.COMPLETED else None,
                    "completed_at": completed_at if task_status == AdmissionTask.Status.COMPLETED else None,
                    "created_by": seed_user,
                },
            )
            if task_created:
                manifest.add("AdmissionTask", task.pk)

    def _seed_consulting_team(
        self,
        *,
        ctx: FacilityContext,
        encounter: Encounter,
        primary_team: Optional[ClinicalUnit],
        archetype: str,
        seed_user: User,
        manifest: SeedManifest,
    ) -> None:
        if archetype not in {"chronic_complex", "surgical", "maternity", "infectious"}:
            return
        candidates = [
            team for name, team in ctx.team_units.items()
            if team.pk != getattr(primary_team, "pk", None)
        ]
        if not candidates:
            return
        team = _rng.choice(candidates)
        assignment, created = EncounterCareTeam.objects.get_or_create(
            encounter=encounter,
            team=team,
            defaults={
                "role": "consulting",
                "status": "active" if encounter.status == "in-progress" else "completed",
                "consult_reason": "Seeded cross-specialty review.",
                "consult_requested_at": encounter.start_time + timedelta(hours=2),
                "consult_accepted_at": encounter.start_time + timedelta(hours=3),
                "consult_completed_at": encounter.end_time if encounter.status == "finished" else None,
                "is_active": encounter.status == "in-progress",
                "created_by": seed_user,
            },
        )
        if created:
            manifest.add("EncounterCareTeam", assignment.pk)

    def _seed_inpatient_nursing_and_medication_workflow(
        self,
        *,
        ctx: FacilityContext,
        patient: PatientProfile,
        admission: Admission,
        encounter: Encounter,
        doctor: PractitionerProfile,
        nurse: Optional[PractitionerProfile],
        start_dt,
        status: str,
        manifest: SeedManifest,
    ) -> None:
        if not self._feature_enabled(ctx.facility, "nursing_workflows"):
            return
        med = self._select_medication()
        prescription = self._seed_prescription(
            ctx=ctx,
            patient=patient,
            encounter=encounter,
            doctor=doctor,
            start_dt=start_dt,
            manifest=manifest,
            medication=med,
        )
        inventory_item = ctx.inventory_items.get(med["name"])
        pharmacy = ctx.storage_locations.get("pharmacy")
        dispensing_user = ctx.pharmacists[0].user if ctx.pharmacists else ctx.seed_user
        treatment = TreatmentSheetEntry.objects.create(
            patient=patient,
            facility=ctx.facility,
            admission=admission,
            encounter=encounter,
            medication_name=med["name"],
            dosage=med["dosage"],
            route=med["route"],
            frequency=med["frequency"],
            start_datetime=start_dt + timedelta(hours=2),
            duration_days=5,
            status="active" if status != "discharged" else "completed",
            ordered_by=doctor,
            total_doses_ordered=10,
            total_doses_dispensed=6 if status != "discharged" else 10,
            total_doses_administered=2 if status != "discharged" else 10,
            inventory_item=inventory_item,
            prescription=prescription,
            created_by=ctx.seed_user,
        )
        manifest.add("TreatmentSheetEntry", treatment.pk)

        now = timezone.now()
        dose_specs = [
            (now - timedelta(hours=6), "administered"),
            (now - timedelta(hours=1), "scheduled" if status != "discharged" else "administered"),
            (now + timedelta(hours=1), "scheduled" if status != "discharged" else "administered"),
        ]
        for scheduled_time, med_status in dose_specs:
            administered_time = scheduled_time + timedelta(minutes=10) if med_status == "administered" else None
            med_admin = MedicationAdministration.objects.create(
                patient=patient,
                facility=ctx.facility,
                medication_name=med["name"],
                dosage=med["dosage"],
                route=med["route"],
                frequency=med["frequency"],
                scheduled_time=scheduled_time,
                administered_time=administered_time,
                status=med_status,
                administered_by=nurse if med_status == "administered" else None,
                prescribed_by=doctor,
                prescription=prescription,
                treatment_entry=treatment,
                is_dispensed=True,
                dispensed_at=start_dt + timedelta(hours=3),
                dispensed_by=dispensing_user,
                inventory_item=inventory_item,
                dispensing_location=pharmacy,
                created_by=ctx.seed_user,
            )
            manifest.add("MedicationAdministration", med_admin.pk)

        supply_request = SupplyRequest.objects.create(
            treatment_entry=treatment,
            facility=ctx.facility,
            quantity_requested=12,
            quantity_dispensed=6 if status != "discharged" else 12,
            status="pending" if status != "discharged" else "dispensed",
            requested_by=nurse or doctor,
            dispensed_by=None if status != "discharged" else dispensing_user,
            dispensed_at=None if status != "discharged" else start_dt + timedelta(hours=4),
            notes="Seeded ward medication supply request.",
        )
        manifest.add("SupplyRequest", supply_request.pk)

        task_specs = [
            ("vitals", "Record four-hourly observations", now - timedelta(minutes=30), "high"),
            ("medication", f"Administer {med['name']} dose", now + timedelta(hours=1), "medium"),
            ("assessment", "Complete shift assessment", now + timedelta(hours=2), "medium"),
        ]
        if status == "pending_discharge":
            task_specs.append(("discharge", "Prepare nursing discharge checklist", now + timedelta(hours=1), "high"))
        for task_type, description, scheduled_time, priority in task_specs:
            task = NursingTask.objects.create(
                patient=patient,
                facility=ctx.facility,
                task_type=task_type,
                description=description,
                scheduled_time=scheduled_time,
                assigned_to=nurse,
                priority=priority,
                status="pending",
                created_by=ctx.seed_user,
            )
            manifest.add("NursingTask", task.pk)

        if status != "discharged":
            alert = NursingAlert.objects.create(
                patient=patient,
                facility=ctx.facility,
                alert_type="task_overdue",
                severity="high",
                message="Seeded high-priority nursing follow-up for active admission.",
            )
            manifest.add("NursingAlert", alert.pk)

        handoff = ShiftHandoff.objects.create(
            patient=patient,
            facility=ctx.facility,
            shift_date=timezone.localdate(),
            shift_type=_rng.choice(["day", "evening", "night"]),
            from_nurse=nurse,
            to_nurse=nurse,
            patient_condition="Stable with ongoing inpatient monitoring.",
            ongoing_issues="Medication schedule and lab follow-up pending.",
            pending_tasks="Review observations and medication administration record.",
            medication_changes=f"{med['name']} started during admission.",
            key_events="Seeded admission workflow activity.",
            care_plan_updates="Continue monitoring and reassess during ward round.",
            created_by=ctx.seed_user,
        )
        manifest.add("ShiftHandoff", handoff.pk)

        for entry_type, category, volume in (("intake", "oral", 600), ("output", "urine", 450)):
            fluid = FluidBalance.objects.create(
                patient=patient,
                facility=ctx.facility,
                admission=admission,
                entry_type=entry_type,
                category=category,
                subcategory="Water" if entry_type == "intake" else "Spontaneous void",
                volume_ml=volume,
                recorded_at=now - timedelta(hours=2),
                recorded_by=nurse,
                notes="Seeded fluid balance entry.",
                colour="clear" if entry_type == "output" else None,
                created_by=ctx.seed_user,
            )
            manifest.add("FluidBalance", fluid.pk)

    def _seed_discharge_workflow(
        self,
        *,
        ctx: FacilityContext,
        patient: PatientProfile,
        admission: Admission,
        encounter: Encounter,
        doctor: PractitionerProfile,
        nurse: Optional[PractitionerProfile],
        status: str,
        seed_user: User,
        manifest: SeedManifest,
    ) -> None:
        if status not in ("pending_discharge", "discharged"):
            return
        if not self._feature_enabled(ctx.facility, "discharge_workflows"):
            return
        medical_ready_at = admission.expected_discharge_date or timezone.now()
        nursing_task = NursingTask.objects.create(
            patient=patient,
            facility=ctx.facility,
            task_type="discharge",
            description="Finalize discharge education and nursing documentation.",
            scheduled_time=medical_ready_at - timedelta(hours=2),
            assigned_to=nurse,
            priority="high",
            status="completed" if status == "discharged" else "pending",
            completed_by=nurse if status == "discharged" else None,
            completed_time=medical_ready_at if status == "discharged" else None,
            created_by=seed_user,
        )
        manifest.add("NursingTask", nursing_task.pk)

        case = DischargeCase.objects.create(
            facility=ctx.facility,
            patient=patient,
            admission=admission,
            encounter=encounter,
            nursing_task=nursing_task,
            medical_ready_at=medical_ready_at,
            billing_cutoff_at=medical_ready_at + timedelta(hours=1),
            finalized_at=admission.actual_discharge_date if status == "discharged" else None,
            status=(
                DischargeCase.Status.FINALIZED
                if status == "discharged"
                else DischargeCase.Status.AWAITING_CLEARANCE
            ),
            discharge_disposition="home",
            submitted_by=seed_user,
        )
        manifest.add("DischargeCase", case.pk)

        for task_type, role, blocking in (
            (DischargeTask.TaskType.BILLING_CLEARANCE, "billing", True),
            (DischargeTask.TaskType.NURSING_FINALIZATION, "nurse", True),
            (DischargeTask.TaskType.PHARMACY_FOLLOWUP, "pharmacist", False),
            (DischargeTask.TaskType.LAB_FOLLOWUP, "lab_technician", False),
        ):
            task_status = DischargeTask.Status.COMPLETED if status == "discharged" else DischargeTask.Status.PENDING
            task = DischargeTask.objects.create(
                case=case,
                task_type=task_type,
                assigned_role=role,
                blocking=blocking,
                status=task_status,
                notes="Seeded discharge workflow task.",
                completed_by=seed_user if task_status == DischargeTask.Status.COMPLETED else None,
                completed_at=case.finalized_at if task_status == DischargeTask.Status.COMPLETED else None,
                created_by=seed_user,
            )
            manifest.add("DischargeTask", task.pk)

    # ------------------------------------------------------------------
    # LAB ORDER
    # ------------------------------------------------------------------

    def _seed_lab_order(self, ctx: FacilityContext, patient, enc, doctor,
                        lab_tech, order_dt, archetype: str, manifest: SeedManifest) -> None:
        cfg = ARCHETYPE[archetype]
        lab_codes = cfg["labs"]
        available = [ctx.lab_tests[c] for c in lab_codes if c in ctx.lab_tests]
        if not available:
            return

        # Select 1-3 tests
        selected = _rng.sample(available, min(len(available), _rng.randint(1, 3)))

        order_date = order_dt.date() if hasattr(order_dt, "date") else order_dt
        order_num = self._reserve_lab_order_number(order_date)
        if order_dt >= timezone.now() - timedelta(days=2):
            order_status = _rng.choices(
                ["ordered", "collected", "received", "processing", "completed"],
                weights=[20, 20, 20, 20, 20],
                k=1,
            )[0]
        else:
            order_status = "completed"

        collected_at = order_dt + timedelta(minutes=30) if order_status != "ordered" else None
        received_at = order_dt + timedelta(hours=1) if order_status in ("received", "processing", "completed") else None
        completed_at = order_dt + timedelta(hours=selected[0].tat_hours if selected else 4) if order_status == "completed" else None

        lab_order = LabOrder(
            order_number=order_num,
            patient=patient,
            facility=ctx.facility,
            encounter=enc,
            ordering_provider=doctor,
            priority="routine",
            status=order_status,
            ordered_at=order_dt,
            collected_at=collected_at,
            received_at=received_at,
            completed_at=completed_at,
        )
        lab_order.save()
        manifest.add("LabOrder", lab_order.pk)

        # Specimen
        specimen = None
        if order_status != "ordered":
            barcode = f"SPX-{order_date.strftime('%Y%m%d')}-{_rng.randint(100000, 999999)}"
            specimen_status = {
                "collected": "collected",
                "received": "received",
                "processing": "processing",
                "completed": "stored",
            }[order_status]
            specimen = LabSpecimen(
                barcode=barcode,
                order=lab_order,
                facility=ctx.facility,
                specimen_type=selected[0].specimen_type,
                container_type=selected[0].container_type,
                collected_at=collected_at,
                collected_by=lab_tech,
                received_by=lab_tech if received_at else None,
                received_at=received_at,
                status=specimen_status,
            )
            specimen.save()
            manifest.add("LabSpecimen", specimen.pk)

        # Order tests + results
        for test in selected:
            ot = LabOrderTest(
                order=lab_order,
                facility=ctx.facility,
                test=test,
                status=order_status,
            )
            ot.save()
            manifest.add("LabOrderTest", ot.pk)
            if order_status != "completed":
                continue

            test_cfg = next((t for t in LAB_TESTS_CONFIG if t["code"] == test.code), None)
            if not test_cfg:
                continue
            value_str, flag = _rnd_lab_value(test_cfg)

            result = LabResult(
                order_test=ot,
                specimen=specimen,
                facility=ctx.facility,
                value=value_str,
                unit=test.unit,
                reference_low=Decimal(str(test_cfg["low"])) if test_cfg["low"] != 0 else None,
                reference_high=Decimal(str(test_cfg["high"])) if test_cfg["high"] != 0 else None,
                flag=flag,
                performed_by=lab_tech,
                performed_at=order_dt + timedelta(hours=test.tat_hours),
                is_verified=True,
                verified_by=lab_tech,
                verified_at=order_dt + timedelta(hours=test.tat_hours + 1),
            )
            result.save()
            manifest.add("LabResult", result.pk)

    # ------------------------------------------------------------------
    # BILLING
    # ------------------------------------------------------------------

    def _seed_invoice(self, ctx: FacilityContext, patient, enc, service,
                      invoice_dt, seed_user, manifest: SeedManifest,
                      quantity: int = 1, is_admission: bool = False,
                      admission: Optional[Admission] = None,
                      unit_price_override: Optional[Decimal] = None,
                      patient_insurance: Optional[PatientInsurance] = None) -> Optional[Invoice]:
        inv_num = f"SED-{_rng.randint(100000000000, 999999999999)}"
        unit_price = unit_price_override if unit_price_override is not None else service.base_price
        total = unit_price * quantity

        # 80% paid, 15% pending, 5% overdue
        status_roll = _rng.random()
        status = "paid" if status_roll < 0.80 else ("pending" if status_roll < 0.95 else "overdue")

        dt = invoice_dt.date() if hasattr(invoice_dt, "date") else invoice_dt

        inv = Invoice(
            invoice_number=inv_num,
            patient=patient,
            facility=ctx.facility,
            encounter=enc,
            admission=admission if is_admission else None,
            patient_insurance=patient_insurance,
            invoice_date=dt,
            due_date=dt + timedelta(days=30),
            subtotal=total,
            tax_amount=Decimal("0.00"),
            discount_amount=Decimal("0.00"),
            total_amount=total,
            patient_responsibility=total,
            status=status,
            created_by=seed_user,
        )
        inv.save()
        manifest.add("Invoice", inv.pk)

        # Invoice Item
        item = InvoiceItem(
            invoice=inv,
            service=service,
            quantity=quantity,
            unit_price=unit_price,
            tax_rate=Decimal("0.00"),
            discount_percentage=Decimal("0.00"),
            description=service.name,
            created_by=seed_user,
        )
        item.save()
        manifest.add("InvoiceItem", item.pk)
        inv.refresh_from_db()
        if inv.insurance_amount > 0:
            self._seed_claim_for_invoice(ctx, inv, seed_user, manifest)

        # Payment (if paid)
        if status == "paid":
            method = _rng.choices(PAYMENT_METHODS, weights=PAYMENT_WEIGHTS, k=1)[0]
            payer = "patient"
            payment_amount = inv.patient_responsibility
            if payment_amount <= 0:
                payer = "insurance"
                method = "insurance"
                payment_amount = inv.insurance_amount
            elif method == "insurance":
                method = "mobile_money"
            pay = Payment(
                invoice=inv,
                payment_date=dt,
                amount=payment_amount,
                payer=payer,
                status="posted",
                payment_method=method,
                reference_number=f"REF-{_rng.randint(100000, 999999)}",
            )
            pay.save()
            manifest.add("Payment", pay.pk)

        return inv

    def _seed_claim_for_invoice(
        self,
        ctx: FacilityContext,
        invoice: Invoice,
        seed_user: User,
        manifest: SeedManifest,
    ) -> None:
        if not self._feature_enabled(ctx.facility, "insurance_claims"):
            return
        period_start = invoice.invoice_date.replace(day=1)
        period_end = (period_start + timedelta(days=32)).replace(day=1) - timedelta(days=1)
        batch, batch_created = NHISClaimBatch.objects.get_or_create(
            facility=ctx.facility,
            period_start=period_start,
            period_end=period_end,
            defaults={
                "status": "draft",
                "notes": "Seeded NHIS claim batch.",
                "created_by": seed_user,
                "updated_by": seed_user,
            },
        )
        if batch_created:
            manifest.add("NHISClaimBatch", batch.pk)
        claim, created = Claim.objects.get_or_create(
            invoice=invoice,
            defaults={
                "claim_number": f"CLM-{invoice.invoice_date.strftime('%Y%m%d')}-{str(invoice.pk)[:8].upper()}",
                "batch": batch,
                "submitted_at": timezone.now(),
                "submitted_by": seed_user,
                "submission_reference": f"NHIS-{_rng.randint(100000, 999999)}",
                "submission_date": invoice.invoice_date,
                "status": _rng.choice(["submitted", "in_review", "approved"]),
                "claimed_amount": invoice.insurance_amount,
                "approved_amount": invoice.insurance_amount if _rng.random() < 0.35 else Decimal("0.00"),
                "created_by": seed_user,
                "updated_by": seed_user,
            },
        )
        if created:
            manifest.add("Claim", claim.pk)

    # ------------------------------------------------------------------
    # ROLLBACK
    # ------------------------------------------------------------------

    def _rollback(self, manifest: SeedManifest) -> None:
        if not manifest.path.exists():
            raise CommandError(f"Manifest file not found: {manifest.path}")

        self._reconcile_pending_batches(manifest)

        self.stdout.write(self.style.WARNING(
            f"\nRolling back {manifest.total():,} records from {manifest.path}...\n"
        ))

        # Delete in reverse dependency order
        ORDER = [
            ("Claim",             Claim),
            ("Payment",           Payment),
            ("InvoiceItem",       InvoiceItem),
            ("Invoice",           Invoice),
            ("NHISClaimBatch",    NHISClaimBatch),
            ("PatientInsurance",  PatientInsurance),
            ("LabResult",         LabResult),
            ("LabOrderTest",      LabOrderTest),
            ("LabSpecimen",       LabSpecimen),
            ("LabOrder",          LabOrder),
            ("DischargeTask",     DischargeTask),
            ("DischargeCase",     DischargeCase),
            ("SupplyRequest",     SupplyRequest),
            ("MedicationAdministration", MedicationAdministration),
            ("TreatmentSheetEntry", TreatmentSheetEntry),
            ("Prescription",      Prescription),
            ("NoteEntry",         NoteEntry),
            ("NursingAlert",      NursingAlert),
            ("NursingTask",       NursingTask),
            ("ShiftHandoff",      ShiftHandoff),
            ("FluidBalance",      FluidBalance),
            ("VitalSigns",        VitalSigns),
            ("BedAllocationLog",  BedAllocationLog),
            ("OutpatientVisit",   OutpatientVisit),
            ("EncounterCareTeam", EncounterCareTeam),
            ("Encounter",         Encounter),
            ("BedReservation",    BedReservation),
            ("AdmissionTask",     AdmissionTask),
            ("AdmissionCase",     AdmissionCase),
            ("Admission",         Admission),
            ("Appointment",       Appointment),
            ("PatientSearchIndex",PatientSearchIndex),
            ("PatientProfile",    PatientProfile),
            ("WardStaffAssignment", WardStaffAssignment),
            ("StaffUnitAssignment", StaffUnitAssignment),
            ("UnitMemberAssignment", UnitMemberAssignment),
            ("PractitionerProfile", PractitionerProfile),
            ("Staff",             Staff),
            ("LocationStock",     LocationStock),
            ("InventoryItem",     InventoryItem),
            ("InventoryCategory", InventoryCategory),
            ("StorageLocation",   StorageLocation),
            ("Bed",               Bed),
            ("UnitWardAllocation", UnitWardAllocation),
            ("RosterEntry",       RosterEntry),
            ("DepartmentDutyType", DepartmentDutyType),
            ("Ward",              Ward),
            ("ClinicSchedule",    ClinicSchedule),
            ("Clinic",            Clinic),
            ("ClinicalUnit",      ClinicalUnit),
            ("NoteTemplate",      NoteTemplate),
            ("LabTestCatalog",    LabTestCatalog),
            ("Service",           Service),
            ("ServiceCategory",   ServiceCategory),
            ("AppointmentType",   AppointmentType),
            ("InsurancePlan",     InsurancePlan),
            ("InsuranceProvider", InsuranceProvider),
            ("Department",        Department),
            ("Facility",          Facility),
            ("User",              User),
        ]

        for label, Model in ORDER:
            pks = manifest.data.get(label, [])
            if not pks:
                continue
            deleted, _ = Model.objects.filter(pk__in=pks).delete()
            self.stdout.write(f"  Deleted {deleted:>6,} {label} records")

        manifest.path.unlink(missing_ok=True)
        self.stdout.write(self.style.SUCCESS("\nRollback complete. Manifest deleted."))

    # ------------------------------------------------------------------
    # DRY RUN
    # ------------------------------------------------------------------

    def _dry_run(self, n_facilities: int, n_patients: int, n_years: int) -> None:
        avg_op = sum(
            (lo + hi) / 2 * w for arch, (lo, hi, *_) in
            [(k, (v["op"][0], v["op"][1])) for k, v in ARCHETYPE.items()]
            for w in [ARCHETYPE_WEIGHTS[arch]]
        ) / sum(ARCHETYPE_WEIGHTS.values()) * n_years
        est_encounters = int(n_patients * avg_op)
        est_admissions = int(n_patients * sum(v["adm"] * ARCHETYPE_WEIGHTS[k] for k, v in ARCHETYPE.items()) / sum(ARCHETYPE_WEIGHTS.values()) * n_years)
        est_labs = int(est_encounters * 0.70 * 2)
        est_invoices = est_encounters + est_admissions

        self.stdout.write(f"\n{'='*55}")
        self.stdout.write(f"  DRY RUN — Estimated record counts")
        self.stdout.write(f"{'='*55}")
        self.stdout.write(f"  Facilities:          {n_facilities:>10,}")
        self.stdout.write(f"  Staff (total):       {n_facilities * sum(s[5] for s in STAFF_SPECS):>10,}")
        self.stdout.write(f"  Patients:            {n_patients:>10,}")
        self.stdout.write(f"  Outpatient Enc.:     {est_encounters:>10,}")
        self.stdout.write(f"  Admissions:          {est_admissions:>10,}")
        self.stdout.write(f"  Vitals:              {est_encounters + est_admissions * 3:>10,}")
        self.stdout.write(f"  Note Entries:        {est_encounters + est_admissions:>10,}")
        self.stdout.write(f"  Lab Orders:          {est_labs:>10,}")
        self.stdout.write(f"  Lab Results:         {est_labs * 2:>10,}")
        self.stdout.write(f"  Invoices:            {est_invoices:>10,}")
        self.stdout.write(f"  Payments:            {int(est_invoices * 0.8):>10,}")
        self.stdout.write(f"{'='*55}")
        self.stdout.write(f"  TOTAL (est.):        {est_encounters + est_admissions + est_labs*3 + est_invoices*2 + n_patients:>10,}")
        self.stdout.write(f"{'='*55}\n")

    # ------------------------------------------------------------------
    # UTILITIES
    # ------------------------------------------------------------------

    @staticmethod
    def _distribute(total: int, n: int) -> list[int]:
        """Distribute total across n buckets (last bucket gets remainder)."""
        base = total // n
        result = [base] * n
        result[-1] += total - base * n
        return result
