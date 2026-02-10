# Local Development Playbook

Owner: Engineering (current owner: @jebre)
Last reviewed: 2026-02-10
Status: Active
Scope: Local setup, execution, and testing commands.

## Prerequisites

- Python 3.9+
- Node.js 16+
- PostgreSQL running and reachable
- Redis running for Celery workflows

## Backend

```bash
cd /Users/jebre/Desktop/hms/backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python manage.py migrate
python manage.py runserver
```

Alternative full stack launcher:

```bash
cd /Users/jebre/Desktop/hms/backend
./start.sh
```

## Frontend

```bash
cd /Users/jebre/Desktop/hms/frontend
npm install
cp .env.example .env
npm run dev
```

## Tests

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

## Safety Checks Before PR

- No PHI in logs, screenshots, or fixtures.
- Hot paths avoid N+1 queries.
- List endpoints remain paginated and lightweight.
- Documentation updates are included.
