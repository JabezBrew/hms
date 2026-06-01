# monitoring/tempo

Status: active observability reference
Owner: Operations/Performance Engineering
Last reviewed: 2026-06-01
Scope: Tempo tracing configuration.

## Invariants

- Trace attributes must use route templates and operational metadata.
- Do not attach patient names, MRNs, request bodies, or clinical free text.
- Trace sampling should support latency diagnosis without overwhelming modest
  deployments.
