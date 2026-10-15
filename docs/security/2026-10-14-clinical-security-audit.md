# Clinical security audit — 14 October 2026

## Scope and method

This review covers the active Rust V2 API, PostgreSQL repositories, React clinician
workspace, frontend Nginx origin and resolved application dependencies changed in
this phase. The reviewed product source ends at `3538ed17`; the backend tree is
`050036ae5c707cfd9ef310862b3a00ae55b80ef0`, built from `3e91b452`.

Work combined source and contract review, adversarial authorization requests,
transaction/concurrency regressions, browser workflows with synthetic patients,
real local container checks and dependency-feature inspection. Findings were
fixed and independently reviewed. This is a bounded implementation audit, not an
external penetration test, compliance certification or exhaustive review of every
route and deployment. Legacy Django was not reviewed.

The [phase report](../quality/2026-10-14-clinical-quality-phase.md) records final
release gates and their exact source revisions. The
[performance audit](../performance/2026-10-14-frontend-performance-audit.md) covers
capacity and timing evidence separately.

## Findings and fixes

### Authentication, recovery and delegated authority

- **Refresh could make an old sign-in appear freshly authenticated.** The
  request extractor now uses the earlier of the server session start and token
  issue time. Refresh does not establish new credential proof. Freshness also
  rejects future authentication times. Cached delegated authority must still
  match facility, permission, scope and its current start/end interval at use.
  Evidence: [extractor](../../backend-rs/crates/hms-api/src/extractors.rs),
  [access policy and unit regressions](../../backend-rs/crates/hms-access/src/lib.rs),
  and `refresh_rotation_does_not_renew_high_risk_reauthentication` in the
  [authentication contracts](../../backend-rs/crates/hms-api/tests/api_contract/auth.rs).
- **Password work and login attempts needed explicit resource bounds.** Argon2
  hashing/verification runs on blocking workers behind a semaphore; the worker
  retains its permit even if its awaiting request is cancelled. Unknown-account
  and wrong-facility login checks execute a real dummy Argon2 verification.
  Login permits ten attempts per normalized account/facility per minute and
  admits at most four concurrent attempts, bounded further by configured password
  capacity. Excess admission fails generically and recovers when capacity frees;
  it does not impose a timed global login lockout. Identity windows use salted
  fingerprints and a 4,096-entry bound. Evidence:
  [limiter and concurrency tests](../../backend-rs/crates/hms-api/src/auth.rs),
  [bounded workers and admission-release regression](../../backend-rs/crates/hms-api/src/state.rs),
  and the login enumeration/throttling contract above. Matching response shape
  and dummy password work reduce enumeration signals; exact network timing
  indistinguishability is not claimed.
- **Recovery-code generation could index outside its alphabet and panic.** A
  complete 32-character alphabet now matches the five-bit selection. Format,
  normalization, bounded generation and uniqueness regressions accompany the
  [generator](../../backend-rs/crates/hms-auth/src/lib.rs). The authentication
  contracts verify credential checks, regeneration and single-use hashes.
