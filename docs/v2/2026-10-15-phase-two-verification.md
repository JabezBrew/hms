# Phase two: first verified parity increment

Scope: scoped MAR correctness, explicit prescription stock selection, passkey
Settings integration, and existing-item catalog correction. This is one
increment of the expanded parity ledger, not a feature-completeness claim.

## Result

- MAR filtering runs before cursor pagination, with patient/admission access,
  `[scheduled_from, scheduled_before)` bounds and effective source-held status.
  History has real Next/Previous cursor behavior; complete schedule reads follow
  bounded pages and fail visibly on incomplete or failed later pages. Query keys
  separate canonical filters and sanitized authorization scope.
- Prescribers can explicitly choose an active facility medication. The new
  bounded catalog excludes supply/inactive/foreign items and procurement/stock
  details. Editing medication text clears an old stock binding. Supplied stock
  bindings are validated server-side; free-text prescriptions remain supported.
- Security Settings uses real Rust passkey/recovery contracts. Device challenge
  cancellation, current-password confirmation, uncertain recovery responses and
  one-time-code visibility after a failed status refresh are covered. Enrollment
  does not imply second-factor login or fresh authentication proof.
- Inventory managers can record supported code/name/unit corrections with an
  effective date and reason. The saved version remains visible through background
  read failures; new corrections wait for an authoritative refresh. Source-item
  locking serializes concurrent catalog versions. Future activation/history and
  whole-item CRUD remain backlog work.

## Local acceptance

- Full Rust workspace: **255 tests passed**, zero failures/ignored, 61 test and
  documentation groups. Formatting passes. New DB tests cover more than 100
  unrelated/newer MAR records, cursor direction/range edges, source-held status
  and concurrent catalog corrections. API tests cover access, scope, minimal
  projections, paging, escaped search and invalid stock binding.
- Exact staged frontend exported to `/tmp/hms-phase2-index-review`: **1,286 tests
  passed in 210 files**, plus lint, production Rust-mode build, generated-client
  check and bundle budgets. This excludes concurrent, uncommitted later phases.
- React Doctor on the staged/new-file change set: **83/100**, zero errors, one
  maintainability warning for `PasskeySettings` control-flow complexity. This is
  a changed-file score, not a global security or accessibility certification.
- Native API plus compiled UI: desktop 1366×768 and mobile 390×844 Security
  Settings had no horizontal overflow and showed actual enrollment status.
  Real device passkey creation was not performed; challenge behavior is exercised
  with serialized WebAuthn regression fixtures.
- Browser prescribing selected a specific facility product, created one
  synthetic prescription, and showed success. Independent API reads verified
  the exact stock binding and two-day duration. That test prescription was then
  stopped, preserving its history.
- Browser catalog correction persisted a version through the real API and
  displayed the returned supported fields/date/reason. The local synthetic item
  values were left unchanged by that verification.

Logs: `/tmp/hms-phase2-workspace-acceptance.log`,
`/tmp/hms-phase2-indexed-frontend-acceptance.log`,
`/tmp/hms-phase2-indexed-{lint,build,client-check,bundle}.log`, and
`/tmp/hms-phase2-final-quality.log`. The staged source hashes matched the tested
workspace sources before commit. GitHub Actions remains disabled; this evidence
does not yet establish deployment of this increment.
