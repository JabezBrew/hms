from datetime import datetime, timedelta
import logging
import math
import statistics

from django.core.cache import cache
from django.db.models import Count, Exists, OuterRef, Q
from django.db.models.functions import TruncHour
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.appointments.models import Appointment
from apps.audit.models import AuditAction, AuditLog
from apps.clinical_notes.models import NoteEntry
from apps.core.cache_utils import facility_cache_key_for_code
from apps.core.models import BreakGlassEvent
from apps.core.security import FacilityScopedPermission, get_user_facility
from apps.dashboards.tasks import (
    refresh_admin_dashboard_appointments,
    refresh_doctor_dashboard_appointments,
    refresh_facility_dashboard_appointments,
)
from apps.encounters.models import Encounter
from apps.nursing.models import MedicationAdministration, NursingAlert, NursingTask
from apps.organization.models import DepartmentDutyType, RosterEntry
from apps.users.models import PatientProfile, PractitionerProfile
from apps.wards.models import Admission, Bed, Ward
from .appointment_cache import extract_patient_fhir_id
from .realtime import (
    admin_dashboard_projection_cache_key,
    doctor_clinic_projection_cache_key,
    doctor_my_work_projection_cache_key,
    inpatient_dashboard_projection_cache_key,
    nurse_dashboard_projection_cache_key,
    reception_dashboard_projection_cache_key,
)

logger = logging.getLogger(__name__)

ADMIN_DASHBOARD_V2_ALLOWED_WINDOWS = {'now', 'today', '7d'}
ADMIN_DASHBOARD_V2_ROOT_CACHE_TTL = 30
ADMIN_DASHBOARD_V2_SECTION_CACHE_TTL = 60


def _resolve_dashboard_role(user):
    """
    Normalize user role resolution across legacy/new user payloads.
    """
    return getattr(user, 'user_type', None) or getattr(user, 'role', None)


@api_view(['GET'])
@permission_classes([IsAuthenticated, FacilityScopedPermission])
def my_work_dashboard(request):
    """
    Role-based dashboard data
    Routes to appropriate dashboard based on user role

    GET /api/dashboards/my-work/
    """
    user = request.user

    # Get user role
    role = _resolve_dashboard_role(user)

    # Route to appropriate dashboard
    if role in ['doctor', 'physician', 'practitioner']:
        return Response(get_doctor_dashboard_data(user, request))
    elif role in ['nurse', 'head_nurse', 'nurse_practitioner']:
        return Response(get_nurse_dashboard_data(user, request))
    elif role in ['receptionist', 'admin_staff']:
        return Response(get_receptionist_dashboard_data(user, request))
    else:
        # Default generic dashboard
        return Response({
            'role': role or 'unknown',
            'message': 'Dashboard not configured for this role'
        })


def _get_cached_appointments(facility_code, cache_key, refresh_fn):
    cached = cache.get(facility_cache_key_for_code(facility_code, cache_key))
    if cached is not None:
        return cached, False

    stale_key = facility_cache_key_for_code(facility_code, f"{cache_key}_stale")
    stale = cache.get(stale_key)

    lock_key = facility_cache_key_for_code(facility_code, f"{cache_key}_lock")
    if cache.add(lock_key, "1", timeout=30):
        refresh_fn()

    if stale is not None:
        return stale, True

    return [], True


def _is_admin_actor(user):
    role = str(_resolve_dashboard_role(user) or '').lower()
    return role == 'admin' or bool(getattr(user, 'is_staff', False) or getattr(user, 'is_superuser', False))


def _forbidden_admin_only_response():
    return Response({'detail': 'Admin role is required.'}, status=403)


def _today_bounds(now):
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    return day_start, day_start + timedelta(days=1)


def _window_bounds(window, now):
    if window == 'now':
        return now - timedelta(hours=2), now
    if window == '7d':
        day_start, day_end = _today_bounds(now)
        return day_start - timedelta(days=6), day_end
    return _today_bounds(now)


def _safe_trend_pct(current, baseline):
    current_value = float(current or 0)
    baseline_value = float(baseline or 0)
    if baseline_value <= 0:
        return 100.0 if current_value > 0 else 0.0
    return round(((current_value - baseline_value) / baseline_value) * 100, 1)


def _severity_rank(severity):
    return 0 if severity == 'critical' else 1


def _percentile_value(values, percentile):
    if not values:
        return 0
    index = max(0, min(len(values) - 1, math.ceil(len(values) * percentile) - 1))
    return values[index]


def _combine_hourly_series(admissions_by_hour, discharges_by_hour):
    combined = {}
    for row in admissions_by_hour:
        bucket = row['bucket']
        combined.setdefault(bucket, {'hour': bucket.isoformat(), 'admissions': 0, 'discharges': 0})
        combined[bucket]['admissions'] = row['count']
    for row in discharges_by_hour:
        bucket = row['bucket']
        combined.setdefault(bucket, {'hour': bucket.isoformat(), 'admissions': 0, 'discharges': 0})
        combined[bucket]['discharges'] = row['count']
    return [combined[key] for key in sorted(combined.keys())]


def _parse_admin_v2_window(raw_window):
    value = str(raw_window or 'today').strip().lower()
    return value if value in ADMIN_DASHBOARD_V2_ALLOWED_WINDOWS else None


def _parse_admin_v2_expand(raw_expand):
    if not raw_expand:
        return set()
    allowed = {'capacity', 'workforce', 'compliance', 'actions'}
    tokens = {token.strip().lower() for token in str(raw_expand).split(',') if token.strip()}
    return {token for token in tokens if token in allowed}


def _build_admin_v2_capacity_detail(facility, now, window):
    start_dt, end_dt = _window_bounds(window, now)

    wards_qs = Ward.objects.filter(
        is_active=True,
        department__facility=facility,
    ).annotate(
        total_beds_annotated=Count('beds'),
        occupied_beds_annotated=Count('beds', filter=Q(beds__status='occupied')),
        available_beds_annotated=Count('beds', filter=Q(beds__status='available')),
        maintenance_beds_annotated=Count('beds', filter=Q(beds__status='maintenance')),
    )
    wards = list(wards_qs)

    ward_rows = []
    high_occupancy_count = 0
    for ward in wards:
        occupancy_pct = (
            (ward.occupied_beds_annotated / ward.total_beds_annotated) * 100
        ) if ward.total_beds_annotated else 0
        if occupancy_pct >= 90:
            high_occupancy_count += 1
        ward_rows.append({
            'ward_id': str(ward.id),
            'ward_name': ward.name,
            'occupied_beds': ward.occupied_beds_annotated,
            'available_beds': ward.available_beds_annotated,
            'maintenance_beds': ward.maintenance_beds_annotated,
            'total_beds': ward.total_beds_annotated,
            'occupancy_pct': round(occupancy_pct, 1),
        })
    ward_rows.sort(key=lambda row: row['occupancy_pct'], reverse=True)

    admissions_by_hour = Admission.objects.filter(
        facility=facility,
        admission_date__gte=start_dt,
        admission_date__lt=end_dt,
    ).annotate(
        bucket=TruncHour('admission_date')
    ).values('bucket').annotate(
        count=Count('id')
    ).order_by('bucket')

    discharges_by_hour = Admission.objects.filter(
        facility=facility,
        actual_discharge_date__gte=start_dt,
        actual_discharge_date__lt=end_dt,
    ).annotate(
        bucket=TruncHour('actual_discharge_date')
    ).values('bucket').annotate(
        count=Count('id')
    ).order_by('bucket')

    delay_window_end = min(end_dt, now)
    delayed_start_times = list(
        Appointment.objects.filter(
            facility=facility,
            status__in=['proposed', 'pending', 'booked', 'arrived'],
            start_time__gte=start_dt,
            start_time__lt=delay_window_end,
        ).order_by('-start_time').values_list('start_time', flat=True)[:500]
    )
    delays = sorted(max(int((now - start_time).total_seconds() / 60), 0) for start_time in delayed_start_times)
    median_wait = round(statistics.median(delays), 1) if delays else 0
    p95_wait = _percentile_value(delays, 0.95) if delays else 0

    status = 'normal'
    if high_occupancy_count > 0:
        status = 'warning'
    if any(row['occupancy_pct'] >= 100 for row in ward_rows):
        status = 'critical'

    return {
        'summary': {
            'status': status,
            'ward_count': len(wards),
            'high_occupancy_wards': high_occupancy_count,
        },
        'wards': ward_rows[:20],
        'admissions_discharges_hourly': _combine_hourly_series(admissions_by_hour, discharges_by_hour),
        'wait_time': {
            'median_minutes': median_wait,
            'p95_minutes': p95_wait,
        },
    }


