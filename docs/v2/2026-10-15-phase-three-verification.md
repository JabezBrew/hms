# Third parity checkpoint

Scope: terminal medication outcomes, managed-access revocation, immutable NHIS
internal export records, current-admission fluid consistency and release builds.
The parity ledger still contains unfinished clinical, administrative and external
workflows. PRN and standing-order work in the shared checkout is excluded from
this reviewed checkpoint.

## Behavior

- The reachable Chronicle medication chart records administered, missed, refused
  or held with server actor/time and required reasons for nonadministration.
  Source/dose locks preserve terminal evidence and exact same-actor replay.
  Source-based administration requires actual pharmacy supply; nonadministration
  reconciles pending supply without inventing stock. Source prescription holds
  remain distinct from terminal nurse outcomes. Unknown writes block repeats.
  The chart is keyed by admission to prevent stale patient content from becoming
  writable. Browser testing caught and fixed a real encounter/admission identifier
  mismatch in the Chronicle launcher; three routing regressions cover it.
- Managed permission/delegation/authority grants can be reviewed and ended with
  fresh reauthentication, immutable evidence and atomic permission-version/audit
  updates. New grants no longer copy rights permanently. Ambiguous historical
  copies require an explicit retain/remove decision; other valid sources survive.
  Durable permission-version checks fence warm caches across two API instances;
  future grant boundaries expire caches. This adds one deliberate version query
  per request. Continuous socket/session logout propagation is separate.
- NHIS export records are internal metadata, not downloaded files or submitted
  claims. Eligible locked claim snapshots, checked totals and immutable replay
  cannot reset submitted/remitted batches. The UI preserves saved confirmation
  through refresh failure and locks unknown writes. Related mapping/batch generic
  409 responses use the same uncertain-save treatment.
- Current-admission fluid forms/history/totals and Chronicle summary now share
  the actual admission scope. Associated amounts explicitly require ml; neutral
  Close and unsupported-correction wording avoid misleading actions.
- Docker builds cache registry, Git and target dependencies separately by toolchain
  and architecture. Application source timestamps are refreshed before compilation
  so rollback archives cannot reuse newer application artifacts. Runtime binaries
  are copied out of the ephemeral target mount in the same build step. The actual
  remote cache behavior still needs release verification; no measured build-speed
  gain is claimed from source inspection.

## Acceptance

- Frozen index exported to `/tmp/hms-phase3-index-review`: full Rust workspace
  **311 passed**, zero failed/ignored, 69 result groups; formatting and generated
  contracts pass. Tests use isolated Docker Postgres databases.
- Exact frozen frontend: **1,410 passed in 222 files**. Lint has zero errors and
  71 existing warnings. Generated client, Rust-mode production build and all bundle
  budgets pass: startup 60.80 KB gzip, entry JS 30.08 KB, CSS 30.71 KB and largest
  chunk 115.05 KB. Operational regression suite: **84 passed**. Docker build check
  reports no findings.
- Independent source reviews covered authorization/cache/time boundaries, audit
  rollback, supply/outcome concurrency, immutable export lifecycle and UI unknown
  writes. Changed-file React Doctor reports zero errors; remaining complexity
  findings are maintainability feedback, not security/accessibility certification.
- Browser against the compiled checkpoint opened the real current-admission chart,
  displayed Administered disabled for an unsupplied source dose, and saved a
  synthetic refusal. Independent API reads confirmed one source dose, saved reason,
  server actor/time, no administration timestamp and no invented dispensing.
  The test prescription was stopped afterward, preserving history. A synthetic
  NHIS internal export record was saved in the UI and independently replayed with
  its checksum and one-claim count preserved.

Evidence logs: `/tmp/hms-phase3-index-{rust,frontend}-acceptance.log`,
`/tmp/hms-phase3-index-{lint,client,build,bundle}.log`,
`/tmp/hms-phase3-ops-acceptance.log`. The exact staged blobs were compared with
accepted snapshot files and SHA-256 fingerprints retained before committing.
Deployment evidence will be recorded after independent live verification.
