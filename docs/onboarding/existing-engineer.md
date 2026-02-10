# Existing Contributor Context Refresh

Owner: Engineering (current owner: @jebre)
Last reviewed: 2026-02-10
Status: Active
Scope: 30-minute refresh flow for engineers returning to HMS.

## 10-Minute Repo Refresh

1. Review latest architecture and process docs:
   - /Users/jebre/Desktop/hms/docs/README.md
   - /Users/jebre/Desktop/hms/docs/architecture/system-overview.md
   - /Users/jebre/Desktop/hms/docs/CONTRIBUTING.md
2. Read current constraints:
   - /Users/jebre/Desktop/hms/AGENTS.md
   - /Users/jebre/Desktop/hms/claude.md

## 10-Minute Domain Refresh

Pick affected areas and review corresponding docs:

- Backend domains: /Users/jebre/Desktop/hms/docs/domains/backend/README.md
- Frontend domains: /Users/jebre/Desktop/hms/docs/domains/frontend/README.md
- Existing specs in `/Users/jebre/Desktop/hms/docs/` for feature-specific context.

## 10-Minute Operational Refresh

- Deployment process: /Users/jebre/Desktop/hms/docs/RAILWAY_DEPLOYMENT.md
- Runbooks index: /Users/jebre/Desktop/hms/docs/runbooks/README.md
- Migration failure handling: /Users/jebre/Desktop/hms/docs/runbooks/database-migration-failure.md

## Exit Criteria

Before starting feature work, confirm:

- You can map frontend route to backend endpoint for your target workflow.
- You know what tests are required for your change.
- You know which docs must be updated in your PR.
