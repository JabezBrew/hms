"""
Fluid Balance tests for nursing app.

Tests for:
- Fluid balance entry creation (intake/output)
- Category validation based on entry type
- Volume validation
- Daily balance calculations
- API endpoints (list, create, summary, today_balance)
"""
import pytest
from datetime import date, timedelta
from django.utils import timezone
from django.core.exceptions import ValidationError
from rest_framework import status
from rest_framework.test import APIClient

from apps.nursing.models import FluidBalance
from apps.users.tests.factories import (
    PatientProfileFactory, PractitionerProfileFactory,
    NurseUserFactory, DoctorUserFactory, AdminUserFactory
)
from .factories import (
    FluidBalanceFactory, FluidBalanceIntakeFactory,
    FluidBalanceOutputFactory, AdmissionFactory
)


@pytest.fixture(autouse=True)
def disable_team_access_strict(settings):
    settings.TEAM_ACCESS_STRICT = False


def configure_facility_header(client, user):
    facility = getattr(user, 'primary_facility', None)
    if facility:
        client.credentials(HTTP_X_FACILITY_CODE=facility.code)


# =============================================================================
# Model Tests
# =============================================================================

@pytest.mark.tier1
class TestFluidBalanceModel:
    """Tests for FluidBalance model creation and validation."""

    def test_fluid_balance_creation_intake(self, db):
        """Test creating a fluid intake record with all fields."""
        entry = FluidBalanceIntakeFactory(
            entry_type='intake',
            category='oral',
            subcategory='Water',
            volume_ml=250
        )

        assert entry.entry_type == 'intake'
        assert entry.category == 'oral'
        assert entry.subcategory == 'Water'
        assert entry.volume_ml == 250
        assert entry.patient is not None
        assert entry.recorded_by is not None

    def test_fluid_balance_creation_output(self, db):
        """Test creating a fluid output record with all fields."""
        entry = FluidBalanceOutputFactory(
            entry_type='output',
            category='urine',
            volume_ml=400
        )

        assert entry.entry_type == 'output'
        assert entry.category == 'urine'
        assert entry.volume_ml == 400

    def test_all_intake_categories_valid(self, db):
        """Test all intake categories are accepted."""
        patient = PatientProfileFactory()
        intake_categories = ['oral', 'iv', 'enteral', 'blood']

        for category in intake_categories:
            entry = FluidBalanceIntakeFactory(
                patient=patient,
                entry_type='intake',
                category=category
            )
            assert entry.category == category

    def test_all_output_categories_valid(self, db):
        """Test all output categories are accepted."""
        patient = PatientProfileFactory()
        output_categories = ['urine', 'vomit', 'stool', 'drain', 'ng_suction', 'other']

        for category in output_categories:
            entry = FluidBalanceOutputFactory(
                patient=patient,
                entry_type='output',
                category=category
            )
            assert entry.category == category

    def test_fluid_balance_string_representation(self, db):
        """Test __str__ returns meaningful representation."""
        entry = FluidBalanceIntakeFactory(
            entry_type='intake',
            category='oral',
            volume_ml=300
        )

        str_repr = str(entry)
        assert 'intake' in str_repr.lower() or '300' in str_repr

    def test_fluid_balance_ordering(self, db):
        """Test entries are ordered by recorded_at descending."""
        patient = PatientProfileFactory()
        admission = AdmissionFactory(patient=patient)

        entry1 = FluidBalanceFactory(patient=patient, admission=admission)
        entry2 = FluidBalanceFactory(patient=patient, admission=admission)
        entry3 = FluidBalanceFactory(patient=patient, admission=admission)

        entries = list(FluidBalance.objects.filter(patient=patient))

        # Most recent should be first
        assert entries[0] == entry3

    def test_fluid_balance_admission_linkage(self, db):
        """Test fluid balance is linked to admission."""
        admission = AdmissionFactory()
        entry = FluidBalanceFactory(
            patient=admission.patient,
            admission=admission
        )

        assert entry.admission == admission
        assert entry in admission.fluid_balance_records.all()

    def test_fluid_balance_without_admission(self, db):
        """Test fluid balance can be created without admission (outpatient)."""
        patient = PatientProfileFactory()
        entry = FluidBalanceFactory(
            patient=patient,
            admission=None
        )

        assert entry.admission is None
        assert entry.patient == patient


