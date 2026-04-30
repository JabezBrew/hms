import pytest
from django.core.cache import cache
from django.utils import timezone

from apps.core.cache_utils import facility_cache_key_for_code
from apps.nursing.tests.factories import (
    AdmissionFactory,
    BedFactory,
    EncounterFactory,
    CompletedNursingTaskFactory,
    TreatmentSheetEntryFactory,
    WardFactory,
)
from apps.users.models import UserPatientList


@pytest.mark.django_db
def test_ward_nurses_returns_recent_nurse_activity(
    nurse_client,
    nurse_practitioner,
    patient_profile_factory,
    default_facility,
):
    patient = patient_profile_factory(facility=default_facility)
    ward = WardFactory(department__facility=default_facility)
    bed = BedFactory(ward=ward, facility=default_facility)
    AdmissionFactory(patient=patient, bed=bed, facility=default_facility, status='admitted')
    CompletedNursingTaskFactory(
        patient=patient,
        facility=default_facility,
        completed_by=nurse_practitioner,
        completed_time=timezone.now(),
    )

    response = nurse_client.get(f'/api/nursing/monitoring/ward_nurses/?ward={ward.id}')

    assert response.status_code == 200
    returned_ids = {item['id'] for item in response.data}
    assert str(nurse_practitioner.id) in returned_ids


@pytest.mark.django_db
def test_monitoring_dashboard_clamps_page_size_and_serves_stale_cache(
    monkeypatch,
    nurse_client,
    nurse_user,
    default_facility,
):
    requested_page_size = 500
    clamped_page_size = 50
    cache_key = facility_cache_key_for_code(
        default_facility.code,
        f'nursing_dashboard_all_u{nurse_user.id}_p1_ps{clamped_page_size}',
    )
    stale_payload = {
        'count': 1,
        'page': 1,
        'page_size': clamped_page_size,
        'total_pages': 1,
        'results': [{'patient_id': 'stale-patient'}],
    }
    cache.set(f'{cache_key}_stale', stale_payload, timeout=300)
    monkeypatch.setattr("apps.nursing.views.cache.add", lambda *_args, **_kwargs: False)

    response = nurse_client.get(
        f'/api/nursing/monitoring/dashboard/?page=1&page_size={requested_page_size}'
    )

    assert response.status_code == 200
    assert response.data == stale_payload


@pytest.mark.django_db
def test_vital_signs_create_query_budget(
    monkeypatch,
    nurse_client,
    nurse_user,
    nurse_practitioner,
    patient_profile_factory,
    default_facility,
    django_assert_max_num_queries,
    django_capture_on_commit_callbacks,
):
    patient = patient_profile_factory(facility=default_facility)
    encounter = EncounterFactory(
        patient=patient,
        facility=default_facility,
        practitioner=nurse_practitioner,
        created_by=nurse_user,
        status='in-progress',
    )
    monkeypatch.setattr('apps.audit.services.log_audit_async.delay', lambda *args, **kwargs: None)
    monkeypatch.setattr('apps.nursing.signals.get_channel_layer', lambda: None)

    payload = {
        'patient': str(patient.id),
        'encounter': str(encounter.id),
        'temperature': '37.2',
        'heart_rate': 84,
        'blood_pressure_systolic': 118,
        'blood_pressure_diastolic': 76,
        'respiratory_rate': 16,
        'oxygen_saturation': 98,
        'notes': 'Routine round',
    }

    with django_assert_max_num_queries(35):
        with django_capture_on_commit_callbacks(execute=True):
            response = nurse_client.post('/api/nursing/vital-signs/', payload, format='json')

    assert response.status_code == 201
    assert response.data['encounter_created'] is False


@pytest.mark.django_db
def test_treatment_sheet_list_scopes_to_accessible_patients_when_strict(
    settings,
    nurse_client,
    nurse_user,
    patient_profile_factory,
    default_facility,
):
    settings.TEAM_ACCESS_STRICT = True
    allowed_patient = patient_profile_factory(facility=default_facility)
    blocked_patient = patient_profile_factory(facility=default_facility)
    allowed_entry = TreatmentSheetEntryFactory(
        patient=allowed_patient,
        facility=default_facility,
    )
    blocked_entry = TreatmentSheetEntryFactory(
        patient=blocked_patient,
        facility=default_facility,
    )
    UserPatientList.objects.create(user=nurse_user, patient=allowed_patient)

    response = nurse_client.get('/api/nursing/treatment-sheet/')

    assert response.status_code == 200
    returned_ids = {item['id'] for item in response.data['results']}
    assert str(allowed_entry.id) in returned_ids
    assert str(blocked_entry.id) not in returned_ids
