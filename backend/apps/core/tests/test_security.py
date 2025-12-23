import pytest
from datetime import timedelta
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied

from apps.core.security import check_clinical_access
from apps.core.models import BreakGlassEvent
from apps.users.tests.factories import (
    AdminUserFactory,
    DoctorUserFactory,
    PatientProfileFactory,
    PractitionerProfileFactory,
)
from apps.wards.tests.factories import AdmissionFactory, WardStaffAssignmentFactory
from apps.encounters.tests.factories import EncounterFactory


@pytest.mark.tier1
class TestTeamBasedClinicalAccess:
    def test_admin_can_access_any_patient(self, settings):
        settings.TEAM_ACCESS_STRICT = True
        admin = AdminUserFactory()
        patient = PatientProfileFactory()

        assert check_clinical_access(admin, patient) is True

    def test_doctor_denied_without_team_or_break_glass(self, settings):
        settings.TEAM_ACCESS_STRICT = True
        doctor_user = DoctorUserFactory()
        patient = PatientProfileFactory()

        with pytest.raises(PermissionDenied):
            check_clinical_access(doctor_user, patient)

    def test_admitting_doctor_has_access(self, settings):
        settings.TEAM_ACCESS_STRICT = True
        doctor_user = DoctorUserFactory()
        practitioner = PractitionerProfileFactory(staff__user=doctor_user)
        patient = PatientProfileFactory()

        AdmissionFactory(patient=patient, admitting_doctor=practitioner)

        assert check_clinical_access(doctor_user, patient) is True

    def test_ward_team_member_has_access(self, settings):
        settings.TEAM_ACCESS_STRICT = True
        doctor_user = DoctorUserFactory()
        practitioner = PractitionerProfileFactory(staff__user=doctor_user)
        patient = PatientProfileFactory()

        admission = AdmissionFactory(patient=patient)
        WardStaffAssignmentFactory(ward=admission.bed.ward, practitioner=practitioner, is_active=True)

        assert check_clinical_access(doctor_user, patient) is True

    def test_encounter_practitioner_has_access(self, settings):
        settings.TEAM_ACCESS_STRICT = True
        doctor_user = DoctorUserFactory()
        practitioner = PractitionerProfileFactory(staff__user=doctor_user)
        patient = PatientProfileFactory()

        EncounterFactory(patient=patient, practitioner=practitioner, status='in-progress')

        assert check_clinical_access(doctor_user, patient) is True

    def test_break_glass_grants_access(self, settings):
        settings.TEAM_ACCESS_STRICT = True
        doctor_user = DoctorUserFactory()
        patient = PatientProfileFactory()

        BreakGlassEvent.objects.create(
            user=doctor_user,
            patient=patient,
            scope='clinical',
            reason='Emergency coverage',
            expires_at=timezone.now() + timedelta(minutes=30),
        )

        assert check_clinical_access(doctor_user, patient) is True