def _build_admin_v2_workforce_detail(facility, now, window):
    today = now.date()

    required_rows = DepartmentDutyType.objects.filter(
        department__root_unit__code=facility.code,
        department__is_active=True,
        is_active=True,
    ).values(
        'department_id',
        'department__name',
    ).annotate(
        required=Count('id')
    )

    filled_rows = RosterEntry.objects.filter(
        department__root_unit__code=facility.code,
        department__is_active=True,
        date=today,
        status='published',
    ).values(
        'department_id',
        'department__name',
    ).annotate(
        filled=Count('id')
    )

    coverage_map = {}
    for row in required_rows:
        dept_id = str(row['department_id'])
        coverage_map[dept_id] = {
            'unit_id': dept_id,
            'unit_name': row['department__name'] or 'Unknown Unit',
            'required': row['required'],
            'filled': 0,
        }
    for row in filled_rows:
        dept_id = str(row['department_id'])
        if dept_id not in coverage_map:
            coverage_map[dept_id] = {
                'unit_id': dept_id,
                'unit_name': row['department__name'] or 'Unknown Unit',
                'required': 0,
                'filled': row['filled'],
            }
        else:
            coverage_map[dept_id]['filled'] = row['filled']

    coverage_rows = []
    for row in coverage_map.values():
        uncovered = max((row['required'] or 0) - (row['filled'] or 0), 0)
        coverage_rows.append({
            **row,
            'uncovered': uncovered,
        })

    coverage_rows.sort(key=lambda item: (item['uncovered'] * -1, item['unit_name']))

    published_entry_exists = RosterEntry.objects.filter(
        duty_type_id=OuterRef('pk'),
        date=today,
        status='published',
    )
    uncovered_shift_rows = DepartmentDutyType.objects.filter(
        department__root_unit__code=facility.code,
        department__is_active=True,
        is_active=True,
    ).annotate(
        has_entry=Exists(published_entry_exists)
    ).filter(
        has_entry=False
    ).select_related('department').order_by(
        'department__name',
        'display_order',
        'name',
    )[:20]

    uncovered_shifts = []
    for duty_type in uncovered_shift_rows:
        starts_at = None
        if duty_type.start_time:
            starts_at = timezone.make_aware(
                datetime.combine(today, duty_type.start_time),
                timezone.get_current_timezone(),
            ).isoformat()
        uncovered_shifts.append({
            'shift_id': str(duty_type.id),
            'unit_name': duty_type.department.name if duty_type.department else 'Unknown Unit',
            'duty_type_name': duty_type.name,
            'starts_at': starts_at,
            'priority': 'high' if duty_type.category in {'ward', 'on_call'} else 'medium',
        })

    required_total = sum(row['required'] for row in coverage_rows)
    filled_total = sum(row['filled'] for row in coverage_rows)
    critical_uncovered = sum(1 for row in uncovered_shifts if row['priority'] == 'high')
    next_2h_cutoff = (now + timedelta(hours=2)).time()
    next_2h_risks = sum(
        1 for shift in uncovered_shift_rows
        if shift.start_time is not None and now.time() <= shift.start_time <= next_2h_cutoff
    )

    status = 'normal'
    if critical_uncovered > 0 or next_2h_risks > 0:
        status = 'warning'

    overtime_risks = [
        {
            'unit_name': row['unit_name'],
            'at_risk_staff_count': row['uncovered'],
        }
        for row in coverage_rows if row['uncovered'] > 0
    ][:5]

    return {
        'summary': {
            'status': status,
            'required_shifts': required_total,
            'filled_shifts': filled_total,
            'critical_uncovered_count': critical_uncovered,
            'next_2h_risks': next_2h_risks,
        },
        'coverage_by_unit': coverage_rows[:20],
        'uncovered_shifts': uncovered_shifts,
        'overtime_risks': overtime_risks,
    }


def _build_admin_v2_compliance_detail(facility, now, window):
    last_24h = now - timedelta(hours=24)
    last_7d = now - timedelta(days=7)
    today_start, tomorrow_start = _today_bounds(now)

    break_glass_qs = BreakGlassEvent.objects.filter(
        patient__facility=facility,
        created_at__gte=last_7d,
    ).select_related('user').order_by('-created_at')

    break_glass_recent = [
        {
            'id': str(event.id),
            'scope': event.scope,
            'created_at': event.created_at.isoformat(),
            'expires_at': event.expires_at.isoformat(),
            'requester_role': _resolve_dashboard_role(event.user) or 'unknown',
        }
        for event in break_glass_qs[:20]
    ]

    anomaly_actions = [AuditAction.LOGIN_FAILED, AuditAction.OFFSITE_ACCESS, AuditAction.BREAK_GLASS]
    anomaly_rows = list(
        AuditLog.objects.filter(
            facility=facility,
            timestamp__gte=last_24h,
            action__in=anomaly_actions,
        ).values('action').annotate(
            count=Count('id')
        ).order_by('-count')
    )
    anomalies_24h = sum(row['count'] for row in anomaly_rows)

    encounters_today = Encounter.objects.filter(
        facility=facility,
        status='finished',
        start_time__gte=today_start,
        start_time__lt=tomorrow_start,
    )
    documented_encounters = encounters_today.annotate(
        has_notes=Exists(NoteEntry.objects.filter(encounter_id=OuterRef('pk')))
    ).filter(has_notes=True).count()
    total_encounters = encounters_today.count()
    documentation_pct = round((documented_encounters / total_encounters) * 100, 1) if total_encounters else 100.0

    break_glass_pending_review = break_glass_qs.filter(created_at__gte=last_24h).count()

    status = 'normal'
    if anomalies_24h > 0 or break_glass_pending_review > 0:
        status = 'warning'

    return {
        'summary': {
            'status': status,
            'break_glass_pending_review': break_glass_pending_review,
            'audit_anomalies_24h': anomalies_24h,
            'documentation_completeness_pct': documentation_pct,
        },
        'break_glass_recent': break_glass_recent,
        'audit_anomalies_breakdown': [
            {
                'action': row['action'],
                'count': row['count'],
            }
            for row in anomaly_rows
        ],
        'documentation': {
            'finished_encounters_today': total_encounters,
            'documented_encounters_today': documented_encounters,
            'completeness_pct': documentation_pct,
        },
    }


