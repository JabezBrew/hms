# Celery Integration for HMS Backend

This document explains how to use Celery for background task processing and scheduled tasks in the HMS Backend.

## Overview

Celery is used for two main purposes in this project:
1. Running background tasks asynchronously
2. Scheduling periodic tasks (using Celery Beat)

The main scheduled task is the weekly generation of appointment slots for practitioners with active recurring schedules.

## Configuration

The Celery configuration is in the following files:
- `hms_backend/celery.py`: Main Celery app configuration
- `hms_backend/settings.py`: Celery settings and task schedule
- `apps/appointments/tasks.py`: Task definitions

## Running Celery

### Prerequisites

Make sure Redis is running. Redis is used as the message broker for Celery.

```bash
# Check if Redis is running
redis-cli ping
# Should return PONG
```

### Starting Celery Worker

To start a Celery worker that processes tasks:

```bash
cd backend
celery -A hms_backend worker --loglevel=info
```

### Starting Celery Beat (Scheduler)

To start the Celery Beat scheduler that triggers periodic tasks:

```bash
cd backend
celery -A hms_backend beat --loglevel=info
```

You can also run both the worker and beat in a single command (useful for development):

```bash
cd backend
celery -A hms_backend worker --beat --loglevel=info
```

## Scheduled Tasks

### Weekly Slot Generation

The system automatically generates appointment slots for practitioners with active recurring schedules. This task runs once a week and generates slots for the next 14 days.

Configuration in `settings.py`:
```python
CELERY_BEAT_SCHEDULE = {
    'generate-slots-weekly': {
        'task': 'apps.appointments.tasks.generate_slots_weekly',
        'schedule': timedelta(days=7),  # Run once a week
        'args': (14,),  # Generate slots for the next 14 days
    },
}
```

## Manual Testing

You can manually trigger the slot generation task for testing:

```bash
cd backend
python test_celery_task.py
```

## Monitoring

For production environments, consider using tools like Flower to monitor Celery tasks:

```bash
pip install flower
celery -A hms_backend flower
```

Then access the Flower dashboard at http://localhost:5555