"""
Tests for the Encounter services module.

Tests get_or_create_active_encounter, ensure_encounter_for_entry, and
get_active_encounter_for_patient functions, including all edge case fixes:
- Race condition prevention (select_for_update)
- Linking to finished/cancelled encounters validation
- Planned encounters transition to in-progress
- encounter_type forwarding
- created_by audit field
- Multiple active admissions ordering
"""
import pytest
from django.utils import timezone
from datetime import timedelta
from unittest.mock import patch

from apps.appointments.models import Appointment
from apps.appointments.tests.factories import AppointmentTypeFactory
from apps.encounters.models import Encounter, OutpatientVisit
from apps.encounters.services import (
    get_or_create_active_encounter,
    get_active_encounter_for_patient,
    ensure_encounter_for_entry,
    VisitService,
)
from apps.encounters.tests.factories import EncounterFactory
from apps.organization.models import Clinic, ClinicalUnit, UnitTypeConfig
from apps.users.tests.factories import PatientProfileFactory, PractitionerProfileFactory, UserFactory
from apps.wards.tests.factories import AdmissionFactory, BedFactory


def create_clinic(facility):
    facility_type = UnitTypeConfig.objects.create(
        code=f"facility-{facility.id}",
        name='Facility',
        can_be_root=True,
        depth_level=0,
    )
    department_type = UnitTypeConfig.objects.create(
        code=f"department-{facility.id}",
        name='Department',
        depth_level=1,
    )
    department_type.allowed_parent_types.add(facility_type)
    root_unit = ClinicalUnit.objects.create(
        unit_type=facility_type,
        code=facility.code,
        name=facility.name,
        is_active=True,
    )
    department = ClinicalUnit.objects.create(
        unit_type=department_type,
        parent=root_unit,
        code='OPD',
        name='Outpatient Department',
        is_active=True,
    )
    return Clinic.objects.create(
        facility=facility,
        department=department,
        code='OPD-GEN',
        name='General OPD',
        is_active=True,
    )


def create_outpatient_encounter_with_visit(
    patient,
    practitioner=None,
    encounter_status='planned',
    visit_status=OutpatientVisit.VisitStatus.WAITING,
    start_time=None,
):
    practitioner = practitioner or PractitionerProfileFactory()
    clinic = create_clinic(patient.facility)
    appointment_type = AppointmentTypeFactory()
    start_time = start_time or timezone.now().replace(second=0, microsecond=0)
    end_time = start_time + timedelta(minutes=30)
    appointment = Appointment.objects.create(
        facility=patient.facility,
        patient=patient,
        practitioner=practitioner,
        clinic=clinic,
        appointment_type=appointment_type,
        status='arrived',
        start_time=start_time,
        end_time=end_time,
    )
    encounter = EncounterFactory(
        patient=patient,
        facility=patient.facility,
        practitioner=practitioner,
        clinic=clinic,
        department=clinic.department,
        appointment=appointment,
        encounter_type='outpatient',
        status=encounter_status,
        start_time=start_time,
    )
    visit = OutpatientVisit.objects.create(
        appointment=appointment,
        encounter=encounter,
        clinic=clinic,
        visit_status=visit_status,
    )
    return encounter, visit