def _build_admin_v2_actions(kpis, section_summaries):
    actions = []
    occupancy_pct = (kpis.get('occupancy') or {}).get('percent') or 0
    staffing_uncovered = (kpis.get('staffing_coverage') or {}).get('critical_uncovered') or 0
    compliance_total = (kpis.get('compliance_risk') or {}).get('total') or 0
    discharges = kpis.get('discharges_today') or {}
    planned_discharges = discharges.get('planned') or 0
    completed_discharges = discharges.get('completed') or 0
    throughput = kpis.get('appointment_throughput') or {}
    throughput_rate = throughput.get('completion_rate') or 0

    if occupancy_pct >= 90:
        actions.append({
            'id': 'action_bed_board',
            'severity': 'critical',
            'title': 'Open bed board for capacity intervention',
            'href': '/wards',
        })

    if staffing_uncovered > 0:
        actions.append({
            'id': 'action_fill_shift',
            'severity': 'warning',
            'title': 'Assign uncovered critical shifts',
            'href': '/admin/organization/duty-roster',
        })

    if compliance_total > 0:
        actions.append({
            'id': 'action_review_compliance',
            'severity': 'warning',
            'title': 'Review compliance queue',
            'href': '/admin/audit-logs',
        })

    if planned_discharges > completed_discharges:
        actions.append({
            'id': 'action_discharges',
            'severity': 'warning',
            'title': 'Resolve delayed discharge workflow',
            'href': '/admissions/new',
        })

    if throughput_rate < 70:
        actions.append({
            'id': 'action_appointments',
            'severity': 'warning',
            'title': 'Investigate low appointment throughput',
            'href': '/appointments',
        })

    if not actions:
        actions.append({
            'id': 'action_monitor',
            'severity': 'normal',
            'title': 'No urgent operational action required',
            'href': '/dashboards/admin',
        })

    actions.sort(key=lambda item: (_severity_rank(item['severity']), item['title']))
    return actions


def _build_admin_v2_root_payload(facility, now, window, expand_sections=None):
    expand_sections = expand_sections or set()
    today_start, tomorrow_start = _today_bounds(now)
    yesterday_start = today_start - timedelta(days=1)

    bed_stats = Bed.objects.filter(facility=facility).aggregate(
        total=Count('id'),
        occupied=Count('id', filter=Q(status='occupied')),
    )
    total_beds = bed_stats['total'] or 0
    occupied_beds = bed_stats['occupied'] or 0
    occupancy_pct = round((occupied_beds / total_beds) * 100, 1) if total_beds else 0.0

    admission_rollup = Admission.objects.filter(
        facility=facility,
    ).aggregate(
        admissions_today=Count(
            'id',
            filter=Q(admission_date__gte=today_start, admission_date__lt=tomorrow_start),
        ),
        admissions_yesterday=Count(
            'id',
            filter=Q(admission_date__gte=yesterday_start, admission_date__lt=today_start),
        ),
        planned_discharges=Count(
            'id',
            filter=Q(
                status='admitted',
                expected_discharge_date__gte=today_start,
                expected_discharge_date__lt=tomorrow_start,
            ),
        ),
        completed_discharges=Count(
            'id',
            filter=Q(actual_discharge_date__gte=today_start, actual_discharge_date__lt=tomorrow_start),
        ),
    )
    admissions_today = admission_rollup['admissions_today'] or 0
    admissions_yesterday = admission_rollup['admissions_yesterday'] or 0
    planned_discharges = admission_rollup['planned_discharges'] or 0
    completed_discharges = admission_rollup['completed_discharges'] or 0

    appointment_rollup = Appointment.objects.filter(
        facility=facility,
    ).aggregate(
        scheduled=Count(
            'id',
            filter=Q(start_time__gte=today_start, start_time__lt=tomorrow_start) & ~Q(status='cancelled'),
        ),
        completed=Count(
            'id',
            filter=Q(start_time__gte=today_start, start_time__lt=tomorrow_start, status='fulfilled'),
        ),
    )
    scheduled_appointments = appointment_rollup['scheduled'] or 0
    completed_appointments = appointment_rollup['completed'] or 0
    completion_rate = round((completed_appointments / scheduled_appointments) * 100, 1) if scheduled_appointments else 0.0

    required_shifts = DepartmentDutyType.objects.filter(
        department__root_unit__code=facility.code,
        department__is_active=True,
        is_active=True,
    ).count()
    filled_shifts = RosterEntry.objects.filter(
        department__root_unit__code=facility.code,
        department__is_active=True,
        date=today_start.date(),
        status='published',
    ).count()
    critical_uncovered = max(required_shifts - filled_shifts, 0)

    last_24h = now - timedelta(hours=24)
    break_glass_pending_review = BreakGlassEvent.objects.filter(
        patient__facility=facility,
        created_at__gte=last_24h,
    ).count()
    audit_anomalies_24h = AuditLog.objects.filter(
        facility=facility,
        timestamp__gte=last_24h,
        action__in=[AuditAction.LOGIN_FAILED, AuditAction.OFFSITE_ACCESS, AuditAction.BREAK_GLASS],
    ).count()
    compliance_total = break_glass_pending_review + audit_anomalies_24h

    ward_rollup = list(Ward.objects.filter(
        is_active=True,
        department__facility=facility,
    ).annotate(
        total_beds_annotated=Count('beds'),
        occupied_beds_annotated=Count('beds', filter=Q(beds__status='occupied')),
    ).values('total_beds_annotated', 'occupied_beds_annotated'))
    ward_count = len(ward_rollup)
    high_occupancy_wards = 0
    for ward in ward_rollup:
        ward_total_beds = ward['total_beds_annotated'] or 0
        ward_occupied_beds = ward['occupied_beds_annotated'] or 0
        ward_occupancy = ((ward_occupied_beds / ward_total_beds) * 100) if ward_total_beds else 0
        if ward_occupancy >= 90:
            high_occupancy_wards += 1

    capacity_status = 'normal'
    if occupancy_pct >= 100:
        capacity_status = 'critical'
    elif occupancy_pct >= 85:
        capacity_status = 'warning'

    workforce_status = 'warning' if critical_uncovered > 0 else 'normal'
    compliance_status = 'warning' if compliance_total > 0 else 'normal'

    kpis = {
        'occupancy': {
            'percent': occupancy_pct,
            'occupied_beds': occupied_beds,
            'total_beds': total_beds,
            'trend_pct': _safe_trend_pct(occupied_beds, max(total_beds - occupied_beds, 0)),
        },
        'admissions_today': {
            'count': admissions_today,
            'trend_pct': _safe_trend_pct(admissions_today, admissions_yesterday),
        },
        'discharges_today': {
            'planned': planned_discharges,
            'completed': completed_discharges,
            'completion_rate': round((completed_discharges / planned_discharges) * 100, 1) if planned_discharges else 0.0,
        },
        'appointment_throughput': {
            'scheduled': scheduled_appointments,
            'completed': completed_appointments,
            'completion_rate': completion_rate,
        },
        'staffing_coverage': {
            'required_shifts': required_shifts,
            'filled_shifts': filled_shifts,
            'critical_uncovered': critical_uncovered,
        },
        'compliance_risk': {
            'break_glass_pending_review': break_glass_pending_review,
            'audit_anomalies_24h': audit_anomalies_24h,
            'total': compliance_total,
        },
    }

    section_summaries = {
        'capacity': {
            'status': capacity_status,
            'ward_count': ward_count,
            'high_occupancy_wards': high_occupancy_wards,
        },
        'workforce': {
            'status': workforce_status,
            'critical_uncovered_count': critical_uncovered,
            'next_2h_risks': critical_uncovered,
        },
        'compliance': {
            'status': compliance_status,
            'break_glass_pending_review': break_glass_pending_review,
            'audit_anomalies_24h': audit_anomalies_24h,
        },
    }

    alerts = []
    if occupancy_pct >= 90:
        alerts.append({
            'id': 'alert_capacity',
            'severity': 'critical' if occupancy_pct >= 100 else 'warning',
            'title': f'Bed occupancy at {occupancy_pct:.1f}%',
            'started_at': now.isoformat(),
            'primary_action': {'label': 'Open bed board', 'href': '/wards'},
        })
    if critical_uncovered > 0:
        alerts.append({
            'id': 'alert_staffing',
            'severity': 'warning',
            'title': f'{critical_uncovered} critical shifts uncovered',
            'started_at': now.isoformat(),
            'primary_action': {'label': 'Open roster', 'href': '/admin/organization/duty-roster'},
        })
    if break_glass_pending_review > 0:
        alerts.append({
            'id': 'alert_break_glass',
            'severity': 'warning',
            'title': f'{break_glass_pending_review} break-glass events awaiting review',
            'started_at': now.isoformat(),
            'primary_action': {'label': 'Open audit logs', 'href': '/admin/audit-logs'},
        })
    if audit_anomalies_24h > 0:
        alerts.append({
            'id': 'alert_audit',
            'severity': 'warning',
            'title': f'{audit_anomalies_24h} audit anomalies in the last 24h',
            'started_at': now.isoformat(),
            'primary_action': {'label': 'Review anomalies', 'href': '/admin/audit-logs'},
        })
    alerts.sort(key=lambda item: (_severity_rank(item['severity']), item['title']))

    actions = _build_admin_v2_actions(kpis, section_summaries)

    payload = {
        'meta': {
            'facility_code': facility.code,
            'window': window,
            'generated_at': now.isoformat(),
            'stale': False,
            'stale_sections': [],
        },
        'alerts_top': alerts[:3],
        'kpis': kpis,
        'section_summaries': section_summaries,
        'action_queue_top': actions[:5],
        'links': {
            'capacity': '/api/dashboards/admin-v2/capacity/',
            'workforce': '/api/dashboards/admin-v2/workforce/',
            'compliance': '/api/dashboards/admin-v2/compliance/',
        },
    }

    if 'actions' in expand_sections:
        payload['actions'] = actions[:20]
    if 'capacity' in expand_sections:
        payload['capacity'] = _build_admin_v2_capacity_detail(facility, now, window)
    if 'workforce' in expand_sections:
        payload['workforce'] = _build_admin_v2_workforce_detail(facility, now, window)
    if 'compliance' in expand_sections:
        payload['compliance'] = _build_admin_v2_compliance_detail(facility, now, window)

    return payload


