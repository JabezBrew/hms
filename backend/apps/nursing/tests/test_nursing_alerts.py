"""
Nursing Alert tests for nursing app.

Tests for:
- Alert creation (critical vitals, task overdue, medication due)
- Severity levels (low, medium, high, critical)
- Alert acknowledgment
- Alert resolution with notes
- Alert history
"""
import pytest
from django.utils import timezone

from apps.nursing.models import NursingAlert, VitalSigns, NursingTask
from apps.users.tests.factories import PatientProfileFactory, PractitionerProfileFactory
from .factories import (
    NursingAlertFactory, CriticalAlertFactory,
    AcknowledgedAlertFactory, VitalSignsFactory
)


@pytest.mark.tier1
class TestNursingAlertCreation:
    """Tests for nursing alert creation."""

    def test_alert_creation_with_all_fields(self, db):
        """Test creating an alert with all fields."""
        patient = PatientProfileFactory()
        alert = NursingAlertFactory(
            patient=patient,
            alert_type='vital_signs',
            severity='high',
            message='Critical vital signs detected'
        )

        assert alert.patient == patient
        assert alert.alert_type == 'vital_signs'
        assert alert.severity == 'high'
        assert alert.message == 'Critical vital signs detected'
        assert alert.is_acknowledged is False

    def test_alert_string_representation(self, db):
        """Test __str__ returns patient, type, and severity."""
        alert = NursingAlertFactory(
            alert_type='vital_signs',
            severity='critical'
        )

        str_repr = str(alert)
        assert alert.patient.user.get_full_name() in str_repr

    def test_all_alert_types_valid(self, db):
        """Test all alert type choices can be created."""
        alert_types = [
            'vital_signs', 'medication', 'task_overdue',
            'patient_fall', 'deterioration', 'equipment', 'other'
        ]

        for alert_type in alert_types:
            alert = NursingAlertFactory(alert_type=alert_type)
            assert alert.alert_type == alert_type

    def test_all_severity_levels_valid(self, db):
        """Test all severity levels can be created."""
        severities = ['low', 'medium', 'high', 'critical']

        for severity in severities:
            alert = NursingAlertFactory(severity=severity)
            assert alert.severity == severity


@pytest.mark.tier1
class TestAlertSeverityLevels:
    """Tests for alert severity levels."""

    def test_low_severity_alert(self, db):
        """Test creating a low severity alert."""
        alert = NursingAlertFactory(severity='low')
        assert alert.severity == 'low'

    def test_medium_severity_alert(self, db):
        """Test creating a medium severity alert."""
        alert = NursingAlertFactory(severity='medium')
        assert alert.severity == 'medium'

    def test_high_severity_alert(self, db):
        """Test creating a high severity alert."""
        alert = NursingAlertFactory(severity='high')
        assert alert.severity == 'high'

    def test_critical_severity_alert(self, db):
        """Test creating a critical severity alert."""
        alert = CriticalAlertFactory()
        assert alert.severity == 'critical'


@pytest.mark.tier1
class TestAlertAcknowledgment:
    """Tests for alert acknowledgment functionality."""

    def test_new_alert_not_acknowledged(self, db):
        """Test new alerts are not acknowledged by default."""
        alert = NursingAlertFactory()

        assert alert.is_acknowledged is False
        assert alert.acknowledged_by is None
        assert alert.acknowledged_at is None

    def test_acknowledge_alert_method(self, db):
        """Test acknowledge method updates all fields."""
        alert = NursingAlertFactory()
        practitioner = PractitionerProfileFactory()

        alert.acknowledge(practitioner, notes='Alert reviewed and addressed')

        assert alert.is_acknowledged is True
        assert alert.acknowledged_by == practitioner
        assert alert.acknowledged_at is not None
        assert alert.resolution_notes == 'Alert reviewed and addressed'

    def test_acknowledge_without_notes(self, db):
        """Test acknowledge method works without notes."""
        alert = NursingAlertFactory()
        practitioner = PractitionerProfileFactory()

        alert.acknowledge(practitioner)

        assert alert.is_acknowledged is True
        assert alert.acknowledged_by == practitioner
        assert alert.resolution_notes is None

    def test_acknowledged_alert_factory(self, db):
        """Test acknowledged alert factory creates proper state."""
        alert = AcknowledgedAlertFactory()

        assert alert.is_acknowledged is True
        assert alert.acknowledged_by is not None
        assert alert.acknowledged_at is not None
        assert alert.resolution_notes is not None