- **Self-service reset acknowledged requests without a usable delivery path.**
  It now uses the configured trusted account-setup adapter, a hashed token and a
  30-minute expiry. Unknown, throttled and disabled-delivery requests retain the
  generic public acknowledgement; disabled delivery issues no unusable token.
  Only resolved accounts claim the three-per-account/60-overall delivery budget
  per 15 minutes. Webhook delivery follows persistence, outside transactions and
  the response path; redirects are disabled and delivery failures log a constant
  message. Public API responses and persisted domain events do not contain plaintext reset tokens;
  synthetic tests use the explicit in-memory sink. Evidence:
  [delivery and reset implementation](../../backend-rs/crates/hms-api/src/state.rs),
  [delivery contract](../../backend-rs/crates/hms-api/README.md#staff-onboarding-delivery),
  and reset delivery/disabled-delivery/single-use/session-revocation tests in the
  authentication contracts. No external email or delivery service was exercised.

### Patient access and emergency access

- **Direct clinical endpoints bypassed Chronicle's treating-relationship gate.**
  Notes, versions, problems, allergies, prescriptions and chart operations now
  use the shared patient relationship or audited break-glass decision.
  Demographic browsing and a generic clinical permission cannot manufacture a
  relationship by writing a first note. Inferred owned/team encounter access
  requires an active encounter and, when linked, an open visit for the same
  patient and facility. Legitimate explicit assignment and authored history keep
  their own policy, including post-death documentation. Active triage assessment
  responsibility and ward pathways remain available. Pharmacy safety access
  requires actual prescription/fulfillment work; laboratory access retains its
  scoped order pathway. Evidence:
  [clinical service](../../backend-rs/crates/hms-api/src/services/clinical.rs),
  [relationship evidence](../../backend-rs/crates/hms-db/src/auth.rs), and
  [direct endpoint denial, break-glass, linked-visit and covering-nurse regressions](../../backend-rs/crates/hms-api/tests/api_contract/clinical_access.rs).
- **Worklists and browser caches could preserve the wrong access context.**
  My Patients derives current owned/team assignments without persisting inferred
  grants, rejects cross-patient/facility links and preserves bounded, stable
  pagination. Visit, triage and search query scope includes opaque user, runtime
  facility and authorization facts, including permission/session versions.
  Evidence: [patient worklist tests](../../backend-rs/crates/hms-db/tests/patient_contexts.rs),
  [query scope](../../frontend/src/shared/lib/queryKeys.js),
  [visit/triage regressions](../../frontend/src/hooks/__tests__/useVisitQueries.scope.test.jsx),
  and [search scope regression](../../frontend/src/shared/hooks/__tests__/useOmniSearchResults.scope.test.jsx).
- **The native emergency workflow was inaccessible and could retain stale
  clinical data around expiry.** The existing native grant/end endpoints now
  require the dedicated permission, category, reason and confirmation in the UI;
  the server remains authoritative. Grant/end requests neither refresh/replay
  authentication nor retry automatically. Clinical data remains hidden until a
  fresh authorized read. Expiry/end/failed checks evict clinical cache; patient,
  facility and session changes discard local grant state and late responses.
  The local deadline is bounded by the server's two-hour lifetime using a
  monotonic clock, including when the wall clock is behind. Rechecks run every
  30 seconds and on foreground focus/visibility, even if permission to request a
  new grant has since been revoked. A demographics-only denial lookup identifies
  the confirmation patient and never supplies clinical fallback data. Evidence:
  [native adapter tests](../../frontend/src/features/patients/api/__tests__/breakGlass.test.js),
  [emergency-access hook and 14 regressions](../../frontend/src/features/patients/chronicle/__tests__/useChronicleBreakGlassAccess.test.jsx),
  [Chronicle integration regressions](../../frontend/src/features/patients/pages/__tests__/PatientChroniclePage.v2-workflows.test.jsx),
  and the actual grant/reload/end/denial flow in the
  [browser suite](../../frontend/e2e/rust-v2-routes.spec.js).

### Clinical transaction integrity and truthful state

- **Concurrent laboratory transitions could violate cancellation and completion
  boundaries.** Parent-order locks serialize cancellation, specimens, results
  and verification. Result batches enforce order/patient/specimen/test scope and
  roll back together. Cancelled orders reject clinical writes; full requested
  test verification is required before order completion. Retries preserve the
  first verifier. Evidence: [laboratory repository](../../backend-rs/crates/hms-db/src/laboratory.rs)
  and [cancellation, rollback, subset and concurrent verification regressions](../../backend-rs/crates/hms-db/tests/laboratory.rs).
- **Medication actions could accept inactive sources, unrelated witnesses or
  expired stock.** Generation/dispensing/administration lock and validate the
  admission, prescription and course, including patient/facility and stable
  medication descriptors. Generated doses require dispensing before
  administration; manual MAR retains its established workflow. Witnesses must
  be active accounts in the same facility. Completed retries return historical
  actor/witness/time rather than rewriting evidence. Both dispensing paths
  exclude expired stock. Evidence: [MAR repository](../../backend-rs/crates/hms-db/src/ward/mar.rs),
  [course/fulfillment repository](../../backend-rs/crates/hms-db/src/pharmacy.rs),
  [inventory dispensing](../../backend-rs/crates/hms-db/src/inventory/pharmacy.rs),
  and [medication safety regressions](../../backend-rs/crates/hms-db/tests/medication_safety.rs).
  This validates the supplied witness identity; it does not introduce a
  second-credential or professional-role attestation policy.
- **Uncertain writes could be repeated or represented as successful.** Global
  React Query mutation retries are zero; native emergency writes additionally
  suppress automatic authentication replay. Unsupported medication outcomes fail
  closed. Failed laboratory reads hide stale clinical data/counts and offer
  explicit retry. Native criticality no longer becomes an invented Normal or
  Critical High interpretation; an empty allergy list no longer asserts NKDA.
  The template UI requires the visible review step and an explicit save action.
  Evidence: [mutation regression](../../frontend/src/lib/__tests__/react-query-mutations.test.js),
  [laboratory UI regressions](../../frontend/src/features/laboratory/pages/__tests__/LabResultsPage.v2-ai.test.jsx),
  [allergy summary regression](../../frontend/src/components/chronicle/__tests__/ClinicalSummarySidebar.test.jsx),
  and [template review regressions](../../frontend/src/components/clinical-notes/__tests__/TemplateBuilder.test.jsx).

### Gateway and dependency hardening

The frontend origin previously lost security headers in locations with their
own caching headers. Its shared [header include](../../frontend/nginx-security-headers.conf)
now applies framing denial, MIME sniffing protection, referrer policy and the
baseline CSP to HTML, runtime configuration, static assets and errors. Server
access logging is off and request-context error logging goes to `/dev/null`, so
reset query tokens, patient route identifiers and referrers do not enter these
origin logs. Main Nginx startup diagnostics and safe API telemetry remain.
[Real Nginx tests](../../ops/tests/test_frontend_security_headers.py) cover
successful and missing assets plus reset, patient and denied-directory sentinels;
a separate negative control detected the leak when error-log protection was
removed. This does not establish privacy of external proxy/CDN/provider logs.

The [frontend image](../../frontend/Dockerfile) uses Node 24 LTS and explicit
public-asset read permissions; its [build exclusions](../../frontend/.dockerignore)
omit environment files, browser authentication state, recordings, logs and test
artifacts. The installed npm audit reports **zero vulnerabilities**.

The [Rust lockfile](../../backend-rs/Cargo.lock) updates `rustls` to 0.23.46,
`quinn-proto` to 0.11.18, `anyhow` to 1.0.103, `event-listener` to 5.4.2 and
`spin` to 0.9.9, resolving the reviewed advisories/yanked release. Whole-lock
audit still reports **RUSTSEC-2023-0071**, `rsa` 0.9.10, with no patched release.
`cargo tree --locked --workspace --target all -i rsa` has no reverse application
tree: it belongs to optional SQLx/MySQL dependencies absent from the application
build. The `spin` reverse tree is also empty. No advisory suppression was added.
Reassess this evidence if dependency features change; it does not clear the
advisory from the lockfile or constitute an OS-image vulnerability scan.

## Verification and remaining limits

Completed phase gates include 253 Rust tests across 57 targets, the 1,395-test
frontend suite, 91 operations tests including six real Nginx cases, production
frontend and Rust 1.88 image builds, generated-contract equality and a completed
32-workflow desktop run. Targeted security regressions include adversarial
same-facility access denial, cross-facility/inactive assignment and witness
rejection, concurrency, first-writer preservation, no write retry, clock-skew
expiry, revoked invocation permission, foreground revalidation and cache
eviction. Final responsive/browser repeats and release evidence are maintained
in the linked phase report; pending checks are not implied to have passed here.

The remaining boundaries are concrete:

- Rate counters and admission are process-local. Multiple replicas require
  coordinated edge limits; these controls do not provide general DDoS protection.
  Saturation rejects attempts, and the finite identity map can reject new
  identities until windows expire. The shared reset-delivery budget can also
  temporarily suppress legitimate recovery during a burst of known accounts.
- The native startup response does not expose an existing grant deadline after
  reload. Periodic/focus reads bound revalidation while open; background browser
  throttling can delay timers. Every new server operation still checks access.
- Disabling automatic mutation retry is not request idempotency. Lost
  acknowledgements for chart writes, payments or dispensing still require
  reconciliation before a deliberate retry. Ward-round action replacement is a
  non-atomic sequence. Discharge summary review checks fresh identity/version/body
  but the API has no atomic expected-version guard and this is not a signature.
- The CSP is a baseline for framing, objects and base URLs, not a nonce-based
  script policy. External TLS termination, edge logging, live credentials and
  deployed configuration were not verified; no deployment identity was attached.
- No exhaustive fuzzing, external penetration test, physical/operational security
  review or legacy-Django audit was performed. Dependency results are a snapshot,
  not a guarantee against undisclosed vulnerabilities.

The final repository hygiene scan covered 300 files from `origin/main...HEAD`,
the tracked working tree and new documentation, including the two explicitly
approved synthetic screenshots and the
[aggregate local smoke evidence](../performance/2026-10-15-local-smoke-evidence.json).
The aggregate JSON contains normalized labels, source/image hashes and metrics;
it contains no setup data, fixture UUIDs, raw URLs, request/response bodies or SQL.
Private-key, AWS-key, GitHub/provider-token,
credential-URL and literal-JWT patterns produced zero matches; values were not
printed. There were no unapproved artifact paths or binaries. The only binaries
were the licensed font and the reviewed desktop/mobile PNGs under
`docs/quality/assets/`; neither PNG contained ancillary metadata chunks. These
evidence exceptions do not authorize raw authentication state, database dumps,
browser traces, recordings or logs to enter Git. Pattern/path scans cannot prove
the absence of arbitrary or obfuscated secrets; screenshot content was separately
reviewed using the intentionally synthetic fixtures.