def get_doctor_dashboard_data(user, request):
    """
    Doctor dashboard: Today's clinic with scheduled consultations

    Returns:
        {
            'role': 'doctor',
            'user_name': 'Dr. Smith',
            'current_patient': {...},
            'upcoming': [...],
            'completed': [...]
        }
    """
    facility = get_user_facility(request)
    if not facility:
        return {
            'role': 'doctor',
            'user_name': user.get_full_name(),
            'error': 'Facility context is required',
            'current_patient': None,
            'upcoming': [],
            'completed': [],
        }

    # Get today's date
    today = timezone.now().date()

    # Get practitioner profile
    practitioner_id = None
    if hasattr(user, 'practitionerprofile'):
        practitioner_id = user.practitionerprofile.fhir_practitioner_id

    if not practitioner_id:
        return {
            'role': 'doctor',
            'user_name': user.get_full_name(),
            'error': 'Practitioner profile not found',
            'current_patient': None,
            'upcoming': [],
            'completed': [],
        }

    projection_cache_key = doctor_my_work_projection_cache_key(
        facility.code,
        practitioner_id,
        today,
    )
    cached_projection = cache.get(projection_cache_key)
    if cached_projection is not None:
        return {
            'role': 'doctor',
            'user_name': user.get_full_name(),
            **cached_projection,
        }

    # Fetch today's appointments (cached; refreshed asynchronously)
    try:
        cache_key = f"doctor_dashboard_appointments_{practitioner_id}_{today.isoformat()}"
        all_appointments, is_stale = _get_cached_appointments(
            facility.code,
            cache_key,
            lambda: refresh_doctor_dashboard_appointments.delay(
                facility_id=str(facility.id),
                facility_code=facility.code,
                practitioner_id=practitioner_id,
                date_str=today.isoformat(),
            ),
        )

        # Separate by status
        current_patient = None
        upcoming = []
        completed_today = []

        now = timezone.now()

        for appt in all_appointments:
            appt_data = format_appointment_for_dashboard(appt)

            if appt.get('status') == 'fulfilled' or appt.get('status') == 'cancelled':
                completed_today.append(appt_data)
            elif appt.get('status') == 'arrived' or appt.get('status') == 'in-progress':
                # This is likely the current patient
                if not current_patient:
                    current_patient = appt_data
                else:
                    upcoming.append(appt_data)
            else:
                # booked or pending
                upcoming.append(appt_data)

        # Sort upcoming by start time
        upcoming.sort(key=lambda x: x.get('start_time', ''))

        # If no current patient, take the first upcoming if it's within 15 minutes
        if not current_patient and upcoming:
            first_upcoming = upcoming[0]
            # Check if appointment time is within 15 minutes
            try:
                appt_time_str = first_upcoming.get('start_time')
                if appt_time_str:
                    appt_time = timezone.datetime.fromisoformat(appt_time_str.replace('Z', '+00:00'))
                    if abs((now - appt_time).total_seconds()) < 900:  # 15 minutes
                        current_patient = upcoming.pop(0)
            except:
                pass

        projection = {
            'date': today.isoformat(),
            'current_patient': current_patient,
            'upcoming': upcoming[:10],  # Next 10 appointments
            'completed': completed_today[-5:],  # Last 5 completed
            'appointments_stale': bool(is_stale),
        }
        # Keep stale projection short-lived so async refresh can replace it quickly.
        cache.set(projection_cache_key, projection, timeout=300 if not is_stale else 15)
        return {
            'role': 'doctor',
            'user_name': user.get_full_name(),
            **projection,
        }

    except Exception as e:
        logger.error(f"Error fetching doctor dashboard data: {str(e)}")
        return {
            'role': 'doctor',
            'user_name': user.get_full_name(),
            'error': f'Failed to load appointments: {str(e)}',
            'current_patient': None,
            'upcoming': [],
            'completed': [],
        }


