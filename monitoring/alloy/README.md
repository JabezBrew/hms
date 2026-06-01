# monitoring/alloy

Status: active observability reference
Owner: Operations/Performance Engineering
Last reviewed: 2026-06-01
Scope: Grafana Alloy log collection configuration.

## Invariants

- Collect container stdout/stderr with PHI-safe labels.
- Do not enrich logs with request bodies, patient names, MRNs, or clinical text.
- Keep client/environment/service labels stable for incident queries.
