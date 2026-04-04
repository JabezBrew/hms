"""
seed_production_dataset.py
Comprehensive production data seeder for HMS.

Creates thousands of interconnected, realistic patients, staff, clinical journeys,
and billing records across multiple facilities. All data is archetype-driven so
every patient's labs, vitals, medications, and billing are medically coherent.

Usage:
    python manage.py seed_production_dataset
    python manage.py seed_production_dataset --profile large
    python manage.py seed_production_dataset --facilities 3 --patients 10000 --years 5
    python manage.py seed_production_dataset --chunk 0-2000   # seed patients 0-1999
    python manage.py seed_production_dataset --dry-run
    python manage.py seed_production_dataset --rollback --manifest /tmp/seed_manifest.json

Architecture:
    - Direct ORM + bulk_create (no HTTP overhead); ~10-20 min for 10k patients
    - Archetype-driven: each patient's entire history flows from one archetype
    - Transactions per 1000-patient batch; safe to interrupt and resume with --chunk
    - Manifest JSON records every created PK; --rollback deletes them in safe order
    - Tagged: seed engine admin user (seed_engine@hms.local) as created_by on all records
"""
from __future__ import annotations

import json
import random
import uuid
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Optional

from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import make_password
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from django.utils import timezone

from apps.appointments.models import Appointment, AppointmentType
from apps.billing.models import Invoice, InvoiceItem, Payment, PatientInsurance, Service, ServiceCategory
from apps.clinical_notes.models import NoteEntry, NoteTemplate
from apps.core.models import Department, Facility
from apps.encounters.models import Encounter, OutpatientVisit
from apps.laboratory.models import (
    LabOrder, LabOrderSequence, LabOrderTest, LabResult, LabSpecimen, LabTestCatalog,
)
from apps.nursing.models import VitalSigns
from apps.organization.models import ClinicalUnit, Clinic, UnitTypeConfig
from apps.patients.models import PatientSearchIndex
from apps.users.models import PatientProfile, PractitionerProfile, Staff
from apps.wards.models import Admission, Bed, BedAllocationLog, Ward, WardSection

User = get_user_model()

# ============================================================================
# SEED PROFILES
# ============================================================================