def get_nurse_dashboard_data(user, request):
    """
    Nurse dashboard: Ward assignments and tasks

    Returns:
        {
            'role': 'nurse',
            'user_name': 'Nurse Johnson',
            'assigned_ward': 'Ward 3A',
            'urgent': {...},
            'shift_patients': [...],
            'medications_schedule': [...],
            'tasks': [...],
        }
    """
    facility = get_user_facility(request)
    if not facility:
        return {
            'role': 'nurse',
            'user_name': user.get_full_name(),
            'assigned_ward': None,
            'urgent': {},
            'shift_patients': [],
            'medications_schedule': [],
            'tasks': [],
        }

    now = timezone.now()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    # Get ward filter from query params
    ward_id = request.query_params.get('ward')

    # Get nurse's assigned ward
    nurse_profile = getattr(user, 'practitionerprofile', None)
    assigned_ward = ward_id or (getattr(nurse_profile, 'assigned_ward_id', None) if nurse_profile else None)

    ward_scope = str(assigned_ward) if assigned_ward else "all"
    projection_cache_key = nurse_dashboard_projection_cache_key(facility.code, ward_scope)
    cached_projection = cache.get(projection_cache_key)
    if cached_projection is not None:
        return {
            'role': 'nurse',
            'user_name': user.get_full_name(),
            **cached_projection,
        }

    # Build admission filter
    admission_filter = {'status': 'admitted', 'facility': facility}
    if assigned_ward:
        admission_filter['bed__ward_id'] = assigned_ward

    # Get admitted patients
    admissions_qs = Admission.objects.filter(**admission_filter).select_related(
        'patient', 'patient__user', 'bed', 'bed__ward', 'admitting_doctor', 'admitting_doctor__staff', 'admitting_doctor__staff__user'
    ).order_by('bed__bed_number')

    patient_ids_subquery = admissions_qs.values('patient_id')
    admissions = list(admissions_qs)

    # Critical alerts (unacknowledged, high severity)
    critical_alerts = NursingAlert.objects.filter(
        facility=facility,
        patient_id__in=patient_ids_subquery,
        is_acknowledged=False,
        severity__in=['critical', 'high']
    ).select_related('patient', 'patient__user').order_by('-created_at')[:10]

    # Overdue medications
    overdue_meds = MedicationAdministration.objects.filter(
        facility=facility,
        patient_id__in=patient_ids_subquery,
        status='scheduled',
        scheduled_time__lt=now
    ).select_related('patient', 'patient__user').order_by('scheduled_time')[:10]

    # Medications due in next 2 hours
    medications_due = MedicationAdministration.objects.filter(
        facility=facility,
        patient_id__in=patient_ids_subquery,
        status='scheduled',
        scheduled_time__gte=now,
        scheduled_time__lte=now + timedelta(hours=2)
    ).select_related('patient', 'patient__user').order_by('scheduled_time')

    # Today's pending tasks
    pending_tasks = NursingTask.objects.filter(
        facility=facility,
        patient_id__in=patient_ids_subquery,
        status__in=['pending', 'overdue'],
        scheduled_time__gte=today_start
    ).select_related('patient', 'patient__user').order_by('scheduled_time')

    # Format shift patients
    shift_patients_data = []
    for admission in admissions:
        shift_patients_data.append({
            'id': str(admission.id),
            'patient_id': str(admission.patient.id),
            'patient_name': admission.patient.user.get_full_name(),
            'mrn': admission.patient.medical_record_number,
            'ward_name': admission.bed.ward.name if admission.bed else None,
            'bed_number': admission.bed.bed_number if admission.bed else None,
            'admission_date': admission.admission_date.isoformat(),
            'admitting_doctor': admission.admitting_doctor.staff.user.get_full_name() if admission.admitting_doctor else None,
        })

    # Format critical alerts
    alerts_data = []
    for alert in critical_alerts:
        alerts_data.append({
            'id': str(alert.id),
            'patient_id': str(alert.patient.id),
            'patient_name': alert.patient.user.get_full_name(),
            'alert_type': alert.alert_type,
            'severity': alert.severity,
            'message': alert.message,
            'created_at': alert.created_at.isoformat(),
        })

    # Format overdue medications
    overdue_meds_data = []
    for med in overdue_meds:
        overdue_meds_data.append({
            'id': str(med.id),
            'patient_id': str(med.patient.id),
            'patient_name': med.patient.user.get_full_name(),
            'medication_name': med.medication_name,
            'dose': med.dose,
            'scheduled_time': med.scheduled_time.isoformat(),
        })

    # Format medications due
    meds_due_data = []
    for med in medications_due:
        meds_due_data.append({
            'id': str(med.id),
            'patient_id': str(med.patient.id),
            'patient_name': med.patient.user.get_full_name(),
            'medication_name': med.medication_name,
            'dose': med.dose,
            'route': med.route,
            'scheduled_time': med.scheduled_time.isoformat(),
        })

    # Format tasks
    tasks_data = []
    for task in pending_tasks:
        tasks_data.append({
            'id': str(task.id),
            'patient_id': str(task.patient.id),
            'patient_name': task.patient.user.get_full_name(),
            'title': task.title,
            'description': task.description,
            'priority': task.priority,
            'status': task.status,
            'scheduled_time': task.scheduled_time.isoformat(),
        })

    projection = {
        'assigned_ward': str(assigned_ward) if assigned_ward else None,
        'urgent': {
            'critical_alerts': alerts_data,
            'overdue_medications': overdue_meds_data,
            'count': len(alerts_data) + len(overdue_meds_data),
        },
        'shift_patients': shift_patients_data,
        'medications_schedule': meds_due_data,
        'tasks': tasks_data,
    }
    # Avoid keeping async-refresh stale snapshots warm for too long.
    cache.set(projection_cache_key, projection, timeout=300 if not is_stale else 15)
    return {
        'role': 'nurse',
        'user_name': user.get_full_name(),
        **projection,
    }


def get_receptionist_dashboard_data(user, request):
    """
    Receptionist dashboard: Front desk operations

    Returns:
        {
            'role': 'receptionist',
            'user_name': 'Jane Doe',
            'check_in_queue': [...],
            'schedule': {...},
            'stats': {...},
        }
    """
    facility = get_user_facility(request)
    if not facility:
        return {
            'role': 'receptionist',
            'user_name': user.get_full_name(),
            'date': timezone.now().date().isoformat(),
            'check_in_queue': [],
            'schedule': {'scheduled': [], 'in_progress': []},
            'stats': {'total_today': 0, 'waiting': 0, 'scheduled': 0, 'in_progress': 0},
        }

    projection_cache_key = reception_dashboard_projection_cache_key(facility.code)
    cached_projection = cache.get(projection_cache_key)
    if cached_projection is not None:
        return {
            'role': 'receptionist',
            'user_name': user.get_full_name(),
            **cached_projection,
        }

    today = timezone.now().date()

    cache_key = f"facility_dashboard_appointments_{today.isoformat()}"
    appointments, is_stale = _get_cached_appointments(
        facility.code,
        cache_key,
        lambda: refresh_facility_dashboard_appointments.delay(
            facility_id=str(facility.id),
            facility_code=facility.code,
            date_str=today.isoformat(),
        ),
    )
    formatted_appointments = [format_appointment_for_dashboard(appt) for appt in appointments]

    # Categorize by status
    check_in_queue = [a for a in formatted_appointments if a['status'] == 'arrived']
    scheduled = [a for a in formatted_appointments if a['status'] == 'booked']
    in_progress = [a for a in formatted_appointments if a['status'] in ['in-progress', 'fulfilled']]

    # Sort check-in queue by arrival time (earliest first)
    check_in_queue.sort(key=lambda x: x.get('start_time', ''))

    # Sort scheduled by appointment time
    scheduled.sort(key=lambda x: x.get('start_time', ''))

    projection = {
        'date': today.isoformat(),
        'check_in_queue': check_in_queue,
        'schedule': {
            'scheduled': scheduled,
            'in_progress': in_progress,
        },
        'stats': {
            'total_today': len(formatted_appointments),
            'waiting': len(check_in_queue),
            'scheduled': len(scheduled),
            'in_progress': len(in_progress),
        },
        'appointments_stale': bool(is_stale),
    }
    cache.set(projection_cache_key, projection, timeout=300)
    return {
        'role': 'receptionist',
        'user_name': user.get_full_name(),
        **projection,
    }


def format_appointment_for_dashboard(appointment):
    """
    Format appointment data for dashboard display

    Args:
        appointment: FHIR Appointment resource

    Returns:
        Formatted appointment dictionary
    """
    # Extract patient information
    participant_data = appointment.get('participant', [])
    patient_name = 'Unknown Patient'
    patient_id = None

    for participant in participant_data:
        actor = participant.get('actor', {})
        if actor.get('reference', '').startswith('Patient/'):
            patient_id = actor.get('reference').split('/')[-1]
            patient_name = actor.get('display', 'Unknown Patient')
            break

    # Extract appointment details
    start_time = appointment.get('start')
    end_time = appointment.get('end')
    status = appointment.get('status', 'unknown')

    # Extract reason/description
    reason = None
    if appointment.get('description'):
        reason = appointment.get('description')
    elif appointment.get('reasonCode'):
        reason_codes = appointment.get('reasonCode', [])
        if reason_codes and reason_codes[0].get('text'):
            reason = reason_codes[0].get('text')

    # Calculate time info
    time_info = ''
    if start_time:
        try:
            start_dt = timezone.datetime.fromisoformat(start_time.replace('Z', '+00:00'))
            time_info = start_dt.strftime('%I:%M %p')

            # Add relative time if upcoming
            now = timezone.now()
            if start_dt > now:
                delta = start_dt - now
                minutes = int(delta.total_seconds() / 60)
                if minutes < 60:
                    time_info += f' (in {minutes} min)'
        except:
            time_info = start_time

    return {
        'id': appointment.get('id'),
        'patient_id': patient_id,
        'patient_name': patient_name,
        'start_time': start_time,
        'end_time': end_time,
        'time_display': time_info,
        'status': status,
        'reason': reason,
        'appointment_type': appointment.get('appointmentType', {}).get('text', 'General'),
    }


