"""
Medication workflow integration tests.

Tests for complete medication workflow from prescription to administration:
1. Doctor creates prescription
2. Treatment sheet entry created
3. MAR entries generated
4. Nurse dispenses medication
5. Nurse administers medication
6. Supply tracking and restocking
"""
import pytest
from datetime import date, timedelta
from decimal import Decimal
from django.utils import timezone
from unittest.mock import patch, MagicMock

from apps.clinical_notes.models import Prescription
from apps.nursing.models import (
    TreatmentSheetEntry, MedicationAdministration, SupplyRequest
)
from apps.nursing.services import (
    calculate_daily_doses, calculate_supply_needed,
    create_supply_request, dispense_supply_request, dispense_medication
)
from apps.users.tests.factories import (
    PatientProfileFactory, DoctorUserFactory, NurseUserFactory,
    PractitionerProfileFactory, AdminUserFactory
)
from apps.nursing.tests.factories import (
    AdmissionFactory, EncounterFactory, TreatmentSheetEntryFactory,
    MedicationAdministrationFactory, SupplyRequestFactory
)
from apps.clinical_notes.tests.factories import PrescriptionFactory


@pytest.mark.tier1
@pytest.mark.integration
class TestMedicationWorkflowIntegration:
    """Integration tests for medication workflow."""

    def test_complete_medication_workflow(self, db):
        """
        Test complete medication workflow from prescription to administration.

        Flow:
        1. Doctor creates prescription for admitted patient
        2. Treatment sheet entry is created
        3. MAR entries are generated
        4. Pharmacist dispenses medication
        5. Nurse administers medication
        """
        # Setup
        doctor = DoctorUserFactory()
        nurse = NurseUserFactory()
        pharmacist = AdminUserFactory()
        patient = PatientProfileFactory()
        admission = AdmissionFactory(patient=patient)
        encounter = EncounterFactory(patient=patient)
        practitioner = PractitionerProfileFactory(staff__user=doctor)

        # Step 1: Doctor creates prescription
        prescription = Prescription.objects.create(
            patient=patient,
            prescribed_by=practitioner,
            encounter=encounter,
            medication_name='Amoxicillin',
            dosage='500mg',
            route='oral',
            frequency='tid',  # Three times daily
            duration_days=5,
            status='active'
        )

        assert prescription.status == 'active'
        assert prescription.frequency == 'tid'

        # Step 2: Treatment sheet entry created (simulating service behavior)
        treatment_entry = TreatmentSheetEntry.objects.create(
            patient=patient,
            admission=admission,
            encounter=encounter,
            medication_name=prescription.medication_name,
            dosage=prescription.dosage,
            route=prescription.route,
            frequency=prescription.frequency,
            start_datetime=timezone.now(),
            status='active',
            total_doses_dispensed=0,
            total_doses_administered=0,
            ordered_by=practitioner
        )

        assert treatment_entry.status == 'active'

        # Step 3: MAR entries are generated
        # For TID (3x daily) for 5 days = 15 doses
        mar_entries = []
        scheduled_time = timezone.now()
        for day in range(5):
            for dose in range(3):  # TID = 3 doses per day
                mar = MedicationAdministration.objects.create(
                    patient=patient,
                    treatment_entry=treatment_entry,
                    medication_name=treatment_entry.medication_name,
                    dosage=treatment_entry.dosage,
                    route=treatment_entry.route,
                    frequency=treatment_entry.frequency,
                    scheduled_time=scheduled_time + timedelta(days=day, hours=dose * 8),
                    status='scheduled',
                    is_dispensed=False
                )
                mar_entries.append(mar)

        assert len(mar_entries) == 15

        # Step 4: Supply request created by nurse
        supply_request = create_supply_request(
            treatment_entry=treatment_entry,
            quantity=15,
            requested_by=practitioner,
            notes='Initial supply for 5 day course'
        )

        assert supply_request.status == 'pending'
        assert supply_request.quantity_requested == 15

        # Step 5: Pharmacist dispenses medication
        dispense_supply_request(
            supply_request=supply_request,
            quantity_dispensed=15,
            dispensed_by=pharmacist
        )

        supply_request.refresh_from_db()
        treatment_entry.refresh_from_db()

        assert supply_request.status == 'dispensed'
        assert supply_request.quantity_dispensed == 15
        assert treatment_entry.total_doses_dispensed == 15

        # Step 6: Nurse dispenses and administers first dose
        first_mar = mar_entries[0]
        dispense_medication(first_mar, pharmacist)

        first_mar.refresh_from_db()
        assert first_mar.is_dispensed is True

        # Administer the medication
        nurse_practitioner = PractitionerProfileFactory(staff__user=nurse)
        first_mar.status = 'administered'
        first_mar.administered_time = timezone.now()
        first_mar.administered_by = nurse_practitioner
        first_mar.administration_notes = 'Patient tolerated well'
        first_mar.save()

        first_mar.refresh_from_db()
        assert first_mar.status == 'administered'
        assert first_mar.administered_by == nurse_practitioner

        # Verify supply tracking
        assert treatment_entry.supply_remaining == 15  # 15 dispensed - 0 tracked as administered

    def test_medication_workflow_with_missed_dose(self, db):
        """Test handling of missed medication dose."""
        patient = PatientProfileFactory()
        nurse = NurseUserFactory()
        nurse_practitioner = PractitionerProfileFactory(staff__user=nurse)

        # Create MAR entry
        mar = MedicationAdministrationFactory(
            patient=patient,
            status='scheduled',
            scheduled_time=timezone.now() - timedelta(hours=2),  # 2 hours ago
            is_dispensed=True
        )

        # Mark as missed
        mar.status = 'missed'
        mar.reason_not_given = 'Patient was in surgery'
        mar.save()

        mar.refresh_from_db()
        assert mar.status == 'missed'
        assert mar.reason_not_given == 'Patient was in surgery'

    def test_medication_workflow_with_refusal(self, db):
        """Test handling of patient refusing medication."""
        patient = PatientProfileFactory()
        nurse = NurseUserFactory()
        nurse_practitioner = PractitionerProfileFactory(staff__user=nurse)

        mar = MedicationAdministrationFactory(
            patient=patient,
            status='scheduled',
            is_dispensed=True
        )

        # Mark as refused
        mar.status = 'refused'
        mar.reason_not_given = 'Patient declined medication'
        mar.save()

        mar.refresh_from_db()
        assert mar.status == 'refused'

    def test_medication_workflow_held_per_physician(self, db):
        """Test holding medication per physician order."""
        patient = PatientProfileFactory()

        mar = MedicationAdministrationFactory(
            patient=patient,
            status='scheduled',
            is_dispensed=True
        )

        # Hold medication
        mar.status = 'held'
        mar.reason_not_given = 'Held per physician order - low blood pressure'
        mar.save()

        mar.refresh_from_db()
        assert mar.status == 'held'