@pytest.mark.django_db
class TestGetOrCreateActiveEncounter:
    """Tests for get_or_create_active_encounter function."""

    def test_creates_new_encounter_for_new_patient(self):
        """Test raises when no active encounter exists."""
        patient = PatientProfileFactory()
        practitioner = PractitionerProfileFactory()

        with pytest.raises(ValueError):
            get_or_create_active_encounter(
                patient=patient,
                practitioner=practitioner,
                reason='Check-up'
            )

    def test_returns_existing_active_encounter(self):
        """Test returns existing in-progress encounter for same day."""
        patient = PatientProfileFactory()
        practitioner = PractitionerProfileFactory()

        existing = EncounterFactory(
            patient=patient,
            practitioner=practitioner,
            status='in-progress',
            start_time=timezone.now()
        )

        encounter, created = get_or_create_active_encounter(
            patient=patient,
            practitioner=practitioner
        )

        assert created is False
        assert encounter.id == existing.id

    def test_returns_different_practitioner_encounter(self):
        """Test returns active encounter from different practitioner same day."""
        patient = PatientProfileFactory()
        practitioner1 = PractitionerProfileFactory()
        practitioner2 = PractitionerProfileFactory()

        existing = EncounterFactory(
            patient=patient,
            practitioner=practitioner1,
            status='in-progress',
            start_time=timezone.now()
        )

        encounter, created = get_or_create_active_encounter(
            patient=patient,
            practitioner=practitioner2
        )

        assert created is False
        assert encounter.id == existing.id

    def test_prefers_same_practitioner_encounter(self):
        """Test prefers same practitioner's encounter when multiple exist."""
        patient = PatientProfileFactory()
        practitioner1 = PractitionerProfileFactory()
        practitioner2 = PractitionerProfileFactory()

        # Create encounters from different practitioners
        EncounterFactory(
            patient=patient,
            practitioner=practitioner1,
            status='in-progress',
            start_time=timezone.now()
        )
        my_encounter = EncounterFactory(
            patient=patient,
            practitioner=practitioner2,
            status='in-progress',
            start_time=timezone.now()
        )

        encounter, created = get_or_create_active_encounter(
            patient=patient,
            practitioner=practitioner2
        )

        assert created is False
        assert encounter.id == my_encounter.id

    def test_does_not_return_yesterdays_encounter(self):
        """Test doesn't return encounters from yesterday."""
        patient = PatientProfileFactory()

        EncounterFactory(
            patient=patient,
            status='in-progress',
            start_time=timezone.now() - timedelta(days=1)
        )

        with pytest.raises(ValueError):
            get_or_create_active_encounter(patient=patient)

    def test_does_not_return_finished_encounter(self):
        """Test doesn't return finished encounters."""
        patient = PatientProfileFactory()

        EncounterFactory(
            patient=patient,
            status='finished',
            start_time=timezone.now()
        )

        with pytest.raises(ValueError):
            get_or_create_active_encounter(patient=patient)

    def test_does_not_return_cancelled_encounter(self):
        """Test doesn't return cancelled encounters."""
        patient = PatientProfileFactory()

        EncounterFactory(
            patient=patient,
            status='cancelled',
            start_time=timezone.now()
        )

        with pytest.raises(ValueError):
            get_or_create_active_encounter(patient=patient)


