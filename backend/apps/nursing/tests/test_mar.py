"""
Medication Administration Record (MAR) tests for nursing app.

Tests for:
- MAR entry creation and scheduling
- Medication administration tracking
- Status workflow (scheduled → administered/missed/refused/held)
- Overdue medication alerts
- Dispensing workflow
"""
import pytest
from datetime import timedelta
from django.utils import timezone

from apps.nursing.models import MedicationAdministration, NursingAlert
from apps.users.tests.factories import PatientProfileFactory, PractitionerProfileFactory
from .factories import (
    MedicationAdministrationFactory, AdministeredMedicationFactory,
    OverdueMedicationFactory
)


@pytest.mark.tier1
@pytest.mark.critical
class TestMAREntryCreation:
    """Tests for MAR entry creation."""

    def test_mar_entry_creation(self, db):
        """Test creating a MAR entry with all fields."""
        prescriber = PractitionerProfileFactory()
        mar_entry = MedicationAdministrationFactory(
            medication_name='Paracetamol',
            dosage='500mg',
            route='Oral',
            frequency='QID',
            prescribed_by=prescriber
        )

        assert mar_entry.medication_name == 'Paracetamol'
        assert mar_entry.dosage == '500mg'
        assert mar_entry.route == 'Oral'
        assert mar_entry.frequency == 'QID'
        assert mar_entry.prescribed_by == prescriber
        assert mar_entry.status == 'scheduled'

    def test_mar_entry_string_representation(self, db):
        """Test __str__ returns patient, medication, and time."""
        mar_entry = MedicationAdministrationFactory(
            medication_name='Amoxicillin'
        )

        str_repr = str(mar_entry)
        assert mar_entry.patient.user.get_full_name() in str_repr
        assert 'Amoxicillin' in str_repr

    def test_initial_status_is_scheduled(self, db):
        """Test new MAR entries start with scheduled status."""
        mar_entry = MedicationAdministrationFactory()
        assert mar_entry.status == 'scheduled'

    def test_initial_dispensed_is_false(self, db):
        """Test new MAR entries start as not dispensed."""
        mar_entry = MedicationAdministrationFactory()
        assert mar_entry.is_dispensed is False


@pytest.mark.tier1
@pytest.mark.critical
class TestMARStatusWorkflow:
    """Tests for MAR status workflow."""

    def test_all_status_values_valid(self, db):
        """Test all status values can be set."""
        statuses = [
            'scheduled', 'administered', 'missed',
            'refused', 'held', 'cancelled'
        ]

        for status in statuses:
            mar = MedicationAdministrationFactory(status=status)
            assert mar.status == status

    def test_status_transition_to_administered(self, db):
        """Test MAR can transition to administered."""
        mar = MedicationAdministrationFactory(status='scheduled')
        nurse = PractitionerProfileFactory()

        mar.status = 'administered'
        mar.administered_time = timezone.now()
        mar.administered_by = nurse
        mar.administration_notes = 'Patient tolerated well'
        mar.save()

        mar.refresh_from_db()
        assert mar.status == 'administered'
        assert mar.administered_by == nurse
        assert mar.administered_time is not None

    def test_status_transition_to_missed(self, db):
        """Test MAR can transition to missed with reason."""
        mar = MedicationAdministrationFactory(status='scheduled')

        mar.status = 'missed'
        mar.reason_not_given = 'Patient was in surgery'
        mar.save()

        mar.refresh_from_db()
        assert mar.status == 'missed'
        assert mar.reason_not_given == 'Patient was in surgery'

    def test_status_transition_to_refused(self, db):
        """Test MAR can transition to refused with reason."""
        mar = MedicationAdministrationFactory(status='scheduled')

        mar.status = 'refused'
        mar.reason_not_given = 'Patient declined medication'
        mar.save()

        mar.refresh_from_db()
        assert mar.status == 'refused'

    def test_status_transition_to_held(self, db):
        """Test MAR can transition to held with reason."""
        mar = MedicationAdministrationFactory(status='scheduled')

        mar.status = 'held'
        mar.reason_not_given = 'Held per physician order - low BP'
        mar.save()

        mar.refresh_from_db()
        assert mar.status == 'held'


@pytest.mark.tier1
class TestMARAdministration:
    """Tests for medication administration."""

    def test_administered_medication_factory(self, db):
        """Test administered medication factory."""
        mar = AdministeredMedicationFactory()

        assert mar.status == 'administered'
        assert mar.administered_time is not None
        assert mar.administered_by is not None
        assert mar.is_dispensed is True

    def test_administration_requires_dispensed(self, db):
        """Test that medications should be dispensed before administration."""
        mar = MedicationAdministrationFactory(is_dispensed=False)

        # In real workflow, medication should be dispensed first
        assert mar.is_dispensed is False

        # Dispense first
        mar.is_dispensed = True
        mar.dispensed_at = timezone.now()
        mar.save()

        # Then administer
        mar.status = 'administered'
        mar.administered_time = timezone.now()
        mar.administered_by = PractitionerProfileFactory()
        mar.save()

        mar.refresh_from_db()
        assert mar.status == 'administered'
        assert mar.is_dispensed is True

    def test_administration_notes_stored(self, db):
        """Test administration notes are stored."""
        mar = AdministeredMedicationFactory(
            administration_notes='Given with food as directed'
        )

        assert mar.administration_notes == 'Given with food as directed'


