from celery import shared_task
from django.core.mail import send_mail
from django.conf import settings
from django.template.loader import render_to_string
from .models import LabResult, LabOrder
import logging

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=3)
def send_critical_value_alert(self, result_id):
    """
    Send alert notification when a critical lab value is reported.
    Notifies the ordering provider immediately.

    Args:
        result_id: UUID of the LabResult with critical value
    """
    try:
        result = LabResult.objects.select_related(
            'order_test__order__ordering_provider',
            'order_test__order__patient',
            'order_test__test'
        ).get(id=result_id)

        if not result.is_critical:
            logger.warning(f"Result {result_id} is not marked as critical")
            return {"status": "skipped", "reason": "not_critical"}

        order = result.order_test.order
        ordering_provider = order.ordering_provider

        if not ordering_provider or not ordering_provider.email:
            logger.error(f"No ordering provider email found for order {order.id}")
            return {"status": "error", "reason": "no_provider_email"}

        # Prepare email context
        context = {
            'provider_name': f"Dr. {ordering_provider.first_name} {ordering_provider.last_name}",
            'patient_name': f"{order.patient.first_name} {order.patient.last_name}",
            'patient_mrn': order.patient.medical_record_number,
            'test_name': result.order_test.test.name,
            'result_value': result.value,
            'result_unit': result.unit,
            'reference_range': result.reference_range,
            'order_number': order.order_number,
            'result_notes': result.result_notes,
            'result_date': result.result_date.strftime('%B %d, %Y %H:%M'),
        }

        # Render email templates
        subject = f"🚨 CRITICAL LAB VALUE - {result.order_test.test.name} - {order.patient.first_name} {order.patient.last_name}"

        html_message = render_to_string('laboratory/emails/critical_value_alert.html', context)
        text_message = render_to_string('laboratory/emails/critical_value_alert.txt', context)

        # Send email
        send_mail(
            subject=subject,
            message=text_message,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[ordering_provider.email],
            html_message=html_message,
            fail_silently=False,
        )

        logger.info(f"Critical value alert sent for result {result_id} to {ordering_provider.email}")

        return {
            "status": "success",
            "result_id": str(result_id),
            "provider_email": ordering_provider.email,
            "test_name": result.order_test.test.name,
        }

    except LabResult.DoesNotExist:
        logger.error(f"Lab result {result_id} not found")
        return {"status": "error", "reason": "result_not_found"}

    except Exception as e:
        logger.error(f"Error sending critical value alert: {str(e)}")
        # Retry the task with exponential backoff
        raise self.retry(exc=e, countdown=60 * (2 ** self.request.retries))


@shared_task(bind=True, max_retries=3)
def send_result_available_notification(self, order_id):
    """
    Send notification when lab results are available and verified.

    Args:
        order_id: UUID of the LabOrder with completed results
    """
    try:
        order = LabOrder.objects.select_related(
            'ordering_provider',
            'patient'
        ).prefetch_related('order_tests__results').get(id=order_id)

        if order.status != 'completed':
            logger.warning(f"Order {order_id} is not completed yet")
            return {"status": "skipped", "reason": "not_completed"}

        ordering_provider = order.ordering_provider

        if not ordering_provider or not ordering_provider.email:
            logger.error(f"No ordering provider email found for order {order.id}")
            return {"status": "error", "reason": "no_provider_email"}

        # Count results
        total_results = sum(test.results.count() for test in order.order_tests.all())
        verified_results = sum(
            test.results.filter(verified=True).count()
            for test in order.order_tests.all()
        )
        critical_results = sum(
            test.results.filter(is_critical=True).count()
            for test in order.order_tests.all()
        )

        # Prepare email context
        context = {
            'provider_name': f"Dr. {ordering_provider.first_name} {ordering_provider.last_name}",
            'patient_name': f"{order.patient.first_name} {order.patient.last_name}",
            'patient_mrn': order.patient.medical_record_number,
            'order_number': order.order_number,
            'total_results': total_results,
            'verified_results': verified_results,
            'critical_results': critical_results,
            'order_date': order.created_at.strftime('%B %d, %Y'),
        }

        # Render email templates
        subject = f"Lab Results Available - {order.patient.first_name} {order.patient.last_name} - Order #{order.order_number}"

        html_message = render_to_string('laboratory/emails/results_available.html', context)
        text_message = render_to_string('laboratory/emails/results_available.txt', context)

        # Send email
        send_mail(
            subject=subject,
            message=text_message,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[ordering_provider.email],
            html_message=html_message,
            fail_silently=False,
        )

        logger.info(f"Results available notification sent for order {order_id} to {ordering_provider.email}")

        return {
            "status": "success",
            "order_id": str(order_id),
            "provider_email": ordering_provider.email,
            "total_results": total_results,
            "critical_results": critical_results,
        }

    except LabOrder.DoesNotExist:
        logger.error(f"Lab order {order_id} not found")
        return {"status": "error", "reason": "order_not_found"}

    except Exception as e:
        logger.error(f"Error sending results available notification: {str(e)}")
        # Retry the task with exponential backoff
        raise self.retry(exc=e, countdown=60 * (2 ** self.request.retries))


@shared_task
def send_daily_lab_summary(provider_id):
    """
    Send daily summary of pending lab results to a provider.
    Can be scheduled as a periodic task.

    Args:
        provider_id: UUID of the provider
    """
    try:
        from apps.users.models import User

        provider = User.objects.get(id=provider_id)

        if not provider.email:
            logger.error(f"No email found for provider {provider_id}")
            return {"status": "error", "reason": "no_email"}

        # Get orders with completed/processing results
        pending_orders = LabOrder.objects.filter(
            ordering_provider=provider,
            status__in=['processing', 'completed']
        ).select_related('patient').prefetch_related('order_tests__results')[:10]

        if not pending_orders:
            logger.info(f"No pending lab results for provider {provider_id}")
            return {"status": "success", "count": 0}

        # Count critical results
        critical_count = sum(
            sum(
                test.results.filter(is_critical=True).count()
                for test in order.order_tests.all()
            )
            for order in pending_orders
        )

        # Prepare email context
        context = {
            'provider_name': f"Dr. {provider.first_name} {provider.last_name}",
            'orders': pending_orders,
            'total_orders': pending_orders.count(),
            'critical_count': critical_count,
        }

        # Render email templates
        subject = f"Daily Lab Summary - {pending_orders.count()} Pending Results"

        html_message = render_to_string('laboratory/emails/daily_summary.html', context)
        text_message = render_to_string('laboratory/emails/daily_summary.txt', context)

        # Send email
        send_mail(
            subject=subject,
            message=text_message,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[provider.email],
            html_message=html_message,
            fail_silently=False,
        )

        logger.info(f"Daily lab summary sent to {provider.email}")

        return {
            "status": "success",
            "provider_email": provider.email,
            "orders_count": pending_orders.count(),
            "critical_count": critical_count,
        }

    except Exception as e:
        logger.error(f"Error sending daily lab summary: {str(e)}")
        return {"status": "error", "message": str(e)}
