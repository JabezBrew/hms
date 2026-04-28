import hashlib
import json
from datetime import datetime
from typing import Dict, Iterable, List, Optional, Tuple

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .models import (
    OnboardingEventReceipt,
    OnboardingFlowDefinition,
    OnboardingProgress,
    OnboardingProgressStatus,
)


def _normalize_role(role: Optional[str]) -> str:
    return (role or '').strip().lower()


def get_active_flows_for_role(role: Optional[str]) -> List[OnboardingFlowDefinition]:
    normalized_role = _normalize_role(role)
    if not normalized_role:
        return []

    queryset = OnboardingFlowDefinition.objects.filter(active=True).filter(
        Q(roles__contains=[normalized_role]) | Q(roles=[]),
    ).order_by('flow_key', '-version')
    return list(queryset)


def get_latest_active_flows_by_key(role: Optional[str]) -> Dict[str, OnboardingFlowDefinition]:
    latest_by_key: Dict[str, OnboardingFlowDefinition] = {}
    for flow in get_active_flows_for_role(role):
        if flow.flow_key not in latest_by_key:
            latest_by_key[flow.flow_key] = flow
    return latest_by_key


def _bit_is_set(mask: int, index: int) -> bool:
    return (mask & (1 << index)) != 0


def _set_bit(mask: int, index: int) -> int:
    return mask | (1 << index)


def _get_steps(flow: OnboardingFlowDefinition) -> List[dict]:
    steps = flow.definition.get('steps', [])
    return steps if isinstance(steps, list) else []


def _is_step_done(progress: OnboardingProgress, step_index: int) -> bool:
    return _bit_is_set(progress.completed_steps_mask, step_index) or _bit_is_set(progress.skipped_steps_mask, step_index)


def _resolve_step_index(steps: List[dict], step_id: str) -> Optional[int]:
    for index, step in enumerate(steps):
        if step.get('id') == step_id:
            return index
    return None


def _advance_current_step(progress: OnboardingProgress, steps: List[dict]) -> bool:
    previous = progress.current_step_index
    step_count = len(steps)
    idx = min(progress.current_step_index, step_count)

    while idx < step_count and _is_step_done(progress, idx):
        idx += 1

    progress.current_step_index = idx
    return idx != previous


def _all_required_steps_done(progress: OnboardingProgress, steps: List[dict]) -> bool:
    for index, step in enumerate(steps):
        if not step.get('required', True):
            continue
        if not _is_step_done(progress, index):
            return False
    return True


def _to_number(value):
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _get_path(payload: dict, key: str):
    current = payload
    for part in key.split('.'):
        if not isinstance(current, dict) or part not in current:
            return None
        current = current[part]
    return current


def _resolve_expected(expected, state: dict):
    if isinstance(expected, str) and expected.startswith('$state.'):
        return _get_path(state, expected[7:])
    return expected


def _parse_where_key(key: str) -> Tuple[str, str]:
    comparator_suffixes = (
        ('_gte', 'gte'),
        ('_lte', 'lte'),
        ('_gt', 'gt'),
        ('_lt', 'lt'),
    )
    for suffix, comparator in comparator_suffixes:
        if key.endswith(suffix):
            return key[: -len(suffix)], comparator
    return key, 'eq'


def _compare(actual, expected, comparator: str) -> bool:
    if comparator == 'eq':
        return actual == expected

    actual_number = _to_number(actual)
    expected_number = _to_number(expected)
    if actual_number is None or expected_number is None:
        return False

    if comparator == 'gte':
        return actual_number >= expected_number
    if comparator == 'lte':
        return actual_number <= expected_number
    if comparator == 'gt':
        return actual_number > expected_number
    if comparator == 'lt':
        return actual_number < expected_number
    return False


def _matches_where(where: dict, payload: dict, state: dict) -> bool:
    for key, expected in where.items():
        field, comparator = _parse_where_key(key)
        actual = _get_path(payload, field)
        resolved_expected = _resolve_expected(expected, state)
        if not _compare(actual, resolved_expected, comparator):
            return False
    return True


def _matches_condition(event_name: str, payload: dict, condition: dict, state: dict) -> bool:
    if event_name != condition.get('name'):
        return False

    where = condition.get('where')
    if where and not _matches_where(where, payload, state):
        return False

    where_any = condition.get('where_any')
    if where_any:
        return any(_matches_where(option, payload, state) for option in where_any if isinstance(option, dict))

    return True


