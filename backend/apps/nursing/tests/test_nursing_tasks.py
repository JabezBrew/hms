"""
Nursing Task tests for nursing app.

Tests for:
- Task creation and assignment
- Status workflow (pending → in_progress → completed)
- Priority handling
- Overdue task detection
- Task completion with notes
"""
import pytest
from datetime import timedelta
from django.utils import timezone
from unittest.mock import patch

from apps.nursing.models import NursingTask
from apps.users.tests.factories import PatientProfileFactory, PractitionerProfileFactory
from .factories import (
    NursingTaskFactory, OverdueNursingTaskFactory,
    CompletedNursingTaskFactory
)


@pytest.mark.tier1
class TestNursingTaskCreation:
    """Tests for nursing task creation."""

    def test_task_creation_with_all_fields(self, db):
        """Test creating a task with all fields."""
        practitioner = PractitionerProfileFactory()
        task = NursingTaskFactory(
            task_type='medication',
            description='Administer medication to patient',
            priority='high',
            assigned_to=practitioner
        )

        assert task.task_type == 'medication'
        assert task.description == 'Administer medication to patient'
        assert task.priority == 'high'
        assert task.assigned_to == practitioner
        assert task.status == 'pending'

    def test_task_string_representation(self, db):
        """Test __str__ returns patient, task type, and time."""
        task = NursingTaskFactory()

        str_repr = str(task)
        assert task.patient.user.get_full_name() in str_repr

    def test_all_task_types_valid(self, db):
        """Test all task type choices can be created."""
        task_types = [
            'medication', 'assessment', 'vitals', 'wound_care',
            'hygiene', 'nutrition', 'mobility', 'documentation', 'other'
        ]

        for task_type in task_types:
            task = NursingTaskFactory(task_type=task_type)
            assert task.task_type == task_type

    def test_all_priority_levels_valid(self, db):
        """Test all priority levels can be created."""
        priorities = ['low', 'medium', 'high', 'urgent']

        for priority in priorities:
            task = NursingTaskFactory(priority=priority)
            assert task.priority == priority


@pytest.mark.tier1
class TestNursingTaskStatusWorkflow:
    """Tests for nursing task status workflow."""

    def test_initial_status_is_pending(self, db):
        """Test new tasks start with pending status."""
        task = NursingTaskFactory()
        assert task.status == 'pending'

    def test_status_transition_to_in_progress(self, db):
        """Test task can transition to in_progress."""
        task = NursingTaskFactory(status='pending')
        task.status = 'in_progress'
        task.save()

        task.refresh_from_db()
        assert task.status == 'in_progress'

    def test_status_transition_to_completed(self, db):
        """Test task can transition to completed."""
        task = NursingTaskFactory(status='in_progress')
        practitioner = PractitionerProfileFactory()

        task.status = 'completed'
        task.completed_time = timezone.now()
        task.completed_by = practitioner
        task.completion_notes = 'Task completed successfully'
        task.save()

        task.refresh_from_db()
        assert task.status == 'completed'
        assert task.completed_by == practitioner
        assert task.completion_notes == 'Task completed successfully'

    def test_status_transition_to_cancelled(self, db):
        """Test task can transition to cancelled."""
        task = NursingTaskFactory(status='pending')
        task.status = 'cancelled'
        task.save()

        task.refresh_from_db()
        assert task.status == 'cancelled'

    def test_all_status_values_valid(self, db):
        """Test all status values can be set."""
        statuses = ['pending', 'in_progress', 'completed', 'cancelled', 'overdue']

        for status in statuses:
            task = NursingTaskFactory(status=status)
            assert task.status == status


@pytest.mark.tier1
class TestOverdueTaskDetection:
    """Tests for overdue task detection."""

    def test_pending_task_becomes_overdue_on_save(self, db):
        """Test pending task with past scheduled time becomes overdue."""
        task = NursingTask(
            patient=PatientProfileFactory(),
            task_type='vitals',
            description='Check vitals',
            scheduled_time=timezone.now() - timedelta(hours=1),
            status='pending',
            created_by=None
        )
        task.save()

        assert task.status == 'overdue'

    def test_in_progress_task_not_auto_overdue(self, db):
        """Test in_progress task doesn't auto-transition to overdue."""
        task = NursingTask(
            patient=PatientProfileFactory(),
            task_type='vitals',
            description='Check vitals',
            scheduled_time=timezone.now() - timedelta(hours=1),
            status='in_progress',
            created_by=None
        )
        task.save()

        # Should stay in_progress even though past scheduled time
        assert task.status == 'in_progress'

    def test_future_task_stays_pending(self, db):
        """Test task with future scheduled time stays pending."""
        task = NursingTaskFactory(
            scheduled_time=timezone.now() + timedelta(hours=2),
            status='pending'
        )

        assert task.status == 'pending'


