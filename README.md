# Hospital Management System (HMS)

HMS is a workflow-oriented hospital management platform with a Django REST backend and a React frontend.

## Start Here

- Documentation hub: /Users/jebre/Desktop/hms/docs/README.md
- Engineering constraints: /Users/jebre/Desktop/hms/AGENTS.md
- Workflow/product guidance: /Users/jebre/Desktop/hms/claude.md

## Local Development

### Backend

```bash
cd /Users/jebre/Desktop/hms/backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python manage.py migrate
python manage.py runserver
```

### Frontend

```bash
cd /Users/jebre/Desktop/hms/frontend
npm install
cp .env.example .env
npm run dev
```

## Testing

Backend:

```bash
cd /Users/jebre/Desktop/hms/backend
source .venv/bin/activate
pytest
```

Frontend:

```bash
cd /Users/jebre/Desktop/hms/frontend
npm run lint
npm run build
```

## Repository Layout

- `/Users/jebre/Desktop/hms/backend`: Django apps and backend services.
- `/Users/jebre/Desktop/hms/frontend`: React application.
- `/Users/jebre/Desktop/hms/docs`: architecture, onboarding, domain docs, runbooks, ADR/RFC process.
- `/Users/jebre/Desktop/hms/tests`: test assets and load test artifacts.
