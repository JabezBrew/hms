import pytest

from apps.appointments.proxies import AppointmentProxy
from apps.patients.tests.factories import PatientFHIRMappingFactory
from apps.users.tests.factories import PatientProfileFactory, PractitionerProfileFactory


@pytest.mark.django_db
def test_search_bulk_enriches_appointments_without_n_plus_one(monkeypatch, django_assert_max_num_queries):
    patient = PatientProfileFactory(fhir_patient_id='patient-fhir-1')
    PatientFHIRMappingFactory(patient_profile=patient, fhir_patient_id='patient-fhir-1')
    practitioner = PractitionerProfileFactory(fhir_practitioner_id='practitioner-fhir-1')

    monkeypatch.setattr(
        'apps.appointments.proxies.fhir_client.search_resources',
        lambda *_args, **_kwargs: {
            'entry': [
                {
                    'resource': {
                        'resourceType': 'Appointment',
                        'id': 'appt-1',
                        'participant': [
                            {'actor': {'reference': 'Patient/patient-fhir-1'}},
                            {'actor': {'reference': 'Practitioner/practitioner-fhir-1'}},
                        ],
                    }
                },
                {
                    'resource': {
                        'resourceType': 'Appointment',
                        'id': 'appt-2',
                        'participant': [
                            {'actor': {'reference': 'Patient/patient-fhir-1'}},
                            {'actor': {'reference': 'Practitioner/practitioner-fhir-1'}},
                        ],
                    }
                },
            ]
        },
    )

    with django_assert_max_num_queries(2):
        bundle = AppointmentProxy.search(date='2026-03-06')

    appointments = [entry['resource'] for entry in bundle['entry']]
    for appointment in appointments:
        patient_actor = appointment['participant'][0]['actor']
        practitioner_actor = appointment['participant'][1]['actor']
        assert patient_actor['display'] == patient.user.get_full_name()
        assert practitioner_actor['display'].startswith('Dr. ')
        assert appointment['hms_patient_context']['id'] == str(patient.id)
