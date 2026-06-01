# monitoring/loki

Status: active observability reference
Owner: Operations/Performance Engineering
Last reviewed: 2026-06-01
Scope: Loki log storage configuration.

## Invariants

- Loki stores operational logs only; application code must not emit PHI.
- Query by labels such as service, environment, client, route, status, and
  request id.
- Do not search or label by patient names, MRNs, or clinical text.
