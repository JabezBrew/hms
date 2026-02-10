# HMS System Overview

Owner: Engineering (current owner: @jebre)
Last reviewed: 2026-02-10
Status: Active
Scope: High-level architecture, runtime components, and reliability boundaries.

## Purpose

HMS is a workflow-oriented hospital management platform optimized for clinical safety, multi-role operations, and predictable performance.

## Runtime Components

- Frontend: React/Vite app in `/Users/jebre/Desktop/hms/frontend`.
- Backend API: Django + DRF in `/Users/jebre/Desktop/hms/backend`.
- Background workers: Celery + Redis for async work.
- Database: PostgreSQL as primary transactional store.
- External integrations: FHIR and related services via integration modules.

## Architectural Constraints

- Every patient-bound endpoint enforces queryset + object-level access control.
- Clinical list endpoints must avoid N+1 and use lightweight list serializers.
- External I/O (FHIR, emails, PDFs) stays async and out of request hot paths.
- Clinical data access in UI stays anchored to patient chronicle workflows.

## Major Backend API Surfaces

- `/api/auth/*`
- `/api/patients/*`
- `/api/encounters/*`
- `/api/nursing/*`
- `/api/laboratory/*`
- `/api/pharmacy/*`
- `/api/organization/*`
- `/api/workflows/*`, `/api/dashboards/*`

## Major Frontend Surfaces

- `frontend/src/features/*` for feature modules.
- `frontend/src/app/routes/featureRoutes.js` for consolidated route registration.
- `frontend/src/shared/*` for cross-cutting primitives and query key helpers.

## Availability and Operations

- Health check endpoint: `/api/health/`.
- Migration safety: strict preflight checks and controlled rollout.
- Production startup model documented in `/Users/jebre/Desktop/hms/docs/RAILWAY_DEPLOYMENT.md`.
