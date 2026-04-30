import pytest
from django.apps import apps

if not apps.is_installed('apps.ward_board'):
    pytest.skip('apps.ward_board is not registered in INSTALLED_APPS yet.', allow_module_level=True)

from django.utils import timezone

from apps.users.tests.factories import NurseUserFactory, PatientProfileFactory
from apps.ward_board.models import (
    WardBoardAcknowledgement,
    WardBoardTask,
    WardBoardTaskEvent,
)
from apps.ward_board.services import acknowledge_task, complete_task, create_task
from apps.wards.tests.factories import AdmissionFactory


@pytest.mark.django_db
def test_create_task_records_safe_create_event(default_facility, settings):
    settings.TEAM_ACCESS_STRICT = False
    nurse = NurseUserFactory(primary_facility=default_facility)
    patient = PatientProfileFactory(facility=default_facility)
    admission = AdmissionFactory(
        patient=patient,
        facility=default_facility,
        bed__ward__department__facility=default_facility,
        status='admitted',
    )

    task = create_task(
        facility=default_facility,
        actor=nurse,
        patient=patient,
        admission=admission,
        owner_role='nurse',
        category=WardBoardTask.Category.VITALS,
        priority=WardBoardTask.Priority.URGENT,
        due_at=timezone.now(),
        action_text='Repeat observations and notify doctor if worsening.',
        contingency_text='Escalate to rapid review if oxygen requirement increases.',
    )

    event = WardBoardTaskEvent.objects.get(task=task)
    assert event.event_type == WardBoardTaskEvent.EventType.CREATE
    assert event.facility == default_facility
    assert event.metadata['category'] == WardBoardTask.Category.VITALS
    assert event.metadata['priority'] == WardBoardTask.Priority.URGENT
    assert 'action_text' not in event.metadata
    assert 'contingency_text' not in event.metadata


@pytest.mark.django_db
def test_acknowledge_is_unique_and_complete_appends_event(default_facility, settings):
    settings.TEAM_ACCESS_STRICT = False
    nurse = NurseUserFactory(primary_facility=default_facility)
    patient = PatientProfileFactory(facility=default_facility)
    task = create_task(
        facility=default_facility,
        actor=nurse,
        patient=patient,
        owner_role='nurse',
        action_text='Check IV site.',
    )

    first_ack = acknowledge_task(task, actor=nurse, note='Seen.')
    second_ack = acknowledge_task(task, actor=nurse, note='Seen again.')
    task = complete_task(task, actor=nurse)

    assert first_ack.id == second_ack.id
    assert WardBoardAcknowledgement.objects.filter(task=task, user=nurse).count() == 1
    assert task.status == WardBoardTask.Status.COMPLETED
    assert task.completed_by == nurse
    assert list(task.events.values_list('event_type', flat=True)) == [
        WardBoardTaskEvent.EventType.CREATE,
        WardBoardTaskEvent.EventType.ACKNOWLEDGE,
        WardBoardTaskEvent.EventType.COMPLETE,
    ]