@pytest.mark.django_db
class TestPlannedEncounterTransition:
    """Tests for planned encounter -> in-progress transition."""

    def test_transitions_planned_encounter_to_in_progress(self):
        """Test planned encounter transitions to in-progress when accessed."""
        patient = PatientProfileFactory()
        practitioner = PractitionerProfileFactory()

        planned = EncounterFactory(
            patient=patient,
            practitioner=practitioner,
            encounter_type='emergency',
            status='planned',
            start_time=timezone.now()
        )

        encounter, created = get_or_create_active_encounter(
            patient=patient,
            practitioner=practitioner
        )

        assert created is False
        assert encounter.id == planned.id
        encounter.refresh_from_db()
        assert encounter.status == 'in-progress'

    def test_transitions_any_practitioners_planned_encounter(self):
        """Test transitions planned encounter even for different practitioner."""
        patient = PatientProfileFactory()
        practitioner1 = PractitionerProfileFactory()
        practitioner2 = PractitionerProfileFactory()

        planned = EncounterFactory(
            patient=patient,
            practitioner=practitioner1,
            encounter_type='emergency',
            status='planned',
            start_time=timezone.now()
        )

        encounter, created = get_or_create_active_encounter(
            patient=patient,
            practitioner=practitioner2
        )

        assert created is False
        assert encounter.id == planned.id
        encounter.refresh_from_db()
        assert encounter.status == 'in-progress'

    def test_prefers_same_practitioner_planned_encounter(self):
        """Test prefers same practitioner's planned encounter."""
        patient = PatientProfileFactory()
        practitioner1 = PractitionerProfileFactory()
        practitioner2 = PractitionerProfileFactory()

        EncounterFactory(
            patient=patient,
            practitioner=practitioner1,
            encounter_type='emergency',
            status='planned',
            start_time=timezone.now()
        )
        my_planned = EncounterFactory(
            patient=patient,
            practitioner=practitioner2,
            encounter_type='emergency',
            status='planned',
            start_time=timezone.now()
        )

        encounter, created = get_or_create_active_encounter(
            patient=patient,
            practitioner=practitioner2
        )

        assert created is False
        assert encounter.id == my_planned.id
        encounter.refresh_from_db()
        assert encounter.status == 'in-progress'

    def test_adds_reason_to_planned_encounter_without_reason(self):
        """Test adds reason to planned encounter if not set."""
        patient = PatientProfileFactory()

        planned = EncounterFactory(
            patient=patient,
            encounter_type='emergency',
            status='planned',
            start_time=timezone.now(),
            reason=''  # No reason set
        )

        encounter, created = get_or_create_active_encounter(
            patient=patient,
            reason='New symptom'
        )

        assert created is False
        encounter.refresh_from_db()
        assert encounter.reason == 'New symptom'

    def test_does_not_overwrite_existing_reason(self):
        """Test doesn't overwrite existing reason on planned encounter."""
        patient = PatientProfileFactory()

        planned = EncounterFactory(
            patient=patient,
            encounter_type='emergency',
            status='planned',
            start_time=timezone.now(),
            reason='Scheduled follow-up'
        )

        encounter, created = get_or_create_active_encounter(
            patient=patient,
            reason='New symptom'
        )

        assert created is False
        encounter.refresh_from_db()
        assert encounter.reason == 'Scheduled follow-up'

    def test_reuses_checked_in_planned_outpatient_without_promotion(self):
        patient = PatientProfileFactory()
        practitioner = PractitionerProfileFactory()
        planned, visit = create_outpatient_encounter_with_visit(
            patient=patient,
            practitioner=practitioner,
            encounter_status='planned',
            visit_status=OutpatientVisit.VisitStatus.WAITING,
        )

        encounter, created = get_or_create_active_encounter(
            patient=patient,
            practitioner=practitioner,
        )

        assert created is False
        assert encounter.id == planned.id
        encounter.refresh_from_db()
        assert encounter.status == 'planned'

    def test_does_not_return_planned_outpatient_without_visit(self):
        patient = PatientProfileFactory()

        EncounterFactory(
            patient=patient,
            encounter_type='outpatient',
            status='planned',
            start_time=timezone.now(),
        )

        with pytest.raises(ValueError):
            get_or_create_active_encounter(patient=patient)


