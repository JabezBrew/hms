# ADR 0004: Patient Chronicle Owns Patient Clinical Data Placement

Status: accepted
Owner: Frontend/Clinical Workflow
Last reviewed: 2026-06-01
Scope: UI placement of patient clinical data.

## Context

HMS is workflow-oriented. Scattering vitals, notes, medications, labs, and other
patient clinical data across standalone pages makes context, access review,
auditability, and user navigation worse.

## Decision

Patient Chronicle is the product home for patient clinical data. Clinical
features should appear inside `PatientChroniclePage` or as panels, slide-overs,
or timeline entries launched from it.

Patient Registry can support identity discovery and operational navigation, but
it must not become a full clinical-record surface.

## Rejected Alternatives

- Create standalone clinical pages for each workflow. Rejected because it
  spreads patient context and access-sensitive data across too many routes.
- Let each feature decide its own patient-data placement. Rejected because it
  produces inconsistent audit, navigation, and access behavior.

## Consequences

- New clinical patient-data UI needs Chronicle placement review.
- Routes like standalone nursing fluid-balance pages are not acceptable unless a
  future ADR changes this decision.
- Frontend tests and route reviews should check that clinical patient data stays
  within the Chronicle experience.
