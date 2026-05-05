"""
Pharmacy views tests.

Tests for:
- DispensingViewSet (pending, dispense, bulk-dispense, ready-for-admin)
- SupplyRequestDispensingViewSet (pending, dispense, reject, bulk-dispense)
"""
import pytest
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient
from django.utils import timezone
from datetime import timedelta

from apps.nursing.models import MedicationAdministration, SupplyRequest
from apps.users.tests.factories import (
    PatientProfileFactory, PractitionerProfileFactory,
    NurseUserFactory, PharmacistUserFactory
)
from apps.nursing.tests.factories import (
    MedicationAdministrationFactory, TreatmentSheetEntryFactory,
    SupplyRequestFactory, AdmissionFactory
)
from apps.clinical_notes.tests.factories import PrescriptionFactory


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def pharmacist_user(db):
    return PharmacistUserFactory()


@pytest.fixture
def nurse_user(db):
    return NurseUserFactory()


@pytest.fixture
def patient(db):
    return PatientProfileFactory()


@pytest.fixture
def practitioner(db):
    return PractitionerProfileFactory()


@pytest.mark.tier1
class TestDispensingViewSetPermissions:
    """Test pharmacy permissions."""

    def test_unauthenticated_user_cannot_access(self, api_client, db):
        """Test unauthenticated users cannot access dispensing endpoints."""
        response = api_client.get('/api/pharmacy/dispensing/pending/')
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_nurse_cannot_access_dispensing(self, api_client, nurse_user, db):
        """Test nurses cannot access dispensing endpoints."""
        api_client.force_authenticate(user=nurse_user)
        response = api_client.get('/api/pharmacy/dispensing/pending/')
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_pharmacist_can_access_dispensing(self, api_client, pharmacist_user, db):
        """Test pharmacists can access dispensing endpoints."""
        api_client.force_authenticate(user=pharmacist_user)
        response = api_client.get('/api/pharmacy/dispensing/pending/')
        assert response.status_code == status.HTTP_200_OK


@pytest.mark.tier1
class TestDispensingViewSetPending:
    """Test pending dispensing endpoint."""

    def test_returns_undispensed_medications(self, api_client, pharmacist_user, patient, practitioner, db):
        """Test pending endpoint returns undispensed scheduled medications."""
        api_client.force_authenticate(user=pharmacist_user)

        # Create undispensed medication
        med = MedicationAdministrationFactory(
            patient=patient,
            prescribed_by=practitioner,
            status='scheduled',
            is_dispensed=False,
            scheduled_time=timezone.now() + timedelta(hours=1)
        )

        response = api_client.get('/api/pharmacy/dispensing/pending/')
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) >= 1

        med_ids = [str(m['id']) for m in response.data]
        assert str(med.id) in med_ids

    def test_excludes_dispensed_medications(self, api_client, pharmacist_user, patient, practitioner, db):
        """Test pending endpoint excludes already dispensed medications."""
        api_client.force_authenticate(user=pharmacist_user)

        # Create dispensed medication
        med = MedicationAdministrationFactory(
            patient=patient,
            prescribed_by=practitioner,
            status='scheduled',
            is_dispensed=True,
            scheduled_time=timezone.now() + timedelta(hours=1)
        )

        response = api_client.get('/api/pharmacy/dispensing/pending/')
        assert response.status_code == status.HTTP_200_OK

        med_ids = [str(m['id']) for m in response.data]
        assert str(med.id) not in med_ids


