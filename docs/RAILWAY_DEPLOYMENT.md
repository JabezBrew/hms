# Railway Deployment (Monorepo)

This repository deploys as two Railway services from one GitHub repo:

1. Backend service
2. Frontend service

Use Dockerfile-based builds for both services to keep build behavior deterministic.
The repository-level `/Users/jebre/Desktop/hms/railway.json` intentionally does not force a builder, to avoid overriding service-level Dockerfile builds.

## Service Configuration

### Backend service

- Root Directory: `backend`
- Config File: `backend/railway.toml`
- Dockerfile: `backend/Dockerfile`
- Health Check Path: `/api/health/`

### Frontend service

- Root Directory: `frontend`
- Config File: `frontend/railway.toml`
- Dockerfile: `frontend/Dockerfile`
- Health Check Path: `/health`

## Required Environment Variables

### Backend

- `SECRET_KEY` (required)
- `DATABASE_URL` (required in production)
- `ALLOWED_HOSTS` (recommended explicit value)
- `CORS_ALLOWED_ORIGINS` (recommended explicit value)
- `CSRF_TRUSTED_ORIGINS` (recommended explicit value)

### Frontend

- `VITE_API_BASE_URL` (recommended explicit value)
- `VITE_WS_URL` (recommended explicit value)

## Build Reliability Guardrails

- CI now runs Docker builds for both Railway images on every push/PR:
  - Backend: `backend/Dockerfile`
  - Frontend: `frontend/Dockerfile`
- Build contexts are reduced with service-local `.dockerignore` files to avoid accidental context bloat and unrelated file conflicts.

## Push Workflow

1. Commit changes locally.
2. Push branch to GitHub.
3. Ensure GitHub Actions pass, including `railway-docker-builds`.
4. Railway auto-deploys from the same commit after CI is green.

If Railway fails but CI passed, compare Railway service root directory settings against the paths above first.
