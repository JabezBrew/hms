# Clinical data visibility and UI authority

Status: focused implementation and frozen checkpoint-eight local gates passed.
No new browser or staging acceptance is claimed.

## Confirmed gap

A synthetic isolated Docker-database probe against checkpoint seven's actual
router reproduced demographic-only visibility plus clinical workflow permissions
returning medication text and allowing an old prescription-status update and
allergy creation. The newer protected prescribing detail correctly returned 403.
Workflow permission and facility membership did not establish the data class.

The new regression contract failed against the prior source on three
200-versus-403 assertions. Its nonpatient-template positive control passed.
The original four contract tests pass after the repairs. An additional actual-router
test separates nursing vitals authority from note and prescribing authority. Test fixtures explicitly
configure their intended visibility; production provisioning remains unchanged.

## Protected projections

| Surface | Required data class, in addition to its existing feature, workflow permission and patient/facility checks |
| --- | --- |
| Patient clinical lists and lean problem/allergy reads | `clinical_summary` or `full_clinical` |
| Patient clinical writes, full note body/version history and prescribing detail | `full_clinical` |
| Ward Round narrative, draft and actions | `full_clinical`, with the existing Chronicle relationship and action permissions |
| Minimal pharmacy clinical context | `prescription` or `full_clinical`, plus the Pharmacy feature and dispensing workflow permission |
| Minimal laboratory order context | `laboratory` or `full_clinical`, plus its existing laboratory workflow/feature gate |
| Nonpatient note-template configuration and medication catalog metadata | Existing explicit configuration/catalog permissions; no unnecessary full-patient-visibility grant |

Clinical relationship evidence authorizes ordinary Chronicle summary access only
when the actor also has a clinical-summary or full-clinical data grant. The
existing separately governed emergency grant remains an explicit audited summary
access override. It does not imply full note-body access or clinical write rights.

Chronicle returns authoritative `can_view_full_clinical` and write availability
flags. The note and prescribing flags require clinical-documentation authority;
vitals use the separate Nursing feature and task permission used by their actual
endpoint. All three require full clinical visibility and the current connection's
write decision.
The general connection read-only flag is not overloaded: other purpose-specific
workflows retain their own permissions. Frontend consumers must use explicit
server facts and fail closed when a field is absent.

Summary lists and Chronicle timeline metadata do not include full note bodies,
prescribing instructions or prescribing reasons. Correcting a visibility flag
must invalidate its authorization version; it is not a way to bypass feature,
patient or ward scope. This slice does not broaden production user defaults or
invent visibility from an administrative role.

## Evidence and remaining work

- Five actual-router tests cover demographic denial/no mutation, legitimate lean
  summaries, full-note/history/write denial, explicit full-note access, purpose
  classes/feature isolation, nonpatient template configuration and independent
  nursing vitals action availability.
- Nineteen access checks pass, including relationship plus data-class decisions.
- Twelve existing patient-contract checks pass; two read-only Chronicle shaping
  and cache fixtures now explicitly grant `clinical_summary`.
- Existing governed emergency-access HTTP acceptance passes.
- Evidence: `/tmp/hms-phase9-visibility-probe.log`,
  `/tmp/hms-clinical-visibility8-red-final.log`,
  `/tmp/hms-clinical-visibility8-five-final.log`,
  `/tmp/hms-clinical-visibility8-access-final.log`,
  `/tmp/hms-clinical-visibility8-patients-final.log` and
  `/tmp/hms-clinical-visibility8-existing.log`.

The broader nursing, laboratory and other purpose-specific route audit continues;
this record does not assert universal data-class or relationship enforcement.
Nonmedication write authority after database waits and a governed operator/UI
workflow for explicitly configuring visibility remain separate work. Current
clinical-visibility fixtures are synthetic and explicit; SQL-only fixture setup
is not a completed facility-administration feature. Full checkpoint-eight local tests and source fingerprints are recorded in its
verification report; rendered browser acceptance remains pending.
