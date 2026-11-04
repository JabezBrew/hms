# Laboratory catalog availability governance

Checkpoint 27 introduces a separate facility catalog-management purpose at
runtime 033. It governs availability of existing test and panel definitions;
it does not complete laboratory definition administration.

## Authority and public contract

Nine compiled/generated operations expose bounded test/panel directories,
UUID detail, availability commands, scalar history and own original receipts.
The management permission is `laboratory.catalog.manage`, with the Laboratory
feature and current facility/profile/session/network authority. This audience
needs no patient identifier, demographics visibility, order/verify permission,
deployment-metadata grant or role label. Reads retain ordinary current authority;
commands and own receipt recovery additionally require fresh ordinary credentials.
The four pre-existing clinical catalog operations retain their separate purpose
and closed projections. The actual API and generated client contain 549 operations.

List items have seven scalars. Test/panel definitions have 14/12 fields, ordering
observations two, ordinary history eight and original receipts eight. History
omits private reasons, actors and definition copies. Nullable and unchanged
historical text remains exact. Server cursors bound lists; no per-row query loop
or unbounded directory fetch supplies paging.

Availability commands bind subject kind/UUID, current positive version, requested
availability, normalized reason and client request UUID. Review freezes that
input and requires consent. No-op commands retain definition/version/time and
attribution while recording an immutable original result. Only the original
actor's exact command result with current transport proof resolves an uncertain
write. Current detail/history cannot acknowledge it; no automatic POST retry is
offered. A deliberate same-input retry retains the same UUID.

## Clinical continuity and preservation

New orders validate active local tests, panel membership and every expanded
member atomically, with current patient/care/actor proof. Panel orderability can
change when a member changes without a panel version increment. Availability
changes do not rewrite old orders, collection, result or verified evidence.
Completed historical Ward Round receipts retain their original shape and digest.
New clinical commits require server-known catalog versions. An old unversioned
draft must be explicitly saved with a new command UUID/current round version
before completion; the server supplies current observations.

Baseline provisioning preserves configured definitions and panel membership.
It can add newly introduced permissions to its bootstrap owner. Native attempt 17
measures the known one-owner catalog-management permission delta separately from
conservation after a refused demo reset. Optional demo or
performance publication skips the complete laboratory journey when required
definitions are unavailable; it must not publish a partial graph. Retained demo
clinical evidence blocks destructive reset. Completed performance receipts replay
their original outcome independently of later catalog availability. Dormant
private seed helpers are source-audited, not claimed as executed CLI publishers.

Own catalog search projection changes share the command transaction; unrelated
documents remain unchanged. Retained Omni caches can need turnover/refetch.
Migration 033 and matching API/worker/migrator require the deployment quiesce and
no-old-restart fence. Runtime 032 is not a supported rollback after 033 commits.

## Interface and finite clock/denial followup

`/laboratory/catalog-administration/*` provides separate test/panel directories,
UUID detail, review, history and original-result recovery. It reuses the accepted
BoardUI Table adapter and Chronicle/Shadcn tokens, with scoped cancellation,
current-read leases, duplicate-dispatch locks and focus restoration. Current
denial removes protected detail and write/recovery controls. No global typography,
theme or framework migration accompanies this slice.

The finite followup distinguishes current, denied and expired UI proof lifetimes.
Clock refresh alone cannot revive content concealed by a pending denial. Definite
expiry discards retained content even after a failed network refetch. Own producer denials settle
their own form/recovery state using actual dispatch transport provenance. These
UI facts grant no server authority or automatic write replay. The 290 focused
followup cases are supporting coverage within the final 4,010-test frontend run,
not another 290 unique full-suite tests.

The Rust V2 main Chronicle route also honors its exact clinical-read capability,
so a mixed clinical/laboratory role is not denied by lossy legacy role inference.
Patient and feature authorization remain required. Historical completed Ward
narrative display is a separate queued UI parity feature; the current editor is
draft-only and historical protected API/storage checks remain separate. Exact
encounter-list admission links are retained over thin duplicate active context,
and startup loading or denial cannot normalize away a requested visit. The 18
route, 13 admission-linkage and nine initial-loading controls are also subsets of
the final 4,010-test run. The final Ward completion Alert repair changes only its
content-column layout; the final rendered flow opens the newly completed note
and displays its narrative.

## Remaining parity and acceptance

Definition creation/deletion/reset, names, categories, specimen/unit definitions,
price, ranges, TAT and panel composition remain unsupported public operations.
Historical ordered-definition snapshots are checkpoint 28 proposal work; current
033 order projections can still reflect later definition changes. The optional
nested order result summary is currently null; real result detail is separate.
Selecting a result among multiple specimens needs an explicit later contract.
Normal migrator live-layout admission before all provisioning is also a checkpoint
28 proposal, not an additional protection implemented by 033.

Source-confirmed self-verification, aggregate result-completion and malformed
result/order facility-patient ownership gaps remain checkpoint 28 work. Their
reviewed source-only repairs and regressions await compilation, genuine baseline
reproduction and correction validation. Availability governance does not resolve
them.

Complete local component results are 1,245 Rust tests across 170 summaries, 4,010
frontend tests across 402 files, 618 ops tests, and 25 separately executed canonical
storage-guard tests. The ops/guard aggregate is 643 nonoverlapping cases. The guard
adds no actual Cargo-admission or original-six integration claim. Fresh native
attempt 17, protected timing, 326 catalog and 80 Ward browser checks pass. Selected
final visuals were inspected and all three owned databases closed and removed,
with the 63 unrelated inventory entries unchanged. Earlier failed attempts remain
preserved. See [checkpoint 27 verification](2026-11-04-checkpoint-27-verification.md)
for exact local evidence and limits.