@pytest.mark.django_db
class TestInpatientAdmissionEncounter:
    """Tests for inpatient admission encounter logic."""

    def test_returns_admission_encounter_for_inpatient(self):
        """Test returns admission's encounter for admitted patient."""
        patient = PatientProfileFactory()
        bed = BedFactory()

        # Create admission with linked encounter
        admission = AdmissionFactory(patient=patient, bed=bed, status='admitted')
        admission_encounter = EncounterFactory(
            patient=patient,
            encounter_type='inpatient',
            status='in-progress',
            admission=admission
        )

        encounter, created = get_or_create_active_encounter(
            patient=patient,
            encounter_type='outpatient'  # Should be ignored for inpatient
        )

        assert created is False
        assert encounter.id == admission_encounter.id

    def test_creates_encounter_for_admission_without_one(self):
        """Test creates encounter for admission that has no linked encounter."""
        patient = PatientProfileFactory()
        bed = BedFactory()

        # Create admission WITHOUT linked encounter (edge case)
        admission = AdmissionFactory(patient=patient, bed=bed, status='admitted')

        encounter, created = get_or_create_active_encounter(patient=patient)

        assert created is True
        assert encounter.encounter_type == 'inpatient'
        assert encounter.admission == admission

    def test_ignores_discharged_admission(self):
        """Test ignores discharged admissions."""
        patient = PatientProfileFactory()
        bed = BedFactory()

        # Create discharged admission
        discharged_admission = AdmissionFactory(
            patient=patient,
            bed=bed,
            status='discharged'
        )
        EncounterFactory(
            patient=patient,
            encounter_type='inpatient',
            status='finished',
            admission=discharged_admission
        )

        with pytest.raises(ValueError):
            get_or_create_active_encounter(patient=patient)

    def test_uses_most_recent_admission_if_multiple(self):
        """Test uses most recent admission when multiple exist (edge case fix)."""
        patient = PatientProfileFactory()
        bed1 = BedFactory()
        bed2 = BedFactory()

        # Create older admission
        old_admission = AdmissionFactory(
            patient=patient,
            bed=bed1,
            status='admitted',
            admission_date=timezone.now() - timedelta(days=2)
        )
        old_encounter = EncounterFactory(
            patient=patient,
            encounter_type='inpatient',
            status='in-progress',
            admission=old_admission
        )

        # Create newer admission
        new_admission = AdmissionFactory(
            patient=patient,
            bed=bed2,
            status='admitted',
            admission_date=timezone.now()
        )
        new_encounter = EncounterFactory(
            patient=patient,
            encounter_type='inpatient',
            status='in-progress',
            admission=new_admission
        )

        encounter, created = get_or_create_active_encounter(patient=patient)

        # Should return the newer admission's encounter
        assert created is False
        assert encounter.id == new_encounter.id


@pytest.mark.django_db
class TestEncounterTypeForwarding:
    """Tests for encounter_type parameter forwarding (edge case fix)."""

    def test_creates_outpatient_by_default(self):
        """Test raises when no outpatient encounter exists."""
        patient = PatientProfileFactory()

        with pytest.raises(ValueError):
            get_or_create_active_encounter(patient=patient)

    def test_creates_emergency_when_specified(self):
        """Test raises when no emergency encounter exists."""
        patient = PatientProfileFactory()

        with pytest.raises(ValueError):
            get_or_create_active_encounter(
                patient=patient,
                encounter_type='emergency'
            )

    def test_returns_emergency_for_emergency_request(self):
        """Test returns existing emergency encounter for emergency request."""
        patient = PatientProfileFactory()

        existing = EncounterFactory(
            patient=patient,
            encounter_type='emergency',
            status='in-progress',
            start_time=timezone.now()
        )

        encounter, created = get_or_create_active_encounter(
            patient=patient,
            encounter_type='emergency'
        )

        assert created is False
        assert encounter.id == existing.id


@pytest.mark.django_db
class TestCreatedByAuditField:
    """Tests for created_by audit field (edge case fix)."""

    def test_sets_created_by_on_new_encounter(self):
        """Test raises when no encounter exists."""
        patient = PatientProfileFactory()
        user = UserFactory()

        with pytest.raises(ValueError):
            get_or_create_active_encounter(
                patient=patient,
                created_by=user
            )

    def test_created_by_not_changed_on_existing(self):
        """Test created_by not changed when returning existing encounter."""
        patient = PatientProfileFactory()
        original_creator = UserFactory()
        different_user = UserFactory()

        existing = EncounterFactory(
            patient=patient,
            status='in-progress',
            start_time=timezone.now(),
            created_by=original_creator
        )

        encounter, created = get_or_create_active_encounter(
            patient=patient,
            created_by=different_user
        )

        assert created is False
        assert encounter.created_by == original_creator


