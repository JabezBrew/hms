import pytest
from datetime import timedelta
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied

from apps.core.security import check_clinical_access, get_access_flags
from apps.core.models import BreakGlassEvent
from apps.users.tests.factories import (
    AdminUserFactory,
    DoctorUserFactory,
    PatientProfileFactory,
    PractitionerProfileFactory,
)
from apps.wards.tests.factories import AdmissionFactory, WardStaffAssignmentFactory
from apps.encounters.tests.factories import EncounterFactory, EncounterCareTeamFactory
from apps.organization.tests.factories import ClinicalUnitFactory, StaffUnitAssignmentFactory


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

    def test_encounter_primary_team_grants_access(self, settings):
        """Test that user assigned to encounter's primary_team has access."""
        settings.TEAM_ACCESS_STRICT = True
        doctor_user = DoctorUserFactory()
        practitioner = PractitionerProfileFactory(staff__user=doctor_user)
        patient = PatientProfileFactory()

        # Create a clinical unit and assign the practitioner to it
        unit = ClinicalUnitFactory()
        StaffUnitAssignmentFactory(practitioner=practitioner, unit=unit, is_active=True)

        # Create an encounter with the unit as primary_team (different practitioner)
        other_practitioner = PractitionerProfileFactory()
        EncounterFactory(
            patient=patient,
            practitioner=other_practitioner,
            primary_team=unit,
            status='in-progress'
        )

        assert check_clinical_access(doctor_user, patient) is True

    def test_encounter_consulting_team_grants_access(self, settings):
        """Test that user assigned to encounter's consulting team has access."""
        settings.TEAM_ACCESS_STRICT = True
        doctor_user = DoctorUserFactory()
        practitioner = PractitionerProfileFactory(staff__user=doctor_user)
        patient = PatientProfileFactory()

        # Create a clinical unit and assign the practitioner to it
        unit = ClinicalUnitFactory()
        StaffUnitAssignmentFactory(practitioner=practitioner, unit=unit, is_active=True)

        # Create an encounter with a different primary_team
        other_unit = ClinicalUnitFactory()
        encounter = EncounterFactory(
            patient=patient,
            primary_team=other_unit,
            status='in-progress'
        )

        # Add the user's unit as a consulting team
        EncounterCareTeamFactory(
            encounter=encounter,
            team=unit,
            role='consulting',
            is_active=True
        )

        assert check_clinical_access(doctor_user, patient) is True

    def test_no_access_when_encounter_finished(self, settings):
        """Test that finished encounters don't grant team access."""
        settings.TEAM_ACCESS_STRICT = True
        doctor_user = DoctorUserFactory()
        practitioner = PractitionerProfileFactory(staff__user=doctor_user)
        patient = PatientProfileFactory()

        # Create encounter with primary_team, but status is finished
        unit = ClinicalUnitFactory()
        StaffUnitAssignmentFactory(practitioner=practitioner, unit=unit, is_active=True)
        EncounterFactory(
            patient=patient,
            primary_team=unit,
            status='finished'  # Not an active encounter status
        )

        with pytest.raises(PermissionDenied):
            check_clinical_access(doctor_user, patient)


@pytest.mark.tier1
class TestGetAccessFlags:
    """Tests for get_access_flags() - optimization hint for frontend."""

    def test_admin_gets_all_access_flags(self, settings):
        settings.TEAM_ACCESS_STRICT = True
        admin = AdminUserFactory()
        patient = PatientProfileFactory()

        flags = get_access_flags(admin, patient)

        assert flags['clinical'] is True
        assert flags['lab'] is True
        assert flags['prescription'] is True
        assert flags['billing'] is True
        assert flags['demographics'] is True

    def test_doctor_without_team_access_gets_demographics_only(self, settings):
        settings.TEAM_ACCESS_STRICT = True
        doctor_user = DoctorUserFactory()
        patient = PatientProfileFactory()

        flags = get_access_flags(doctor_user, patient)

        assert flags['clinical'] is False
        assert flags['lab'] is False
        assert flags['prescription'] is False
        assert flags['demographics'] is True  # Doctors always get demographics

    def test_doctor_with_team_access_gets_clinical_flags(self, settings):
        settings.TEAM_ACCESS_STRICT = True
        doctor_user = DoctorUserFactory()
        practitioner = PractitionerProfileFactory(staff__user=doctor_user)
        patient = PatientProfileFactory()

        # Create encounter to grant team access
        EncounterFactory(patient=patient, practitioner=practitioner, status='in-progress')

        flags = get_access_flags(doctor_user, patient)

        assert flags['clinical'] is True
        assert flags['lab'] is True
        assert flags['prescription'] is True
        assert flags['demographics'] is True

    def test_break_glass_grants_clinical_flag(self, settings):
        settings.TEAM_ACCESS_STRICT = True
        doctor_user = DoctorUserFactory()
        patient = PatientProfileFactory()

        # No team access, but create break-glass event
        BreakGlassEvent.objects.create(
            user=doctor_user,
            patient=patient,
            scope='clinical',
            reason='Emergency coverage',
            expires_at=timezone.now() + timedelta(minutes=30),
        )

        flags = get_access_flags(doctor_user, patient)

        assert flags['clinical'] is True
        assert flags['lab'] is True
        assert flags['prescription'] is True