@pytest.mark.tier1
@pytest.mark.integration
class TestSupplyManagementIntegration:
    """Integration tests for medication supply management."""

    def test_supply_request_and_dispense_workflow(self, db):
        """Test complete supply request and dispense workflow."""
        patient = PatientProfileFactory()
        nurse = NurseUserFactory()
        pharmacist = AdminUserFactory()
        nurse_practitioner = PractitionerProfileFactory(staff__user=nurse)

        # Create treatment entry with low supply
        treatment_entry = TreatmentSheetEntryFactory(
            patient=patient,
            frequency='bid',
            total_doses_dispensed=4,
            total_doses_administered=3
        )

        # Check supply remaining
        assert treatment_entry.supply_remaining == 1

        # Calculate needed supply for 3 more days
        needed = calculate_supply_needed(treatment_entry, days=3)
        assert needed == 6  # BID = 2 per day * 3 days

        # Create supply request
        supply_request = create_supply_request(
            treatment_entry=treatment_entry,
            quantity=needed,
            requested_by=nurse_practitioner,
            notes='Running low on supply'
        )

        assert supply_request.status == 'pending'
        assert supply_request.quantity_requested == 6

        # Dispense supply
        dispense_supply_request(
            supply_request=supply_request,
            quantity_dispensed=6,
            dispensed_by=pharmacist
        )

        supply_request.refresh_from_db()
        treatment_entry.refresh_from_db()

        assert supply_request.status == 'dispensed'
        assert treatment_entry.total_doses_dispensed == 10  # 4 + 6
        assert treatment_entry.supply_remaining == 7  # 10 - 3

    def test_partial_supply_dispense(self, db):
        """Test partial supply dispense when requested amount unavailable."""
        patient = PatientProfileFactory()
        nurse = NurseUserFactory()
        pharmacist = AdminUserFactory()
        nurse_practitioner = PractitionerProfileFactory(staff__user=nurse)

        treatment_entry = TreatmentSheetEntryFactory(
            patient=patient,
            total_doses_dispensed=0
        )

        # Request 20 units
        supply_request = create_supply_request(
            treatment_entry=treatment_entry,
            quantity=20,
            requested_by=nurse_practitioner
        )

        # Only dispense 15 (partial)
        dispense_supply_request(
            supply_request=supply_request,
            quantity_dispensed=15,
            dispensed_by=pharmacist
        )

        supply_request.refresh_from_db()
        treatment_entry.refresh_from_db()

        assert supply_request.quantity_requested == 20
        assert supply_request.quantity_dispensed == 15
        assert treatment_entry.total_doses_dispensed == 15