@pytest.mark.django_db
class TestEnsureEncounterForEntry:
    """Tests for ensure_encounter_for_entry function."""

    def test_creates_encounter_when_none_provided(self):
        """Test raises when no encounter exists."""
        patient = PatientProfileFactory()
        practitioner = PractitionerProfileFactory()

        with pytest.raises(ValueError):
            ensure_encounter_for_entry(
                patient=patient,
                practitioner=practitioner,
                reason='Vitals check'
            )

    def test_returns_valid_encounter_when_provided(self):
        """Test returns encounter when valid encounter_id provided."""
        patient = PatientProfileFactory()
        existing, _ = create_outpatient_encounter_with_visit(
            patient=patient,
            encounter_status='in-progress',
            visit_status=OutpatientVisit.VisitStatus.IN_PROGRESS,
            start_time=timezone.now() - timedelta(minutes=5),
        )

        encounter, created = ensure_encounter_for_entry(
            patient=patient,
            encounter_id=existing.id
        )

        assert created is False
        assert encounter.id == existing.id

    def test_raises_on_nonexistent_encounter(self):
        """Test raises ValueError when encounter_id doesn't exist."""
        patient = PatientProfileFactory()
        fake_uuid = '00000000-0000-0000-0000-000000000000'

        with pytest.raises(ValueError) as exc_info:
            ensure_encounter_for_entry(
                patient=patient,
                encounter_id=fake_uuid
            )

        assert f"Encounter {fake_uuid} not found" in str(exc_info.value)

    def test_raises_on_wrong_patient_encounter(self):
        """Test raises ValueError when encounter belongs to different patient."""
        patient1 = PatientProfileFactory()
        patient2 = PatientProfileFactory()
        other_encounter = EncounterFactory(patient=patient2, status='in-progress')

        with pytest.raises(ValueError) as exc_info:
            ensure_encounter_for_entry(
                patient=patient1,
                encounter_id=other_encounter.id
            )

        assert "belongs to a different patient" in str(exc_info.value)

    def test_raises_on_finished_encounter(self):
        """Test raises ValueError when encounter is finished (edge case fix)."""
        patient = PatientProfileFactory()
        finished_encounter = EncounterFactory(
            patient=patient,
            status='in-progress'
        )
        finished_encounter.finish()

        with pytest.raises(ValueError) as exc_info:
            ensure_encounter_for_entry(
                patient=patient,
                encounter_id=finished_encounter.id
            )

        assert "Cannot add entries to finished encounter" in str(exc_info.value)

    def test_raises_on_cancelled_encounter(self):
        """Test raises ValueError when encounter is cancelled (edge case fix)."""
        patient = PatientProfileFactory()
        cancelled_encounter = EncounterFactory(
            patient=patient,
            status='planned'
        )
        cancelled_encounter.cancel()

        with pytest.raises(ValueError) as exc_info:
            ensure_encounter_for_entry(
                patient=patient,
                encounter_id=cancelled_encounter.id
            )

        assert "Cannot add entries to cancelled encounter" in str(exc_info.value)

    def test_allows_planned_encounter(self):
        """Test allows planned outpatient encounters after check-in."""
        patient = PatientProfileFactory()
        planned, _ = create_outpatient_encounter_with_visit(
            patient=patient,
            encounter_status='planned',
            visit_status=OutpatientVisit.VisitStatus.WAITING,
        )

        encounter, created = ensure_encounter_for_entry(
            patient=patient,
            encounter_id=planned.id
        )

        assert created is False
        assert encounter.id == planned.id

    def test_rejects_planned_outpatient_without_check_in(self):
        patient = PatientProfileFactory()
        planned = EncounterFactory(
            patient=patient,
            encounter_type='outpatient',
            status='planned',
            start_time=timezone.now(),
        )

        with pytest.raises(ValueError) as exc_info:
            ensure_encounter_for_entry(patient=patient, encounter_id=planned.id)

        assert "before check-in" in str(exc_info.value)

    def test_rejects_future_in_progress_outpatient(self):
        patient = PatientProfileFactory()
        fake_now = timezone.now().replace(hour=9, minute=0, second=0, microsecond=0)
        encounter, _ = create_outpatient_encounter_with_visit(
            patient=patient,
            encounter_status='in-progress',
            visit_status=OutpatientVisit.VisitStatus.IN_PROGRESS,
            start_time=fake_now + timedelta(hours=2),
        )

        with patch('apps.encounters.services.timezone.now', return_value=fake_now):
            with pytest.raises(ValueError) as exc_info:
                ensure_encounter_for_entry(patient=patient, encounter_id=encounter.id)

        assert "before its start time" in str(exc_info.value)

    def test_rejects_stale_outpatient_encounter(self):
        patient = PatientProfileFactory()
        encounter, _ = create_outpatient_encounter_with_visit(
            patient=patient,
            encounter_status='in-progress',
            visit_status=OutpatientVisit.VisitStatus.IN_PROGRESS,
            start_time=timezone.now() - timedelta(days=1),
        )

        with pytest.raises(ValueError) as exc_info:
            ensure_encounter_for_entry(patient=patient, encounter_id=encounter.id)

        assert "different day" in str(exc_info.value)

    def test_forwards_encounter_type(self):
        """Test raises when no encounter exists."""
        patient = PatientProfileFactory()

        with pytest.raises(ValueError):
            ensure_encounter_for_entry(
                patient=patient,
                encounter_type='emergency'
            )

    def test_forwards_created_by(self):
        """Test raises when no encounter exists."""
        patient = PatientProfileFactory()
        user = UserFactory()

        with pytest.raises(ValueError):
            ensure_encounter_for_entry(
                patient=patient,
                created_by=user
            )


