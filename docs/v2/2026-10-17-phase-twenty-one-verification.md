# Storage-location maintenance — combined local acceptance

Checkpoint21 implements a deliberately bounded inventory administration slice:
location creation, name correction and reversible maintenance of unused
locations. It does not complete used-location retirement, item administration,
physical transfers, procurement or controlled-stock closeout. Checkpoints20–22
share frozen local release acceptance. Browser, physical-authenticator and
deployment acceptance remain separate.

Location id, facility, code, type, temperature classification and creation time
are permanent. Later metadata commands review the exact version and retain an
original-actor UUID receipt. A name correction may preserve a used location's
identity and operational history. State changes here refuse any operational
reference, including zero lots and terminal history, with a truthful history
blocker. This is an unused-maintenance scope limit, not a claim that terminal
history represents present stock or that used locations can never retire.

New operational references must retain an active same-facility location inside
their actual publication transaction. Existing unchanged historical links remain
available for closure and evidence. The inspected schema has13 edges across10
tables; Rust purchase orders and goods received notes have no location foreign
key. A temperature label does not grant controlled-substance authority.

Actual baselines capture list/detail200, missing create405 and missing
rename/state/receipt404. The producer baseline accepts inactive transfers and
requisitions. It also records a foreign requisition returning409 after a row was
inserted: response status alone did not prove rollback. The persisted baseline
contains four unsafe rows. Repairs must verify both the response and zero
persisted effects through the same production interfaces.

A canonical governed rename200 followed by repeat provisioning reproduces a
seed failure: the new identity/version guard rejects the old destructive upsert.
This is not a claim that the old seed bypassed the guard and overwrote the name.
The preserving provisioning repair passes its focused controls; existing
provisioning regressions pass in the final combined workspace. An earlier setup
attempt failed before the seed control because three authored index identifiers
exceeded PostgreSQL's63-byte limit; corrected names and the matching exact
startup probe are retained separately from the genuine seed baseline.

Authority follows existing inventory policy: InventoryView for the directory,
InventoryManage for commands, real demographics visibility, Inventory feature,
fresh credential reauthentication, retained facility/session/network proof and
final database time. Admin role or a newly invented passkey requirement cannot
substitute for that policy. Privileged-account factor policy remains separately
authoritative.

Migration028 is a breaking runtime change. Its authored probe requires the
committed checksum and preceding chain, typed nonnullable command columns,
version/update metadata,12 enabled guards with exact functions/events/reference
arguments, the command primary key and15 real supporting indexes. Focused startup
tests pass31 cases on the frozen schema source; function-body/operator-state
attestation is outside this probe.
The deployment registry explicitly recognizes028 and refuses an older runtime
after028 commits. Older binaries are not assumed to discover future migrations.

| Gate | Current result |
| --- | --- |
| Ops registry baseline | Three actual failures against unchanged027 registry; seven refusal controls retained |
| Complete local ops |181 pass, four existing opt-in skips; captured59-path source unchanged |
| Governed backend and reference races |23 actual focused HTTP tests pass, including malformed typed extractors,13 history edges, producer/lifecycle races and final authority expiry; the final combined workspace passes |
| Startup/layout/CLI/API/worker |31 pass: database12, migrator9, API5 and worker5; captured root schema source unchanged |
| Actual OpenAPI/SDK and UI | Final511 operations/417 paths/1142 schemas/3680 resolved references, deterministic client check passes; combined frontend3077 tests/343 suites, zero failures |
| Full combined backend |1027 tests/150 targets, zero failures;635 backend/3405 context hashes unchanged; format/native binary build/actual export pass |
| Storage and ordinary-auth native |127 functional assertions,552 total assertions over466 actual HTTP calls; all eight generated methods, real initial password lifecycle, no ordinary factor, nine command/audit receipts/two no-ops, three stock units and preserved historical check closure pass. Read-only persistence verifies100 migrations/028 and exact authority |
| Local protected-read sample |24 warmups then400 bounded protected requests at concurrency4, zero errors; p50/p95/p99 1.950/5.674/28.805 ms on isolated loopback Docker topology; no production or clinical latency claim |
| Rendered browser, physical authenticator, staging and production latency | not accepted |

Full local acceptance preserves immutable original receipts, strict CAS/no-op
behavior, rollback on audit failure, both ordered producer/lifecycle races and
authority expiry after real waits. Current list rows cannot acknowledge an
uncertain command. Unknown RAM requests keep their exact UUID/body; reload
recovery uses the existing opaque barrier, an actual original receipt and a
separate acknowledgment. Local test success will not establish full Python
inventory parity or a deployed release.

Independent review captures actual invalid-input responses with422/plaintext
and echoed synthetic markers, while the declared contract promises a static400
envelope. All seven new handler extractors now return static400 envelopes under11
actual malformed-input controls without marker echo or persisted effects. The
earlier arbitrary4xx assertions are superseded.

The frontend's new read-only transition control also reproduces a stuck pending
attempt. Its narrow repair aborts that local attempt, retains the exact unknown
RAM command and conceals late results. The existing organization flow uses a
different keyed unmount lifetime: two actual generated-client controls retain
its opaque recovery barrier and reproduce no corresponding stuck state. No
organization source change follows from that comparison.

Further actual-transport frontend controls reproduce retained-error
acknowledgment after a newer denial, reload receipt display after a newer denial,
and cancelled receipt validation being published as reviewed. Shared transport
repairs bind review and receipt display to the actual current response lease and
exact uncertainty identity. The final combined frontend passes3077 tests/343 suites; independent recovery
controls and source ownership review pass. These results supersede earlier
frontend-only acceptance. Both owned native APIs stop and close their ports.