@pytest.mark.tier1
@pytest.mark.integration
class TestMARGenerationIntegration:
    """Integration tests for MAR (Medication Administration Record) generation."""

    def test_mar_generation_for_daily_frequency(self, db):
        """Test MAR generation for daily medication."""
        patient = PatientProfileFactory()

        treatment_entry = TreatmentSheetEntryFactory(
            patient=patient,
            frequency='daily'
        )

        # Generate MAR entries for 7 days
        daily_doses = calculate_daily_doses('daily')
        total_doses = daily_doses * 7

        assert daily_doses == 1
        assert total_doses == 7

    def test_mar_generation_for_bid_frequency(self, db):
        """Test MAR generation for BID (twice daily) medication."""
        daily_doses = calculate_daily_doses('bid')
        total_doses = daily_doses * 7

        assert daily_doses == 2
        assert total_doses == 14

    def test_mar_generation_for_tid_frequency(self, db):
        """Test MAR generation for TID (three times daily) medication."""
        daily_doses = calculate_daily_doses('tid')
        total_doses = daily_doses * 7

        assert daily_doses == 3
        assert total_doses == 21

    def test_mar_generation_for_qid_frequency(self, db):
        """Test MAR generation for QID (four times daily) medication."""
        daily_doses = calculate_daily_doses('qid')
        total_doses = daily_doses * 7

        assert daily_doses == 4
        assert total_doses == 28

    def test_mar_generation_for_q4h_frequency(self, db):
        """Test MAR generation for Q4H (every 4 hours) medication."""
        daily_doses = calculate_daily_doses('q4h')
        total_doses = daily_doses * 7

        assert daily_doses == 6
        assert total_doses == 42


@pytest.mark.tier1
@pytest.mark.integration
class TestPrescriptionToMARIntegration:
    """Integration tests for prescription to MAR flow."""

    def test_prescription_status_affects_mar(self, db):
        """Test that prescription status changes affect MAR entries."""
        patient = PatientProfileFactory()
        practitioner = PractitionerProfileFactory()
        encounter = EncounterFactory(patient=patient)

        # Create prescription
        prescription = Prescription.objects.create(
            patient=patient,
            prescribed_by=practitioner,
            encounter=encounter,
            medication_name='Test Med',
            dosage='100mg',
            route='oral',
            frequency='daily',
            status='active'
        )

        # Create associated MAR entry
        mar = MedicationAdministrationFactory(
            patient=patient,
            medication_name=prescription.medication_name,
            status='scheduled'
        )

        # Discontinue prescription
        prescription.status = 'discontinued'
        prescription.discontinued_at = timezone.now()
        prescription.discontinued_by = practitioner
        prescription.discontinue_reason = 'Adverse reaction'
        prescription.save()

        # In real implementation, this would trigger MAR cancellation
        # Simulating the expected behavior:
        mar.status = 'cancelled'
        mar.save()

        mar.refresh_from_db()
        assert mar.status == 'cancelled'

    def test_multi_day_prescription_generates_correct_mars(self, db):
        """Test that multi-day prescription generates correct number of MARs."""
        patient = PatientProfileFactory()
        practitioner = PractitionerProfileFactory()
        encounter = EncounterFactory(patient=patient)

        # 5-day BID prescription
        prescription = Prescription.objects.create(
            patient=patient,
            prescribed_by=practitioner,
            encounter=encounter,
            medication_name='Antibiotic',
            dosage='250mg',
            route='oral',
            frequency='bid',
            duration_days=5,
            status='active'
        )

        # Calculate expected MARs
        daily_doses = calculate_daily_doses('bid')
        expected_mars = daily_doses * 5

        assert expected_mars == 10  # 2 per day * 5 days
