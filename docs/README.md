# HMS Documentation Hub

Owner: Engineering (current owner: @jebre)
Last reviewed: 2026-02-10
Status: Active

This directory is the single entry point for technical documentation.

If a code change alters behavior, data flow, operations, or onboarding steps, update docs in the same PR.

## Quick Start By Audience

- New to HMS: /Users/jebre/Desktop/hms/docs/onboarding/new-hire.md
- Existing contributor returning to context: /Users/jebre/Desktop/hms/docs/onboarding/existing-engineer.md
- Local setup and day-to-day commands: /Users/jebre/Desktop/hms/docs/onboarding/local-development.md
- Architecture baseline: /Users/jebre/Desktop/hms/docs/architecture/system-overview.md
- Data and request flow: /Users/jebre/Desktop/hms/docs/architecture/data-flow.md
- Domain docs (backend/frontend): /Users/jebre/Desktop/hms/docs/domains/README.md
- Operational runbooks: /Users/jebre/Desktop/hms/docs/runbooks/README.md
- Decision records (ADR): /Users/jebre/Desktop/hms/docs/adr/README.md
- RFC process for larger changes: /Users/jebre/Desktop/hms/docs/rfc/README.md
- Documentation contribution rules: /Users/jebre/Desktop/hms/docs/CONTRIBUTING.md

## Documentation Principles

- Docs are part of delivery, not post-delivery cleanup.
- Keep source of truth close to code, and link from this hub.
- Prefer short, task-oriented docs over long narrative dumps.
- Treat PHI as toxic waste in examples and screenshots.
- Record non-obvious architectural decisions in ADRs.

## Directory Map

- `architecture/`: system boundaries, repo map, data flow, critical constraints.
- `onboarding/`: first-week ramps for new and existing contributors.
- `domains/`: backend app and frontend feature documentation.
- `runbooks/`: incident handling and operational recovery procedures.
- `adr/`: architecture decision record index and accepted ADRs.
- `rfc/`: request-for-comments workflow and in-flight proposals.
- `templates/`: reusable templates for docs in this repository.

## Required Metadata For New Docs

Include these fields at the top of every new doc:

- `Owner`
- `Last reviewed` (YYYY-MM-DD)
- `Status` (`Draft`, `Active`, `Deprecated`)
- `Scope` (what the document covers)

## Current Document Inventory (Legacy + Active)

- Active: /Users/jebre/Desktop/hms/claude.md
- Active: /Users/jebre/Desktop/hms/AGENTS.md
- Active: /Users/jebre/Desktop/hms/docs/ADR-0001-data-isolation-and-deployment-model.md
- Active: /Users/jebre/Desktop/hms/docs/CARE_TEAM_ASSIGNMENT_DESIGN.md
- Active: /Users/jebre/Desktop/hms/docs/OUTPATIENT_VISIT_FLOW.md
- Active: /Users/jebre/Desktop/hms/docs/RAILWAY_DEPLOYMENT.md
- Active: /Users/jebre/Desktop/hms/docs/ROSTER_MANAGEMENT_SPEC.md
- Draft: /Users/jebre/Desktop/hms/docs/ADMIN_DASHBOARD_V2_DRAFT.md

When creating net-new docs, prefer placing them in the structured folders above.