@pytest.mark.tier1
class TestFluidBalanceValidation:
    """Tests for fluid balance validation."""

    def test_volume_min_validation(self, db):
        """Test volume minimum value validation (must be > 0)."""
        entry = FluidBalance(
            patient=PatientProfileFactory(),
            recorded_by=PractitionerProfileFactory(),
            entry_type='intake',
            category='oral',
            volume_ml=0  # Invalid - must be at least 1
        )

        with pytest.raises(ValidationError):
            entry.full_clean()

    def test_volume_max_validation(self, db):
        """Test volume maximum value validation."""
        entry = FluidBalance(
            patient=PatientProfileFactory(),
            recorded_by=PractitionerProfileFactory(),
            entry_type='intake',
            category='oral',
            volume_ml=15000  # Above maximum 10000
        )

        with pytest.raises(ValidationError):
            entry.full_clean()

    def test_valid_volume_range(self, db):
        """Test valid volume values are accepted."""
        entry = FluidBalanceIntakeFactory(volume_ml=500)
        entry.full_clean()  # Should not raise
        assert entry.volume_ml == 500

    def test_entry_type_choices(self, db):
        """Test only intake/output entry types are allowed."""
        entry = FluidBalance(
            patient=PatientProfileFactory(),
            recorded_by=PractitionerProfileFactory(),
            entry_type='invalid_type',
            category='oral',
            volume_ml=100
        )

        with pytest.raises(ValidationError):
            entry.full_clean()


@pytest.mark.tier1
class TestFluidBalanceIndexes:
    """Tests for database indexes on fluid balance."""

    def test_patient_recorded_at_index(self, db):
        """Test patient + recorded_at index exists."""
        indexes = FluidBalance._meta.indexes
        indexed_fields = [tuple(idx.fields) for idx in indexes]

        assert ('patient', '-recorded_at') in indexed_fields

    def test_admission_recorded_at_index(self, db):
        """Test admission + recorded_at index exists."""
        indexes = FluidBalance._meta.indexes
        indexed_fields = [tuple(idx.fields) for idx in indexes]

        assert ('admission', '-recorded_at') in indexed_fields


# =============================================================================
# API Tests
# =============================================================================

