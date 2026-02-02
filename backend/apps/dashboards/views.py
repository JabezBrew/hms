from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.utils import timezone
from datetime import timedelta, datetime
import logging

from django.core.cache import cache

from apps.wards.models import Admission, Ward, Bed
from apps.nursing.models import NursingAlert, MedicationAdministration, NursingTask
from apps.users.models import PatientProfile, PractitionerProfile
from apps.core.security import FacilityScopedPermission, get_user_facility
from apps.core.cache_utils import facility_cache_key_for_code
from apps.dashboards.tasks import (
    refresh_admin_dashboard_appointments,
    refresh_facility_dashboard_appointments,
    refresh_doctor_dashboard_appointments,
)
from .appointment_cache import extract_patient_fhir_id

logger = logging.getLogger(__name__)


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
    role = getattr(user, 'role', None)

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

        return {
            'role': 'doctor',
            'user_name': user.get_full_name(),
            'date': today.isoformat(),
            'current_patient': current_patient,
            'upcoming': upcoming[:10],  # Next 10 appointments
            'completed': completed_today[-5:],  # Last 5 completed
            'appointments_stale': bool(is_stale),
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

    cache_key = facility_cache_key_for_code(
        facility.code,
        f"nurse_dashboard_{assigned_ward or 'all'}_u{user.id}"
    )
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

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

    data = {
        'role': 'nurse',
        'user_name': user.get_full_name(),
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
    cache.set(cache_key, data, timeout=30)
    return data


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

    return {
        'role': 'receptionist',
        'user_name': user.get_full_name(),
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

        return Response({
            'date': target_date.isoformat(),
            'practitioner_id': practitioner_id,
            'appointments': formatted_appointments,
            'total_count': len(formatted_appointments),
            'appointments_stale': bool(is_stale),
        })

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

    cache_key = facility_cache_key_for_code(
        facility.code,
        f"inpatient_dashboard_{practitioner.id}_u{user.id}"
    )
    cached = cache.get(cache_key)
    if cached is not None:
        return Response(cached)

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
        discharges_data.append({
            'id': str(admission.id),
            'patient_id': str(admission.patient.id),
            'patient_name': admission.patient.user.get_full_name(),
            'mrn': admission.patient.medical_record_number,
            'ward_name': admission.bed.ward.name if admission.bed else None,
            'bed_number': admission.bed.bed_number if admission.bed else None,
            'expected_discharge_date': admission.expected_discharge_date.isoformat() if admission.expected_discharge_date else None,
        })

    data = {
        'role': 'inpatient_doctor',
        'user_name': user.get_full_name(),
        'new_admissions': new_admissions_data,
        'my_patients': my_patients_data,
        'planned_discharges': discharges_data,
        'pending': {
            'orders_to_sign': [],  # Future: integrate with orders system
            'results_to_review': [],  # Future: integrate with lab results
        },
    }
    cache.set(cache_key, data, timeout=30)
    return Response(data)


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

    return Response({
        'role': 'admin',
        'user_name': request.user.get_full_name(),
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
    })


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