@pytest.mark.tier1
class TestDispensingViewSetDispense:
    """Test dispense action."""

    def test_dispense_single_medication(self, api_client, pharmacist_user, patient, practitioner, db):
        """Test dispensing a single medication."""
        api_client.force_authenticate(user=pharmacist_user)

        med = MedicationAdministrationFactory(
            patient=patient,
            prescribed_by=practitioner,
            status='scheduled',
            is_dispensed=False
        )

        response = api_client.post(f'/api/pharmacy/dispensing/{med.id}/dispense/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['is_dispensed'] is True

        med.refresh_from_db()
        assert med.is_dispensed is True
        assert med.dispensed_by == pharmacist_user

    def test_cannot_dispense_already_dispensed(self, api_client, pharmacist_user, patient, practitioner, db):
        """Test cannot dispense already dispensed medication."""
        api_client.force_authenticate(user=pharmacist_user)

        med = MedicationAdministrationFactory(
            patient=patient,
            prescribed_by=practitioner,
            status='scheduled',
            is_dispensed=True
        )

        response = api_client.post(f'/api/pharmacy/dispensing/{med.id}/dispense/')
        assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.tier1
class TestDispensingViewSetBulkDispense:
    """Test bulk dispense action."""

    def test_bulk_dispense_multiple_medications(self, api_client, pharmacist_user, patient, practitioner, db):
        """Test bulk dispensing multiple medications."""
        api_client.force_authenticate(user=pharmacist_user)

        meds = [
            MedicationAdministrationFactory(
                patient=patient,
                prescribed_by=practitioner,
                status='scheduled',
                is_dispensed=False
            )
            for _ in range(3)
        ]

        response = api_client.post(
            '/api/pharmacy/dispensing/bulk-dispense/',
            {'medication_ids': [str(m.id) for m in meds]},
            format='json'
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data['dispensed_count'] == 3

        for med in meds:
            med.refresh_from_db()
            assert med.is_dispensed is True


@pytest.mark.tier1
class TestDispensingViewSetPendingGrouped:
    """Test pending-grouped endpoint (one row per prescription)."""

    def test_collapses_mars_from_same_prescription(
        self, api_client, pharmacist_user, patient, practitioner, db
    ):
        """21 MARs from one 5 mg TDS x 7 days prescription collapse to one row."""
        api_client.force_authenticate(user=pharmacist_user)

        prescription = PrescriptionFactory(
            patient=patient,
            prescribed_by=practitioner,
            medication_name='Morphine',
            dosage='5mg',
            route='oral',
            frequency='tid',
        )
        base = timezone.now() + timedelta(hours=1)
        mars = [
            MedicationAdministrationFactory(
                patient=patient,
                prescribed_by=practitioner,
                prescription=prescription,
                medication_name='Morphine',
                dosage='5mg',
                route='Oral',
                frequency='tid',
                status='scheduled',
                is_dispensed=False,
                scheduled_time=base + timedelta(hours=8 * i),
            )
            for i in range(21)
        ]

        response = api_client.get('/api/pharmacy/dispensing/pending-grouped/')
        assert response.status_code == status.HTTP_200_OK

        groups = [g for g in response.data if g['id'] == f'rx:{prescription.id}']
        assert len(groups) == 1
        group = groups[0]
        assert group['dose_count'] == 21
        assert len(group['mar_entry_ids']) == 21
        assert set(group['mar_entry_ids']) == {str(m.id) for m in mars}
        # next_due is the earliest scheduled_time
        assert group['scheduled_time'].startswith(mars[0].scheduled_time.isoformat()[:19])

    def test_groups_ad_hoc_mars_without_prescription_by_composite_key(
        self, api_client, pharmacist_user, patient, practitioner, db
    ):
        """MARs without a prescription FK group by patient+medication+dosage+route+frequency."""
        api_client.force_authenticate(user=pharmacist_user)

        shared = dict(
            patient=patient,
            prescribed_by=practitioner,
            medication_name='Paracetamol',
            dosage='500mg',
            route='Oral',
            frequency='qid',
            status='scheduled',
            is_dispensed=False,
        )
        for i in range(4):
            MedicationAdministrationFactory(
                scheduled_time=timezone.now() + timedelta(hours=6 * i),
                **shared,
            )

        response = api_client.get('/api/pharmacy/dispensing/pending-grouped/')
        assert response.status_code == status.HTTP_200_OK

        paracetamol_groups = [
            g for g in response.data
            if g['medication_name'] == 'Paracetamol' and g['dosage'] == '500mg'
        ]
        assert len(paracetamol_groups) == 1
        assert paracetamol_groups[0]['dose_count'] == 4
        assert paracetamol_groups[0]['id'].startswith('adhoc:')

    def test_bulk_dispense_with_group_mar_ids_clears_group(
        self, api_client, pharmacist_user, patient, practitioner, db
    ):
        """Posting a group's mar_entry_ids to bulk-dispense flips every dose."""
        api_client.force_authenticate(user=pharmacist_user)

        prescription = PrescriptionFactory(
            patient=patient, prescribed_by=practitioner,
            medication_name='Ibuprofen', dosage='200mg',
            route='oral', frequency='bid',
        )
        mars = [
            MedicationAdministrationFactory(
                patient=patient,
                prescribed_by=practitioner,
                prescription=prescription,
                medication_name='Ibuprofen',
                dosage='200mg',
                route='Oral',
                frequency='bid',
                status='scheduled',
                is_dispensed=False,
                scheduled_time=timezone.now() + timedelta(hours=12 * i + 1),
            )
            for i in range(6)
        ]

        response = api_client.get('/api/pharmacy/dispensing/pending-grouped/')
        group = next(g for g in response.data if g['id'] == f'rx:{prescription.id}')

        response = api_client.post(
            '/api/pharmacy/dispensing/bulk-dispense/',
            {'medication_ids': group['mar_entry_ids']},
            format='json',
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data['dispensed_count'] == 6

        for m in mars:
            m.refresh_from_db()
            assert m.is_dispensed is True


@pytest.mark.tier1
class TestSupplyRequestDispensingViewSet:
    """Test supply request dispensing endpoints."""

    def test_pending_supply_requests(self, api_client, pharmacist_user, patient, practitioner, db):
        """Test pending supply requests endpoint."""
        api_client.force_authenticate(user=pharmacist_user)

        admission = AdmissionFactory(patient=patient)
        treatment = TreatmentSheetEntryFactory(
            patient=patient,
            admission=admission,
            ordered_by=practitioner
        )
        supply_request = SupplyRequestFactory(
            treatment_entry=treatment,
            requested_by=practitioner,
            status='pending'
        )

        response = api_client.get('/api/pharmacy/supply-requests/pending/')
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) >= 1

    def test_dispense_supply_request(self, api_client, pharmacist_user, patient, practitioner, db):
        """Test dispensing a supply request."""
        api_client.force_authenticate(user=pharmacist_user)

        admission = AdmissionFactory(patient=patient)
        treatment = TreatmentSheetEntryFactory(
            patient=patient,
            admission=admission,
            ordered_by=practitioner,
            total_doses_dispensed=0
        )
        supply_request = SupplyRequestFactory(
            treatment_entry=treatment,
            requested_by=practitioner,
            status='pending',
            quantity_requested=10
        )

        response = api_client.post(
            f'/api/pharmacy/supply-requests/{supply_request.id}/dispense/',
            {'quantity_dispensed': 10},
            format='json'
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data['status'] == 'dispensed'

        supply_request.refresh_from_db()
        assert supply_request.status == 'dispensed'
        assert supply_request.quantity_dispensed == 10

    def test_reject_supply_request(self, api_client, pharmacist_user, patient, practitioner, db):
        """Test rejecting a supply request."""
        api_client.force_authenticate(user=pharmacist_user)

        admission = AdmissionFactory(patient=patient)
        treatment = TreatmentSheetEntryFactory(
            patient=patient,
            admission=admission,
            ordered_by=practitioner
        )
        supply_request = SupplyRequestFactory(
            treatment_entry=treatment,
            requested_by=practitioner,
            status='pending'
        )

        response = api_client.post(
            f'/api/pharmacy/supply-requests/{supply_request.id}/reject/',
            {'reason': 'Out of stock'},
            format='json'
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data['status'] == 'rejected'

        supply_request.refresh_from_db()
        assert supply_request.status == 'rejected'
        assert supply_request.rejection_reason == 'Out of stock'
