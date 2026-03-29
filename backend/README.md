# Hospital Management System - Backend

This document provides an overview of the backend implementation for the Hospital Management System.

## Getting Started

### Quick Start

To start the entire backend stack (Django, Celery, Redis) in one command:

```bash
cd backend
./start.sh
```

This will automatically start:
- Django development server (port 8000)
- Celery worker (for background tasks)
- Celery beat scheduler (for periodic tasks)
- Redis server (port 6379, message broker)

Press `Ctrl+C` to stop all services at once.

### Railway Deployment Pattern

For production Railway deployments, split migration and web startup:

1. **Migrator job**: run `python /app/run_migrations.py` once per release.
2. **Web service**: keep Railway start command as `python /app/startup_and_run.py`.
3. **Startup flow**: the web process performs dependency checks and fails fast if pending migrations remain, but it does not mutate schema.
4. **Replica safety**: only the dedicated migrator acquires the advisory lock and applies schema/bootstrap changes.

Recommended Railway environment variables:

```bash
MIGRATE_ON_STARTUP=False
FAIL_ON_PENDING_MIGRATIONS=True
DEFAULT_FACILITY_CODE=<valid existing facility code>
RUN_MIGRATIONS_ONLY=False
```

The dedicated migrator will bootstrap a minimal `core_facility` row when needed before
strict preflight checks run.

Before running migrations, execute:

```bash
python manage.py preflight_migration_checks --strict
```

This prevents known facility-backfill migrations from failing mid-deploy due to missing fallback configuration (for example missing `DEFAULT_FACILITY_CODE` on multi-facility datasets).

Health and metrics endpoints:

- `/api/health/alive/`
- `/api/health/started/`
- `/api/health/ready/`
- `/api/metrics/`

### Prerequisites

- Python 3.8+
- Redis (will be checked by startup script)
- Virtual environment with dependencies installed

```bash
# Create and activate virtual environment
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration

# Run migrations
python manage.py migrate

# Create superuser (optional)
python manage.py createsuperuser
```

For more details on Celery and background tasks, see [README_CELERY.md](README_CELERY.md).

## Phase 2 Completion

Phase 2 (Core Backend Development) has been fully implemented with the following components:

1. **Django Project Structure**: The project follows a modular structure with separate apps for different modules:
   - `users`: User and role management
   - `patients`: Patient management
   - `appointments`: Appointment scheduling
   - `wards`: Ward and bed management
   - `inventory`: Inventory and pharmacy stock management
   - `billing`: Billing and invoice management
   - `fhir_client`: FHIR client service for Google Cloud Healthcare API

2. **Django REST Framework**: Set up with proper serializers, viewsets, and routers for all modules.

3. **User & Role Management**:
   - Custom User model with email as the unique identifier
   - Staff model for hospital staff members
   - PractitionerProfile model for doctors and nurses
   - PatientProfile model for patients
   - Role-based permissions using Django's groups and permissions

4. **FHIR Client Service**:
   - Proxy services for Google Cloud Healthcare API
   - Error handling and retries
   - Mock mode for development without valid credentials
   - Utility functions for creating and manipulating FHIR resources

5. **Custom Models for Non-FHIR Entities**:
   - Ward and Bed management models
   - Inventory and Pharmacy stock models
   - Billing and Invoice models
   - Audit logging through model audit fields and request logging middleware

6. **API Endpoints**: Created for all core modules with proper authentication and authorization.

7. **Authentication and Authorization**:
   - JWT authentication with access and refresh tokens
   - Role-based permissions
   - Secure token handling with HttpOnly cookies for refresh tokens

8. **Unit and Integration Tests**:
   - Tests for models
   - Tests for serializers
   - Tests for API endpoints
   - Tests for FHIR client

## Running the Tests

To run the tests, use the following command:

```bash
cd backend
python manage.py test
```

To run tests for a specific app:

```bash
python manage.py test apps.users
python manage.py test apps.patients
python manage.py test apps.fhir_client
```

## Project Structure

```
backend/
├── apps/                  # Django apps
│   ├── appointments/      # Appointment scheduling
│   ├── billing/           # Billing and claims
│   ├── fhir_client/       # FHIR API client
│   ├── inventory/         # Inventory management
│   ├── patients/          # Patient management
│   ├── users/             # User management
│   └── wards/             # Ward management
├── hms_backend/           # Project settings
├── logs/                  # Application logs
└── manage.py              # Django management script
```

## API Endpoints

The following API endpoints are available:

- **Authentication**:
  - `/api/auth/login/`: Login and get tokens
  - `/api/auth/token/refresh/`: Refresh access token
  - `/api/auth/token/verify/`: Verify token
  - `/api/auth/logout/`: Logout and blacklist refresh token
  - `/api/auth/registration/`: Register a new user

- **Users**:
  - `/api/users/`: User management

- **Patients**:
  - `/api/patients/`: Patient management
  - `/api/patients/fhir-mappings/`: Patient FHIR mappings
  - `/api/patients/searches/`: Patient searches
  - `/api/patients/recent/`: Recent patients
  - `/api/patients/validation-rules/`: Patient registration validation rules
  - `/api/patients/notes/`: Patient notes
  - `/api/patients/register/`: Register a new patient
  - `/api/patients/search/`: Search for patients
  - `/api/patients/{id}/`: Get a specific patient

- **Appointments**:
  - `/api/appointments/`: Appointment management

- **Wards**:
  - `/api/wards/`: Ward management

- **Inventory**:
  - `/api/inventory/`: Inventory management

- **Billing**:
  - `/api/billing/`: Billing management

## Next Steps

With Phase 2 completed, the project is ready to move on to Phase 3: Frontend Foundation.
