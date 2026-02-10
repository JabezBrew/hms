# Documentation Contribution Rules

Owner: Engineering (current owner: @jebre)
Last reviewed: 2026-02-10
Status: Active
Scope: How contributors must create and maintain HMS documentation.

## Non-Negotiable Rule

If behavior changes in code, documentation changes in the same PR.

## Documentation Update Matrix

Update these docs when these changes happen:

- API contract or serializer fields change:
  - Update domain doc in `/Users/jebre/Desktop/hms/docs/domains/backend/`
  - Update relevant runbook if operational behavior changes
- Frontend workflow, route, or role access changes:
  - Update `/Users/jebre/Desktop/hms/docs/domains/frontend/`
  - Update onboarding task flow docs if user journey changed
- New architecture or storage decision:
  - Add ADR using `/Users/jebre/Desktop/hms/docs/templates/adr-template.md`
- Incident class discovered or mitigation changed:
  - Update runbook in `/Users/jebre/Desktop/hms/docs/runbooks/`

## Writing Standards

- Use explicit, imperative steps.
- Use exact commands and file paths.
- Use absolute dates for time-sensitive notes.
- Keep examples safe: never include PHI or secrets.
- Keep procedures copy-pasteable.

## Review and Freshness

- Default review cadence: every 90 days.
- Set `Last reviewed` on each update.
- If a doc is obsolete, mark `Status: Deprecated` and link replacement.

## PR Checklist (Documentation)

Use this checklist before merge:

- I updated docs that are impacted by this change.
- I updated `Last reviewed` in touched docs.
- I confirmed no PHI/secrets were introduced.
- I linked any new docs from `/Users/jebre/Desktop/hms/docs/README.md`.
