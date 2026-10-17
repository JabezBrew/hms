# Fifteenth checkpoint: template history and reviewed shared copies

Status: focused and combined frozen backend, frontend and native synthetic
acceptance passed. This checkpoint ships together with checkpoint sixteen; it
was not independently released. Complete Python/UI parity and a live release
remain separate.

## Implemented behavior

The active Rust template catalog loads descending, cursor-paginated immutable
revision metadata, with 25 rows by default and a maximum of 100. Lists contain no
template body. Exact revision reads require the selected facility, root and
revision UUID; they never substitute the latest revision. Recorded availability
is distinct from the current root's availability and version.

Imported and malformed historical content remains readable evidence. Foreign
creator and owner identity edges are redacted, including their IDs. Current
resolved author names are not immutable recorded name snapshots. Template reads
require current clinical documentation access without requiring patient Full
visibility for this nonpatient catalog. Facility, session, permission, feature,
network publication and final-clock proofs remain held through projection.

Creating a shared copy opens a reviewed new-template command with a new UUID and
current ownership, inactive by default. It does not change the original root,
revision or existing patient notes. Reading another owner's revision does not
grant management of the original; creating a copy independently requires current
management authority. This is an explicit facility-shared copy, not Python's
private-copy authorization model or a server-recorded copied-from relationship.

Untouched source body text is retained exactly. Structured edits preserve
unknown metadata. Independent review reproduced unsafe integer rounding and
duplicate-key collapse during reserialization; those source bodies now allow an
exact-content copy with separately reviewed title, type and availability, while
body edits are refused. Malformed historical structure cannot seed a new copy.
Uncertain writes retain their original request and recovery barrier, including
close/reopen, authority changes and exact retry.

Unused Rust compatibility methods no longer claim an empty history or silently
send a retired duplicate command. The reachable catalog uses the actual generated
history/version operations and bounded paging.

## Verification

| Check | Result |
| --- | --- |
| New actual HTTP template history/copy contracts | 11 passed |
| Existing clinical-note HTTP / database contracts | 6 / 11 passed |
| Backend formatting | passed |
| Focused frontend | 153 passed in 9 suites |
| Full frontend | 2,360 passed in 304 suites |
| ESLint | 0 errors; 72 existing warnings outside owned files |
| Build, bundle budget, generated-client check | passed |
| Historical React Doctor changed-file scan | score 93; zero errors/warnings in that scan; untracked-source coverage was not established |
| Independent adversarial source/model review | one confirmed preservation defect repaired; no unresolved findings in reviewed scope |
| Combined fifteenth/sixteenth frozen Rust workspace | 842 passed across 132 groups, 0 ignored; one full successful command |
| Combined native synthetic HTTP | 107 checks and 800 warm requests pass against the frozen compiled API |
| Combined React Doctor with explicit untracked source | score 92; 49 files; zero reported issues |

The generated contract has 484 operations, 392 paths, 1,063 schemas and 3,392
resolved local references with no duplicate operation IDs. Its SHA-256 is
`776c653924dde2355b5482cb2d90e43c8f516c9d97524a532f069b537a30e6c6`.
The startup bundle remains 70.89 KB gzip; the entry remains 39.87 KB gzip.

The first new HTTP run had nine passes and one test-fixture failure: restoring an
isolated ownership trigger before evaluating deferred constraint events raised
SQLSTATE 55006. The fixture now evaluates those constraints before restoring the
guard in the same isolated transaction. No production guard was weakened. The
complete corrected eleven-case suite passed, including a copy whose management
permission is withdrawn during an actual lock wait and a fresh View-only denial.

Rendered browser, physical-authenticator and staging acceptance remain pending.
Patient-aware starter rendering ships in the combined sixteenth checkpoint.
The combined source has 2,432 frontend tests across 307 files; earlier fifteenth
counts above describe that earlier candidate and are not additional unique tests. Publication
approvals, private sharing and other parity-ledger rows are not closed here.

Pushed source is not a deployed release. See `2026-10-15-parity-ledger.md` for
remaining workflow and external-integration boundaries.