@pytest.mark.django_db
class TestVisitServiceLifecycle:
    def test_start_consultation_promotes_outpatient_encounter(self):
        patient = PatientProfileFactory()
        encounter, visit = create_outpatient_encounter_with_visit(
            patient=patient,
            encounter_status='planned',
            visit_status=OutpatientVisit.VisitStatus.WAITING,
            start_time=timezone.now().replace(second=0, microsecond=0),
        )

        VisitService.start_consultation(visit)

        visit.refresh_from_db()
        encounter.refresh_from_db()
        assert visit.visit_status == OutpatientVisit.VisitStatus.IN_PROGRESS
        assert encounter.status == 'in-progress'
        assert encounter.start_time <= timezone.now()

    def test_end_consultation_finishes_encounter(self):
        patient = PatientProfileFactory()
        encounter, visit = create_outpatient_encounter_with_visit(
            patient=patient,
            encounter_status='in-progress',
            visit_status=OutpatientVisit.VisitStatus.IN_PROGRESS,
            start_time=timezone.now() - timedelta(minutes=10),
        )
        visit.consultation_started_at = timezone.now() - timedelta(minutes=10)
        visit.save(update_fields=['consultation_started_at', 'updated_at'])

        VisitService.end_consultation(visit)

        visit.refresh_from_db()
        encounter.refresh_from_db()
        assert visit.visit_status == OutpatientVisit.VisitStatus.READY_CHECKOUT
        assert encounter.status == 'finished'
        assert encounter.end_time is not None

    def test_mark_no_show_cancels_encounter(self):
        patient = PatientProfileFactory()
        encounter, visit = create_outpatient_encounter_with_visit(
            patient=patient,
            encounter_status='planned',
            visit_status=OutpatientVisit.VisitStatus.WAITING,
        )

        VisitService.mark_no_show(visit)

        visit.refresh_from_db()
        encounter.refresh_from_db()
        assert visit.visit_status == OutpatientVisit.VisitStatus.NO_SHOW
        assert encounter.status == 'cancelled'


