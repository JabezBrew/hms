# Verified factor login and privileged workflow protection

Status: frozen local Rust, frontend, schema and native synthetic gates pass.
Browser, physical authenticator and live release require separate evidence.
Full Python feature parity is not claimed.

This checkpoint implements actual password-plus-factor sign-in, restricted
operator-assisted first setup, recovery-code consumption, same-session passkey
confirmation and bounded credential lifecycle. Registration does not authenticate
a session: a separate signed assertion with authenticator user verification is
required. Recovery cannot satisfy privileged passkey proof or replace trusted
keys. Password and factor verification retain separate durable timestamps through
step-up and refresh. See the authentication policy and session assurance scope.

All ten existing privileged permission families retain current facility, feature
and permission checks. Clinical writers also preserve their separate patient,
visibility, admission and ward restrictions. Protected mutations hold live
session/key proof through source and audit work and check actual database time
before commit. Ordinary admission closure and ordinary own-password/session
maintenance do not gain an invented factor requirement. Required password change
is enforced server-side. Own-password changes reject a session revoked during
verification or a row wait; reset completion rejects actual token expiry after
waits and immediately before commit.

HMS operations snapshots collect external metrics before a short, final live
family-proof transaction. Expiry, actual public session revocation, password
freshness changes and Admin entitlement withdrawal during collection prevent
publication. The collection does not retain identity database locks. The
separate configured Cloudflare Access operator mode retains its own contract.

The shadcn sign-in and Security Settings flows keep pending grants and secrets
in memory, support genuine passkey ceremonies and explicit recovery, and never
publish an authenticated user for a restricted setup response. Exact-session
confirmation can preserve reviewed drafts only when identity, permissions,
clinical visibility, nonfactor security facts and a freshly staged network
policy decision agree. Request credentials remain strict. Interrupted commands
retain their original reviewed UUID/body for reconciliation, without automatic
submission after confirmation. Authentication-only interfaces and network
verification code load on demand. Failed chunk downloads expose local retry or
cancel controls while preserving clinical drafts and pending restricted grants.
The existing startup and entry bundle limits remain unchanged.

Administration now rejects foreign/inactive organization parents and position
units, foreign templates, and appointment reuse of invalid legacy positions.
Reference eligibility remains locked through the write. Scoped projections do
not expose foreign parent names or template references; invalid source rows are
retained for operator review rather than silently repaired. Sorted actor/target
locks protect reciprocal administrative commands.

Controlled-stock writes require an active local location and an active local
witness distinct from the actor when supplied; negative movement still requires
a witness. Witness attribution is not a separate cryptographic attestation.
Register and physical stock must agree before count or movement: drift returns a
specific review-required refusal without inferring opening stock or applying an
automatic reconciliation. Item locking serializes counts and movement, and new
ledger timestamps reflect the serialized insertion rather than transaction start.
The frontend sends controlled dispense/wastage/count once, preserves typed
errors and opaque uncertain-write evidence, and propagates cancellation. These
commands still lack UUID receipts and a governed reconciliation workflow.

Ordinary receipt, legacy supply and standing-order stock paths reject either
controlled classification under the item lock. The dedicated controlled receipt
recognizes those same classifications. Legacy supply commands accept at most
one hundred lines before transaction work; the limit does not claim constant
query count for bulk issue. Provisioning preserves an existing canonical
medicine even after a reviewed code, unit or classification change. A conflicting
noncanonical identity requires review; no stock or ledger is rekeyed.

Focused review also covers bounded child-first ephemeral cleanup, immutable
operator retirement and audited named-user bootstrap. Readiness reports
structural key validity only, never physical key possession or usability. Normal
management preserves the last active key, rejects invalid/over-cap records and
never silently enables password fallback. Migration022 starts existing sessions
without invented proof and preserves credential/audit history.

## Local verification

Focused runtime evidence already includes thirteen assurance lifecycle tests,
fourteen genuine signed ceremony tests, the twenty-five existing auth contracts,
all ten privileged permission families and separate clinical lifetime checks.
Five operations lifetime tests and five existing operations contracts pass;
four actual external-wait regressions were behavioral failures before repair.
Administration reference tests likewise reproduced foreign/inactive acceptance
before repair. Retained-history tests exercise five thousand expired challenges
and five thousand retired keys with bounded indexed seeks. These focused results
are supplemented by the final frozen full-workspace gate below.

| Check | Result |
| --- | --- |
| Frozen Rust workspace | 689 tests across 117 groups; zero failures or ignored tests |
| Rust formatting | Pass |
| Frozen frontend | 2,202 tests across 291 files; pass |
| Frontend lint | Zero errors; 72 existing warnings |
| Production frontend build and generated client | Pass |
| Existing bundle limits | Pass; entry 39.82 KiB gzip, startup 341.64 KiB raw / 70.81 KiB gzip, CSS 30.99 KiB gzip, largest lazy chunk 115.05 KiB gzip |
| Generated OpenAPI | Byte-identical; 474 operations, 382 paths, 1,028 schemas, 3,256 resolved references |
| Fresh isolated migration | 94 successful migrations through `202610160022`; baseline provisioned once |
| Final native HTTP pilot | 40 checks pass against the final compiled binaries |
| Warm local debug benchmark | 400 requests, concurrency 5, all HTTP200; p99 identity 45.36 ms, assurance 66.96 ms, factor status 3.68 ms, registry 5.69 ms |
| React Doctor | Focused tracked scope 91, zero errors and one existing complexity warning; full scan retains unrelated existing diagnostics |
| Current dependency audit | npm: zero findings across 743 dependencies; OSV: 337 external Rust crates checked, one retained optional lockfile advisory |

The final API SHA256 is
`7cb6895f2674e951e650e765e951487360ca445566f6b33c2e605ba546928ede`;
the migrator SHA256 is
`b9d1d369515013eb05e14c409bcffbcb70250cb0921ce2893840c46c6fb1f89c`.
Native evidence comes from a dedicated synthetic facility and a fresh, owned
Docker test database. Signed P256 ceremonies use an ephemeral software
authenticator; this is not evidence of physical key possession or browser UX.
Warm debug measurements exclude cold origin, edge, browser and production
capacity. The previously measured cold staging p99 of 332.98 ms remains open.

An earlier full run rejected one fresh assertion in the privileged-route
matrix. It did not reproduce in twenty consecutive instrumented matrix runs,
three repeated complete factor suites, or the final full workspace. No cause or
production repair is claimed for that isolated failure. Failure-only diagnostics
retain coarse proof/version/clock facts without identifiers, credentials, actual
timestamps, request bodies or clinical data.

The retained Rust finding is [RUSTSEC-2023-0071](https://rustsec.org/advisories/RUSTSEC-2023-0071.html)
in `rsa 0.9.10`, reached in the lockfile through optional `sqlx-mysql`. HMS enables
Postgres with SQLx defaults disabled. Locked normal API dependency trees for
native macOS and Linux ARM64/AMD64 exclude this crate. No external crate version,
source or checksum changed from checkpoint eleven; no advisory suppression or
unsupported crypto override was added. An all-target inverse-tree attempt could
not finish because an unused target crate cache download was blocked; it is not
reported as a completed all-platform check.

No normal local or remote human account was bootstrapped, enrolled or retired.
Existing free staging and browser approval requests remain unresolved; a pushed
commit alone is not a deployed release.

A general network-policy publication fence after every in-flight workflow wait
remains a separate cross-workflow audit item. Current-request network enforcement
is not evidence of that stronger guarantee.