@api_view(['GET'])
@permission_classes([IsAuthenticated, FacilityScopedPermission])
def clinic_schedule(request):
    """
    Get clinic schedule for a specific date
    More detailed than dashboard view

    GET /api/dashboards/clinic/
    Query params:
        - date: YYYY-MM-DD (defaults to today)
        - practitioner_id: Filter by practitioner (defaults to current user)
    """
    user = request.user
    facility = get_user_facility(request)
    if not facility:
        return Response({'error': 'Facility context is required'}, status=400)

    # Get date from query params
    date_str = request.query_params.get('date')
    if date_str:
        try:
            target_date = datetime.strptime(date_str, '%Y-%m-%d').date()
        except ValueError:
            return Response({'error': 'Invalid date format. Use YYYY-MM-DD'}, status=400)
    else:
        target_date = timezone.now().date()

    # Get practitioner ID
    practitioner_id = request.query_params.get('practitioner_id')
    if not practitioner_id:
        if hasattr(user, 'practitionerprofile'):
            practitioner_id = user.practitionerprofile.fhir_practitioner_id
        else:
            return Response({'error': 'Practitioner profile not found'}, status=400)

    if not practitioner_id:
        return Response({'error': 'Practitioner profile not found'}, status=400)

    projection_cache_key = doctor_clinic_projection_cache_key(
        facility.code,
        practitioner_id,
        target_date,
    )
    cached_projection = cache.get(projection_cache_key)
    if cached_projection is not None:
        return Response(cached_projection)

    try:
        cache_key = f"doctor_dashboard_appointments_{practitioner_id}_{target_date.isoformat()}"
        appointments, is_stale = _get_cached_appointments(
            facility.code,
            cache_key,
            lambda: refresh_doctor_dashboard_appointments.delay(
                facility_id=str(facility.id),
                facility_code=facility.code,
                practitioner_id=practitioner_id,
                date_str=target_date.isoformat(),
            ),
        )
        formatted_appointments = [format_appointment_for_dashboard(appt) for appt in appointments]
        formatted_appointments.sort(key=lambda x: x.get('start_time', ''))

        projection = {
            'date': target_date.isoformat(),
            'practitioner_id': practitioner_id,
            'appointments': formatted_appointments,
            'total_count': len(formatted_appointments),
            'appointments_stale': bool(is_stale),
        }
        cache.set(projection_cache_key, projection, timeout=300 if not is_stale else 15)
        return Response(projection)

    except Exception as e:
        logger.error(f"Error fetching clinic schedule: {str(e)}")
        return Response({'error': f'Failed to load schedule: {str(e)}'}, status=500)


@api_view(['GET'])
@permission_classes([IsAuthenticated, FacilityScopedPermission])
def nurse_dashboard(request):
    """
    Nurse-specific dashboard data
    GET /api/dashboards/nurse/
    Query params:
        - ward: Filter by ward ID (optional)
    """
    user = request.user
    return Response(get_nurse_dashboard_data(user, request))


@api_view(['GET'])
@permission_classes([IsAuthenticated, FacilityScopedPermission])
def inpatient_dashboard(request):
    """
    Inpatient doctor dashboard data
    GET /api/dashboards/inpatient/
    """
    user = request.user
    facility = get_user_facility(request)
    if not facility:
        return Response({
            'error': 'Facility context is required',
            'role': 'inpatient_doctor',
            'user_name': user.get_full_name(),
        })
    now = timezone.now()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    yesterday = today_start - timedelta(days=1)

    practitioner = getattr(user, 'practitionerprofile', None)

    if not practitioner:
        return Response({
            'error': 'Practitioner profile not found',
            'role': 'inpatient_doctor',
            'user_name': user.get_full_name(),
        })

    projection_cache_key = inpatient_dashboard_projection_cache_key(
        facility.code,
        str(practitioner.id),
    )
    cached_projection = cache.get(projection_cache_key)
    if cached_projection is not None:
        return Response({
            'role': 'inpatient_doctor',
            'user_name': user.get_full_name(),
            **cached_projection,
        })

    # New admissions (last 24 hours)
    new_admissions = Admission.objects.filter(
        facility=facility,
        status='admitted',
        admission_date__gte=yesterday,
        admitting_doctor=practitioner
    ).select_related('patient', 'patient__user', 'bed', 'bed__ward')

    # All my patients
    my_patients = Admission.objects.filter(
        facility=facility,
        status='admitted',
        admitting_doctor=practitioner
    ).select_related('patient', 'patient__user', 'bed', 'bed__ward')

    # Planned discharges today
    planned_discharges = Admission.objects.filter(
        facility=facility,
        status='admitted',
        expected_discharge_date__gte=today_start,
        expected_discharge_date__lt=today_start + timedelta(days=1),
        admitting_doctor=practitioner
    ).select_related('patient', 'patient__user', 'bed', 'bed__ward')

    # Format new admissions
    new_admissions_data = []
    for admission in new_admissions:
        new_admissions_data.append({
            'id': str(admission.id),
            'patient_id': str(admission.patient.id),
            'patient_name': admission.patient.user.get_full_name(),
            'mrn': admission.patient.medical_record_number,
            'ward_name': admission.bed.ward.name if admission.bed else None,
            'bed_number': admission.bed.bed_number if admission.bed else None,
            'admission_date': admission.admission_date.isoformat(),
            'admission_reason': admission.admission_notes,
        })

    # Format my patients
    my_patients_data = []
    for admission in my_patients:
        los_days = (timezone.now().date() - admission.admission_date.date()).days
        my_patients_data.append({
            'id': str(admission.id),
            'patient_id': str(admission.patient.id),
            'patient_name': admission.patient.user.get_full_name(),
            'mrn': admission.patient.medical_record_number,
            'ward_name': admission.bed.ward.name if admission.bed else None,
            'bed_number': admission.bed.bed_number if admission.bed else None,
            'admission_date': admission.admission_date.isoformat(),
            'los_days': los_days,
        })

    # Format planned discharges
    discharges_data = []
    for admission in planned_discharges:
        los_days = (timezone.now().date() - admission.admission_date.date()).days
        discharges_data.append({
            'id': str(admission.id),
            'patient_id': str(admission.patient.id),
            'patient_name': admission.patient.user.get_full_name(),
            'mrn': admission.patient.medical_record_number,
            'ward_name': admission.bed.ward.name if admission.bed else None,
            'bed_number': admission.bed.bed_number if admission.bed else None,
            'expected_discharge_date': admission.expected_discharge_date.isoformat() if admission.expected_discharge_date else None,
            'length_of_stay': max(los_days, 0),
        })

    projection = {
        'new_admissions': new_admissions_data,
        'my_patients': my_patients_data,
        'planned_discharges': discharges_data,
        'pending': {
            'orders_to_sign': [],  # Future: integrate with orders system
            'results_to_review': [],  # Future: integrate with lab results
        },
    }
    cache.set(projection_cache_key, projection, timeout=300)
    return Response({
        'role': 'inpatient_doctor',
        'user_name': user.get_full_name(),
        **projection,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated, FacilityScopedPermission])
def reception_dashboard(request):
    """
    Receptionist dashboard data
    GET /api/dashboards/reception/
    """
    user = request.user
    return Response(get_receptionist_dashboard_data(user, request))