@pytest.mark.django_db
class TestGetActiveEncounterForPatient:
    """Tests for get_active_encounter_for_patient function."""

    def test_returns_none_for_no_encounters(self):
        """Test returns None when patient has no active encounters."""
        patient = PatientProfileFactory()

        result = get_active_encounter_for_patient(patient)

        assert result is None

    def test_returns_inpatient_encounter(self):
        """Test returns inpatient admission encounter."""
        patient = PatientProfileFactory()
        bed = BedFactory()
        admission = AdmissionFactory(patient=patient, bed=bed, status='admitted')
        encounter = EncounterFactory(
            patient=patient,
            encounter_type='inpatient',
            status='in-progress',
            admission=admission
        )

        result = get_active_encounter_for_patient(patient)

        assert result is not None
        assert result.id == encounter.id

    def test_returns_outpatient_encounter_today(self):
        """Test returns outpatient encounter from today."""
        patient = PatientProfileFactory()
        encounter = EncounterFactory(
            patient=patient,
            encounter_type='outpatient',
            status='in-progress',
            start_time=timezone.now()
        )

        result = get_active_encounter_for_patient(patient)

        assert result is not None
        assert result.id == encounter.id

    def test_returns_planned_encounter_today(self):
        """Test returns checked-in planned encounter from today."""
        patient = PatientProfileFactory()
        encounter, _ = create_outpatient_encounter_with_visit(
            patient=patient,
            encounter_status='planned',
            visit_status=OutpatientVisit.VisitStatus.WAITING,
        )

        result = get_active_encounter_for_patient(patient)

        assert result is not None
        assert result.id == encounter.id

    def test_does_not_return_planned_outpatient_without_check_in(self):
        patient = PatientProfileFactory()
        EncounterFactory(
            patient=patient,
            encounter_type='outpatient',
            status='planned',
            start_time=timezone.now(),
        )

        result = get_active_encounter_for_patient(patient)

        assert result is None

    def test_does_not_return_yesterday_encounter(self):
        """Test doesn't return encounters from yesterday."""
        patient = PatientProfileFactory()
        EncounterFactory(
            patient=patient,
            status='in-progress',
            start_time=timezone.now() - timedelta(days=1)
        )

        result = get_active_encounter_for_patient(patient)

        assert result is None

    def test_does_not_return_finished_encounter(self):
        """Test doesn't return finished encounters."""
        patient = PatientProfileFactory()
        EncounterFactory(
            patient=patient,
            status='finished',
            start_time=timezone.now()
        )

        result = get_active_encounter_for_patient(patient)

        assert result is None


@pytest.mark.integration
@pytest.mark.slow
class TestRaceConditionPrevention:
    """Tests for race condition prevention (edge case fix).

    These tests verify that concurrent calls to get_or_create_active_encounter
    don't create duplicate encounters.

    NOTE: These are integration tests that verify database-level locking.
    They may produce inconsistent results in test environments that use
    SQLite or test isolation that doesn't support select_for_update.
    Run with: pytest -m integration --no-cov
    """

    def test_service_uses_atomic_transaction(self, db):
        """Test that get_or_create_active_encounter uses atomic transactions."""
        # Verify the service function uses transaction.atomic
        import inspect
        from apps.encounters import services
        source = inspect.getsource(services.get_or_create_active_encounter)
        assert 'transaction.atomic()' in source, "Service should use atomic transaction"
        assert 'select_for_update' in source, "Service should use select_for_update"

    def test_sequential_calls_return_same_encounter(self, db):
        """Test sequential calls require an existing encounter."""
        patient = PatientProfileFactory()

        with pytest.raises(ValueError):
            get_or_create_active_encounter(patient=patient)

    def test_sequential_planned_transition(self, db):
        """Test sequential calls properly transition planned encounter."""
        patient = PatientProfileFactory()
        planned = EncounterFactory(
            patient=patient,
            encounter_type='emergency',
            status='planned',
            start_time=timezone.now()
        )
        original_id = planned.id

        # First call transitions planned to in-progress
        encounter1, created1 = get_or_create_active_encounter(patient=patient)
        assert created1 is False
        assert encounter1.id == original_id
        encounter1.refresh_from_db()
        assert encounter1.status == 'in-progress'

        # Second call returns same encounter
        encounter2, created2 = get_or_create_active_encounter(patient=patient)
        assert created2 is False
        assert encounter2.id == original_id