def _apply_capture(capture: dict, payload: dict, state: dict) -> dict:
    if not capture:
        return state

    updated = dict(state or {})
    for target_key, source_key in capture.items():
        if not isinstance(target_key, str) or not isinstance(source_key, str):
            continue
        value = _get_path(payload, source_key)
        if value is not None:
            updated[target_key] = value
    return updated


def _evaluate_step_event(
    step: dict,
    event_name: str,
    payload: dict,
    state: dict,
    runtime: dict,
) -> Tuple[bool, dict, dict]:
    complete_when = step.get('complete_when', {})
    rule_type = complete_when.get('type')

    if rule_type == 'event':
        if _matches_condition(event_name, payload, complete_when, state):
            new_state = _apply_capture(complete_when.get('capture', {}), payload, state)
            return True, new_state, {}
        return False, state, runtime

    if rule_type == 'any_of':
        for condition in complete_when.get('conditions', []):
            if not isinstance(condition, dict):
                continue
            if _matches_condition(event_name, payload, condition, state):
                new_state = _apply_capture(condition.get('capture', {}), payload, state)
                return True, new_state, {}
        return False, state, runtime

    if rule_type == 'sequence':
        sequence_events = complete_when.get('events', [])
        if not sequence_events:
            return False, state, runtime

        next_index = int(runtime.get('next_index', 0))
        next_index = max(0, min(next_index, len(sequence_events)))

        def _match_at_index(index: int, current_state: dict) -> Tuple[bool, dict]:
            event_def = sequence_events[index]
            if not isinstance(event_def, dict):
                return False, current_state
            if _matches_condition(event_name, payload, event_def, current_state):
                captured_state = _apply_capture(event_def.get('capture', {}), payload, current_state)
                return True, captured_state
            return False, current_state

        matched, next_state = _match_at_index(next_index, state)
        if not matched:
            # Allow restart from the first sequence event.
            matched, next_state = _match_at_index(0, state)
            if not matched:
                return False, state, runtime
            next_index = 0

        advanced_index = next_index + 1
        if advanced_index >= len(sequence_events):
            return True, next_state, {}

        updated_runtime = dict(runtime or {})
        updated_runtime['next_index'] = advanced_index
        return False, next_state, updated_runtime

    return False, state, runtime


def _build_progress_snapshot(
    flow: OnboardingFlowDefinition,
    progress: Optional[OnboardingProgress],
) -> dict:
    steps = _get_steps(flow)
    step_ids = [step.get('id') for step in steps if step.get('id')]

    if not progress:
        return {
            'flow_key': flow.flow_key,
            'flow_version': flow.version,
            'status': 'not_started',
            'current_step_index': 0,
            'current_step_id': step_ids[0] if step_ids else None,
            'completed_step_ids': [],
            'skipped_step_ids': [],
            'is_flow_completed': False,
            'updated_at': None,
        }

    completed_step_ids = [
        step_id
        for index, step_id in enumerate(step_ids)
        if _bit_is_set(progress.completed_steps_mask, index)
    ]
    skipped_step_ids = [
        step_id
        for index, step_id in enumerate(step_ids)
        if _bit_is_set(progress.skipped_steps_mask, index)
    ]

    current_step_id = None
    if progress.current_step_index < len(step_ids):
        current_step_id = step_ids[progress.current_step_index]

    return {
        'flow_key': flow.flow_key,
        'flow_version': flow.version,
        'status': progress.status,
        'current_step_index': progress.current_step_index,
        'current_step_id': current_step_id,
        'completed_step_ids': completed_step_ids,
        'skipped_step_ids': skipped_step_ids,
        'is_flow_completed': progress.status == OnboardingProgressStatus.COMPLETED,
        'updated_at': progress.updated_at,
    }


def get_active_flows_payload(role: Optional[str]) -> List[dict]:
    payload = []
    latest_by_key = get_latest_active_flows_by_key(role)
    for flow in latest_by_key.values():
        payload.append({
            'flow_key': flow.flow_key,
            'version': flow.version,
            'active': flow.active,
            'roles': flow.roles,
            'definition': flow.definition,
        })
    payload.sort(key=lambda item: item['flow_key'])
    return payload


