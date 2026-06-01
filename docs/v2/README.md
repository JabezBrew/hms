# docs/v2

Status: active for Rust V2 planning and cutover decisions
Owner: Backend/Operations Engineering
Last reviewed: 2026-06-01
Scope: Rust V2 backend architecture, seed behavior, cutover scope, and production readiness.

## File Map

| File | Owns |
| --- | --- |
| `rust-v2-backend-spec.md` | Rust V2 backend architecture, request model, access model, performance model, and milestones. |
| `v2-cutover-scope.md` | what is in/out of first Rust V2 cutover. |
| `v2-production-cutover.md` | production readiness gates and environment-independent proof sequence. |
| `rust-v2-demo-seed.md` | demo seed behavior and provisioning expectations. |
| `archive/` | historical V2 material kept out of the active path. |

## Invariants

- `backend-rs/` and generated `/api/v2` contracts are the active backend path.
- Current staging/performance validation uses GCP runbooks.
- Hetzner V2 remains rollback/reusable Compose reference.
- Django behavior is reference only unless a task explicitly asks for legacy
  maintenance or parity research.
