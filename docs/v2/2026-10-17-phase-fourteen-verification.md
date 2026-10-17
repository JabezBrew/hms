# Fourteenth checkpoint: publication, financial and recovery integrity

Status: frozen local backend, frontend, contract and native synthetic acceptance
passed. This is a bounded security and workflow checkpoint. Complete Python/UI
parity, rendered/physical-authenticator acceptance and a live release remain
separate.

## Retained authority and publication order

Protected clinical reads/writes and privileged business transactions retain the
server-resolved network-policy version through result construction and commit.
Version zero may acquire only its unchanged readonly sentinel. Configured proof
is SELECT-only. Missing or superseded proof returns a definite typed 403.
Own-account authentication and the policy writer's exclusive compare-and-set
protocol remain separate, including authentication under a deny policy.

Reviewed recipient, assignee and witness users are locked in deterministic order
before the first policy proof. Existing source-first ordering and later local,
active and clinical eligibility checks remain authoritative. The commands lock
only their reviewed targets; ward-round targets come from bounded normalized
actions, including the persisted draft at commit. A policy-first request rejects
the stale clinical command without clinical, stock, receipt or business-audit
effects. A business-first request permits both commands to finish in order.

Initial probes reproduced six target-user lock-order failures and stale
publication in prescribing, rich fluid and genuinely factor-verified laboratory
workflows. Four sibling medication probes and an inverse MAR probe also exposed
network denials falling through to generic uncertainty. Their mappers now
preserve the exact network denial before other business/unknown outcomes.
Prescribing detail and original receipts preserve their existing facility/Full
outpatient and historical policy; bedside treatment retains its stricter current
patient/ward policy.

## Identity, reviewer and financial evidence

Staff/practitioner projection, filtering, grouping and pagination require the
same facility across every identity edge. Invalid optional practitioner links
are redacted while valid local staff remain visible. A conflicting foreign
practitioner upsert returns definite 409 before modifying source or audit.
Inconsistent imported rows remain intact for explicit operator review.

A named billing reviewer must be distinct, active and local, with current
Billing feature and manage authority. Direct, facility-assignment and delegation
semantics are checked at database time after locks. Reviewer and acting-user
time boundaries share one final clock check. This is eligible attribution, not
a second person's authenticated or cryptographically signed approval.

Invoice finalization preserves the first actor, reviewer and all original time
evidence and emits one finalization event, including concurrent first calls.
Repeats return the protected current invoice; they do not freeze later invoice
balances. An actual concurrent counterexample refunded 120 from a payment of
100. Reversals now read the ledger total after acquiring the payment lock and
version the parent for every reversal. The indexed sum still scans that
payment's history; no constant-row-work or production-capacity claim is made.

## Unknown outcomes and usable recovery

Privileged financial, laboratory, consent, discharge, administration and
emergency-access fallbacks distinguish unknown persistence/commit outcomes from
typed authority, validation, reference, uniqueness and business conflicts.
Unknown outcomes use an explicit `*_unconfirmed` code. Audit-fault tests prove
conservative classification and rollback; they do not simulate an acknowledgement
lost after a successful commit.

Repeated staff activation/deactivation preserves the first transition's session
version, timestamp and audit, including a newly established session after
reactivation. Failed staff setup delivery is definite only when account removal
is confirmed; failed or skipped compensation requires saved-account review.

The production query client disables automatic mutation retries while preserving
read retry. Real consent and laboratory hooks previously dispatched two POSTs
after one definite-looking failure. Explicit unknown 409 responses retain the
central opaque recovery barrier, including emergency-access remounts. Recovery
tests use the actual generated transport: refresh saved status, explicitly
acknowledge the recovery notice, then end a possible grant. Reads never silently
confirm an uncertain command. Clinical text, credentials and raw identifiers are
not persisted in the recovery marker.

## Verification

| Check | Result |
| --- | --- |
| Frozen Rust workspace | 797 unique tests across 128 groups accepted; initial full run 794 pass / three diagnosed test-only failures; complete corrected billing (five), nursing (12) and fluid (12) groups pass |
| Rust formatting | Pass |
| Focused adversarial contracts | 71 API cases across eight groups and 42 database cases across four groups pass; included in workspace coverage, not additional unique counts |
| Frontend | 2,312 tests across 302 files pass |
| Frontend lint | Zero errors; 72 existing warnings |
| Production build, generated client and bundle limits | Pass; startup 342.08 KiB raw / 70.89 KiB gzip, entry 39.87 KiB gzip, CSS 31.02 KiB gzip, largest lazy chunk 115.05 KiB gzip |
| React Doctor | Reviewed checkpoint diff score 100 with zero diagnostics; maintainability evidence only |
| Generated OpenAPI | Byte-identical; 482 operations, 390 paths, 1,058 schemas, 3,376 resolved references |
| Fresh isolated migration | 95 successful migrations through epoch023; baseline provisioned once; actual native schema-compatibility command confirms epoch023 |
| Native synthetic HTTP | 69 checks pass against the frozen compiled API; readiness HTTP200 |
| Native persistence | One course, two supply headers, two command receipts and one local stop; conserved stock, zero physical-administration evidence and active source prescription |
| Warm local debug requests | 600 requests at concurrency five, all HTTP200; course-list p99 48.84 ms and detail p99 21.21 ms |
| Independent adversarial source review | No confirmed outstanding blocker in the explicitly reviewed changes |

The workspace's billing positive fixture had selected an intentionally inactive,
setup-required demo reviewer. The corrected fixture creates a separate eligible
synthetic reviewer without weakening production policy. Two strict query budgets
were updated from nine to eleven to name the version-zero sentinel and policy
proof queries added by this checkpoint. Both retain their one-versus-many row
comparisons and malformed/scoped-row assertions. Only these three test files
changed after the full compilation; production source remained identical. The
acceptance is a full run plus complete corrected suite reruns, not an assertion
that the original full command exited successfully.

The API SHA256 is
`3f765fcb67855a0964eb2a0f95d0cf7c1d7bd4dec85a789038a9bc500be6e7e5`;
the migrator SHA256 is
`e61c125795a7919414f998df97d7c8a8049b4f288c024ac07ef19cb4e255af51`.
The exact frozen source manifests, original failing evidence and final regression
receipts remain in local checkpoint evidence. Native checks used a dedicated
synthetic Docker database; the primary database and human accounts were not
modified. Genuine P256 assertions used a temporary software key held only in
memory. Warm debug measurements exclude cold origin, edge, browser and production
capacity. Existing cold staging latency remains open.

Ordinary administration metadata APIs and every other clinical family are not
claimed newly publication-fenced by this slice. The earlier dependency review's
optional, unused SQLx MySQL RSA advisory remains unresolved; passing these gates
does not establish an advisory-free dependency graph. Rendered browser,
physical-authenticator and staging acceptance remain pending.

Pushed source is not a deployed release. The broader implementation backlog and
workflow-specific acceptance boundaries remain in
`2026-10-15-parity-ledger.md`.
