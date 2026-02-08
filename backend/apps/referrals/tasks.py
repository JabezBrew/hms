from celery import shared_task
from django.core.mail import send_mail
from django.conf import settings
from django.template.loader import render_to_string
from .models import Referral, ReferralStatus
from apps.core.models import Facility
from .services import ReferralSLAService, ClinicWaitlistService
import logging

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=3)
def send_referral_submitted_notification(self, referral_id):
    """
    Send notification when a new referral is submitted.
    Notifies the specialist/department receiving the referral.

    Args:
        referral_id: UUID of the submitted Referral
    """
    try:
        referral = Referral.objects.select_related(
            'referring_provider',
            'patient'
        ).get(id=referral_id)

        if referral.status != ReferralStatus.PENDING:
            logger.warning(f"Referral {referral_id} is not in pending status")
            return {"status": "skipped", "reason": "not_pending"}

        # In a real system, you would query for specialists in the department
        # For now, we'll use a department-specific email from settings
        department_emails = getattr(
            settings,
            'DEPARTMENT_EMAILS',
            {}
        )
        recipient_email = department_emails.get(referral.referred_to_department)

        if not recipient_email:
            logger.warning(
                f"No email configured for department {referral.referred_to_department}"
            )
            return {"status": "skipped", "reason": "no_department_email"}

        # Determine urgency label
        urgency_labels = {
            'routine': 'Routine',
            'urgent': '⚠️ URGENT',
            'emergency': '🚨 EMERGENCY',
        }
        urgency_label = urgency_labels.get(referral.urgency, 'Routine')

        # Prepare email context
        context = {
            'referral_number': referral.referral_number,
            'urgency': urgency_label,
            'department': referral.referred_to_department.replace('_', ' ').title(),
            'specialty': referral.referred_to_specialty or 'General',
            'patient_name': f"{referral.patient.first_name} {referral.patient.last_name}",
            'patient_mrn': referral.patient.medical_record_number,
            'referring_provider': f"Dr. {referral.referring_provider.first_name} {referral.referring_provider.last_name}",
            'reason': referral.reason,
            'clinical_summary': referral.clinical_summary,
            'relevant_history': referral.relevant_history,
            'referral_date': referral.created_at.strftime('%B %d, %Y'),
        }

        # Render email templates
        subject = f"{urgency_label} Referral - {referral.patient.first_name} {referral.patient.last_name} - {referral.referred_to_department.replace('_', ' ').title()}"

        html_message = render_to_string('referrals/emails/referral_submitted.html', context)
        text_message = render_to_string('referrals/emails/referral_submitted.txt', context)

        # Send email
        send_mail(
            subject=subject,
            message=text_message,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[recipient_email],
            html_message=html_message,
            fail_silently=False,
        )

        logger.info(f"Referral submitted notification sent for referral {referral_id}")

        return {
            "status": "success",
            "referral_id": str(referral_id),
        }

    except Referral.DoesNotExist:
        logger.error(f"Referral {referral_id} not found")
        return {"status": "error", "reason": "referral_not_found"}

    except Exception as e:
        logger.error(f"Error sending referral submitted notification: {str(e)}")
        # Retry the task with exponential backoff
        raise self.retry(exc=e, countdown=60 * (2 ** self.request.retries))


@shared_task(bind=True, max_retries=3)
def send_referral_status_update(self, referral_id, action):
    """
    Send notification when a referral status changes.
    Notifies the referring provider of the status change.

    Args:
        referral_id: UUID of the Referral
        action: Status change action ('accepted', 'declined', 'scheduled', 'completed')
    """
    try:
        referral = Referral.objects.select_related(
            'referring_provider',
            'patient',
            'responding_specialist'
        ).get(id=referral_id)

        referring_provider = referral.referring_provider

        if not referring_provider or not referring_provider.email:
            logger.error(f"No referring provider email found for referral {referral.id}")
            return {"status": "error", "reason": "no_provider_email"}

        if action != 'completed':
            logger.info(
                f"Skipping referral status email for action {action} on {referral.id}"
            )
            return {"status": "skipped", "reason": "unsupported_action"}

        # Action-specific content
        action_config = {
            'accepted': {
                'subject_prefix': '✅ Referral Accepted',
                'title': 'Referral Accepted',
                'message': 'Your referral has been accepted by the specialist.',
                'additional_info': referral.acceptance_notes,
            },
            'declined': {
                'subject_prefix': '❌ Referral Declined',
                'title': 'Referral Declined',
                'message': 'Your referral has been declined.',
                'additional_info': referral.decline_reason,
            },
            'scheduled': {
                'subject_prefix': '📅 Referral Scheduled',
                'title': 'Appointment Scheduled',
                'message': 'An appointment has been scheduled for your referral.',
                'additional_info': None,
            },
            'completed': {
                'subject_prefix': '✅ Referral Completed',
                'title': 'Referral Consultation Completed',
                'message': 'The specialist consultation has been completed.',
                'additional_info': referral.specialist_notes,
            },
        }

        config = action_config.get(action, {})

        # Prepare email context
        context = {
            'provider_name': f"Dr. {referring_provider.first_name} {referring_provider.last_name}",
            'patient_name': f"{referral.patient.first_name} {referral.patient.last_name}",
            'patient_mrn': referral.patient.medical_record_number,
            'referral_number': referral.referral_number,
            'department': referral.referred_to_department.replace('_', ' ').title(),
            'specialty': referral.referred_to_specialty or 'General',
            'reason': referral.reason,
            'title': config.get('title', 'Referral Update'),
            'message': config.get('message', 'Your referral status has been updated.'),
            'additional_info': config.get('additional_info'),
            'recommendations': referral.recommendations if action == 'completed' else None,
            'specialist_name': (
                f"Dr. {referral.responding_specialist.first_name} {referral.responding_specialist.last_name}"
                if referral.responding_specialist else None
            ),
        }

        # Render email templates
        subject = f"{config.get('subject_prefix', 'Referral Update')} - {referral.patient.first_name} {referral.patient.last_name}"

        html_message = render_to_string('referrals/emails/referral_status_update.html', context)
        text_message = render_to_string('referrals/emails/referral_status_update.txt', context)

        # Send email
        send_mail(
            subject=subject,
            message=text_message,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[referring_provider.email],
            html_message=html_message,
            fail_silently=False,
        )

        logger.info(f"Referral status update ({action}) sent for referral {referral_id}")

        return {
            "status": "success",
            "referral_id": str(referral_id),
            "action": action,
        }

    except Referral.DoesNotExist:
        logger.error(f"Referral {referral_id} not found")
        return {"status": "error", "reason": "referral_not_found"}

    except Exception as e:
        logger.error(f"Error sending referral status update: {str(e)}")
        # Retry the task with exponential backoff
        raise self.retry(exc=e, countdown=60 * (2 ** self.request.retries))


