from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any

from apps.laboratory.models import LabOrder, LabResult


FLAG_LABELS = {
    'normal': 'within the expected range',
    'low': 'below the expected range',
    'high': 'above the expected range',
    'critical_low': 'critically low',
    'critical_high': 'critically high',
    'abnormal': 'outside the expected pattern',
}

FLAG_PRIORITY = {
    'critical_high': 5,
    'critical_low': 5,
    'high': 4,
    'low': 4,
    'abnormal': 3,
    'normal': 1,
}


def _to_decimal(value: Any) -> Decimal | None:
    if value is None:
        return None
    try:
        raw = str(value).strip()
        if not raw:
            return None
        return Decimal(raw)
    except (InvalidOperation, TypeError, ValueError):
        return None


def _clip(value: Decimal, *, low: str, high: str) -> float:
    lower = Decimal(low)
    upper = Decimal(high)
    if value < lower:
        value = lower
    if value > upper:
        value = upper
    return float(value)


def _trend_direction(current: Decimal | None, previous: Decimal | None) -> str | None:
    if current is None or previous is None:
        return None

    delta = current - previous
    tolerance = max(abs(previous) * Decimal('0.02'), Decimal('0.01'))
    if abs(delta) <= tolerance:
        return 'stable'
    if delta > 0:
        return 'rising'
    return 'falling'


def _confidence_for_result(result: LabResult, history: list[LabResult]) -> float:
    score = Decimal('0.68')
    current_value = _to_decimal(result.value)

    if result.flag in {'critical_low', 'critical_high', 'normal'}:
        score += Decimal('0.12')
    else:
        score += Decimal('0.08')

    if current_value is not None:
        score += Decimal('0.06')
    else:
        score -= Decimal('0.06')

    if result.reference_low is not None or result.reference_high is not None:
        score += Decimal('0.04')
    else:
        score -= Decimal('0.03')

    if history:
        score += Decimal('0.05')

    if result.interpretation:
        score += Decimal('0.02')

    if result.flag == 'abnormal' and result.reference_low is None and result.reference_high is None:
        score -= Decimal('0.07')

    return _clip(score, low='0.50', high='0.95')


def _citation_for_result(result: LabResult, *, kind: str) -> dict[str, Any]:
    order = result.order_test.order
    test = result.order_test.test
    return {
        'source': kind,
        'result_id': str(result.id),
        'order_id': str(order.id),
        'patient_id': str(order.patient_id),
        'test_code': test.code,
        'test_name': test.short_name,
        'performed_at': result.performed_at.isoformat(),
        'field': 'value',
        'value': f'{result.value} {result.unit}'.strip(),
    }


def _reference_text(result: LabResult) -> str:
    if result.reference_low is None and result.reference_high is None:
        return 'Reference range not available for this result.'
    if result.reference_low is None:
        return f'Reference high <= {result.reference_high} {result.unit}'.strip()
    if result.reference_high is None:
        return f'Reference low >= {result.reference_low} {result.unit}'.strip()
    return f'Reference range: {result.reference_low} - {result.reference_high} {result.unit}'.strip()


def _suggested_next_checks(*, flag: str, audience: str) -> list[str]:
    if audience == 'patient':
        if flag in {'critical_low', 'critical_high'}:
            return [
                'Contact your care team immediately for guidance.',
                'Do not change medications on your own unless your clinician advises it.',
            ]
        if flag in {'high', 'low', 'abnormal'}:
            return [
                'Review this result with your clinician and share any symptoms.',
                'Your clinician may recommend repeat or follow-up tests if needed.',
            ]
        return [
            'Continue the current care plan and routine follow-up.',
            'Ask your clinician if you have new or worsening symptoms.',
        ]

    if flag in {'critical_low', 'critical_high'}:
        return [
            'Escalate to the responsible clinician immediately.',
            'Consider prompt repeat confirmation per local protocol.',
        ]
    if flag in {'high', 'low', 'abnormal'}:
        return [
            'Correlate with symptoms, medications, and current diagnosis.',
            'Consider repeat or related follow-up testing based on clinical judgment.',
        ]
    return [
        'Continue routine monitoring in the current care plan.',
        'Reassess trend on next scheduled measurement.',
    ]


def _build_result_payload(result: LabResult, *, audience: str, history: list[LabResult]) -> dict[str, Any]:
    test = result.order_test.test
    current_value = _to_decimal(result.value)
    previous_value = _to_decimal(history[0].value) if history else None
    trend = _trend_direction(current_value, previous_value)
    trend_text = trend or 'unknown'
    flag_label = FLAG_LABELS.get(result.flag, 'outside the expected range')

    if audience == 'patient':
        summary = (
            f'{test.short_name} is {flag_label}. '
            f'Current value is {result.value} {result.unit}. '
            f'Trend is {trend_text}.'
        )
    else:
        summary = (
            f'{test.short_name} is {flag_label} ({result.flag}). '
            f'Current value: {result.value} {result.unit}. '
            f'Trend vs prior: {trend_text}.'
        )

    payload = {
        'result_id': str(result.id),
        'test_id': str(test.id),
        'test_code': test.code,
        'test_name': test.short_name,
        'flag': result.flag,
        'summary': summary,
        'value': str(result.value),
        'unit': result.unit,
        'reference': _reference_text(result),
        'trend': trend_text,
        'performed_at': result.performed_at.isoformat(),
        'suggested_next_checks': _suggested_next_checks(flag=result.flag, audience=audience),
        'advisory_only': True,
    }
    if audience == 'clinician' and result.interpretation:
        payload['existing_lab_note'] = result.interpretation

    return payload


