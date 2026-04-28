import pytest
from datetime import timedelta
from django.utils import timezone

from apps.users.serializers import PatientSearchListSerializer
from apps.users.tests.factories import PatientProfileFactory
from apps.wards.tests.factories import AdmissionFactory, BedFactory, WardFactory
from apps.encounters.tests.factories import EncounterFactory


@pytest.mark.tier1
def test_patient_search_list_serializer_inpatient_location_and_status(db):
    patient = PatientProfileFactory()
    ward = WardFactory(name='Medical Ward')
    bed = BedFactory(ward=ward, status='available')
    admission = AdmissionFactory(
        patient=patient,
        facility=patient.facility,
        bed=bed,
        status='admitted',
    )

    patient.active_admissions_list = [admission]
    patient.active_encounters_list = []

    data = PatientSearchListSerializer(patient).data
    assert data['current_ward'] == 'Medical Ward'
    assert data['patient_location'] == 'Medical Ward'
    assert data['admission_status'] == 'admitted'
    assert data['registry_status'] == 'admitted'
    assert data['active_clinic_names'] == []


@pytest.mark.tier1
def test_patient_search_list_serializer_outpatient_single_clinic_location(db):
    patient = PatientProfileFactory()
    encounter = EncounterFactory(
        patient=patient,
        facility=patient.facility,
        encounter_type='outpatient',
        status='in-progress',
        location='Cardiology Clinic',
    )

    patient.active_admissions_list = []
    patient.active_encounters_list = [encounter]

    data = PatientSearchListSerializer(patient).data
    assert data['current_ward'] is None
    assert data['patient_location'] == 'Cardiology Clinic'
    assert data['active_clinic_names'] == ['Cardiology Clinic']
    assert data['admission_status'] is None
    assert data['registry_status'] == 'in-progress'


@pytest.mark.tier1
def test_patient_search_list_serializer_outpatient_multiple_clinics_deduped_by_recency(db):
    patient = PatientProfileFactory()
    now = timezone.now()
    most_recent = EncounterFactory(
        patient=patient,
        facility=patient.facility,
        encounter_type='outpatient',
        status='planned',
        location='Neurology Clinic',
        start_time=now,
    )
    older = EncounterFactory(
        patient=patient,
        facility=patient.facility,
        encounter_type='outpatient',
        status='in-progress',
        location='Cardiology Clinic',
        start_time=now - timedelta(hours=1),
    )
    duplicate = EncounterFactory(
        patient=patient,
        facility=patient.facility,
        encounter_type='outpatient',
        status='planned',
        location='Neurology Clinic',
        start_time=now - timedelta(hours=2),
    )

    patient.active_admissions_list = []
    patient.active_encounters_list = [most_recent, older, duplicate]

    data = PatientSearchListSerializer(patient).data
    assert data['patient_location'] == 'Neurology Clinic'
    assert data['active_clinic_names'] == ['Neurology Clinic', 'Cardiology Clinic']
    assert data['registry_status'] == 'planned'


@pytest.mark.tier1
def test_patient_search_list_serializer_registry_status_falls_back_to_historical_annotations(db):
    terminal_patient = PatientProfileFactory()
    terminal_patient.active_admissions_list = []
    terminal_patient.active_encounters_list = []
    terminal_patient.latest_terminal_admission_status = 'transferred'
    terminal_patient.latest_completed_outpatient_status = 'finished'

    terminal_data = PatientSearchListSerializer(terminal_patient).data
    assert terminal_data['registry_status'] == 'transferred'
    assert terminal_data['patient_location'] is None

    completed_only_patient = PatientProfileFactory()
    completed_only_patient.active_admissions_list = []
    completed_only_patient.active_encounters_list = []
    completed_only_patient.latest_terminal_admission_status = None
    completed_only_patient.latest_completed_outpatient_status = 'cancelled'

    completed_data = PatientSearchListSerializer(completed_only_patient).data
    assert completed_data['registry_status'] == 'cancelled'
