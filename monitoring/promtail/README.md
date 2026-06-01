# monitoring/promtail

Status: legacy/compatibility observability reference
Owner: Operations/Performance Engineering
Last reviewed: 2026-06-01
Scope: Promtail log shipping configuration retained for compatibility.

## Invariants

- Prefer the active Alloy path when both are available.
- Labels and pipelines must remain PHI-safe.
- Do not parse clinical text into labels.