@pytest.mark.tier1
class TestFluidBalanceCreateAPI:
    """Tests for FluidBalance create API endpoint."""

    @pytest.fixture
    def nurse_client(self, db):
        """Create authenticated nurse client."""
        nurse_user = NurseUserFactory()
        client = APIClient()
        client.force_authenticate(user=nurse_user)
        configure_facility_header(client, nurse_user)
        return client, nurse_user

    def test_create_intake_entry(self, nurse_client):
        """Test creating an intake entry via API."""
        client, nurse_user = nurse_client
        patient = PatientProfileFactory()
        admission = AdmissionFactory(patient=patient)

        data = {
            'patient': str(patient.id),
            'admission': str(admission.id),
            'entry_type': 'intake',
            'category': 'oral',
            'subcategory': 'Water',
            'volume_ml': 250,
            'notes': 'Patient drank water with medication'
        }

        response = client.post('/api/nursing/fluid-balance/', data, format='json')

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data['entry_type'] == 'intake'
        assert response.data['category'] == 'oral'
        assert response.data['volume_ml'] == 250

    def test_create_output_entry(self, nurse_client):
        """Test creating an output entry via API."""
        client, nurse_user = nurse_client
        patient = PatientProfileFactory()

        data = {
            'patient': str(patient.id),
            'entry_type': 'output',
            'category': 'urine',
            'volume_ml': 400,
        }

        response = client.post('/api/nursing/fluid-balance/', data, format='json')

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data['entry_type'] == 'output'
        assert response.data['category'] == 'urine'

    def test_create_entry_sets_recorded_by(self, nurse_client):
        """Test that recorded_by is automatically set to current user's practitioner profile."""
        client, nurse_user = nurse_client
        patient = PatientProfileFactory()

        # Ensure nurse has a practitioner profile
        from apps.users.models import Staff
        staff = Staff.objects.filter(user=nurse_user).first()
        if staff:
            practitioner, _ = PractitionerProfileFactory._meta.model.objects.get_or_create(staff=staff)

        data = {
            'patient': str(patient.id),
            'entry_type': 'intake',
            'category': 'iv',
            'volume_ml': 1000,
        }

        response = client.post('/api/nursing/fluid-balance/', data, format='json')

        assert response.status_code == status.HTTP_201_CREATED
        # Verify entry was created
        assert FluidBalance.objects.filter(patient=patient, volume_ml=1000).exists()

    def test_create_entry_invalid_volume(self, nurse_client):
        """Test creating entry with invalid volume fails."""
        client, _ = nurse_client
        patient = PatientProfileFactory()

        data = {
            'patient': str(patient.id),
            'entry_type': 'intake',
            'category': 'oral',
            'volume_ml': -100,  # Invalid
        }

        response = client.post('/api/nursing/fluid-balance/', data, format='json')

        assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.tier1
class TestFluidBalanceListAPI:
    """Tests for FluidBalance list API endpoint."""

    @pytest.fixture
    def nurse_client(self, db):
        """Create authenticated nurse client."""
        nurse_user = NurseUserFactory()
        client = APIClient()
        client.force_authenticate(user=nurse_user)
        configure_facility_header(client, nurse_user)
        return client

    def test_list_entries_for_patient(self, nurse_client):
        """Test listing fluid balance entries for a patient."""
        client = nurse_client
        patient = PatientProfileFactory()

        # Create test entries
        FluidBalanceIntakeFactory(patient=patient)
        FluidBalanceOutputFactory(patient=patient)
        FluidBalanceIntakeFactory(patient=patient)

        response = client.get(f'/api/nursing/fluid-balance/?patient={patient.id}')

        assert response.status_code == status.HTTP_200_OK
        # Handle paginated or non-paginated response
        results = response.data.get('results', response.data)
        assert len(results) == 3

    def test_filter_by_entry_type(self, nurse_client):
        """Test filtering by entry type."""
        client = nurse_client
        patient = PatientProfileFactory()

        FluidBalanceIntakeFactory(patient=patient)
        FluidBalanceIntakeFactory(patient=patient)
        FluidBalanceOutputFactory(patient=patient)

        response = client.get(
            f'/api/nursing/fluid-balance/?patient={patient.id}&entry_type=intake'
        )

        assert response.status_code == status.HTTP_200_OK
        results = response.data.get('results', response.data)
        assert len(results) == 2
        assert all(r['entry_type'] == 'intake' for r in results)

    def test_filter_by_date(self, nurse_client):
        """Test filtering by date."""
        client = nurse_client
        patient = PatientProfileFactory()

        today = timezone.now()
        yesterday = today - timedelta(days=1)

        FluidBalanceIntakeFactory(patient=patient, recorded_at=today)
        FluidBalanceIntakeFactory(patient=patient, recorded_at=yesterday)

        response = client.get(
            f'/api/nursing/fluid-balance/?patient={patient.id}&date={today.date()}'
        )

        assert response.status_code == status.HTTP_200_OK
        results = response.data.get('results', response.data)
        assert len(results) == 1


