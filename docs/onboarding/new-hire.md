# New Hire Onboarding

Owner: Engineering (current owner: @jebre)
Last reviewed: 2026-02-10
Status: Active
Scope: First-time onboarding for engineers new to HMS.

## Day 0: Required Reading

Read in this order:

1. /Users/jebre/Desktop/hms/AGENTS.md
2. /Users/jebre/Desktop/hms/claude.md
3. /Users/jebre/Desktop/hms/docs/README.md
4. /Users/jebre/Desktop/hms/docs/architecture/system-overview.md

## Day 1: Environment Boot

1. Clone repository and install dependencies.
2. Backend setup:
   - `cd /Users/jebre/Desktop/hms/backend`
   - `python -m venv .venv`
   - `source .venv/bin/activate`
   - `pip install -r requirements.txt`
   - `cp .env.example .env`
   - `python manage.py migrate`
   - `python manage.py runserver`
3. Frontend setup:
   - `cd /Users/jebre/Desktop/hms/frontend`
   - `npm install`
   - `cp .env.example .env`
   - `npm run dev`

## Day 2: System Orientation

- Trace one patient workflow end-to-end:
  - Frontend route: `/patients/:id` and related features.
  - Backend endpoints: `/api/patients/`, `/api/encounters/`, `/api/nursing/`.
- Review security baseline in `/Users/jebre/Desktop/hms/AGENTS.md`:
  - Queryset/object-level access checks.
  - No PHI logging.
  - Lightweight list serializers.

## Day 3-5: First Safe Change

Choose a low-risk documentation-backed change:

- Add or improve one list serializer documentation entry.
- Clarify one runbook step and validate it locally.
- Update one domain document with missing routes or role access.

Definition of done:

- Code change merged with tests.
- Relevant docs updated in same PR.
- `Last reviewed` refreshed on touched docs.