def _history_for_result(result: LabResult, *, limit: int = 3) -> list[LabResult]:
    order = result.order_test.order
    return list(
        LabResult.objects.select_related('order_test__order', 'order_test__test')
        .filter(
            facility_id=result.facility_id,
            order_test__order__patient_id=order.patient_id,
            order_test__test_id=result.order_test.test_id,
            performed_at__lt=result.performed_at,
        )
        .order_by('-performed_at')[:limit]
    )


def interpret_result(result: LabResult, *, audience: str) -> dict[str, Any]:
    history = _history_for_result(result)
    confidence = _confidence_for_result(result, history)
    result_payload = _build_result_payload(result, audience=audience, history=history)

    citations = [_citation_for_result(result, kind='laboratory.lab_result')]
    citations.extend(_citation_for_result(item, kind='laboratory.lab_result_history') for item in history[:2])

    return {
        'result': {
            'mode': 'result',
            'audience': audience,
            'summary': result_payload['summary'],
            'result': result_payload,
            'advisory_only': True,
        },
        'confidence': confidence,
        'citations': citations,
    }


def _load_order_results(order: LabOrder) -> list[LabResult]:
    return list(
        LabResult.objects.select_related('order_test__order', 'order_test__test')
        .filter(order_test__order_id=order.id, facility_id=order.facility_id)
        .order_by('-performed_at')
    )


def _load_history_for_order(order: LabOrder, results: list[LabResult], *, limit_per_test: int = 3) -> dict[str, list[LabResult]]:
    if not results:
        return {}

    current_ids = {result.id for result in results}
    test_ids = {result.order_test.test_id for result in results}

    history_queryset = (
        LabResult.objects.select_related('order_test__order', 'order_test__test')
        .filter(
            facility_id=order.facility_id,
            order_test__order__patient_id=order.patient_id,
            order_test__test_id__in=test_ids,
        )
        .exclude(id__in=current_ids)
        .order_by('order_test__test_id', '-performed_at')
    )

    history_by_test: dict[str, list[LabResult]] = {}
    for item in history_queryset:
        key = str(item.order_test.test_id)
        bucket = history_by_test.setdefault(key, [])
        if len(bucket) < limit_per_test:
            bucket.append(item)
    return history_by_test


def interpret_order(order: LabOrder, *, audience: str) -> dict[str, Any]:
    results = _load_order_results(order)
    if not results:
        return {
            'result': {
                'mode': 'order',
                'audience': audience,
                'order_id': str(order.id),
                'summary': 'No completed lab results are available for this order yet.',
                'result_count': 0,
                'results': [],
                'suggested_next_checks': ['Wait for results before generating interpretation.'],
                'advisory_only': True,
            },
            'confidence': 0.60,
            'citations': [],
        }

    history_by_test = _load_history_for_order(order, results)
    interpreted_results = []
    confidences: list[float] = []
    citations: list[dict[str, Any]] = []

    for result in results:
        history = history_by_test.get(str(result.order_test.test_id), [])
        confidences.append(_confidence_for_result(result, history))
        payload = _build_result_payload(result, audience=audience, history=history)
        interpreted_results.append(payload)
        citations.append(_citation_for_result(result, kind='laboratory.lab_result'))
        citations.extend(_citation_for_result(item, kind='laboratory.lab_result_history') for item in history[:1])

    critical_count = sum(1 for item in results if item.flag in {'critical_low', 'critical_high'})
    abnormal_count = sum(1 for item in results if item.flag in {'high', 'low', 'abnormal'})
    normal_count = sum(1 for item in results if item.flag == 'normal')

    if audience == 'patient':
        summary = (
            f'{len(results)} result(s) available: '
            f'{critical_count} critical, {abnormal_count} outside expected range, {normal_count} normal.'
        )
    else:
        summary = (
            f'{len(results)} result(s) interpreted for order {order.order_number}: '
            f'{critical_count} critical, {abnormal_count} abnormal, {normal_count} normal.'
        )

    suggested_next_checks: list[str] = []
    for item in interpreted_results:
        for suggestion in item['suggested_next_checks']:
            if suggestion not in suggested_next_checks:
                suggested_next_checks.append(suggestion)
            if len(suggested_next_checks) >= 4:
                break
        if len(suggested_next_checks) >= 4:
            break

    return {
        'result': {
            'mode': 'order',
            'audience': audience,
            'order_id': str(order.id),
            'order_number': order.order_number,
            'summary': summary,
            'result_count': len(results),
            'critical_count': critical_count,
            'abnormal_count': abnormal_count,
            'normal_count': normal_count,
            'results': interpreted_results,
            'suggested_next_checks': suggested_next_checks,
            'advisory_only': True,
        },
        'confidence': min(confidences) if confidences else 0.60,
        'citations': citations[:12],
    }