@shared_task(bind=True, max_retries=3)
def send_referral_reminder(self, referral_id):
    """
    Send reminder notification for pending referrals.
    Can be scheduled as a periodic task to remind specialists.

    Args:
        referral_id: UUID of the pending Referral
    """
    try:
        referral = Referral.objects.select_related(
            'patient'
        ).get(id=referral_id)

        if referral.status not in [ReferralStatus.PENDING, ReferralStatus.ACCEPTED]:
            logger.info(f"Referral {referral_id} is not pending, skipping reminder")
            return {"status": "skipped", "reason": "not_pending"}

        # Get department email
        department_emails = getattr(
            settings,
            'DEPARTMENT_EMAILS',
            {}
        )
        recipient_email = department_emails.get(referral.referred_to_department)

        if not recipient_email:
            logger.warning(f"No email configured for department {referral.referred_to_department}")
            return {"status": "skipped", "reason": "no_department_email"}

        # Calculate days since submission
        from datetime import datetime, timezone
        days_pending = (datetime.now(timezone.utc) - referral.created_at).days

        # Prepare email context
        context = {
            'referral_number': referral.referral_number,
            'patient_name': f"{referral.patient.first_name} {referral.patient.last_name}",
            'patient_mrn': referral.patient.medical_record_number,
            'department': referral.referred_to_department.replace('_', ' ').title(),
            'specialty': referral.referred_to_specialty or 'General',
            'urgency': referral.urgency.upper(),
            'days_pending': days_pending,
            'reason': referral.reason,
            'status': referral.status,
        }

        # Render email templates
        subject = f"⏰ Reminder: Pending Referral - {referral.patient.first_name} {referral.patient.last_name} ({days_pending} days)"

        html_message = render_to_string('referrals/emails/referral_reminder.html', context)
        text_message = render_to_string('referrals/emails/referral_reminder.txt', context)

        # Send email
        send_mail(
            subject=subject,
            message=text_message,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[recipient_email],
            html_message=html_message,
            fail_silently=False,
        )

        logger.info(f"Referral reminder sent for referral {referral_id}")

        return {
            "status": "success",
            "referral_id": str(referral_id),
            "days_pending": days_pending,
        }

    except Referral.DoesNotExist:
        logger.error(f"Referral {referral_id} not found")
        return {"status": "error", "reason": "referral_not_found"}

    except Exception as e:
        logger.error(f"Error sending referral reminder: {str(e)}")
        # Retry the task with exponential backoff
        raise self.retry(exc=e, countdown=60 * (2 ** self.request.retries))


@shared_task
def evaluate_referral_sla_events(facility_code=None, limit=None):
    """Evaluate SLA thresholds/breaches for open referrals."""
    facility = None
    if facility_code:
        facility = Facility.objects.filter(code=facility_code).first()
    result = ReferralSLAService.evaluate_open_referrals(facility=facility, limit=limit)
    logger.info(
        "Referral SLA evaluation completed processed=%s events=%s facility=%s",
        result.get('processed'),
        result.get('events_created'),
        facility_code or 'ALL',
    )
    return result


@shared_task
def expire_waitlist_offers(facility_code=None):
    """Expire stale waitlist offers after response window."""
    expired = ClinicWaitlistService.expire_offers()
    logger.info("Expired waitlist offers count=%s facility=%s", expired, facility_code or 'ALL')
    return {'expired': expired}
