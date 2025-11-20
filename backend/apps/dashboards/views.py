from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.utils import timezone
from datetime import timedelta, datetime
import logging

from apps.appointments.proxies import AppointmentProxy

logger = logging.getLogger(__name__)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
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
    # Get today's date
    today = timezone.now().date()
    today_start = timezone.make_aware(datetime.combine(today, datetime.min.time()))
    today_end = timezone.make_aware(datetime.combine(today, datetime.max.time()))

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

    # Fetch today's appointments for this practitioner
    try:
        # Get all appointments (returns FHIR Bundle)
        bundle = AppointmentProxy.search(
            practitioner_id=practitioner_id,
            date=today.isoformat()
        )

        # Extract appointments from FHIR Bundle
        all_appointments = []
        if bundle and 'entry' in bundle:
            for entry in bundle['entry']:
                if 'resource' in entry:
                    all_appointments.append(entry['resource'])

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
            'urgent_items': [...],
            'ward_round_checklist': {...},
            'medication_schedule': {...},
        }
    """
    # TODO: Implement nurse dashboard
    # This would include:
    # - Assigned ward information
    # - Urgent alerts (critical vitals, overdue meds)
    # - Ward round checklist
    # - Medication schedule

    return {
        'role': 'nurse',
        'user_name': user.get_full_name(),
        'message': 'Nurse dashboard coming soon',
        'assigned_ward': None,
        'urgent_items': [],
        'ward_round_checklist': {'total': 0, 'completed': 0, 'patients': []},
        'medication_schedule': [],
    }


def get_receptionist_dashboard_data(user, request):
    """
    Receptionist dashboard: Front desk operations

    Returns:
        {
            'role': 'receptionist',
            'user_name': 'Jane Doe',
            'check_in_queue': [...],
            'pending_registrations': [...],
        }
    """
    # TODO: Implement receptionist dashboard
    # This would include:
    # - Patients to check in
    # - Pending registrations
    # - Appointment scheduling requests
    # - Payments to collect

    return {
        'role': 'receptionist',
        'user_name': user.get_full_name(),
        'message': 'Receptionist dashboard coming soon',
        'check_in_queue': [],
        'pending_registrations': [],
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
@permission_classes([IsAuthenticated])
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

    # Fetch appointments
    try:
        # Get appointments (returns FHIR Bundle)
        bundle = AppointmentProxy.search(
            practitioner_id=practitioner_id,
            date=target_date.isoformat()
        )

        # Extract appointments from FHIR Bundle
        appointments = []
        if bundle and 'entry' in bundle:
            for entry in bundle['entry']:
                if 'resource' in entry:
                    appointments.append(entry['resource'])

        formatted_appointments = [format_appointment_for_dashboard(appt) for appt in appointments]

        # Sort by start time
        formatted_appointments.sort(key=lambda x: x.get('start_time', ''))

        return Response({
            'date': target_date.isoformat(),
            'practitioner_id': practitioner_id,
            'appointments': formatted_appointments,
            'total_count': len(formatted_appointments),
        })

    except Exception as e:
        logger.error(f"Error fetching clinic schedule: {str(e)}")
        return Response({'error': f'Failed to load schedule: {str(e)}'}, status=500)