PROFILES = {
    "smoke":  {"facilities": 1, "patients": 50,     "years": 1},
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


def _mrn(facility_code: str, n: int, year: int) -> str:
    return f"MRN-{facility_code}-{year}-{n:07d}"


def _emp_id(facility_code: str, n: int, year: int) -> str:
    return f"EMP-{facility_code}-{year}-{n:07d}"


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
        self.data: dict[str, list] = {}
        if self.path.exists():
            self.data = json.loads(self.path.read_text())

    def add(self, model: str, pk) -> None:
        self.data.setdefault(model, []).append(str(pk))

    def add_bulk(self, model: str, pks) -> None:
        self.data.setdefault(model, []).extend(str(p) for p in pks)

    def save(self) -> None:
        self.path.write_text(json.dumps(self.data, indent=2))

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
    admin_user: object       # User
    seed_user: object        # seed engine user


# ============================================================================
# COMMAND
# ============================================================================

class Command(BaseCommand):
    help = "Seed production environment with thousands of realistic, interconnected patient records."

    def add_arguments(self, parser):
        parser.add_argument("--profile", choices=list(PROFILES), default="large",
                            help="Preset profile (smoke|small|medium|large)")
        parser.add_argument("--facilities", type=int, default=None,
                            help="Override number of facilities to create")
        parser.add_argument("--patients", type=int, default=None,
                            help="Override total number of patients")
        parser.add_argument("--years", type=int, default=None,
                            help="Override years of clinical history to generate")
        parser.add_argument("--chunk", type=str, default=None,
                            help="Seed patient range only, e.g. --chunk 0-2000")
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

        manifest = SeedManifest(options["manifest"])

        if options["rollback"]:
            self._rollback(manifest)
            return

        chunk_start, chunk_end = 0, n_patients
        if options["chunk"]:
            try:
                parts = options["chunk"].split("-")
                chunk_start, chunk_end = int(parts[0]), int(parts[1])
            except (ValueError, IndexError):
                raise CommandError("--chunk must be in format START-END, e.g. --chunk 0-2000")

        if options["dry_run"]:
            self._dry_run(n_facilities, n_patients, n_years)
            return

        self.stdout.write(self.style.SUCCESS(
            f"\n{'='*60}\n"
            f"  HMS Production Seeder\n"
            f"  Profile: {options['profile']} | Facilities: {n_facilities} | Patients: {n_patients} | Years: {n_years}\n"
            f"  Chunk: {chunk_start}–{chunk_end}\n"
            f"  Manifest: {options['manifest']}\n"
            f"{'='*60}\n"
        ))

        # Step 1: Seed engine admin user (created_by anchor)
        seed_user = self._get_or_create_seed_user()
        manifest.add("User", seed_user.pk)

        # Step 2: Seed facilities & infrastructure
        facility_contexts: list[FacilityContext] = []
        fac_configs = FACILITIES_CONFIG[:n_facilities]

        for i, fac_cfg in enumerate(fac_configs):
            self.stdout.write(f"\n[Facility {i+1}/{n_facilities}] {fac_cfg['name']}")
            ctx = self._seed_facility(fac_cfg, seed_user, manifest)
            facility_contexts.append(ctx)
            self.stdout.write(self.style.SUCCESS(f"  ✓ Infrastructure seeded"))

        # Step 3: Distribute patients across facilities
        patients_per_fac = self._distribute(n_patients, n_facilities)

        for fac_idx, (ctx, n_fac_patients) in enumerate(zip(facility_contexts, patients_per_fac)):
            fac_start = sum(patients_per_fac[:fac_idx])
            fac_end   = fac_start + n_fac_patients

            # Intersect with chunk
            local_start = max(chunk_start, fac_start) - fac_start
            local_end   = min(chunk_end,   fac_end)   - fac_start
            if local_start >= local_end:
                continue

            self.stdout.write(f"\n[Facility {fac_idx+1}] Seeding patients {local_start}–{local_end} ({local_end - local_start} patients)...")

            # Process in batches of 1000
            BATCH = 1000
            for batch_start in range(local_start, local_end, BATCH):
                batch_end = min(batch_start + BATCH, local_end)
                with transaction.atomic():
                    self._seed_patient_batch(
                        ctx, fac_start + batch_start, batch_start, batch_end,
                        n_years, seed_user, manifest
                    )
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

    def _get_or_create_seed_user(self) -> User:
        user, created = User.objects.get_or_create(
            email="seed_engine@hms.local",
            defaults={
                "username": "seed_engine",
                "first_name": "Seed",
                "last_name": "Engine",
                "user_type": "admin",
                "is_staff": True,
                "password": make_password("SeedEngine!2026"),
            }
        )
        if created:
            self.stdout.write("  Created seed engine user (seed_engine@hms.local)")
        return user

    def _seed_facility(self, cfg: dict, seed_user: User, manifest: SeedManifest) -> FacilityContext:
        # --- Facility ---
        facility, _ = Facility.objects.get_or_create(
            code=cfg["code"],
            defaults={
                "name": cfg["name"],
                "facility_type": "hospital",
                "address": cfg["address"],
                "city": cfg["city"],
                "region": cfg["region"],
                "country": "Ghana",
                "status": "running",
            }
        )
        manifest.add("Facility", facility.pk)

        # --- Departments ---
        departments = {}
        for dept_name in DEPARTMENTS_CONFIG:
            dept, _ = Department.objects.get_or_create(
                name=dept_name, facility=facility,
                defaults={"code": dept_name[:10].upper().replace(" ", "-").replace("&", "AND")}
            )
            departments[dept_name] = dept
        manifest.add_bulk("Department", [d.pk for d in departments.values()])

        # --- Clinical Units (one per department, flat MPTT tree) ---
        unit_type = self._get_or_create_unit_type(seed_user)
        clinical_units = {}
        for dept_name, dept in departments.items():
            code = dept_name[:20].upper().replace(" ", "-").replace("&", "AND").replace("'", "")[:15]
            cu, _ = ClinicalUnit.objects.get_or_create(
                code=f"{cfg['code']}-{code}",
                defaults={
                    "unit_type": unit_type,
                    "core_department": dept,
                    "name": dept_name,
                    "short_name": dept_name[:30],
                    "accepts_referrals": True,
                    "accepts_admissions": True,
                }
            )
            clinical_units[dept_name] = cu
        manifest.add_bulk("ClinicalUnit", [u.pk for u in clinical_units.values()])

        # --- Clinics ---
        clinics = []
        clinic_depts = ["General Outpatient", "Internal Medicine", "Surgery",
                        "Obstetrics & Gynaecology", "Paediatrics", "Emergency Medicine"]
        for cd_name in clinic_depts:
            if cd_name not in clinical_units:
                continue
            cu = clinical_units[cd_name]
            code = f"{cfg['code']}-CLN-{cd_name[:6].upper().replace(' ', '')}"
            clinic, _ = Clinic.objects.get_or_create(
                code=code,
                facility=facility,
                defaults={
                    "department": cu,
                    "name": f"{cd_name} Clinic",
                    "accepts_walk_ins": True,
                    "operates_24_hours": cd_name == "Emergency Medicine",
                    "operating_hours_start": None if cd_name == "Emergency Medicine" else __import__("datetime").time(8, 0),
                    "operating_hours_end": None if cd_name == "Emergency Medicine" else __import__("datetime").time(17, 0),
                }
            )
            clinics.append(clinic)
        manifest.add_bulk("Clinic", [c.pk for c in clinics])

        # --- Appointment Type ---
        apt, _ = AppointmentType.objects.get_or_create(
            name=f"{cfg['code']} General Consultation",
            defaults={"duration_minutes": 30, "category": "in_person", "created_by": seed_user}
        )
        manifest.add("AppointmentType", apt.pk)

        # --- Wards & Beds ---
        wards = {}
        all_beds = []
        for wc in WARDS_CONFIG:
            dept_name = wc["dept"]
            dept = departments.get(dept_name)
            if not dept:
                dept = list(departments.values())[0]

            ward, _ = Ward.objects.get_or_create(
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
            manifest.add("Ward", ward.pk)
            wards[wc["name"]] = ward

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
                created_beds = Bed.objects.bulk_create(new_beds, ignore_conflicts=True)
                manifest.add_bulk("Bed", [b.pk for b in created_beds if b.pk])

            all_beds.extend(list(ward.beds.all()))

        # --- Lab Test Catalog ---
        lab_tests = {}
        for ltc in LAB_TESTS_CONFIG:
            lt, _ = LabTestCatalog.objects.get_or_create(
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
        manifest.add_bulk("LabTestCatalog", [lt.pk for lt in lab_tests.values()])

        # --- Service Categories & Services ---
        categories = {}
        for cat_name in SERVICE_CATEGORIES_CONFIG:
            cat, _ = ServiceCategory.objects.get_or_create(
                facility=facility, name=cat_name,
                defaults={"created_by": seed_user}
            )
            categories[cat_name] = cat
        manifest.add_bulk("ServiceCategory", [c.pk for c in categories.values()])

        services = {}
        for svc in SERVICES_CONFIG:
            cat = categories.get(svc["cat"])
            if not cat:
                continue
            code = f"{cfg['code']}-{svc['code']}"
            s, _ = Service.objects.get_or_create(
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
        manifest.add_bulk("Service", [s.pk for s in services.values()])

        # --- Note Template ---
        note_tmpl, _ = NoteTemplate.objects.get_or_create(
            facility=facility, title=f"{cfg['code']} SOAP Note",
            defaults={
                "structure": SOAP_TEMPLATE_STRUCTURE,
                "category": "soap",
                "visibility": "public",
                "is_public": True,
                "is_active": True,
            }
        )
        manifest.add("NoteTemplate", note_tmpl.pk)

        # --- Staff ---
        doctors, nurses, lab_techs = self._seed_staff(facility, departments, seed_user, manifest, cfg["code"])

        seed_user.primary_facility = facility
        seed_user.save(update_fields=["primary_facility"])
        seed_user.facilities.add(facility)

        return FacilityContext(
            facility=facility,
            departments=departments,
            clinical_units=clinical_units,
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
            admin_user=seed_user,
            seed_user=seed_user,
        )

    def _get_or_create_unit_type(self, seed_user: User) -> UnitTypeConfig:
        ut, _ = UnitTypeConfig.objects.get_or_create(
            code="department",
            defaults={
                "name": "Department",
                "can_be_root": True,
                "depth_level": 0,
                "can_have_wards": True,
                "can_admit_patients": True,
                "can_consult": True,
                "is_active": True,
            }
        )
        return ut

    def _seed_staff(self, facility, departments, seed_user, manifest, fac_code):
        doctors, nurses, lab_techs = [], [], []
        year = date.today().year
        emp_counter = getattr(self, "_emp_counter", 0)

        for spec in STAFF_SPECS:
            user_type, dept_name, specialization, position, qualification, count = spec
            dept = departments.get(dept_name)
            if not dept:
                continue

            for i in range(count):
                emp_counter += 1
                first, last, gender = _rnd_name(gender="F" if user_type == "nurse" else None)
                email = f"{first.lower()}.{last.lower()}.{fac_code.lower()}.{emp_counter}@hms.local"
                username = f"{first.lower()}{last.lower()}{emp_counter}"
                emp_id = _emp_id(fac_code, emp_counter, year)

                user, created = User.objects.get_or_create(
                    email=email,
                    defaults={
                        "username": username,
                        "first_name": first,
                        "last_name": last,
                        "user_type": user_type,
                        "gender": gender,
                        "primary_facility": facility,
                        "password": make_password("HmsStaff!2026"),
                        "is_active": True,
                    }
                )
                if created:
                    user.facilities.add(facility)
                manifest.add("User", user.pk)

                staff, _ = Staff.objects.get_or_create(
                    user=user,
                    defaults={
                        "employee_id": emp_id,
                        "department": dept_name,
                        "position": position,
                        "hire_date": date.today() - timedelta(days=_rng.randint(365, 3650)),
                        "primary_facility": facility,
                        "created_by": seed_user,
                    }
                )
                manifest.add("Staff", staff.pk)

                if user_type in ("doctor", "nurse"):
                    lic = _license(fac_code, user_type, emp_counter)
                    prac, _ = PractitionerProfile.objects.get_or_create(
                        staff=staff,
                        defaults={
                            "license_number": lic,
                            "specialization": specialization or position,
                            "qualification": qualification,
                            "created_by": seed_user,
                        }
                    )
                    manifest.add("PractitionerProfile", prac.pk)
                    if user_type == "doctor":
                        doctors.append(prac)
                    else:
                        nurses.append(prac)
                elif user_type == "lab_technician":
                    lab_techs.append(staff)

        self._emp_counter = emp_counter
        return doctors, nurses, lab_techs

    # ------------------------------------------------------------------
    # PATIENT BATCH SEEDER
    # ------------------------------------------------------------------

    def _seed_patient_batch(self, ctx: FacilityContext, global_offset: int,
                            local_start: int, local_end: int,
                            n_years: int, seed_user: User, manifest: SeedManifest):
        """Seed patients [local_start, local_end) within a single transaction."""
        facility = ctx.facility
        fac_code = facility.code
        year = date.today().year

        archetypes = list(ARCHETYPE_WEIGHTS.keys())
        weights = list(ARCHETYPE_WEIGHTS.values())

        for idx in range(local_start, local_end):
            archetype = _rng.choices(archetypes, weights=weights, k=1)[0]
            gender_override = ARCHETYPE[archetype]["gender"]
            first, last, gender = _rnd_name(gender=gender_override)
            dob = _rnd_dob(archetype)
            phone = _rnd_phone()

            mrn = _mrn(fac_code, global_offset + idx + 1, year)
            email = f"patient.{mrn.lower().replace('-', '.')}@hms.local"

            user = User(
                email=email,
                username=mrn.lower().replace("-", "."),
                first_name=first,
                last_name=last,
                user_type="patient",
                gender=gender,
                date_of_birth=dob,
                phone_number=phone,
                primary_facility=facility,
                is_active=True,
                password=make_password("Patient!2026"),
            )
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

        # Pick a primary doctor for this patient
        doctor = _rng.choice(ctx.doctors) if ctx.doctors else None
        nurse = _rng.choice(ctx.nurses) if ctx.nurses else None
        lab_tech = _rng.choice(ctx.lab_techs) if ctx.lab_techs else None
        clinic = _rng.choice(ctx.clinics) if ctx.clinics else None

        days_span = n_years * 365

        # --- OUTPATIENT ENCOUNTERS ---
        op_invoices = []
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
            clinical_unit = _rng.choice(list(ctx.clinical_units.values())) if ctx.clinical_units else None
            enc = Encounter(
                patient=patient,
                facility=facility,
                practitioner=doctor,
                clinic=clinic,
                department=clinical_unit,
                primary_team=clinical_unit,
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
                lab_result_data = self._seed_lab_order(
                    ctx, patient, enc, doctor, lab_tech, start_dt, archetype, manifest
                )

            # Billing
            if ctx.services:
                cons_svc = ctx.services.get("CONS-GEN") or ctx.services.get("CONS-SPEC")
                if cons_svc:
                    inv = self._seed_invoice(
                        ctx, patient, enc, cons_svc, start_dt, seed_user, manifest
                    )
                    op_invoices.append(inv)

        # --- INPATIENT ADMISSIONS ---
        for adm_idx in range(n_admissions):
            days_ago = _rng.randint(30, days_span)
            adm_dt = _past_dt(days_ago, max(0, days_ago - 10))
            los = _rng.randint(2, 14)  # length of stay in days
            disch_dt = adm_dt + timedelta(days=los)
            is_discharged = disch_dt < timezone.now()

            # Pick a ward appropriate for this archetype
            ward_names = WARD_BY_ARCHETYPE.get(archetype, ["Medical Ward A"])
            ward = None
            for wn in ward_names:
                w = ctx.wards.get(wn)
                if w:
                    ward = w
                    break
            if not ward:
                ward = list(ctx.wards.values())[0]

            # Find a free bed (during seeding, use round-robin by index)
            ward_beds = [b for b in ctx.beds if b.ward_id == ward.pk]
            if not ward_beds:
                continue
            bed = ward_beds[adm_idx % len(ward_beds)]

            admission_type = "maternity" if archetype == "maternity" else (
                "emergency" if archetype in ("infectious", "respiratory", "chronic_complex") and _rng.random() < 0.4
                else "elective"
            )

            adm = Admission(
                patient=patient,
                bed=bed,
                facility=facility,
                admission_date=adm_dt,
                status="discharged" if is_discharged else "admitted",
                admission_type=admission_type,
                admitting_doctor=doctor,
                daily_rate=Decimal(ward.base_rate_per_night),
                admission_notes=f"Admitted with {_rng.choice(ARCHETYPE_COMPLAINTS[archetype])}",
                discharge_notes="Condition improved. Discharged in stable condition." if is_discharged else None,
                actual_discharge_date=disch_dt if is_discharged else None,
                expected_discharge_date=adm_dt + timedelta(days=los),
                primary_team=_rng.choice(list(ctx.clinical_units.values())) if ctx.clinical_units else None,
                created_by=seed_user,
            )
            adm.save()
            manifest.add("Admission", adm.pk)

            # Inpatient Encounter linked to admission
            inpat_enc = Encounter(
                patient=patient,
                facility=facility,
                practitioner=doctor,
                admission=adm,
                encounter_type="inpatient",
                status="finished" if is_discharged else "in-progress",
                start_time=adm_dt,
                end_time=disch_dt if is_discharged else None,
                reason=_rng.choice(ARCHETYPE_COMPLAINTS[archetype]),
                admission_source="emergency" if admission_type == "emergency" else "referral",
                discharge_disposition="home" if is_discharged else None,
                primary_team=adm.primary_team,
                admitted_by_team=adm.primary_team,
                created_by=seed_user,
            )
            inpat_enc.save()
            manifest.add("Encounter", inpat_enc.pk)

            # Bed allocation log
            if is_discharged:
                bal = BedAllocationLog(
                    bed=bed,
                    facility=facility,
                    previous_status="available",
                    new_status="occupied",
                    admission=adm,
                    notes="Patient admitted",
                    created_by=seed_user,
                )
                bal.save()
                manifest.add("BedAllocationLog", bal.pk)

            # Daily vitals during admission
            for day in range(min(los, 5)):
                day_dt = adm_dt + timedelta(days=day, hours=8)
                vd = _rnd_vitals(archetype)
                vs = VitalSigns(
                    patient=patient,
                    facility=facility,
                    recorded_by=nurse or doctor,
                    encounter=inpat_enc,
                    recorded_at=day_dt,
                    **vd,
                )
                vs.save()
                manifest.add("VitalSigns", vs.pk)

            # Admission note
            if doctor:
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
                    practitioner=doctor,
                    data=adm_note_data,
                )
                ne.save()
                manifest.add("NoteEntry", ne.pk)

            # Labs during admission
            if doctor:
                self._seed_lab_order(
                    ctx, patient, inpat_enc, doctor, lab_tech, adm_dt, archetype, manifest
                )

            # Inpatient billing
            if ctx.services and is_discharged:
                ward_svc = ctx.services.get("WARD-GEN") or ctx.services.get("WARD-ICU")
                if ward_svc:
                    self._seed_invoice(ctx, patient, inpat_enc, ward_svc, disch_dt, seed_user, manifest,
                                       quantity=los, is_admission=True)

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

        # Generate order number (bypass save() auto-gen)
        order_date = order_dt.date() if hasattr(order_dt, "date") else order_dt
        seq, _ = LabOrderSequence.objects.get_or_create(date=order_date, defaults={"last_number": 0})
        seq.last_number += len(selected)
        seq.save(update_fields=["last_number"])
        order_num = f"LAB-{order_date.strftime('%Y%m%d')}-{seq.last_number:04d}"

        lab_order = LabOrder(
            order_number=order_num,
            patient=patient,
            facility=ctx.facility,
            encounter=enc,
            ordering_provider=doctor,
            priority="routine",
            status="completed",
            ordered_at=order_dt,
            collected_at=order_dt + timedelta(minutes=30),
            received_at=order_dt + timedelta(hours=1),
            completed_at=order_dt + timedelta(hours=selected[0].tat_hours if selected else 4),
        )
        lab_order.save()
        manifest.add("LabOrder", lab_order.pk)

        # Specimen
        barcode = f"SPX-{order_date.strftime('%Y%m%d')}-{_rng.randint(100000, 999999)}"
        specimen = LabSpecimen(
            barcode=barcode,
            order=lab_order,
            facility=ctx.facility,
            specimen_type=selected[0].specimen_type,
            container_type=selected[0].container_type,
            collected_at=order_dt + timedelta(minutes=30),
            collected_by=lab_tech,
            received_at=order_dt + timedelta(hours=1),
            status="stored",
        )
        specimen.save()
        manifest.add("LabSpecimen", specimen.pk)

        # Order tests + results
        for test in selected:
            ot = LabOrderTest(
                order=lab_order,
                facility=ctx.facility,
                test=test,
                status="completed",
            )
            ot.save()
            manifest.add("LabOrderTest", ot.pk)

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
                      quantity: int = 1, is_admission: bool = False) -> Optional[Invoice]:
        inv_num = f"SED-{_rng.randint(100000000000, 999999999999)}"
        unit_price = service.base_price
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

        # Payment (if paid)
        if status == "paid":
            method = _rng.choices(PAYMENT_METHODS, weights=PAYMENT_WEIGHTS, k=1)[0]
            pay = Payment(
                invoice=inv,
                payment_date=dt,
                amount=total,
                payer="patient",
                status="posted",
                payment_method=method,
                reference_number=f"REF-{_rng.randint(100000, 999999)}",
            )
            pay.save()
            manifest.add("Payment", pay.pk)

        return inv

    # ------------------------------------------------------------------
    # ROLLBACK
    # ------------------------------------------------------------------

    def _rollback(self, manifest: SeedManifest) -> None:
        if not manifest.path.exists():
            raise CommandError(f"Manifest file not found: {manifest.path}")

        self.stdout.write(self.style.WARNING(
            f"\nRolling back {manifest.total():,} records from {manifest.path}...\n"
        ))

        # Delete in reverse dependency order
        ORDER = [
            ("Payment",           Payment),
            ("InvoiceItem",       InvoiceItem),
            ("Invoice",           Invoice),
            ("LabResult",         LabResult),
            ("LabOrderTest",      LabOrderTest),
            ("LabSpecimen",       LabSpecimen),
            ("LabOrder",          LabOrder),
            ("NoteEntry",         NoteEntry),
            ("VitalSigns",        VitalSigns),
            ("BedAllocationLog",  BedAllocationLog),
            ("OutpatientVisit",   OutpatientVisit),
            ("Encounter",         Encounter),
            ("Admission",         Admission),
            ("Appointment",       Appointment),
            ("PatientProfile",    PatientProfile),
            ("PatientSearchIndex",PatientSearchIndex),
            ("PractitionerProfile", PractitionerProfile),
            ("Staff",             Staff),
            ("Bed",               Bed),
            ("Ward",              Ward),
            ("Clinic",            Clinic),
            ("ClinicalUnit",      ClinicalUnit),
            ("NoteTemplate",      NoteTemplate),
            ("LabTestCatalog",    LabTestCatalog),
            ("Service",           Service),
            ("ServiceCategory",   ServiceCategory),
            ("AppointmentType",   AppointmentType),
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
