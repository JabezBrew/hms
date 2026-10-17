# Verified-factor proof for privileged workflow writes

Status: implemented and focused checks passed. This document does
not claim deployment, manufacturer attestation, independent supervisor signing,
or complete authentication assurance for every product workflow.

The governed clinical and financial commands now pass an actor derived from the
resolved request context into an explicit authorized repository interface. The
write transaction locks and verifies the real facility/profile, user versions,
exact live session, durable password proof, current verified passkey assurance
and its active credential. It rereads the command's effective permission and
feature while retaining the corresponding facility/user locks. The final database
clock check is after business writes and audit, immediately before commit. The
proof is bounded by the resolved authority deadline as well as password, factor
and session expiry; refreshing a token does not create a new factor proof.

The protected commands in this packet are laboratory single/bulk verification,
invoice finalization, payment reversal, NHIS receivable adjustment, controlled
movement/count, consent creation/revocation, emergency-access start and discharge
blocker override. This does not add a factor requirement to ordinary admission
cancellation/completion or infer Full clinical visibility from a privileged role.
Existing per-workflow clinical/patient access checks remain in place. Root's
separate admin packet and the authentication owner's HMS Ops/core packet use the
same proof interface.

Business proof retains facility, user, session and key SHARE locks. It does not
modify authentication rows. Authentication management keeps its separate strong
identity locks before credential changes. This allows a governed ward-round
commit holding clinical read proof to serialize with a parent-first discharge
override for the same actor/session without a proof lock upgrade.

Most commands acquire actor proof before their source rows. Discharge blocker
override first acquires its discharge-case parent, matching canonical discharge
completion's existing source-before-actor order. It then verifies factor proof,
rechecks the requested state and writes under that parent lock. Controlled count
and movement serialize their physical item before reading the current balance;
count no longer computes a delta from a balance outside its write transaction.
Controlled commands first lock the facility and sorted actor/witness users,
then verify factor proof and acquire the physical item and active local location.
This also serializes opposite actor/witness pairs. A supplied witness must be
distinct, active and local; it remains recorded identity metadata, not an
independently authenticated witness signature. Emergency-access start retains its
existing per-user quota lock before factor proof, with facility-first ordering;
ending a grant remains an attenuation operation without a new factor demand.

Source waits can therefore expire an already acquired proof, and the final check
rolls back both business changes and audit. A revocation that wins before the
proof denies the command; a revocation that follows an acquired proof waits for
that transaction rather than retroactively invalidating its earlier linearized
work.

Minimal transaction audits contain operation/resource identifiers and bounded
counts, never clinical reasons, consent purpose or narrative. Single-result
verification replay preserves its original verified actor/time. Consent
revocation replay preserves the original evidence without recording a second
revocation event. Existing billing supervisor identifiers are preserved; they
are not proof of an independently signed approval.

Controlled movement/count compares saved register balance with physical stock
under the item parent before any write. Divergence, including a zero-delta count,
returns the definite `controlled_balance_review_required` conflict without
altering either history. The workflow does not infer an opening balance or
reconcile imported inconsistencies; a governed reconciliation command remains
unimplemented. Register insertion uses the database clock at the serialized
write, rather than transaction start time, so an earlier-started request waiting
on a different actor cannot become an older latest-balance row after a later
request has already committed. This is a transaction-order repair, not a general
wall-clock monotonicity claim.

Unexpected controlled storage/commit/readback failures return
`controlled_count_write_unconfirmed` or
`controlled_movement_write_unconfirmed`; the caller must inspect saved records.
Specific eligibility and drift denials remain definite. These operations do not
have a command UUID/exact-replay contract, and the active frontend disables
automatic retries. Count context reads reuse the held transaction connection,
rather than acquiring another pool connection while retaining write locks.

Generic batch receipts, legacy arbitrary-line supply issue and manual pharmacy
dispense cannot change controlled stock outside the dedicated register. They
share an active local item check retained under `FOR SHARE`, rejecting either
the controlled flag or the controlled item type with the definite
`controlled_stock_workflow_required` conflict. Standing-template configuration
and actual issue enforce both classifications in their bounded item-lock query;
issue rereads current flags rather than trusting a previously approved snapshot.
Inventory display flags reflect that same classification. Scheduled and PRN
fulfillment already reject both classifications under their source/item locks.
The dedicated controlled receipt accepts either authoritative classification,
without rewriting the stored flag or granting generic inventory authority.
An actual receipt waiting behind a classification change must inspect the
committed item row before writing any physical stock.
The current generic transfer and GRN operations are metadata-only and are not
claimed to perform or reconcile physical stock. No generic controlled receipt,
transfer, witness attestation, opening-balance or return/waste workflow is
invented by this packet.

Legacy arbitrary-line supply issue is bounded to at most 100 submitted lines in
both the API service and repository, before opening its write transaction. The
existing empty-request contract is retained. This is a bounded sequential legacy
writer, not a claim of bulk SQL or constant query count. Rejected oversized
requests leave stock, request state and movement/dispense evidence unchanged.

Trusted repository entry points remain available for isolated fixtures/imports.
Production services call only the mandatory actor-bearing authorized variants;
there is no public payload flag that selects the internal unproved path.

The integration fixture now keeps runtime P-256 private keys in RAM, scoped to the
actual isolated test database, facility, user and credential. Ordinary privileged
login performs actual options, registration when explicitly bootstrapped, and a
signed assertion before receiving its session. Additional assertions use increasing
counters. Explicit trusted fixture enrollment stores only a passkey accepted by
the production registration verifier; it never inserts fabricated session
assurance. Negative tests use a raw password-login helper so enrollment or forced
password-change premises are not silently removed. Ordinary fixture helpers
complete a required password change through the real endpoint and remember the
replacement only in RAM.

The focused HTTP matrix uses supported requests for all ten privileged permission
families, with separate laboratory bulk, consent revocation and payment reversal
coverage. It compares minimal business/stock evidence for denied or rolled-back
writes, then requires real positive outcomes with fresh signed proof. Temporal
cases use actual PostgreSQL lock waits and database-clock expiry. Full workspace
acceptance and final exact-source results are recorded by the release owner.

Final focused checks for this packet passed 18 HTTP tests for generic and
controlled stock plus existing inventory/standing workflows, 14 HTTP tests for
the actual-factor matrix, authority lifetime and clinical lock ordering, and 10
inventory repository tests. The stock tests include actual current-item lock
waits, both controlled classifications, rejected 101-line requests, valid
dedicated receipts and unchanged evidence on denial. The three-writer clinical
queue test completed successfully; it did not reproduce the hypothesized
deadlock. Existing authentication and fixture suites passed earlier in the
packet; complete workspace acceptance remains the release owner's gate.
