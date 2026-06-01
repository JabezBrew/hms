# ADR 0003: GCP Staging With Hetzner Rollback

Status: accepted
Owner: Operations
Last reviewed: 2026-06-01
Scope: current staging and performance-validation operating model.

## Context

HMS previously used a Hetzner VPS staging path. The project is currently using
GCP for staging and performance validation while preserving Hetzner as rollback.
Docs that call Hetzner the active staging path mislead deploy and incident work.

## Decision

GCP is the current staging and performance-validation path. The current runbook
entry point is `ops/gcp-staging/README.md`.

Hetzner remains the rollback and reusable Rust V2 Compose path through
`ops/hetzner-v2/README.md` until a future ADR changes the production/staging
direction.

## Rejected Alternatives

- Delete Hetzner guidance immediately. Rejected because Hetzner is still a
  rollback anchor.
- Keep Hetzner as the primary doc path while GCP is active. Rejected because it
  causes wrong smoke, SSH, DNS, and performance assumptions.

## Consequences

- Runbooks should name GCP first for staging.
- Hetzner docs should be framed as rollback or reusable Rust V2 Compose
  material unless production direction changes.
- Deploy reports must verify the real remote environment, branch/commit, health,
  smoke, and rollback evidence.