@api_view(['GET'])
@permission_classes([IsAuthenticated, FacilityScopedPermission])
def admin_dashboard(request):
    """
    Admin dashboard with system-wide statistics
    GET /api/dashboards/admin/

    Optimized to avoid N+1 queries and handle slow external APIs gracefully.
    """
    from django.db.models import Count, Q

    facility = get_user_facility(request)
    if not facility:
        return Response({
            'role': 'admin',
            'user_name': request.user.get_full_name(),
            'error': 'Facility context is required',
            'stats': {},
            'wards': [],
        })

    projection_cache_key = admin_dashboard_projection_cache_key(facility.code)
    cached_projection = cache.get(projection_cache_key)
    if cached_projection is not None:
        return Response({
            'role': 'admin',
            'user_name': request.user.get_full_name(),
            'stats': cached_projection.get('stats', {}),
            'wards': cached_projection.get('wards', []),
        })

    today = timezone.now().date()

    # Patient count
    total_patients = PatientProfile.objects.filter(facility=facility).count()

    # Bed statistics - single query with aggregation
    bed_stats = Bed.objects.filter(facility=facility).aggregate(
        total=Count('id'),
        occupied=Count('id', filter=Q(status='occupied')),
    )
    total_beds = bed_stats['total'] or 0
    occupied_beds = bed_stats['occupied'] or 0
    occupancy_rate = (occupied_beds / total_beds * 100) if total_beds > 0 else 0

    # Current admissions
    current_admissions = Admission.objects.filter(
        facility=facility,
        status='admitted'
    ).count()

    # Today's appointments - cached + refreshed async to avoid blocking on FHIR
    cache_key = facility_cache_key_for_code(
        facility.code,
        f"admin_dashboard_appointments_{today.isoformat()}"
    )
    stale_cache_key = facility_cache_key_for_code(
        facility.code,
        f"admin_dashboard_appointments_{today.isoformat()}_stale"
    )
    lock_key = f"{cache_key}:lock"

    appointments_today = cache.get(cache_key)
    if appointments_today is None:
        appointments_today = cache.get(stale_cache_key, 0)
        if cache.add(lock_key, '1', timeout=30):
            try:
                refresh_admin_dashboard_appointments.delay(
                    facility_id=str(facility.id),
                    facility_code=facility.code,
                    date_str=today.isoformat(),
                )
            except Exception as e:
                logger.warning("Failed to queue admin dashboard appointments refresh: %s", e)

    # Active staff (count practitioners whose user accounts are active)
    active_staff = PractitionerProfile.objects.filter(
        staff__user__is_active=True,
        staff__primary_facility=facility
    ).count()

    # Ward breakdown - optimized with annotation to avoid N+1
    # Note: Annotation names must not conflict with Ward model properties
    # (e.g., available_beds_count is a @property on Ward, so we use _annotated suffix)
    wards = Ward.objects.filter(
        is_active=True,
        department__facility=facility
    ).annotate(
        total_beds_annotated=Count('beds'),
        occupied_beds_annotated=Count('beds', filter=Q(beds__status='occupied')),
        available_beds_annotated=Count('beds', filter=Q(beds__status='available')),
        maintenance_beds_annotated=Count('beds', filter=Q(beds__status='maintenance')),
    )

    ward_stats = [
        {
            'id': str(ward.id),
            'name': ward.name,
            'description': ward.description or '',
            'total_beds': ward.total_beds_annotated,
            'occupied_beds': ward.occupied_beds_annotated,
            'available_beds': ward.available_beds_annotated,
            'maintenance_beds': ward.maintenance_beds_annotated,
        }
        for ward in wards
    ]

    projection = {
        'stats': {
            'total_patients': total_patients,
            'current_admissions': current_admissions,
            'occupancy_rate': round(occupancy_rate, 1),
            'total_beds': total_beds,
            'occupied_beds': occupied_beds,
            'todays_appointments': appointments_today,
            'active_staff': active_staff,
        },
        'wards': ward_stats,
    }
    cache.set(projection_cache_key, projection, timeout=300)

    return Response({
        'role': 'admin',
        'user_name': request.user.get_full_name(),
        **projection,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated, FacilityScopedPermission])
def admin_dashboard_v2(request):
    """
    Admin v2 dashboard summary payload (summary-first contract).

    GET /api/dashboards/admin-v2/
    Query params:
        - window: now | today | 7d
        - expand: comma-separated optional sections (capacity,workforce,compliance,actions)
    """
    if not _is_admin_actor(request.user):
        return _forbidden_admin_only_response()

    facility = get_user_facility(request)
    if not facility:
        return Response({'detail': 'Facility context is required.'}, status=400)

    window = _parse_admin_v2_window(request.query_params.get('window'))
    if window is None:
        return Response(
            {'detail': 'Invalid window. Expected one of: now, today, 7d.'},
            status=400,
        )

    expand = _parse_admin_v2_expand(request.query_params.get('expand'))
    now = timezone.now()

    if expand:
        return Response(_build_admin_v2_root_payload(facility, now, window, expand_sections=expand))

    cache_key = facility_cache_key_for_code(facility.code, f'admin_v2_summary_{window}')
    payload = cache.get(cache_key)
    if payload is None:
        payload = _build_admin_v2_root_payload(facility, now, window, expand_sections=set())
        cache.set(cache_key, payload, timeout=ADMIN_DASHBOARD_V2_ROOT_CACHE_TTL)
    return Response(payload)


@api_view(['GET'])
@permission_classes([IsAuthenticated, FacilityScopedPermission])
def admin_dashboard_v2_capacity(request):
    """Detailed capacity panel payload for admin v2."""
    if not _is_admin_actor(request.user):
        return _forbidden_admin_only_response()

    facility = get_user_facility(request)
    if not facility:
        return Response({'detail': 'Facility context is required.'}, status=400)

    window = _parse_admin_v2_window(request.query_params.get('window'))
    if window is None:
        return Response(
            {'detail': 'Invalid window. Expected one of: now, today, 7d.'},
            status=400,
        )

    cache_key = facility_cache_key_for_code(facility.code, f'admin_v2_capacity_{window}')
    payload = cache.get(cache_key)
    if payload is None:
        payload = _build_admin_v2_capacity_detail(facility, timezone.now(), window)
        cache.set(cache_key, payload, timeout=ADMIN_DASHBOARD_V2_SECTION_CACHE_TTL)
    return Response(payload)


@api_view(['GET'])
@permission_classes([IsAuthenticated, FacilityScopedPermission])
def admin_dashboard_v2_workforce(request):
    """Detailed workforce panel payload for admin v2."""
    if not _is_admin_actor(request.user):
        return _forbidden_admin_only_response()

    facility = get_user_facility(request)
    if not facility:
        return Response({'detail': 'Facility context is required.'}, status=400)

    window = _parse_admin_v2_window(request.query_params.get('window'))
    if window is None:
        return Response(
            {'detail': 'Invalid window. Expected one of: now, today, 7d.'},
            status=400,
        )

    cache_key = facility_cache_key_for_code(facility.code, f'admin_v2_workforce_{window}')
    payload = cache.get(cache_key)
    if payload is None:
        payload = _build_admin_v2_workforce_detail(facility, timezone.now(), window)
        cache.set(cache_key, payload, timeout=ADMIN_DASHBOARD_V2_SECTION_CACHE_TTL)
    return Response(payload)


@api_view(['GET'])
@permission_classes([IsAuthenticated, FacilityScopedPermission])
def admin_dashboard_v2_compliance(request):
    """Detailed compliance panel payload for admin v2."""
    if not _is_admin_actor(request.user):
        return _forbidden_admin_only_response()

    facility = get_user_facility(request)
    if not facility:
        return Response({'detail': 'Facility context is required.'}, status=400)

    window = _parse_admin_v2_window(request.query_params.get('window'))
    if window is None:
        return Response(
            {'detail': 'Invalid window. Expected one of: now, today, 7d.'},
            status=400,
        )

    cache_key = facility_cache_key_for_code(facility.code, f'admin_v2_compliance_{window}')
    payload = cache.get(cache_key)
    if payload is None:
        payload = _build_admin_v2_compliance_detail(facility, timezone.now(), window)
        cache.set(cache_key, payload, timeout=ADMIN_DASHBOARD_V2_SECTION_CACHE_TTL)
    return Response(payload)


@api_view(['GET'])
@permission_classes([IsAuthenticated, FacilityScopedPermission])
def my_context_patients(request):
    """
    Return context-specific patients based on user role.

    GET /api/dashboards/my-context-patients/

    Returns patients relevant to the user's current work context:
    - Nurses: Patients in their assigned ward (max 50)
    - Doctors: Today's appointments + admitted patients under their care (max 30 each)
    - Receptionists: Today's scheduled arrivals (max 50)
    - Other roles: Empty list (use search instead)
    """
    user = request.user
    role = getattr(user, 'role', None)

    if role in ['nurse', 'head_nurse', 'nurse_practitioner']:
        return Response(_get_nurse_context_patients(user, request))
    elif role in ['doctor', 'physician', 'practitioner']:
        return Response(_get_doctor_context_patients(user, request))
    elif role in ['receptionist', 'admin_staff']:
        return Response(_get_receptionist_context_patients(user, request))
    else:
        return Response({
            'context': 'none',
            'context_label': 'Search for patients',
            'patients': [],
            'total': 0,
        })


