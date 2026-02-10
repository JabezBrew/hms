# Repository Map

Owner: Engineering (current owner: @jebre)
Last reviewed: 2026-02-10
Status: Active
Scope: Quick navigation guide to core code areas.

## Top-Level

- `/Users/jebre/Desktop/hms/backend`: Django API, domain apps, workers.
- `/Users/jebre/Desktop/hms/frontend`: React application.
- `/Users/jebre/Desktop/hms/docs`: technical documentation hub.
- `/Users/jebre/Desktop/hms/tests`: shared test assets (including load test docs).
- `/Users/jebre/Desktop/hms/docker`, `/Users/jebre/Desktop/hms/k8s`: infrastructure artifacts.

## Backend Structure

- `/Users/jebre/Desktop/hms/backend/apps`: domain-driven Django apps.
- `/Users/jebre/Desktop/hms/backend/hms_backend`: global settings, auth views, URL root.
- `/Users/jebre/Desktop/hms/backend/workflows`: workflow engine and orchestration artifacts.
- `/Users/jebre/Desktop/hms/backend/dashboards`: dashboard-specific backend surfaces.

## Frontend Structure

- `/Users/jebre/Desktop/hms/frontend/src/features`: feature modules (api/hooks/components/pages/routes).
- `/Users/jebre/Desktop/hms/frontend/src/app/routes`: route definitions and route rendering.
- `/Users/jebre/Desktop/hms/frontend/src/shared`: cross-cutting UI/data primitives.
- `/Users/jebre/Desktop/hms/frontend/src/pages`: thin wrappers only.
