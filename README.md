# Hospital Management System (HMS)

A modern, modular, and scalable Hospital Management System using Django REST Framework for the backend and React (Vite) with shadcn/ui components for the frontend.

## Project Overview

The Hospital Management System is designed to integrate with Google Cloud Healthcare API while implementing custom modules and logic that the API doesn't natively support.

### Architecture

- **Backend (Django)**:
  - Acts as a proxy/controller between React frontend and Google Cloud FHIR/DICOM/HL7v2 endpoints.
  - Validates and transforms user input to conform to FHIR resource structure.
  - Implements custom business logic and modules not covered by the Google API.

- **Frontend (React + shadcn/ui)**:
  - Uses modular, composable components (e.g., `PatientForm`, `EncounterForm`, `LabForm`, `PatientSelector`)
  - Dynamically interacts with backend endpoints.
  - Styled with clean UI, minimal state coupling, and reusable patterns.

## Getting Started

### Prerequisites

- Python 3.9+
- Node.js 16+
- Docker Desktop or another Docker daemon for local PostgreSQL/Redis
- Google Cloud account with Healthcare API enabled (for production)

### Backend Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/hms.git
   cd hms
   ```

2. Create a virtual environment and install dependencies:
   ```bash
   python -m venv .venv
   source .venv/bin/activate  # On Windows: .venv\Scripts\activate
   pip install -r backend/requirements.txt
   ```

3. Start local service dependencies:
   ```bash
   docker compose up -d postgres redis
   ```

4. Configure environment variables:
   ```bash
   cp backend/.env.example backend/.env
   # The default local database credentials match compose.yml and CI:
   # DB_NAME=hms DB_USER=postgres DB_PASSWORD=postgres DB_HOST=localhost DB_PORT=5432
   ```

5. Run migrations:
   ```bash
   cd backend
   python manage.py migrate
   ```

6. Create a superuser:
   ```bash
   python manage.py createsuperuser
   ```

7. Run the development server:
   ```bash
   python manage.py runserver
   ```

### Backend Tests

The local and CI test database credentials are intentionally the same. Start
Postgres and Redis first, then run pytest from `backend/`:

```bash
docker compose up -d postgres redis
cd backend
source .venv/bin/activate
pytest -n auto --create-db
```

Use `--create-db` when rebuilding stale reused test databases. Normal reruns can
use:

```bash
pytest -n auto
```

### Frontend Setup

1. Install dependencies:
   ```bash
   cd frontend
   npm install
   ```

2. Configure environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your API URL and other settings
   ```

3. Run the development server:
   ```bash
   npm run dev
   ```

### Hetzner Client VPS Deployment

The low-cost deployment path runs one HMS client per Hetzner VPS with Docker
Compose, Caddy, Postgres, Redis, the Django ASGI API, Celery worker/beat, and
the Nginx-served React frontend.

Use the runbook here:

```text
ops/hetzner-client-vps/README.md
```

The reusable Compose profile is:

```text
ops/hetzner-client-vps/compose.yml
```

Generate a client environment:

```bash
python3 ops/create-client-deployment.py --slug acme --name "Acme Clinic" --profile clinic --mode production --domain acme.thehms.systems --facility-code ACME --output ops/hetzner-client-vps/.env
```

Deploy updates from `/opt/hms` on a client VPS:

```bash
ops/hetzner-client-vps/deploy.sh
```

Legacy managed-hosting deployment files have been removed from the repo.

## Authentication

The system uses JWT authentication with:

- **Access Token**: Short-lived (15 minutes), stored in memory or Authorization header.
- **Refresh Token**: Long-lived (30 days), stored in HttpOnly cookie for security.

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

frontend/
├── public/                # Static files
├── src/
│   ├── components/        # Reusable UI components
│   ├── pages/             # Page components
│   ├── api/               # API service layer
│   ├── context/           # React context providers
│   ├── hooks/             # Custom React hooks
│   ├── utils/             # Utility functions
│   └── App.jsx            # Main application component
└── vite.config.js         # Vite configuration
```

## Development Guidelines

- Follow PEP 8 style guide for Python code
- Use ESLint and Prettier for JavaScript/React code
- Write tests for all new features
- Document code using docstrings and comments
- Follow the Git workflow (feature branches, pull requests)

## License

This project is licensed under the MIT License - see the LICENSE file for details.