def _get_nurse_context_patients(user, request):
    """
    Get ward patients for nurse context.
    Returns patients currently admitted to the nurse's assigned ward.
    """
    from django.db.models import Prefetch

    facility = get_user_facility(request)
    if not facility:
        return {
            'context': 'ward',
            'context_label': 'Ward Patients',
            'ward_id': None,
            'patients': [],
            'total': 0,
        }

    # Get ward filter from query params or nurse's assigned ward
    ward_id = request.query_params.get('ward')
    nurse_profile = getattr(user, 'practitionerprofile', None)
    assigned_ward = ward_id or (getattr(nurse_profile, 'assigned_ward_id', None) if nurse_profile else None)

    # Build admission filter
    admission_filter = {'status': 'admitted', 'facility': facility}
    if assigned_ward:
        admission_filter['bed__ward_id'] = assigned_ward

    # Get patient IDs from admissions
    admissions = Admission.objects.filter(**admission_filter).select_related(
        'patient', 'patient__user', 'bed', 'bed__ward'
    ).order_by('bed__bed_number')[:50]

    # Format patients with ward context
    patients = []
    for admission in admissions:
        patient = admission.patient
        patients.append({
            'id': str(patient.id),
            'name': patient.user.get_full_name(),
            'mrn': patient.medical_record_number,
            'gender': patient.user.gender,
            'date_of_birth': patient.user.date_of_birth.isoformat() if patient.user.date_of_birth else None,
            'current_ward': admission.bed.ward.name if admission.bed else 'Waiting',
            'current_ward_id': str(admission.bed.ward.id) if admission.bed else None,
            'bed_number': admission.bed.bed_number if admission.bed else None,
            'admission_date': admission.admission_date.isoformat(),
            'admission_id': str(admission.id),
        })

    # Get ward name for context label
    ward_name = None
    if assigned_ward and admissions:
        first_admission = admissions[0]
        if first_admission.bed:
            ward_name = first_admission.bed.ward.name

    return {
        'context': 'ward',
        'context_label': f'{ward_name} Patients' if ward_name else 'Ward Patients',
        'ward_id': str(assigned_ward) if assigned_ward else None,
        'patients': patients,
        'total': len(patients),
    }


def _get_doctor_context_patients(user, request):
    """
    Get patients for doctor context.
    Returns today's appointments + admitted patients under their care.
    """
    facility = get_user_facility(request)
    if not facility:
        return {
            'context': 'doctor',
            'context_label': "Today's Patients",
            'patients': [],
            'total': 0,
            'breakdown': {'appointments': 0, 'inpatients': 0},
        }

    today = timezone.now().date()
    practitioner = getattr(user, 'practitionerprofile', None)

    patients = []
    appointments_patients = []
    inpatients = []

    # Get today's appointments (cached; refreshed asynchronously)
    if practitioner and practitioner.fhir_practitioner_id:
        try:
            cache_key = f"doctor_dashboard_appointments_{practitioner.fhir_practitioner_id}_{today.isoformat()}"
            appointments, _ = _get_cached_appointments(
                facility.code,
                cache_key,
                lambda: refresh_doctor_dashboard_appointments.delay(
                    facility_id=str(facility.id),
                    facility_code=facility.code,
                    practitioner_id=practitioner.fhir_practitioner_id,
                    date_str=today.isoformat(),
                ),
            )

            appointment_patient_ids = set()
            for appt in appointments:
                if appt.get('status') not in ['fulfilled', 'cancelled', 'noshow']:
                    patient_id = extract_patient_fhir_id(appt)
                    if patient_id:
                        appointment_patient_ids.add(patient_id)

            if appointment_patient_ids:
                appointment_patients_qs = PatientProfile.objects.filter(
                    fhir_patient_id__in=appointment_patient_ids,
                    facility=facility,
                ).select_related('user')[:30]

                for patient in appointment_patients_qs:
                    appointments_patients.append({
                        'id': str(patient.id),
                        'name': patient.user.get_full_name(),
                        'mrn': patient.medical_record_number,
                        'gender': patient.user.gender,
                        'date_of_birth': patient.user.date_of_birth.isoformat() if patient.user.date_of_birth else None,
                        'current_ward': None,
                        'current_ward_id': None,
                        'context_type': 'appointment',
                    })
        except Exception as e:
            logger.warning(f"Failed to fetch appointment patients: {e}")

    # Get admitted patients under this doctor's care
    if practitioner:
        my_admissions = Admission.objects.filter(
            facility=facility,
            status='admitted',
            admitting_doctor=practitioner
        ).select_related('patient', 'patient__user', 'bed', 'bed__ward')[:30]

        for admission in my_admissions:
            patient = admission.patient
            inpatients.append({
                'id': str(patient.id),
                'name': patient.user.get_full_name(),
                'mrn': patient.medical_record_number,
                'gender': patient.user.gender,
                'date_of_birth': patient.user.date_of_birth.isoformat() if patient.user.date_of_birth else None,
                'current_ward': admission.bed.ward.name if admission.bed else 'Waiting',
                'current_ward_id': str(admission.bed.ward.id) if admission.bed else None,
                'bed_number': admission.bed.bed_number if admission.bed else None,
                'admission_date': admission.admission_date.isoformat(),
                'context_type': 'inpatient',
            })

    # Combine and deduplicate by patient ID
    seen_ids = set()
    for p in inpatients + appointments_patients:  # Prioritize inpatients
        if p['id'] not in seen_ids:
            patients.append(p)
            seen_ids.add(p['id'])

    return {
        'context': 'doctor',
        'context_label': "Today's Patients",
        'patients': patients,
        'total': len(patients),
        'breakdown': {
            'appointments': len(appointments_patients),
            'inpatients': len(inpatients),
        },
    }


def _get_receptionist_context_patients(user, request):
    """
    Get patients for receptionist context.
    Returns today's scheduled arrivals.
    """
    facility = get_user_facility(request)
    if not facility:
        return {
            'context': 'reception',
            'context_label': "Today's Scheduled Patients",
            'patients': [],
            'total': 0,
        }

    today = timezone.now().date()
    patients = []

    try:
        cache_key = f"facility_dashboard_appointments_{today.isoformat()}"
        appointments, _ = _get_cached_appointments(
            facility.code,
            cache_key,
            lambda: refresh_facility_dashboard_appointments.delay(
                facility_id=str(facility.id),
                facility_code=facility.code,
                date_str=today.isoformat(),
            ),
        )

        fhir_patient_ids = set()
        for appt in appointments:
            if appt.get('status') in ['booked', 'arrived', 'pending']:
                patient_id = extract_patient_fhir_id(appt)
                if patient_id:
                    fhir_patient_ids.add(patient_id)

        if fhir_patient_ids:
            scheduled_patients = PatientProfile.objects.filter(
                fhir_patient_id__in=fhir_patient_ids,
                facility=facility,
            ).select_related('user')[:50]

            for patient in scheduled_patients:
                patients.append({
                    'id': str(patient.id),
                    'name': patient.user.get_full_name(),
                    'mrn': patient.medical_record_number,
                    'gender': patient.user.gender,
                    'date_of_birth': patient.user.date_of_birth.isoformat() if patient.user.date_of_birth else None,
                    'phone': patient.user.phone_number,
                })
    except Exception as e:
        logger.warning(f"Failed to fetch scheduled patients: {e}")

    return {
        'context': 'reception',
        'context_label': "Today's Scheduled Patients",
        'patients': patients,
        'total': len(patients),
    }