@pytest.mark.tier1
class TestFluidBalanceSummaryAPI:
    """Tests for FluidBalance summary/totals API endpoint."""

    @pytest.fixture
    def nurse_client(self, db):
        """Create authenticated nurse client."""
        nurse_user = NurseUserFactory()
        client = APIClient()
        client.force_authenticate(user=nurse_user)
        configure_facility_header(client, nurse_user)
        return client

    def test_patient_summary_calculates_totals(self, nurse_client):
        """Test patient_summary endpoint calculates correct totals."""
        client = nurse_client
        patient = PatientProfileFactory()
        today = timezone.now()

        # Create intake entries: 250 + 500 + 1000 = 1750ml
        FluidBalanceIntakeFactory(patient=patient, volume_ml=250, recorded_at=today)
        FluidBalanceIntakeFactory(patient=patient, volume_ml=500, recorded_at=today)
        FluidBalanceIntakeFactory(patient=patient, volume_ml=1000, recorded_at=today)

        # Create output entries: 400 + 300 = 700ml
        FluidBalanceOutputFactory(patient=patient, volume_ml=400, recorded_at=today)
        FluidBalanceOutputFactory(patient=patient, volume_ml=300, recorded_at=today)

        response = client.get(
            f'/api/nursing/fluid-balance/patient_summary/?patient={patient.id}'
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.data['total_intake'] == 1750
        assert response.data['total_output'] == 700
        assert response.data['balance'] == 1050  # 1750 - 700

    def test_patient_summary_with_date(self, nurse_client):
        """Test patient_summary endpoint filters by date."""
        client = nurse_client
        patient = PatientProfileFactory()
        today = timezone.now()
        yesterday = today - timedelta(days=1)

        # Today's entries
        FluidBalanceIntakeFactory(patient=patient, volume_ml=500, recorded_at=today)
        FluidBalanceOutputFactory(patient=patient, volume_ml=200, recorded_at=today)

        # Yesterday's entries (should not be counted)
        FluidBalanceIntakeFactory(patient=patient, volume_ml=1000, recorded_at=yesterday)

        response = client.get(
            f'/api/nursing/fluid-balance/patient_summary/?patient={patient.id}&date={today.date()}'
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.data['total_intake'] == 500
        assert response.data['total_output'] == 200
        assert response.data['balance'] == 300

    def test_today_balance_endpoint(self, nurse_client):
        """Test today_balance endpoint returns today's data."""
        client = nurse_client
        patient = PatientProfileFactory()

        # Today's entries
        FluidBalanceIntakeFactory(patient=patient, volume_ml=800)
        FluidBalanceOutputFactory(patient=patient, volume_ml=500)

        response = client.get(
            f'/api/nursing/fluid-balance/today_balance/?patient={patient.id}'
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.data['total_intake'] == 800
        assert response.data['total_output'] == 500
        assert response.data['balance'] == 300

    def test_summary_with_no_entries(self, nurse_client):
        """Test summary returns zeros when no entries exist."""
        client = nurse_client
        patient = PatientProfileFactory()

        response = client.get(
            f'/api/nursing/fluid-balance/patient_summary/?patient={patient.id}'
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.data['total_intake'] == 0
        assert response.data['total_output'] == 0
        assert response.data['balance'] == 0


@pytest.mark.tier1
class TestFluidBalanceTrendAPI:
    @pytest.fixture
    def nurse_client(self, db):
        nurse_user = NurseUserFactory()
        client = APIClient()
        client.force_authenticate(user=nurse_user)
        configure_facility_header(client, nurse_user)
        return client

    def test_trends_aggregates_daily_intake_and_output(self, nurse_client):
        client = nurse_client
        patient = PatientProfileFactory()
        admission = AdmissionFactory(patient=patient)
        today = timezone.now()
        yesterday = today - timedelta(days=1)

        FluidBalanceIntakeFactory(
            patient=patient,
            admission=admission,
            volume_ml=500,
            recorded_at=yesterday,
        )
        FluidBalanceOutputFactory(
            patient=patient,
            admission=admission,
            volume_ml=250,
            recorded_at=yesterday,
        )
        FluidBalanceIntakeFactory(
            patient=patient,
            admission=admission,
            volume_ml=900,
            recorded_at=today,
        )

        response = client.get(
            f'/api/nursing/fluid-balance/trends/?patient={patient.id}&admission_id={admission.id}'
        )

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) == 2
        assert response.data[0]['intake'] == 500
        assert response.data[0]['output'] == 250
        assert response.data[0]['balance'] == 250
        assert response.data[1]['intake'] == 900
        assert response.data[1]['output'] == 0
        assert response.data[1]['balance'] == 900

    def test_trends_respects_explicit_date_range(self, nurse_client):
        client = nurse_client
        patient = PatientProfileFactory()
        admission = AdmissionFactory(patient=patient)
        today = timezone.now()
        previous_week = today - timedelta(days=7)

        FluidBalanceIntakeFactory(
            patient=patient,
            admission=admission,
            volume_ml=300,
            recorded_at=previous_week,
        )
        recent = FluidBalanceOutputFactory(
            patient=patient,
            admission=admission,
            volume_ml=150,
            recorded_at=today,
        )

        response = client.get(
            f'/api/nursing/fluid-balance/trends/?patient={patient.id}'
            f'&start_date={today.date().isoformat()}&end_date={today.date().isoformat()}'
        )

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) == 1
        assert response.data[0]['date'] == recent.recorded_at.date().isoformat()
        assert response.data[0]['output'] == 150


@pytest.mark.tier1
class TestFluidBalancePermissions:
    """Tests for FluidBalance API permissions."""

    def test_unauthenticated_access_denied(self, db):
        """Test unauthenticated users cannot access API."""
        client = APIClient()

        response = client.get('/api/nursing/fluid-balance/')

        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_nurse_can_create_entry(self, db):
        """Test nurses can create fluid balance entries."""
        nurse_user = NurseUserFactory()
        client = APIClient()
        client.force_authenticate(user=nurse_user)
        configure_facility_header(client, nurse_user)

        patient = PatientProfileFactory()
        data = {
            'patient': str(patient.id),
            'entry_type': 'intake',
            'category': 'oral',
            'volume_ml': 200,
        }

        response = client.post('/api/nursing/fluid-balance/', data, format='json')

        assert response.status_code == status.HTTP_201_CREATED

    def test_doctor_can_view_entries(self, db):
        """Test doctors can view fluid balance entries."""
        doctor_user = DoctorUserFactory()
        client = APIClient()
        client.force_authenticate(user=doctor_user)
        configure_facility_header(client, doctor_user)

        patient = PatientProfileFactory()
        FluidBalanceFactory(patient=patient)

        response = client.get(f'/api/nursing/fluid-balance/?patient={patient.id}')

        assert response.status_code == status.HTTP_200_OK


# =============================================================================
# Batch Creation Helper Tests
# =============================================================================

@pytest.mark.tier1
class TestFluidBalanceBatchHelpers:
    """Tests for batch creation helper functions."""

    def test_create_multiple_entries_for_patient(self, db):
        """Test creating multiple entries for a patient."""
        patient = PatientProfileFactory()
        admission = AdmissionFactory(patient=patient)

        entries = [
            FluidBalanceIntakeFactory(patient=patient, admission=admission)
            for _ in range(5)
        ]

        assert len(entries) == 5
        assert all(e.patient == patient for e in entries)
        assert FluidBalance.objects.filter(patient=patient).count() == 5


# =============================================================================
# Colour Field Tests
# =============================================================================

@pytest.mark.tier1
class TestFluidBalanceColourField:
    """Tests for colour field on output entries."""

    def test_output_entry_with_colour(self, db):
        """Test creating output entry with colour description."""
        entry = FluidBalanceOutputFactory(
            category='urine',
            colour='dark amber'
        )

        assert entry.colour == 'dark amber'
        entry.refresh_from_db()
        assert entry.colour == 'dark amber'

    def test_output_entry_without_colour(self, db):
        """Test output entries don't require colour."""
        entry = FluidBalanceOutputFactory(
            category='urine',
            colour=None
        )

        assert entry.colour is None

    def test_intake_entry_can_have_colour(self, db):
        """Test intake entries can optionally have colour (for flexibility)."""
        entry = FluidBalanceIntakeFactory(
            colour='clear'
        )

        assert entry.colour == 'clear'

    def test_colour_included_in_api_response(self, db):
        """Test colour field is returned in API responses."""
        nurse_user = NurseUserFactory()
        client = APIClient()
        client.force_authenticate(user=nurse_user)
        configure_facility_header(client, nurse_user)

        patient = PatientProfileFactory()
        entry = FluidBalanceOutputFactory(
            patient=patient,
            category='urine',
            colour='pale yellow'
        )

        response = client.get(f'/api/nursing/fluid-balance/?patient={patient.id}')

        assert response.status_code == status.HTTP_200_OK
        results = response.data.get('results', response.data)
        assert len(results) >= 1
        assert results[0]['colour'] == 'pale yellow'

    def test_create_entry_with_colour_via_api(self, db):
        """Test creating entry with colour via API."""
        nurse_user = NurseUserFactory()
        client = APIClient()
        client.force_authenticate(user=nurse_user)
        configure_facility_header(client, nurse_user)

        patient = PatientProfileFactory()
        data = {
            'patient': str(patient.id),
            'entry_type': 'output',
            'category': 'stool',
            'volume_ml': 150,
            'colour': 'brown'
        }

        response = client.post('/api/nursing/fluid-balance/', data, format='json')

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data['colour'] == 'brown'


# =============================================================================
# N.G. Suction Category Tests
# =============================================================================

@pytest.mark.tier1
class TestNGSuctionCategory:
    """Tests for N.G. Suction output category."""

    def test_ng_suction_category_valid(self, db):
        """Test ng_suction is accepted as output category."""
        entry = FluidBalanceOutputFactory(
            category='ng_suction',
            subcategory='Aspirate',
            volume_ml=100
        )

        assert entry.category == 'ng_suction'
        assert entry.subcategory == 'Aspirate'
        entry.full_clean()  # Should not raise

    def test_ng_suction_in_output_choices(self, db):
        """Test ng_suction is in OUTPUT_CATEGORY_CHOICES."""
        categories = [c[0] for c in FluidBalance.OUTPUT_CATEGORY_CHOICES]
        assert 'ng_suction' in categories

    def test_create_ng_suction_entry_via_api(self, db):
        """Test creating ng_suction entry via API."""
        nurse_user = NurseUserFactory()
        client = APIClient()
        client.force_authenticate(user=nurse_user)
        configure_facility_header(client, nurse_user)

        patient = PatientProfileFactory()
        data = {
            'patient': str(patient.id),
            'entry_type': 'output',
            'category': 'ng_suction',
            'subcategory': 'Drainage',
            'volume_ml': 200,
            'colour': 'greenish'
        }

        response = client.post('/api/nursing/fluid-balance/', data, format='json')

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data['category'] == 'ng_suction'
        assert response.data['colour'] == 'greenish'

    def test_ng_suction_included_in_output_breakdown(self, db):
        """Test ng_suction is included in patient summary output breakdown."""
        nurse_user = NurseUserFactory()
        client = APIClient()
        client.force_authenticate(user=nurse_user)
        configure_facility_header(client, nurse_user)

        patient = PatientProfileFactory()
        today = timezone.now()

        FluidBalanceOutputFactory(
            patient=patient, category='ng_suction', volume_ml=150, recorded_at=today
        )
        FluidBalanceOutputFactory(
            patient=patient, category='urine', volume_ml=400, recorded_at=today
        )

        response = client.get(
            f'/api/nursing/fluid-balance/patient_summary/?patient={patient.id}'
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.data['total_output'] == 550
        assert 'ng_suction' in response.data['output_breakdown']
        assert response.data['output_breakdown']['ng_suction'] == 150


# =============================================================================
# Fluid Balance Alerts Tests
# =============================================================================

@pytest.mark.tier1
class TestFluidBalanceAlerts:
    """Tests for fluid balance alert thresholds."""

    @pytest.fixture
    def nurse_client(self, db):
        """Create authenticated nurse client."""
        nurse_user = NurseUserFactory()
        client = APIClient()
        client.force_authenticate(user=nurse_user)
        configure_facility_header(client, nurse_user)
        return client

    def test_check_alerts_returns_no_alerts_when_normal(self, nurse_client):
        """Test no alerts when values are within normal range."""
        client = nurse_client
        patient = PatientProfileFactory()
        today = timezone.now()

        # Normal intake and output
        FluidBalanceIntakeFactory(patient=patient, volume_ml=2000, recorded_at=today)
        FluidBalanceOutputFactory(patient=patient, volume_ml=1800, recorded_at=today)

        response = client.get(
            f'/api/nursing/fluid-balance/check_alerts/?patient={patient.id}'
        )

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data['alerts']) == 0

    def test_low_intake_alert_triggered(self, nurse_client):
        """Test alert when intake is below threshold."""
        client = nurse_client
        patient = PatientProfileFactory()
        today = timezone.now()

        # Very low intake (below default 1500ml threshold)
        FluidBalanceIntakeFactory(patient=patient, volume_ml=500, recorded_at=today)

        response = client.get(
            f'/api/nursing/fluid-balance/check_alerts/?patient={patient.id}'
        )

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data['alerts']) >= 1

        low_intake_alert = next(
            (a for a in response.data['alerts'] if a['type'] == 'low_intake'), None
        )
        assert low_intake_alert is not None
        assert low_intake_alert['severity'] == 'warning'
        assert low_intake_alert['value'] == 500

    def test_high_output_alert_triggered(self, nurse_client):
        """Test alert when output exceeds threshold."""
        client = nurse_client
        patient = PatientProfileFactory()
        today = timezone.now()

        # Ensure enough intake to avoid low intake alert
        FluidBalanceIntakeFactory(patient=patient, volume_ml=2000, recorded_at=today)
        # Very high output (above default 3000ml threshold)
        FluidBalanceOutputFactory(patient=patient, volume_ml=3500, recorded_at=today)

        response = client.get(
            f'/api/nursing/fluid-balance/check_alerts/?patient={patient.id}'
        )

        assert response.status_code == status.HTTP_200_OK

        high_output_alert = next(
            (a for a in response.data['alerts'] if a['type'] == 'high_output'), None
        )
        assert high_output_alert is not None
        assert high_output_alert['severity'] == 'warning'
        assert high_output_alert['value'] == 3500

    def test_negative_balance_alert_triggered(self, nurse_client):
        """Test alert for negative fluid balance."""
        client = nurse_client
        patient = PatientProfileFactory()
        today = timezone.now()

        # Large negative balance (below default -500ml threshold)
        FluidBalanceIntakeFactory(patient=patient, volume_ml=500, recorded_at=today)
        FluidBalanceOutputFactory(patient=patient, volume_ml=1500, recorded_at=today)
        # Balance = 500 - 1500 = -1000ml

        response = client.get(
            f'/api/nursing/fluid-balance/check_alerts/?patient={patient.id}'
        )

        assert response.status_code == status.HTTP_200_OK

        negative_balance_alert = next(
            (a for a in response.data['alerts'] if a['type'] == 'negative_balance'), None
        )
        assert negative_balance_alert is not None
        assert negative_balance_alert['severity'] == 'critical'
        assert negative_balance_alert['value'] == -1000

    def test_check_alerts_returns_thresholds(self, nurse_client):
        """Test check_alerts returns current threshold settings."""
        client = nurse_client
        patient = PatientProfileFactory()

        response = client.get(
            f'/api/nursing/fluid-balance/check_alerts/?patient={patient.id}'
        )

        assert response.status_code == status.HTTP_200_OK
        assert 'thresholds' in response.data
        assert 'min_daily_intake_target' in response.data['thresholds']
        assert 'max_daily_output_threshold' in response.data['thresholds']
        assert 'negative_balance_alert_threshold' in response.data['thresholds']
        assert 'positive_balance_alert_threshold' in response.data['thresholds']

    def test_check_alerts_returns_summary(self, nurse_client):
        """Test check_alerts returns fluid balance summary."""
        client = nurse_client
        patient = PatientProfileFactory()
        today = timezone.now()

        FluidBalanceIntakeFactory(patient=patient, volume_ml=1000, recorded_at=today)
        FluidBalanceOutputFactory(patient=patient, volume_ml=600, recorded_at=today)

        response = client.get(
            f'/api/nursing/fluid-balance/check_alerts/?patient={patient.id}'
        )

        assert response.status_code == status.HTTP_200_OK
        assert 'summary' in response.data
        assert response.data['summary']['total_intake'] == 1000
        assert response.data['summary']['total_output'] == 600
        assert response.data['summary']['balance'] == 400

    def test_check_alerts_requires_patient_param(self, nurse_client):
        """Test check_alerts requires patient parameter."""
        client = nurse_client

        response = client.get('/api/nursing/fluid-balance/check_alerts/')

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert 'patient' in response.data.get('error', '').lower()


# =============================================================================
# Facility Fluid Balance Settings Tests
# =============================================================================

@pytest.mark.tier1
class TestFacilityFluidBalanceSettings:
    """Tests for facility fluid balance settings model and API."""

    def test_settings_singleton_pattern(self, db):
        """Test only one settings instance can exist."""
        from apps.core.models import FacilityFluidBalanceSettings

        # Get or create first instance
        settings1 = FacilityFluidBalanceSettings.get_settings()

        # Try to save a second instance - should update the first
        settings2 = FacilityFluidBalanceSettings(
            min_daily_intake_target=2000
        )
        settings2.save()

        # Should still be only one instance
        assert FacilityFluidBalanceSettings.objects.count() == 1

        # And settings should be updated
        settings1.refresh_from_db()
        assert settings1.min_daily_intake_target == 2000

    def test_settings_default_values(self, db):
        """Test settings have sensible default values."""
        from apps.core.models import FacilityFluidBalanceSettings

        settings = FacilityFluidBalanceSettings.get_settings()

        assert settings.min_daily_intake_target == 1500
        assert settings.max_daily_output_threshold == 3000
        assert settings.negative_balance_alert_threshold == -500
        assert settings.positive_balance_alert_threshold == 2000
        assert settings.enable_intake_alerts is True
        assert settings.enable_output_alerts is True
        assert settings.enable_balance_alerts is True

    def test_settings_api_endpoint(self, db):
        """Test settings API returns correct data."""
        nurse_user = NurseUserFactory()
        client = APIClient()
        client.force_authenticate(user=nurse_user)
        configure_facility_header(client, nurse_user)

        response = client.get('/api/settings/fluid-balance/')

        assert response.status_code == status.HTTP_200_OK
        assert 'min_daily_intake_target' in response.data
        assert 'enable_balance_alerts' in response.data

    def test_settings_update_requires_admin(self, db):
        """Test non-admin users cannot update settings."""
        nurse_user = NurseUserFactory()
        client = APIClient()
        client.force_authenticate(user=nurse_user)
        configure_facility_header(client, nurse_user)

        response = client.patch(
            '/api/settings/fluid-balance/update/',
            {'min_daily_intake_target': 2000},
            format='json'
        )

        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_settings_admin_can_update(self, db):
        """Test admin users can update settings."""
        admin_user = AdminUserFactory()
        client = APIClient()
        client.force_authenticate(user=admin_user)
        configure_facility_header(client, admin_user)

        response = client.patch(
            '/api/settings/fluid-balance/update/',
            {'min_daily_intake_target': 2000},
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.data['min_daily_intake_target'] == 2000