@pytest.mark.tier1
class TestNursingTaskAssignment:
    """Tests for nursing task assignment."""

    def test_task_assigned_to_practitioner(self, db):
        """Test task can be assigned to a practitioner."""
        practitioner = PractitionerProfileFactory()
        task = NursingTaskFactory(assigned_to=practitioner)

        assert task.assigned_to == practitioner

    def test_unassigned_task(self, db):
        """Test task can be created without assignment."""
        task = NursingTaskFactory(assigned_to=None)

        assert task.assigned_to is None

    @patch('apps.notifications.tasks.ingest_nursing_task_async.delay')
    def test_task_reassignment(self, mock_ingest_task, db):
        """Test task can be reassigned to another practitioner."""
        original = PractitionerProfileFactory()
        new_assignee = PractitionerProfileFactory()

        task = NursingTaskFactory(assigned_to=original)
        task.assigned_to = new_assignee
        task.save()

        task.refresh_from_db()
        assert task.assigned_to == new_assignee


@pytest.mark.tier1
class TestNursingTaskPriority:
    """Tests for nursing task priority handling."""

    def test_default_priority_is_medium(self, db):
        """Test default priority is medium."""
        task = NursingTask(
            patient=PatientProfileFactory(),
            task_type='vitals',
            description='Check vitals',
            scheduled_time=timezone.now() + timedelta(hours=1),
            created_by=None
        )
        task.save()

        assert task.priority == 'medium'

    def test_urgent_priority_task(self, db):
        """Test creating an urgent priority task."""
        task = NursingTaskFactory(priority='urgent')

        assert task.priority == 'urgent'

    def test_task_ordering_by_scheduled_time_and_priority(self, db):
        """Test tasks are ordered by scheduled time, then priority."""
        patient = PatientProfileFactory()
        now = timezone.now()

        task_low = NursingTaskFactory(
            patient=patient,
            scheduled_time=now,
            priority='low'
        )
        task_high = NursingTaskFactory(
            patient=patient,
            scheduled_time=now + timedelta(hours=1),
            priority='high'
        )
        task_urgent = NursingTaskFactory(
            patient=patient,
            scheduled_time=now + timedelta(hours=2),
            priority='urgent'
        )

        # First ordering is by scheduled_time
        tasks = list(NursingTask.objects.filter(patient=patient))

        # Should be ordered by scheduled_time first
        assert tasks[0].scheduled_time <= tasks[1].scheduled_time


@pytest.mark.tier1
class TestNursingTaskCompletion:
    """Tests for nursing task completion."""

    def test_completed_task_has_completion_time(self, db):
        """Test completed task has completion timestamp."""
        task = CompletedNursingTaskFactory()

        assert task.status == 'completed'
        assert task.completed_time is not None

    def test_completed_task_has_completed_by(self, db):
        """Test completed task has completed_by set."""
        task = CompletedNursingTaskFactory()

        assert task.completed_by is not None

    def test_completion_notes_stored(self, db):
        """Test completion notes are stored."""
        task = CompletedNursingTaskFactory(
            completion_notes='Patient tolerated well'
        )

        assert task.completion_notes == 'Patient tolerated well'

    def test_complete_task_workflow(self, db):
        """Test full workflow of completing a task."""
        task = NursingTaskFactory(status='pending')
        practitioner = PractitionerProfileFactory()

        # Start task
        task.status = 'in_progress'
        task.save()

        # Complete task
        task.status = 'completed'
        task.completed_time = timezone.now()
        task.completed_by = practitioner
        task.completion_notes = 'Task done'
        task.save()

        task.refresh_from_db()
        assert task.status == 'completed'
        assert task.completed_by == practitioner


@pytest.mark.tier1
class TestNursingTaskIndexes:
    """Tests for database indexes on nursing tasks."""

    def test_patient_status_scheduled_time_index(self, db):
        """Test patient + status + scheduled_time index exists."""
        indexes = NursingTask._meta.indexes
        indexed_fields = [tuple(idx.fields) for idx in indexes]

        assert ('patient', 'status', 'scheduled_time') in indexed_fields

    def test_assigned_to_status_index(self, db):
        """Test assigned_to + status index exists."""
        indexes = NursingTask._meta.indexes
        indexed_fields = [tuple(idx.fields) for idx in indexes]

        assert ('assigned_to', 'status') in indexed_fields

    def test_priority_scheduled_time_index(self, db):
        """Test priority + scheduled_time index exists."""
        indexes = NursingTask._meta.indexes
        indexed_fields = [tuple(idx.fields) for idx in indexes]

        assert ('priority', 'scheduled_time') in indexed_fields


@pytest.mark.tier1
class TestNursingTaskAudit:
    """Tests for nursing task audit fields."""

    def test_created_at_auto_set(self, db):
        """Test created_at is automatically set."""
        task = NursingTaskFactory()

        assert task.created_at is not None

    def test_updated_at_auto_updated(self, db):
        """Test updated_at is updated on save."""
        task = NursingTaskFactory()
        original_updated = task.updated_at

        task.description = 'Updated description'
        task.save()

        task.refresh_from_db()
        assert task.updated_at >= original_updated

    def test_created_by_stored(self, db):
        """Test created_by is stored."""
        task = NursingTaskFactory()

        assert task.created_by is not None
