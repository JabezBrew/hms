# Ordinary credential confirmation and combined recovery hardening

Status: frozen combined local acceptance passed. Checkpoints20 organization maintenance,21 storage
location maintenance and22 ordinary credential confirmation share one final
release acceptance. These results do not establish full Python feature parity,
rendered usability, hardware authenticator behavior or a staging deployment.

The existing ordinary InventoryManage policy requires fresh password proof, but
previously exposed only passkey confirmation. An actual ordinary account completes
its real initial password change, then reproduces POST/auth/reauthenticate404.
The new exact POST accepts only current_password and preserves its exact bytes.
Argon verification runs outside a database transaction with the existing bounded
crypto admission and persistent shared login/confirmation attempt budget.

Finalization retains the actual facility, active account and exact refresh
session; compares verified password hash, session/permission/profile/factor
versions; refuses current privileged or enrolled/malformed-key policy; and checks
the original authority horizon after waits. The original database admission time
becomes the monotonic password proof. The same transaction advances
assurance_version and records a minimal own-session audit before a final clock
check. No factor row, refresh rotation, cookie or session horizon is created or
extended. Cross-instance version checks evict older cached facts, and an older
JWT cannot borrow the newer credential time. A response failure after proof
commit authorizes no automatic replay of a business command.

The exact own-credential network exception is separate from business-write
authority and does not relax the forced-password-change lifecycle. Privileged
and enrolled users retain actual passkey confirmation; ordinary confirmation
does not become fallback after passkey failure or cancellation. Frontend proof
continuity must bind the same session/actor/facility/profile/security facts,
advanced assurance revision and exactly unchanged factor evidence. Current
server facts and a staged network recheck remain required.

The ordinary chooser uses the server's explicit unenrolled, non-required policy.
It verifies mandatory JWT session, actor, facility, profile and security versions,
whole-second authentication times, a strictly advanced assurance revision and the
actual confirmation dispatch time. A stale authentication timestamp cannot pass
merely by advancing the revision. A genuinely expired factor proof cleared by
the server may update the same session while clearing workflow continuity and
requiring fresh review. Password confirmation performs no implicit token refresh
or business-command replay after a definite failure.

Actual transport regressions also reproduce retained-error acknowledgment after
a later denial, late receipt display after a denial, cancelled digest review and
empty-evidence storage-fault review. Shared read/acknowledgment leases now retain
actual dispatch, cancellation, scope activation, uncertainty identity and storage
health. An actual response stamp grants no business authority or acknowledgment.
A legitimate cross-family original note amendment receipt must still recover
through an exact typed protocol; unrelated reads cannot substitute for it.

Additional independent controls reproduced global acknowledgment after cancelling
an already completed receipt read. Global and retained-response acknowledgment
now both require the live actual-read proof after asynchronous scope hashing.
Four permanent cancellation controls and29 independent shared cases pass; the
reported35 executions include two duplicate private controls. Eight existing
manual recovery suites pass170 tests.

A later source review identified two further variants, confirmed by four actual
negative transport tests with four restoration positives. A confirmed network
decision with `access_allowed=false`, or a settled exact-command retry returning
403, could leave an earlier receipt review usable. Both now invalidate published
and pending review monotonically. Merely restoring network access cannot revive
that proof; a fresh permitted read is required. Successful responses received
while current network access is denied cannot establish review. Allowed read-only
access remains eligible for saved-record review. Fourteen permanent controls,
the earlier35 executions and170 existing recovery tests pass after this fix.

Malformed JSON in an actual403 response reproduced the same problem before
parsing completed. Denial invalidation now occurs immediately after receiving
the current403 status, before parsing its body. A malformed403 uses a static
safe error envelope and preserves status403 so feature denial handlers clear
private data; parser messages cannot echo the returned body. Other response
parsing behavior is unchanged. The original stale-acknowledgment and missing-status
baselines remain recorded separately. Final controls pass21 permanent cases,
six private response-shape cases,35 shared executions and170 existing manual
recovery tests. The21 include previous-unknown and fresh-definite tracked-command
controls; a definite403 does not invent an unknown write.

