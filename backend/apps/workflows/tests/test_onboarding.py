from __future__ import annotations

import pytest

from apps.workflows.models import (
    OnboardingEventReceipt,
    OnboardingFlowDefinition,
    OnboardingProgress,
    OnboardingProgressStatus,
)


def _create_flow(
    *,
    flow_key: str,
    version: int,
    steps: list[dict],
    roles: list[str] | None = None,
    active: bool = True,
):
    return OnboardingFlowDefinition.objects.create(
        flow_key=flow_key,
        version=version,
        active=active,
        roles=roles or ['doctor'],
        definition={
            'flow_key': flow_key,
            'version': version,
            'steps': steps,
        },
    )


@pytest.mark.tier1
class TestOnboardingApi:
    def test_active_flows_returns_latest_version_and_etag(self, doctor_client, db):
        flow_key = 'test_etag_flow'
        _create_flow(
            flow_key=flow_key,
            version=1,
            steps=[{'id': 'v1_step', 'required': True, 'complete_when': {'type': 'event', 'name': 'noop'}}],
        )
        _create_flow(
            flow_key=flow_key,
            version=2,
            steps=[{'id': 'v2_step', 'required': True, 'complete_when': {'type': 'event', 'name': 'noop'}}],
        )

        response = doctor_client.get('/api/workflows/onboarding/flows/active/')

        assert response.status_code == 200
        assert 'ETag' in response

        flows = response.json()['flows']
        matching = [flow for flow in flows if flow['flow_key'] == flow_key]
        assert len(matching) == 1
        assert matching[0]['version'] == 2

        etag = response['ETag']
        cached = doctor_client.get(
            '/api/workflows/onboarding/flows/active/',
            HTTP_IF_NONE_MATCH=etag,
        )
        assert cached.status_code == 304

    def test_seeded_steps_include_ui_metadata(self, doctor_client, db):
        response = doctor_client.get('/api/workflows/onboarding/flows/active/')
        assert response.status_code == 200

        flows_by_key = {flow['flow_key']: flow for flow in response.json()['flows']}

        core_steps = {step['id']: step for step in flows_by_key['doctor_core_v1']['definition']['steps']}
        assert core_steps['core_02_open_registry']['ui']['target'] == '[data-onboarding="nav-patients"]'
        assert core_steps['core_02_open_registry']['ui']['placement'] == 'right'

        template_steps = {
            step['id']: step for step in flows_by_key['doctor_templates_v1']['definition']['steps']
        }
        assert (
            template_steps['tpl_05_create_chart_template']['ui']['target']
            == '[data-onboarding="chart-template-create"]'
        )
        assert template_steps['tpl_05_create_chart_template']['ui']['arrow'] is True

    def test_start_progress_is_idempotent(self, doctor_client, doctor_user, db):
        flow_key = 'test_start_idempotent'
        _create_flow(
            flow_key=flow_key,
            version=1,
            steps=[
                {
                    'id': 'step_1',
                    'required': True,
                    'complete_when': {'type': 'event', 'name': 'onboarding.flow_started'},
                }
            ],
        )

        payload = {'flow_key': flow_key}
        first = doctor_client.post('/api/workflows/onboarding/progress/start/', payload, format='json')
        second = doctor_client.post('/api/workflows/onboarding/progress/start/', payload, format='json')

        assert first.status_code == 200
        assert second.status_code == 200
        assert first.json()['flow_key'] == flow_key
        assert second.json()['flow_key'] == flow_key

        assert OnboardingProgress.objects.filter(
            user=doctor_user,
            flow_key=flow_key,
            flow_version=1,
        ).count() == 1

    def test_ingest_progresses_event_and_sequence_steps(self, doctor_client, doctor_user, db):
        flow_key = 'test_ingest_sequence'
        _create_flow(
            flow_key=flow_key,
            version=1,
            steps=[
                {
                    'id': 'step_started',
                    'required': True,
                    'complete_when': {
                        'type': 'event',
                        'name': 'onboarding.flow_started',
                        'where': {'flow_key': flow_key},
                    },
                },
                {
                    'id': 'step_sequence',
                    'required': True,
                    'complete_when': {
                        'type': 'sequence',
                        'events': [
                            {
                                'name': 'demo.sequence.first',
                                'where': {'token': 'abc'},
                                'capture': {'token': 'token'},
                            },
                            {
                                'name': 'demo.sequence.second',
                                'where': {'token': '$state.token'},
                            },
                        ],
                    },
                },
            ],
        )

        doctor_client.post(
            '/api/workflows/onboarding/progress/start/',
            {'flow_key': flow_key},
            format='json',
        )

        response = doctor_client.post(
            '/api/workflows/onboarding/events/ingest/',
            {
                'events': [
                    {
                        'event_id': 'evt-1',
                        'name': 'onboarding.flow_started',
                        'payload': {'flow_key': flow_key},
                    },
                    {
                        'event_id': 'evt-2',
                        'name': 'demo.sequence.first',
                        'payload': {'token': 'abc'},
                    },
                    {
                        'event_id': 'evt-3',
                        'name': 'demo.sequence.second',
                        'payload': {'token': 'abc'},
                    },
                ]
            },
            format='json',
        )

        assert response.status_code == 200
        body = response.json()
        assert body['ack_event_ids'] == ['evt-1', 'evt-2', 'evt-3']
        assert any(update['flow_key'] == flow_key for update in body['updated'])

        progress = OnboardingProgress.objects.get(
            user=doctor_user,
            flow_key=flow_key,
            flow_version=1,
        )
        assert progress.status == OnboardingProgressStatus.COMPLETED
        assert progress.completed_at is not None

    def test_ingest_is_idempotent_for_duplicate_event_id(self, doctor_client, doctor_user, db):
        flow_key = 'test_ingest_idempotent'
        _create_flow(
            flow_key=flow_key,
            version=1,
            steps=[
                {
                    'id': 'step_one',
                    'required': True,
                    'complete_when': {
                        'type': 'event',
                        'name': 'demo.step',
                        'where': {'ok': True},
                    },
                }
            ],
        )

        doctor_client.post(
            '/api/workflows/onboarding/progress/start/',
            {'flow_key': flow_key},
            format='json',
        )

        first = doctor_client.post(
            '/api/workflows/onboarding/events/ingest/',
            {
                'events': [
                    {
                        'event_id': 'dup-evt',
                        'name': 'demo.step',
                        'payload': {'ok': True},
                    }
                ]
            },
            format='json',
        )
        second = doctor_client.post(
            '/api/workflows/onboarding/events/ingest/',
            {
                'events': [
                    {
                        'event_id': 'dup-evt',
                        'name': 'demo.step',
                        'payload': {'ok': True},
                    }
                ]
            },
            format='json',
        )

        assert first.status_code == 200
        assert second.status_code == 200
        assert first.json()['updated']
        assert second.json()['updated'] == []

        assert OnboardingEventReceipt.objects.filter(
            user=doctor_user,
            event_id='dup-evt',
        ).count() == 1
