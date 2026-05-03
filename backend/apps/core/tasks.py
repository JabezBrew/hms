from celery import shared_task

from .observability import refresh_celery_operability_cache


@shared_task(ignore_result=True)
def refresh_celery_operability_metrics():
    refresh_celery_operability_cache()
