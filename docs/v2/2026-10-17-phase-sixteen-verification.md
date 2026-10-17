# Sixteenth checkpoint: reviewed patient-aware note starters

Status: combined fifteenth/sixteenth frozen backend, frontend, generated contract
and native synthetic acceptance passed. Complete Python/UI parity, rendered
browser acceptance and a live release remain separate.

Patient Chronicle provides a separate Preview note template action for ordinary
Full clinical readers with current Patients/Encounters and documentation access.
It opens a retained workspace. A read-only user can generate and review a starter;
saving still requires the existing note-management authority. Existing Add note,
Record and Amend write gates remain in place. Historical/outpatient note access
is not globally tightened by this new-purpose preview rule.

The generated POST preview operation binds the selected patient, exact immutable
template revision and explicit encounter UUID or null. It never silently chooses
another encounter or the latest revision. Current registration, living-patient,
ordinary relationship, Full visibility and demographic visibility are required;
emergency access is not a fallback for this new purpose. Session, facility,
profile, permission, feature, network publication, patient/context and selected
revision facts are retained through result construction and a final database
clock check. Actual lock-wait tests exercise revocation and expiry.

Only eight literal tokens are supported: patient_name, patient_first_name,
patient_last_name, age, sex, mrn, today and chief_complaint.
Demographics come from the protected server read. Chief complaint is explicit
caller input; there is no inferred clinical source. Today and completed age use
the disclosed UTC database date. Missing/unknown tokens remain visible and are
reported in bounded diagnostics. Introduced values are not recursively rendered;
there is no expression language or arbitrary token override.

Rendering parses supported structured JSON before substituting string leaves.
The response is a bounded patch of strings or one-level string maps, preserving
false, zero, metadata and untouched base sections. It does not reserialize and
return an arbitrary caller body. Plain text and supported section/envelope forms
are handled explicitly. Limits cover 20,000-character source/base input, 100
sections, depth ten, 200 generated fields, 20,000 serialized patch bytes and
bounded unresolved-token metadata. Valid JSON beyond the parser's Value-depth
limit is refused rather than treated as plain text; syntactically invalid literal
braces remain literal content.

Generate, review, apply and save are separate actions. Changing a template does
not overwrite the draft. Replacing nonempty sections or starting empty requires
explicit review. Every binding transition discards a completed preview and old
discard consent, including A-to-B-to-A transitions. Current 403 responses unmount
the protected workspace and already-applied clinical draft. Read errors do not
create or acknowledge an uncertain-write barrier; exact POST classification keeps
normal provenance/CSRF guards. Existing opaque uncertainty from a prior real
write remains blocking. Reviewed saving uses the existing UUID note command and
pins the chosen historical revision.

Preview stores no note, command receipt, preview body or clinical audit body and
makes no stock change. Existing version-zero network proof may create its
unchanged infrastructure sentinel; this is not a claim of zero infrastructure
writes. Unknown read faults return a static preview_failed response, without
reflecting database errors or clinical input.

## Verification

- Final pure renderer: 14 cases pass after two independently exposed defects were
  repaired. The first run reproduced five token/classification failures; a later
  deep-valid-JSON counterexample reproduced one depth-limit bypass.
- The full frontend passes 2,432 tests across 307 files; focused preview/history
  coverage passes 270 tests across 17 files. Lint has zero errors and 72 existing
  warnings. Production build, bundle limits and generated-client checks pass.
- React Doctor explicitly includes untracked source: 49 files, score 92 and zero
  reported issues. This is maintainability evidence, not accessibility/security
  certification or a score comparison against a different scan scope.
- Startup is 70.96 KiB gzip within 90 KiB. Entry is 39.94 KiB within the existing
  40 KiB budget; little entry headroom remains.
- Independent source review found and verified repairs for stale completed state
  and applied-draft lifetime. A suspected note/policy lock cycle was disproved by
  the actual compatible SHARE-lock graph. No production locking change is claimed
  for that hypothesis; the positive ordered graph is retained as a regression.

The generated contract has 485 operations, 393 paths, 1,070 schemas and 3,404
resolved local references, with no duplicate operation IDs. SHA256:
`53f111ae9845474156b888aefeb601c77c7012420528f87728e0819734fed18a`.

The full frozen Rust workspace passes 842 tests across 132 groups
with 0 ignored tests, followed by a successful native API/migrator build. This
is one complete successful workspace run over the combined fifteenth/sixteenth
source. The focused 63 backend cases are included in its coverage and are not
added again: 14 renderer, 19 preview HTTP, one ordered-lock HTTP, six existing
note HTTP, eleven template-history HTTP, eleven note database and one exact
read-POST classification case. Formatting passes.

Fresh isolated native acceptance applies 95 migrations through epoch023 and
confirms that epoch using the actual compiled schema-compatibility command.
Readiness returns HTTP200. All 107 native HTTP checks pass, including actual
factor enrollment/assertion/step-up/recovery, existing treatment/supply lifecycle,
template history and exact revision, shared-copy UUID replay, protected preview,
explicitly reviewed note saving and source retirement. Eight optional secondary
fixture controls are explicitly not run; their corresponding API regressions
are separate evidence. The temporary software P256 key exists only in process
memory; physical-authenticator acceptance is not claimed.

Persistence confirms two owned template roots, four revisions and four commands,
one reviewed draft note/version/command pinned to the original source revision,
and preserved false/zero base values. Existing treatment evidence remains one
course, two supply headers, two commands and one local stop, with conserved
stock, zero physical-administration evidence and the source prescription active.
The primary database and human accounts are not modified.

All 800 warm local debug requests at concurrency five return HTTP200:

| Protected read | Requests | HTTP200 | p99 |
| --- | --- | --- | --- |
| identity | 100 | 100 | 1.41 ms |
| assurance | 100 | 100 | 5.72 ms |
| factor status | 100 | 100 | 2.37 ms |
| registry | 100 | 100 | 5.28 ms |
| course list | 100 | 100 | 17.07 ms |
| course detail | 100 | 100 | 27.68 ms |
| template preview | 100 | 100 | 113.07 ms |
| template history | 100 | 100 | 6.38 ms |

These measurements exclude cold origin, edge, browser and production capacity.
The entry bundle remains close to its limit. The earlier optional unused SQLx
MySQL RSA advisory remains unresolved; this checkpoint does not establish an
advisory-free dependency graph.

The compiled API SHA256 is
`588ab037c39481cb2553232b61aee5e1bac03cad8d8e5959fcf08593ce04008d`;
the migrator SHA256 is
`fb4ac7670ed441a20b60effd2da85597dcb2d40e6b42d708ce91d26da79a4370`.
The generated OpenAPI bytes match the frozen source. Frozen source fingerprints,
focused/full gate logs and native receipts remain in local checkpoint evidence.

Rendered browser, physical-authenticator and staging acceptance remain pending. Private
sharing, optional review/publication governance, referral work and other ledger
rows remain separate. Pushed source is not a deployed release.