def compute_flows_etag(flows_payload: List[dict]) -> str:
    serialized = json.dumps(flows_payload, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(serialized.encode('utf-8')).hexdigest()


def _resolve_flow_definition_for_user(user, flow_key: str, flow_version: Optional[int] = None) -> OnboardingFlowDefinition:
    normalized_role = _normalize_role(getattr(user, 'user_type', None))
    queryset = OnboardingFlowDefinition.objects.filter(flow_key=flow_key, active=True).filter(
        Q(roles__contains=[normalized_role]) | Q(roles=[]),
    )
    if flow_version:
        queryset = queryset.filter(version=flow_version)
    flow = queryset.order_by('-version').first()
    if not flow:
        raise ValueError('Flow not found or not allowed for this role.')
    return flow


def start_progress(user, flow_key: str, flow_version: Optional[int] = None) -> dict:
    flow = _resolve_flow_definition_for_user(user, flow_key, flow_version)

    progress, created = OnboardingProgress.objects.get_or_create(
        user=user,
        flow_key=flow.flow_key,
        flow_version=flow.version,
        defaults={
            'flow_definition': flow,
            'status': OnboardingProgressStatus.IN_PROGRESS,
            'current_step_index': 0,
        },
    )

    updated = False
    if progress.flow_definition_id != flow.id:
        progress.flow_definition = flow
        updated = True
    if progress.status != OnboardingProgressStatus.COMPLETED and progress.status != OnboardingProgressStatus.IN_PROGRESS:
        progress.status = OnboardingProgressStatus.IN_PROGRESS
        updated = True

    steps = _get_steps(flow)
    updated = _advance_current_step(progress, steps) or updated

    if updated:
        progress.save()

    return _build_progress_snapshot(flow, progress)


def get_progress(user, flow_keys: Optional[Iterable[str]] = None) -> List[dict]:
    normalized_role = _normalize_role(getattr(user, 'user_type', None))
    active_latest_by_key = get_latest_active_flows_by_key(normalized_role)

    selected_keys = set(flow_keys or active_latest_by_key.keys())
    selected_flows = [flow for key, flow in active_latest_by_key.items() if key in selected_keys]
    selected_flows.sort(key=lambda flow: flow.flow_key)

    progress_records = OnboardingProgress.objects.filter(
        user=user,
        flow_key__in=[flow.flow_key for flow in selected_flows],
        flow_version__in=[flow.version for flow in selected_flows],
    ).select_related('flow_definition')
    progress_map = {(record.flow_key, record.flow_version): record for record in progress_records}

    return [
        _build_progress_snapshot(flow, progress_map.get((flow.flow_key, flow.version)))
        for flow in selected_flows
    ]


def skip_step(
    user,
    flow_key: str,
    step_id: str,
    flow_version: Optional[int] = None,
    reason: str = '',
) -> dict:
    with transaction.atomic():
        flow = _resolve_flow_definition_for_user(user, flow_key, flow_version)
        progress, _ = OnboardingProgress.objects.select_for_update().get_or_create(
            user=user,
            flow_key=flow.flow_key,
            flow_version=flow.version,
            defaults={
                'flow_definition': flow,
                'status': OnboardingProgressStatus.IN_PROGRESS,
                'current_step_index': 0,
            },
        )
        if progress.flow_definition_id != flow.id:
            progress.flow_definition = flow

        steps = _get_steps(flow)
        step_index = _resolve_step_index(steps, step_id)
        if step_index is None:
            raise ValueError('Step not found in flow definition.')

        progress.skipped_steps_mask = _set_bit(progress.skipped_steps_mask, step_index)
        if reason:
            state = dict(progress.state_json or {})
            skip_reasons = dict(state.get('skip_reasons', {}))
            skip_reasons[step_id] = reason[:500]
            state['skip_reasons'] = skip_reasons
            progress.state_json = state

        _advance_current_step(progress, steps)
        if _all_required_steps_done(progress, steps):
            progress.status = OnboardingProgressStatus.COMPLETED
            progress.completed_at = timezone.now()
        else:
            progress.status = OnboardingProgressStatus.IN_PROGRESS
            progress.completed_at = None
        progress.save()

    return _build_progress_snapshot(flow, progress)


def _parse_event_timestamp(value) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value
    return None


def ingest_events(user, events: List[dict]) -> dict:
    if not events:
        return {'ack_event_ids': [], 'updated': []}

    normalized_role = _normalize_role(getattr(user, 'user_type', None))
    flow_by_key = get_latest_active_flows_by_key(normalized_role)

    with transaction.atomic():
        event_ids = [event['event_id'] for event in events]
        existing_ids = set(
            OnboardingEventReceipt.objects.filter(
                user=user,
                event_id__in=event_ids,
            ).values_list('event_id', flat=True)
        )

        fresh_events = [event for event in events if event['event_id'] not in existing_ids]

        if fresh_events:
            OnboardingEventReceipt.objects.bulk_create([
                OnboardingEventReceipt(
                    user=user,
                    event_id=event['event_id'],
                    event_name=event['name'],
                )
                for event in fresh_events
            ])

        progress_records = list(
            OnboardingProgress.objects.select_for_update().select_related('flow_definition').filter(
                user=user,
                status=OnboardingProgressStatus.IN_PROGRESS,
            )
        )
        progress_map = {(p.flow_key, p.flow_version): p for p in progress_records}

        updates_by_flow: Dict[Tuple[str, int], dict] = {}

        for event in fresh_events:
            payload = event.get('payload') or {}
            event_name = event['name']

            if event_name == 'onboarding.flow_started':
                started_flow_key = payload.get('flow_key')
                if started_flow_key and started_flow_key in flow_by_key:
                    started_flow = flow_by_key[started_flow_key]
                    progress, _ = OnboardingProgress.objects.select_for_update().get_or_create(
                        user=user,
                        flow_key=started_flow.flow_key,
                        flow_version=started_flow.version,
                        defaults={
                            'flow_definition': started_flow,
                            'status': OnboardingProgressStatus.IN_PROGRESS,
                            'current_step_index': 0,
                        },
                    )
                    if progress.flow_definition_id != started_flow.id:
                        progress.flow_definition = started_flow
                        progress.save(update_fields=['flow_definition', 'flow_key', 'flow_version', 'updated_at'])
                    progress_map[(progress.flow_key, progress.flow_version)] = progress

            for progress_key, progress in list(progress_map.items()):
                if progress.status == OnboardingProgressStatus.COMPLETED:
                    continue
                flow = progress.flow_definition
                if not flow.active:
                    continue

                steps = _get_steps(flow)
                if not steps:
                    continue

                if _advance_current_step(progress, steps):
                    progress.save(update_fields=['current_step_index', 'updated_at'])

                if progress.current_step_index >= len(steps):
                    if _all_required_steps_done(progress, steps):
                        progress.status = OnboardingProgressStatus.COMPLETED
                        progress.completed_at = timezone.now()
                        progress.save(update_fields=['status', 'completed_at', 'updated_at'])
                    continue

                current_index = progress.current_step_index
                step = steps[current_index]
                step_id = step.get('id')
                if not step_id:
                    continue

                state = dict(progress.state_json or {})
                runtime_map = dict(progress.step_runtime_json or {})
                runtime = dict(runtime_map.get(step_id, {}))

                is_complete, new_state, new_runtime = _evaluate_step_event(
                    step=step,
                    event_name=event_name,
                    payload=payload,
                    state=state,
                    runtime=runtime,
                )

                changed = False
                if new_state != state:
                    progress.state_json = new_state
                    changed = True

                if new_runtime != runtime:
                    if new_runtime:
                        runtime_map[step_id] = new_runtime
                    else:
                        runtime_map.pop(step_id, None)
                    progress.step_runtime_json = runtime_map
                    changed = True

                if is_complete:
                    progress.completed_steps_mask = _set_bit(progress.completed_steps_mask, current_index)
                    runtime_map.pop(step_id, None)
                    progress.step_runtime_json = runtime_map
                    changed = True

                    flow_update = updates_by_flow.setdefault(progress_key, {
                        'flow_key': progress.flow_key,
                        'flow_version': progress.flow_version,
                        'newly_completed_step_ids': [],
                    })
                    flow_update['newly_completed_step_ids'].append(step_id)

                    _advance_current_step(progress, steps)
                    if _all_required_steps_done(progress, steps):
                        progress.status = OnboardingProgressStatus.COMPLETED
                        progress.completed_at = timezone.now()
                    else:
                        progress.status = OnboardingProgressStatus.IN_PROGRESS

                if changed:
                    progress.save()
                    progress_map[progress_key] = progress

        updated_payload = []
        for progress_key, update in updates_by_flow.items():
            progress = progress_map.get(progress_key)
            flow = progress.flow_definition if progress else flow_by_key.get(update['flow_key'])
            steps = _get_steps(flow) if flow else []
            next_step_id = None
            if progress and progress.current_step_index < len(steps):
                next_step_id = steps[progress.current_step_index].get('id')
            updated_payload.append({
                **update,
                'is_flow_completed': bool(progress and progress.status == OnboardingProgressStatus.COMPLETED),
                'next_step_id': next_step_id,
            })

    return {
        'ack_event_ids': [event['event_id'] for event in events],
        'updated': sorted(updated_payload, key=lambda item: item['flow_key']),
    }
