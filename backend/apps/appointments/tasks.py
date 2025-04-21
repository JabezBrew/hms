from celery import shared_task
import logging
from .services import AvailabilityService

logger = logging.getLogger(__name__)

@shared_task(name='apps.appointments.tasks.generate_slots_weekly')
def generate_slots_weekly(days=14):
    """
    Celery task to generate slots for all practitioners for the next N days.
    This task is scheduled to run weekly.
    
    Args:
        days (int): Number of days to generate slots for. Defaults to 14.
        
    Returns:
        dict: Results of the batch generation process.
    """
    logger.info(f"Starting weekly slot generation for the next {days} days")
    try:
        result = AvailabilityService.batch_generate_slots_for_next_n_days(days=days)
        logger.info(f"Successfully generated {result['total_slots_created']} slots for {result['total_practitioners']} practitioners")
        return result
    except Exception as e:
        logger.error(f"Error in weekly slot generation: {str(e)}")
        # Re-raise the exception so Celery can handle it
        raise