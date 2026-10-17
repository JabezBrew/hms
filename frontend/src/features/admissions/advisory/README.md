# Admission follow-up

Rust V2 nonblocking admission advisory checklist, reached inside Patient Chronicle. A case-detail header provides an exact-case handoff; Ready cases have an explicit real case selector and do not require inventing a current stay. Ordinary patient relationship, Full clinical visibility, Admissions/Patients/Encounters features, AdmissionManage, clinical view and actual ward rights are enforced by the backend. UI gates never grant those rights from a role or creator identity.

The eight types are medication reconciliation, baseline laboratory follow-up, infection control, dietary, social work, transport, documents and other. Each type is recorded once per case. The checklist neither clears system blockers nor finishes intake, prevents discharge, assigns an inbox recipient or sends notifications.

The six generated operations are `getPatientChronicleAdmissionAdvisoryCases`, `getPatientChronicleAdmissionAdvisories`, `getPatientChronicleAdmissionAdvisory`, `postPatientChronicleAdmissionAdvisory`, `postPatientChronicleAdmissionAdvisoryDecision` and `getPatientChronicleAdmissionAdvisoryRequest`. Case choices use bounded cursors and explicit closed-history selection. The context is a complete list of at most eight metadata headers; rich notes require exact protected detail reads.

Completion notes are optional. Acknowledging unresolved and manual cancellation require a reason and remain distinct from completion. Case cancellation/discharge may retire pending tasks atomically; persisted source, system reason, actor, time and ward are displayed as episode retirement without rewriting prior terminal history.

## Safety and lifetime

- Query keys use sanitized authorization/transport scope and hashed patient/case/resource identifiers. Raw narrative and identifiers are never persisted in a cache key or uncertainty record.
- Full clinical content waits for a fresh protected context/detail read; errors and 403 override cached data. A protected denial unmounts copied clinical state. Current permissions come from fresh context and per-task flags; immutable receipts have no action authority.
- Explicit case/patient/visit/authority changes discard copied local state. Closing the portal retains only its local controller; closed queries and DOM stay absent. Pending dispatch blocks Escape, overlay, close and duplicate submissions.
- Reviewed context token and task version stay pinned. New source facts require explicit discard/reload, rather than silently advancing the draft. Optional completion notes normalize to null; surrounding note/reason whitespace is reviewed consistently with the contract.
- Commands use a stable UUID, exact reviewed payload and no automatic retry. Unknown results retain the original command and opaque transport metadata across ordinary close/reopen. Scope loss leaves only central opaque uncertainty, without clinical payload persistence.
- Exact validated original-result recovery acknowledges the original uncertainty handle. Missing, malformed or denied lookups cannot authorize a new mutation. Saved confirmation survives a later read-refresh failure.
- The central guard whitelists only the two exact command shapes and binds recovery review to the same case. Lean picker/context reads do not count as review of rich saved evidence. A related response remains a manual review aid, not proof of a complete history or of a saved/absent command.

## Verification

Run the feature suites plus the existing case-page tests:

```sh
npm run test:run -- src/features/admissions/advisory/__tests__ src/features/admissions/pages/__tests__/AdmissionCaseDetailPage.v2.test.jsx
```

These cross actual generated-client fetch boundaries, real Chronicle Host retention, pending/unknown/authority transitions and central persisted uncertainty. Rendered browser verification remains a separate release check.

### Checkpoint 11 frontend evidence

- 123/123 focused and affected tests passed across 12 suites, including the actual generated client and central write guard, real Chronicle Host close/reopen, source denial, authority withdrawal, ready/all-history case binding and stale copied review. Log: `/tmp/hms-advisory11-final.log`.
- Focused ESLint and `git diff --check` passed.
- React Doctor scanned 23 production files: 93/100, zero errors, four warnings. The new `AdvisoryWorkspace.jsx` controller retains a control-flow complexity warning; its read/form/pending/unknown/confirmed branches are explicit and covered by integration tests. Existing AdmissionCaseDetailPage and PatientChroniclePageContent complexity plus a PatientChroniclePageContent transition-all warning remain outside this surgical change. No scanner suppression was added.
- No rendered browser, local dist build, commit, deployment or backend test result is claimed by this frontend evidence. Parent integration owns broad acceptance and release checks.
