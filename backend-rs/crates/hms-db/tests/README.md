# hms-db/tests

Status: active
Owner: Database/Backend Engineering
Last reviewed: 2026-11-04
Scope: SQLx repository contract tests.

## Purpose

These tests prove repository behavior for admin, auth, billing, care, clinical
context, consent, dashboard, inventory, laboratory, migrations, ops, patients,
referrals, search, ward, and ward rounds.

## Invariants

- Tests should cross repository interfaces used by production services.
- Fixtures must be synthetic and PHI-safe.
- Hot-path tests should prove bounded list behavior, deterministic sort, and
  facility scope.

## Run

```bash
cargo test -p hms-db
```

Laboratory 033 controls exercise actual repositories, intrinsic source guards,
scalar publication witnesses and observed INSERT/source gates. Workflow tests
retain their business guards; isolated schema-fault tests intentionally fault and
restore exact layout seams. Completed originals are not manufactured to satisfy
replay assertions.

The unchanged original 17 regression tests compiled against accepted 032 and
reported 14 meaningful failures with 3 passes; the implementation then passed all 17.
A complete final workspace run passes 1,245 Rust tests across 170 summaries with no
failures, ignored, measured or filtered tests. Focused reruns are supporting
evidence and are not added again to that unique full-run count. Complete frontend
and ops component checks also pass: final V10 has 4,010 tests across 402 files,
with the actual 549-operation generated client. Route/admission/initial-loading
focused controls are included subsets, not additional unique tests.
The 618 ops cases and 25 separately executed canonical storage-guard cases total
643 nonoverlapping checks. Use the [Cargo storage policy](../../../../ops/CARGO_BUDGET.md)
without reducing any required suite. Actual Cargo admission and original-six
runner adoption remain separate pending gates.

Final native attempt 17 and protected timing pass, with 326 catalog and 80 Ward
browser checks. Selected visuals were inspected; exact cleanup removed only the
three owned databases and conserved all 63 unrelated entries. It measures the known one-owner
`laboratory.catalog.manage` baseline delta before asserting retained demo-refusal conservation. The optional nested
order result remains NULL, and historical ordered-definition snapshots and normal
migrator live-layout admission before all writes are later checkpoint 28 proposals.
Source-confirmed self-verification, aggregate completion and malformed result/order
ownership repairs also remain uncompiled/unrun checkpoint 28 work.
These documentation changes supplement the tested source maps separately. See
[scope](../../../../docs/v2/2026-11-04-laboratory-catalog-governance-scope.md) and
[verification](../../../../docs/v2/2026-11-04-checkpoint-27-verification.md).
