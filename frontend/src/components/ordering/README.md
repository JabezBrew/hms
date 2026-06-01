# frontend/src/components/ordering

Status: active
Owner: Frontend Clinical Ordering Engineering
Last reviewed: 2026-06-01
Scope: order authoring primitives.

## Invariants

- Order text and clinical context are PHI.
- Order builders should produce structured requests for backend validation
  rather than relying on browser-only rules.