@pytest.mark.tier1
class TestAlertReferences:
    """Tests for alert references to other models."""

    def test_alert_linked_to_vital_signs(self, db):
        """Test alert can be linked to vital signs."""
        vital = VitalSignsFactory()
        alert = NursingAlertFactory(
            patient=vital.patient,
            alert_type='vital_signs',
            related_vital_signs=vital
        )

        assert alert.related_vital_signs == vital

    def test_alert_linked_to_task(self, db):
        """Test alert can be linked to nursing task."""
        from .factories import NursingTaskFactory

        task = NursingTaskFactory()
        alert = NursingAlertFactory(
            patient=task.patient,
            alert_type='task_overdue',
            related_task=task
        )

        assert alert.related_task == task

    def test_alert_without_references(self, db):
        """Test alert can be created without references."""
        alert = NursingAlertFactory(
            related_vital_signs=None,
            related_task=None
        )

        assert alert.related_vital_signs is None
        assert alert.related_task is None


@pytest.mark.tier1
class TestAlertOrdering:
    """Tests for alert ordering."""

    def test_alerts_ordered_by_created_at_descending(self, db):
        """Test alerts are ordered by created_at descending."""
        patient = PatientProfileFactory()

        alert1 = NursingAlertFactory(patient=patient)
        alert2 = NursingAlertFactory(patient=patient)
        alert3 = NursingAlertFactory(patient=patient)

        alerts = list(NursingAlert.objects.filter(patient=patient))

        # Most recent should be first
        assert alerts[0] == alert3
        assert alerts[1] == alert2
        assert alerts[2] == alert1


@pytest.mark.tier1
class TestAlertFiltering:
    """Tests for alert filtering capabilities."""

    def test_filter_unacknowledged_alerts(self, db):
        """Test filtering for unacknowledged alerts."""
        patient = PatientProfileFactory()

        NursingAlertFactory(patient=patient, is_acknowledged=False)
        NursingAlertFactory(patient=patient, is_acknowledged=False)
        AcknowledgedAlertFactory(patient=patient)

        unacknowledged = NursingAlert.objects.filter(
            patient=patient,
            is_acknowledged=False
        )

        assert unacknowledged.count() == 2

    def test_filter_by_severity(self, db):
        """Test filtering alerts by severity."""
        patient = PatientProfileFactory()

        NursingAlertFactory(patient=patient, severity='low')
        NursingAlertFactory(patient=patient, severity='medium')
        NursingAlertFactory(patient=patient, severity='critical')
        NursingAlertFactory(patient=patient, severity='critical')

        critical_alerts = NursingAlert.objects.filter(
            patient=patient,
            severity='critical'
        )

        assert critical_alerts.count() == 2

    def test_filter_by_alert_type(self, db):
        """Test filtering alerts by type."""
        patient = PatientProfileFactory()

        NursingAlertFactory(patient=patient, alert_type='vital_signs')
        NursingAlertFactory(patient=patient, alert_type='vital_signs')
        NursingAlertFactory(patient=patient, alert_type='medication')

        vital_alerts = NursingAlert.objects.filter(
            patient=patient,
            alert_type='vital_signs'
        )

        assert vital_alerts.count() == 2


@pytest.mark.tier1
class TestAlertIndexes:
    """Tests for database indexes on alerts."""

    def test_patient_acknowledged_created_at_index(self, db):
        """Test patient + is_acknowledged + created_at index exists."""
        indexes = NursingAlert._meta.indexes
        indexed_fields = [tuple(idx.fields) for idx in indexes]

        assert ('patient', 'is_acknowledged', '-created_at') in indexed_fields

    def test_severity_acknowledged_index(self, db):
        """Test severity + is_acknowledged index exists."""
        indexes = NursingAlert._meta.indexes
        indexed_fields = [tuple(idx.fields) for idx in indexes]

        assert ('severity', 'is_acknowledged') in indexed_fields

    def test_alert_type_created_at_index(self, db):
        """Test alert_type + created_at index exists."""
        indexes = NursingAlert._meta.indexes
        indexed_fields = [tuple(idx.fields) for idx in indexes]

        assert ('alert_type', '-created_at') in indexed_fields


@pytest.mark.tier1
class TestAlertAudit:
    """Tests for alert audit fields."""

    def test_created_at_auto_set(self, db):
        """Test created_at is automatically set."""
        alert = NursingAlertFactory()

        assert alert.created_at is not None

    def test_updated_at_auto_updated(self, db):
        """Test updated_at is updated on save."""
        alert = NursingAlertFactory()
        original_updated = alert.updated_at

        alert.message = 'Updated message'
        alert.save()

        alert.refresh_from_db()
        assert alert.updated_at >= original_updated