@pytest.mark.tier1
class TestMAROverdueDetection:
    """Tests for overdue medication detection and alerting."""

    def test_overdue_medication_factory(self, db):
        """Test overdue medication factory."""
        mar = OverdueMedicationFactory()

        assert mar.status == 'scheduled'
        assert mar.scheduled_time < timezone.now()

    def test_overdue_medication_alert_creation(self, db):
        """Test overdue medications can trigger alerts."""
        patient = PatientProfileFactory()

        # Create a significantly overdue medication (>30 min)
        scheduled_time = timezone.now() - timedelta(minutes=45)

        # Clear existing alerts
        NursingAlert.objects.filter(patient=patient).delete()

        mar = MedicationAdministration.objects.create(
            patient=patient,
            medication_name='Test Medication',
            dosage='100mg',
            route='Oral',
            frequency='daily',
            scheduled_time=scheduled_time,
            status='scheduled',
            is_dispensed=False,
            created_by=None
        )

        # Alert should be created for overdue medication
        alert = NursingAlert.objects.filter(
            patient=patient,
            alert_type='medication'
        ).first()

        assert alert is not None
        assert 'overdue' in alert.message.lower()


@pytest.mark.tier1
class TestMARDispensing:
    """Tests for medication dispensing workflow."""

    def test_mark_as_dispensed(self, db):
        """Test marking medication as dispensed."""
        from apps.users.tests.factories import AdminUserFactory

        mar = MedicationAdministrationFactory(is_dispensed=False)
        pharmacist = AdminUserFactory()

        mar.is_dispensed = True
        mar.dispensed_at = timezone.now()
        mar.dispensed_by = pharmacist
        mar.save()

        mar.refresh_from_db()
        assert mar.is_dispensed is True
        assert mar.dispensed_by == pharmacist
        assert mar.dispensed_at is not None

    def test_dispensed_status_before_admin(self, db):
        """Test medication can be administered after dispensing."""
        mar = MedicationAdministrationFactory(is_dispensed=True)

        assert mar.is_dispensed is True
        assert mar.status == 'scheduled'


@pytest.mark.tier1
class TestMAROrdering:
    """Tests for MAR ordering."""

    def test_mar_ordered_by_scheduled_time(self, db):
        """Test MAR entries are ordered by scheduled_time."""
        patient = PatientProfileFactory()
        now = timezone.now()

        mar1 = MedicationAdministrationFactory(
            patient=patient,
            scheduled_time=now
        )
        mar2 = MedicationAdministrationFactory(
            patient=patient,
            scheduled_time=now + timedelta(hours=2)
        )
        mar3 = MedicationAdministrationFactory(
            patient=patient,
            scheduled_time=now + timedelta(hours=1)
        )

        meds = list(MedicationAdministration.objects.filter(patient=patient))

        assert meds[0].scheduled_time <= meds[1].scheduled_time
        assert meds[1].scheduled_time <= meds[2].scheduled_time


@pytest.mark.tier1
class TestMARIndexes:
    """Tests for database indexes on MAR."""

    def test_patient_scheduled_time_status_index(self, db):
        """Test patient + scheduled_time + status index exists."""
        indexes = MedicationAdministration._meta.indexes
        indexed_fields = [tuple(idx.fields) for idx in indexes]

        assert ('patient', 'scheduled_time', 'status') in indexed_fields

    def test_status_scheduled_time_index(self, db):
        """Test status + scheduled_time index exists."""
        indexes = MedicationAdministration._meta.indexes
        indexed_fields = [tuple(idx.fields) for idx in indexes]

        assert ('status', 'scheduled_time') in indexed_fields

    def test_administered_by_time_index(self, db):
        """Test administered_by + administered_time index exists."""
        indexes = MedicationAdministration._meta.indexes
        indexed_fields = [tuple(idx.fields) for idx in indexes]

        assert ('administered_by', 'administered_time') in indexed_fields


@pytest.mark.tier1
class TestMARFrequencies:
    """Tests for medication frequency handling."""

    def test_various_frequencies(self, db):
        """Test various medication frequencies can be stored."""
        frequencies = [
            'once', 'daily', 'bid', 'tid', 'qid',
            'q4h', 'q6h', 'q8h', 'q12h', 'prn', 'stat'
        ]

        for freq in frequencies:
            mar = MedicationAdministrationFactory(frequency=freq)
            assert mar.frequency == freq


@pytest.mark.tier1
class TestMARRoutes:
    """Tests for medication route handling."""

    def test_various_routes(self, db):
        """Test various medication routes can be stored."""
        routes = [
            'Oral', 'IV', 'IM', 'SC', 'Topical',
            'Rectal', 'Sublingual', 'Inhaled'
        ]

        for route in routes:
            mar = MedicationAdministrationFactory(route=route)
            assert mar.route == route
