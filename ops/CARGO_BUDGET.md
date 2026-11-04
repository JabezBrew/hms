# Local Cargo storage admission

Status: active tooling; heavy execution remains coordinator-only
Owner: Operations / Backend Engineering
Last reviewed: 2026-11-04
Scope: cooperative local Cargo admission across worktrees of one HMS repository.

Parallel worktrees must share an **existing, explicitly selected Cargo target**.
Do not copy targets or dependencies into worktrees. Only the session coordinator
queues and launches builds, database checks, and browser suites. A successful
admission is not permission to overlap those workloads or start services.

## Invocation

From any HMS worktree (the guard runs Cargo from that worktree's `backend-rs/`):

```bash
python3 scripts/cargo-budget.py \
  --target-dir /absolute/canonical/path/to/existing/shared-target \
  -- test -p hms-access

python3 scripts/cargo-budget.py \
  --target-dir /absolute/canonical/path/to/existing/shared-target \
  --timeout-seconds 1800 \
  -- test -p hms-api --test auth_contract -- --test-threads=1
```

The target must exist, contain a regular `.rustc_info.json` Cargo marker, belong
to the current user, permit no group/other writes, and use the repository's
filesystem. The guard follows no symlink component: use the canonical path
(for example `/private/tmp/…`, not macOS's `/tmp` alias). It rejects targets in
**any linked worktree**, Git metadata, repository/metadata ancestor directories, symlinks
inside the target, special files, nested filesystems, and target replacement.
An explicitly selected existing target under the primary checkout is allowed.
The guard never creates, cleans, repairs, or deletes target artifacts.

Supported commands are `build`, `check`, `test`, `run`, and `clippy`. The guard
adds `--locked --offline`; already supplied copies are preserved once. Missing
dependencies require separate coordinated provisioning, never an automatic
network/install retry. Resource/output/profile overrides, unstable flags,
custom manifests, Cargo aliases, and alternative host targets are refused.
Arguments after Cargo's `--` are accepted unchanged for `test` and `run` only;
compiler passthrough for `clippy` could override the resource policy and is
refused. No shell interprets the command.

The guard forces compiler jobs to **1**, incremental compilation off, and
standard dev/test debug output to **0**, including build-script profiles.
Both Cargo's target directory and newer intermediate build directory use the
same selected path. Guard-owned CLI configuration takes precedence over
environment/configuration overrides (see the official
[Cargo configuration precedence](https://doc.rust-lang.org/cargo/reference/config.html#command-line-overrides)).
The guard adds **no rustflags** and does not silently remove functional flags or
wrappers. It refuses nonempty inherited/configured compiler/doc flags and
wrappers, per-package debug/incremental overrides, configuration includes, and
configured child-environment overrides of the resource policy. Inherited
`CARGO_BUILD_TARGET` and configured scalar/array `build.target` also require
review; the guard adds no explicit `--target host` that could split existing
host/build-dependency fingerprints. It inspects
the workspace manifest, hierarchical Cargo configuration, and `CARGO_HOME`
configuration (legacy `config` takes precedence over `config.toml`). Config
symlinks, special files, malformed shapes, or sources larger than 1 MiB fail
closed. Custom flags/wrappers need a separately reviewed compatibility policy;
do not erase them or introduce an equivalent global flag to get admitted.
Review toolchain/feature compatibility before using an existing target. Test threads
default to 1 if `RUST_TEST_THREADS` was not supplied; this is separate from
compiler jobs. Preserve any deliberately required test matrix.

## Budgets and failure behavior

| Option | Default | Behavior |
| --- | --- | --- |
| `--min-free-gib` | 30 GiB | Refuse below this filesystem-available floor before launch and while running. |
| `--max-target-gib` | 40 GiB | Refuse/stop above this total target size, including existing artifacts. |
| `--poll-seconds` | 1 second | Check free space, target identity, interrupts, and runtime; maximum 10 seconds. |
| `--scan-seconds` | 30 seconds | Full target scan after the prior scan completes; maximum 60 seconds. |
| `--scan-timeout-seconds` | 5 seconds | Fail closed on an excessively slow target scan; maximum 10 seconds. |
| `--timeout-seconds` | 3600 seconds | Bound the build runtime; preflight also has this budget. |
| `--term-grace-seconds` | 3 seconds | TERM grace, then KILL and at most another grace period to reap; maximum 10 seconds. |
| `--kill-grace-seconds` | TERM grace | Optional separate post-KILL inspection/reap budget; maximum 10 seconds. |
| `--max-log-mib` | 16 MiB | Maximum raw output written when an optional private log is selected; maximum 64 MiB. |

All budgets must be finite and positive. Size uses the larger of apparent length
and allocated blocks for each unique inode, including directories, with hard
links counted once. Sparse length is counted conservatively. Files disappearing
during ordinary Cargo renames are tolerated; other unsafe/unreadable states
fail closed. Preflight and final scans catch oversized existing targets and
short-lived builds. Free-space/time/interrupt checks continue during scans.

Every invocation uses the same persistent kernel `flock` inode at
`$(git rev-parse --git-common-dir)/hms-cargo-budget/build.lock`, regardless of
selected target or invoking worktree. The state directory is owned mode 0700;
the lock is owned mode 0600, regular, and singly linked. Unsafe existing state
is refused without changing it. The lock is nonblocking; competing work is
refused, not queued. **Never unlink or replace this state to recover a lock.**

A private new session owns the Cargo process group. A small live session leader
pins its group ID until the final signal, so normal Cargo exit cannot expose a
reused process ID or macOS's zombie-only group signaling behavior. The guard
closes remaining group members even after successful Cargo exit or held-open
stdio. Interrupts, budget violations, unexpected errors, and timeouts trigger
TERM, bounded grace, KILL, final group inspection, and a bounded wait for the
owned session leader. Final inspection uses `/bin/ps` with only PID, group ID,
and process state, keeping the leader unreaped throughout. It requires the
pinned leader to be visible and verifies that every observed member is dead
or a zombie; it never treats a zombie-only group as proof of `ESRCH`.
The helper reaps its Cargo child during ordinary completion; adopted descendants
are reaped by the OS. Closure that cannot be verified fails rather than claiming
success. No process-name search, global kill, or unrelated session is used;
the inspection never selects individual PIDs for signaling.

The kernel lock is inherited by the session leader and Cargo. A dedicated
control pipe has exactly one writer in the supervisor: supervisor death/EOF
also makes the session leader terminate its own group within the cleanup
budget. Live inherited holders retain the lock during that cleanup. A second
interrupt records cancellation without skipping cleanup.

Exit status is Cargo's status on ordinary completion, `128 + signal` after a
handled interrupt, or **75** for admission/monitor/cleanup refusal. Status 75
requires review; do not automatically lower limits or retry outside the guard.
All existing artifacts are preserved, including partial/oversized output.

## Output and execution route

Raw child stdout/stderr is discarded by default. Guard messages contain fixed
reasons, aggregate size, and exit status; they do not echo commands, paths,
environment values, child errors, or clinical data. Optional diagnostics use a
new file only in an existing owned mode-0700 directory:

```bash
# Create/review a private directory separately; use its absolute canonical path.
python3 scripts/cargo-budget.py \
  --target-dir /absolute/canonical/path/to/existing/shared-target \
  --log-file /absolute/canonical/private-directory/build.log \
  -- test -p hms-access
```

The file is created exclusively, mode 0600, never overwritten or followed through
a symlink. The guard drains and discards bytes after the cap and emits a fixed,
nonsensitive truncation fact when bytes are clipped. Logs are raw,
potentially sensitive local diagnostics: inspect privately, keep them out of
Git/shared evidence, and remove them only through separately authorized retention.
The guard does not promise a complete log tail or retain a log automatically.

On macOS under Codex, the process-group suite needs the normal permitted local
execution route when the outer sandbox denies process inspection/signaling.
An actual denied cleanup is a failed run. This guard does not grant elevated
permissions. For commands that launch a browser, also follow `AGENTS.md` and
the shared `browser-test.py` route; this guard does not replace it. `cargo run`
is suitable for finite generators, not a persistent service: background children
are closed at completion and the runtime budget still applies.

## RAM-only evidence capture, protocol v1

Owned evidence runners that redact output before writing must use the reviewed
`scripts/cargo_capture.py::capture_cargo` Interface rather than prefixing the
default CLI around their current process launcher. The default CLI discards
output or clips an optional raw log; neither supplies complete redaction input.
The capture client invokes the same guard, lock, target validation and budgets,
with **no raw output file and no log-size clipping**. The caller must enforce its
own authorization/source/environment gates before calling it and redact the
returned bytes before any persistence. This API does not authorize a build or
prove that a failed test is meaningful RED evidence.

The client has a fail-closed **64 MiB capture ceiling** by default, configurable
through `max_capture_mib`. This is an acceptance limit, not a truncation mode:
one byte beyond the ceiling closes the liveness writer, keeps draining and
discarding during verified shutdown, discards the retained prefix, and returns
no raw output with `output_complete=false`, `capture_limit_exceeded=true` and
the fixed reason `capture memory ceiling exceeded`. The caller must stop and
cannot classify a partial test summary as meaningful RED. Exact-ceiling EOF is
allowed; accepted output remains complete and untruncated.

Required inputs are Cargo subcommand arguments, the existing target, a new
private lifecycle directory outside that target, repository working directory,
the explicitly prepared environment, timeout, and exact SHA-256 pins for the
guard and capture client. `stop_requested` is an optional side-effect-free
callback. Resource and cleanup options retain guard defaults; TERM and KILL
grace may be set separately (for example the RED6 runner's 8/5 seconds).

The client returns `(raw_bytes, closure)`. It retains at most the configured
raw-input ceiling and observes only one extra byte to detect overflow. It does not
print it or place it in a file, argv, environment, or receipt. The guardian's
raw stdout is pipe-only and its stderr contains only fixed guard diagnostics;
the client discards those diagnostics and uses structured lifecycle facts.
Stdout/stderr from Cargo remain merged, matching the original evidence runner.
The final conversion can temporarily hold both the retained buffer and returned
bytes (up to 128 MiB of payload at the default), plus Python allocator
overallocation, a read chunk, pipe buffers and the guardian's 64 KiB chunk.
This is not an RSS quota. Caller redaction can create further copies and expand
replacement text; the capture ceiling does not bound that expansion or guarantee
that Python returns freed memory immediately to the OS. Callers must retain RAM
headroom and bind any higher ceiling explicitly in their own authorization gate.

There are two explicitly owned sessions. The client owns the outer guardian
leader; the guardian owns the pinned inner worker/Cargo group. The client never
blindly kills the inner group. It retains the sole writer of a liveness pipe
until completion, drains raw output continuously, and cancels by closing that
writer. EOF makes the guardian stop and verify its nested group. The guardian
keeps one nonblocking 64 KiB output chunk: a slow/missing reader cannot block
storage sampling or cancellation. After group closure, `--pipe-drain-seconds`
(default 5, maximum 10) bounds final forwarding. Any incomplete stream is an
explicit failed capture, never a successful truncated log.

The guardian exclusively creates three mode-0600, fixed-field JSON files in the
existing owned mode-0700 lifecycle directory:

- `guardian-started.json`: protocol, guardian/controller IDs, time and guard hash.
- `worker-started.json`: guardian and exact nested worker IDs; absent on admission refusal.
- `completed.json`: Cargo/guard statuses, fixed refusal reason, control EOF,
  parent change, byte counts, EOF/completeness and nested closure observations.

These files contain no commands, environment values, raw output, raw output
hashes, or patient data. Existing files are never overwritten. The client checks
both source pins before/after, receipt identities, nested no-live-member proof,
leader reaping, raw EOF and exact byte counts. It separately proves no live outer
group members while its guardian leader is still unreaped, then reaps it. Both
layers distinguish zombie-only observations from `ESRCH`; neither claims PGID
absence from a different observation.

On controller SIGKILL/death, pipe EOF still reaches the independent guardian.
It closes/verifies the nested worker and leaves metadata for external review;
the lost controller's RAM output is never claimed complete. If the **guardian
itself** is SIGKILLed, its existing worker control-pipe fallback still attempts
bounded self-closure, but it cannot fabricate a completion receipt. Missing,
malformed, replayed, mismatched or incomplete proof fails acceptance and prevents
the next command. A coordinator must independently review any such failure.

Callers must require all of `leader_reaped`, `streams_closed`, `group_closed`,
`nested_worker_closed`, `communication_complete`, `output_complete`, and
`source_pins_unchanged`, plus absence of `runner_failure_type`/`closure_failure`.
A normal Cargo exit 101 can retain complete evidence; a guard refusal, timeout,
cancel, incomplete output or closure failure cannot establish meaningful RED.
The original source-gated RED6 adapter is a separately reviewed, versioned
source proposal; its original commands, six tests, source maps, credential
loading stages, and in-RAM redaction remain the coordinator's acceptance scope.

The client allows bounded admission overhead (40 seconds for repository probes
and preflight) in addition to the requested command and cleanup/drain budgets.
No other code may reap its owned guardian or retain the liveness writer. It
uses the normal permitted local process route; it does not bypass a denied
execution permission, escape the cooperative/sampling limits, or detect hostile
descendants that leave the owned session.

## Measurements and limits

On 2026-11-04, before the coordinator's separate authorized cleanup, read-only
measurements found about 39.8 GiB filesystem free, 34.15 GiB in the protected
shared target, and 14.51 GiB in the older primary-checkout target. A Python
descriptor-based scan of the protected target took about **0.34 seconds** and
the older target about 0.09 seconds. These are dated observations, not a target
selection or deletion policy. The coordinator subsequently reported deleting
only the approved older target and about 54.1 GiB free. Do not recreate that
default target. The protected existing target remains intact. Initial limits
stay at 30/40 GiB; protected-target growth headroom is only about **5.85 GiB**.
New flags/toolchains can consume that headroom through rebuilt artifacts.

Read-only fingerprint inspection found **1,280 JSON records with empty
`rustflags` and zero with nonempty flags** in that protected target. The prior
`run-schema-gates.py` runner set jobs=1, incremental=0, dev/test debug=0 and
asserted no `RUSTFLAGS`. The guard therefore preserves the empty-flag default;
injecting even an equivalent `-C debuginfo=0` would produce different dependency
fingerprints. This source/fingerprint evidence does not prove that a different
toolchain, feature set, worktree path, or Cargo version can reuse every artifact.
The later read-only scan measured 34.154 GiB in 0.12 seconds and 54.121 GiB free.

This is **sampled supervision, not an OS disk quota or a security sandbox**.
Free space can cross its floor between samples; target growth can overshoot
between scans, during a scan, or before processes stop. Cleanup and filesystem
I/O can be delayed by the OS. Directory scans are not atomic snapshots and
allocated-block accounting does not model APFS shared extents/compression,
snapshots, or every filesystem metadata allocation. Uncooperative writers can
avoid the guard, close inherited descriptors, change credentials, or escape the
session via `setsid`; a reused group ID is prevented for the owned leader, not
all hostile descendants. Cargo caches, temporary files, test side effects and
other filesystems are not subject to the target-size cap. Free-space sampling
observes their impact only on the target/repository filesystem. This lock does
not serialize independent repository clones or non-Cargo/browser/Docker jobs.
Coordinator scheduling and generous disk headroom remain necessary.

## Lightweight verification

Python 3.11+ (standard-library TOML support), Git, and POSIX process facilities
including `/bin/ps` are required. No packages, compiler, Postgres, Docker, or
browser are required:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s scripts/tests -p 'test_cargo_budget.py' -v
git diff --check
```

The tests create temporary Git repositories/worktrees and a fake Cargo program.
They exercise real process groups, resistant descendants, normal-exit stdio
holders, all handled interrupts, supervisor SIGKILL, unexpected leader death,
internal-worker session validation, lock inheritance,
cross-worktree exclusion, path/CLI refusals, running/final target growth, mocked
running free-space loss, bounded private output, sparse files, hard links, and
scan timeout. They do not establish real Cargo/toolchain compatibility or grant
a heavy-build slot. Coordinator acceptance still needs a separately queued
finite Cargo run through the guard with the explicitly selected existing target.