| Gate | Current evidence |
| --- | --- |
| Ordinary endpoint baseline | Actual404 after real initial password lifecycle; separate preparation errors retained |
| Private auth focused |63 pass across five HTTP targets, plus one exact-network unit;12 owned source paths independently reviewed |
| Storage existing/focused |87 passes:23 new feature,23 PRN,26 API and15 inventory/provision/demo;31 additional root schema/startup controls |
| Ops |181 pass/four existing opt-in skips before documentation overlay; captured production controls unchanged |
| Recovery independent check | Source-bound cancellation/current-denial controls and final71-file ownership binding pass; no remaining finding in the bounded reviewed pass |
| Actual final OpenAPI/SDK |511 operations/417 paths/1142 schemas/3680 resolved references; emitted OpenAPI `fe8e186459787e4e6efc35aa4f70fc076d683bd00d9ab2c05544c4a427163cad`, generated client `83ce56c47248e96543b854f9dbc6d8535c8a71b03fb4717bc0c1429a74fe1aa1`; deterministic generation passes |
| Metadata/extractor/strict body repair |38 pass: four emitted-contract,17 organization and17 consultation controls; tagged unit NoVisit rejects unknown fields while preserving its valid shape |
| Full combined backend |1027 tests/150 targets, zero failures/ignored;635 backend/3405 context hashes unchanged; format/native binary build/actual export pass |
| Organization native compatibility |549 assertions over469 HTTP calls, including124 functional assertions/45 functional calls; frozen503 SDK against final028 binaries, seven immutable commands/audits/receipts and unchanged complete authority appointments |
| Storage and ordinary-auth native |552 assertions over466 HTTP calls, including127 functional assertions; actual511 SDK, real initial password lifecycle, same-session ordinary renewal/no factor/no cookie/horizon widening, nine immutable commands/audits/receipts/two no-ops,100 migrations/028 and historical stock/check persistence |
| Local protected-read samples |Each uses24 warmups plus400 requests at concurrency4, zero errors; organization p50/p95/p99 2.258/3.139/32.672 ms, storage1.950/5.674/28.805 ms; isolated loopback Docker PG/Redis/pool10, not production or clinical latency acceptance |
| Final combined frontend |3077 tests/343 suites, zero failures; lint zero errors/72 warnings, build and deterministic client check pass. All1633 frozen and working paths match,71 reviewed paths; earlier3056/342 and3070/343 passing collections remain superseded by the final denial fixes |
| Bundle | Entry40868/40960 gzip bytes, startup72651/92160 bytes, five preloads and no initial chart chunk; existing limits unchanged |
| React Doctor |68 explicit JavaScript paths, zero errors/seven warnings, score86 with degraded baseline; no numerical comparison or security/accessibility certification |
| Browser/hardware/public staging/production p99 | Not accepted |

The first combined Rust collection is intentionally interrupted during compilation
before any test target finishes after a real exported query declaration defect
is found. Its source/logs remain separate. No accepted run is inferred from that
interruption. The final run binds the corrected emitted contract and unchanged frozen source.
Both organization old-client compatibility and storage/ordinary-auth native
scenarios pass with persisted evidence and their owned processes/ports closed.

The full-run validation harness also had an output-path error: Cargo used the
dedicated care target, while the original final export/hash check referred to
the previous main target. The original collection and runner evidence remain preserved. The corrected
finalizer independently reparses all150 workspace summaries, verifies every gate
exit/log/source hash and finalizes the actual care-target binaries after the
successful workspace tests/native build and byte-identical emitted OpenAPI.
This repair changes validation tooling, not product source or test expectations.

The organization native harness separately corrected two verified test-premise
errors: current parent display changes after a parent rename while the original
receipt stays immutable, and provisioning creates an intentional baseline owner
appointment. The final run checks both current and historical display explicitly
and exact complete authority-appointment digests before/after HTTP. Earlier failed
attempts remain preserved; no product data/guard was altered to satisfy them.
