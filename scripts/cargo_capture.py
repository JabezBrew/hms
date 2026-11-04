"""Versioned, RAM-only client for the Cargo budget guardian.

The caller owns authorization, source gates and redaction before persistence.
No Cargo execution on import; no raw output files or command/environment receipts.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import stat
import subprocess
import sys
import time


PROTOCOL = 'hms-cargo-pipe-capture-v1'
GUARD = Path(__file__).resolve().with_name('cargo-budget.py')


def digest(path: Path) -> str:
    if path.is_symlink() or not path.is_file():
        raise ValueError('capture source must be a regular pinned file')
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_receipt(guard, directory: Path, name: str) -> dict:
    parent = guard.open_directory(directory)
    try:
        guard.private(os.fstat(parent), directory=True)
        descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    finally:
        os.close(parent)
    with os.fdopen(descriptor, 'rb') as source:
        guard.private(os.fstat(source.fileno()))
        value = source.read(65537)
        if len(value) > 65536:
            raise ValueError('capture receipt exceeds its metadata budget')
        result = json.loads(value)
    if not isinstance(result, dict) or result.get('protocol') != PROTOCOL:
        raise ValueError('capture receipt protocol mismatch')
    return result


def capture_cargo(arguments: list[str], *, target_dir: Path, lifecycle_dir: Path,
                  cwd: Path, environment: dict[str, str], expected_guard_sha256: str,
                  expected_client_sha256: str, timeout_seconds: float,
                  stop_requested=lambda: False, term_grace_seconds: float = 8,
                  kill_grace_seconds: float = 5, pipe_drain_seconds: float = 5,
                  min_free_gib: float = 30, max_target_gib: float = 40,
                  poll_seconds: float = 1, scan_seconds: float = 30,
                  max_capture_mib: float = 64) -> tuple[bytes, dict]:
    """Return complete captured bytes plus explicit outer/nested lifecycle facts.

    A false completeness fact forbids acceptance, regardless of a Cargo summary.
    EOF on the sole liveness writer cancels the guardian without killing its
    nested worker owner. No per-command shell or raw output file is used.
    """
    values = (timeout_seconds, term_grace_seconds, kill_grace_seconds, pipe_drain_seconds,
              min_free_gib, max_target_gib, poll_seconds, scan_seconds, max_capture_mib)
    if (any(type(value) not in (int, float) or not math.isfinite(value) or value <= 0 for value in values)
            or max(term_grace_seconds, kill_grace_seconds, pipe_drain_seconds, poll_seconds) > 10
            or scan_seconds > 60 or scan_seconds < poll_seconds
            or any(not math.isfinite(value * 1024 ** 3) for value in (min_free_gib, max_target_gib))
            or max_capture_mib * 1024 ** 2 > sys.maxsize or max_capture_mib * 1024 ** 2 < 1):
        raise ValueError('capture budgets must be finite, positive and within protocol bounds')
    capture_limit = int(max_capture_mib * 1024 ** 2)
    if digest(GUARD) != expected_guard_sha256 or digest(Path(__file__)) != expected_client_sha256:
        raise ValueError('capture sources changed before launch')
    spec = importlib.util.spec_from_file_location('hms_cargo_capture_guard', GUARD)
    guard = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(guard)
    command = [sys.executable, str(GUARD), '--capture-pipe', '--lifecycle-dir', str(lifecycle_dir),
               '--target-dir', str(target_dir), '--timeout-seconds', str(timeout_seconds),
               '--term-grace-seconds', str(term_grace_seconds), '--kill-grace-seconds', str(kill_grace_seconds),
               '--pipe-drain-seconds', str(pipe_drain_seconds), '--min-free-gib', str(min_free_gib),
               '--max-target-gib', str(max_target_gib), '--poll-seconds', str(poll_seconds),
               '--scan-seconds', str(scan_seconds), '--', *arguments]
    closure = {'protocol': PROTOCOL, 'timed_out': False, 'interrupted': False,
               'leader_reaped': False, 'streams_closed': False, 'group_closed': False,
               'communication_complete': False, 'exit_code': None, 'guardian_exit_code': None,
               'nested_worker_closed': False, 'raw_output_files_created': 0,
               'output_complete': False, 'source_pins_unchanged': False,
               'capture_limit_bytes': capture_limit, 'capture_limit_exceeded': False}
    process = None
    output = bytearray()
    observed_bytes = discarded_bytes = 0
    eof = False
    control_closed = False
    deadline = time.monotonic() + timeout_seconds + 40 + term_grace_seconds + kill_grace_seconds + pipe_drain_seconds
    cleanup_deadline = None
    outer_proof = {}

    def cancel():
        nonlocal control_closed, cleanup_deadline
        if process is not None and not control_closed:
            process.stdin.close()
            control_closed = True
            cleanup_deadline = time.monotonic() + term_grace_seconds + kill_grace_seconds + pipe_drain_seconds + 2

    def drain():
        nonlocal eof, observed_bytes, discarded_bytes
        for _ in range(16):
            if eof:
                break
            try:
                remaining = capture_limit - len(output)
                read_size = 65536 if closure['capture_limit_exceeded'] else min(65536, remaining + 1)
                value = os.read(process.stdout.fileno(), read_size)
            except BlockingIOError:
                break
            if not value:
                eof = True
                break
            observed_bytes += len(value)
            if closure['capture_limit_exceeded']:
                discarded_bytes += len(value)
            elif len(output) + len(value) > capture_limit:
                # Retain at most the ceiling, observe only one extra byte to
                # distinguish exact EOF, then release the prefix immediately.
                # Continue draining/discarding while EOF closes both layers.
                closure['capture_limit_exceeded'] = True
                closure['failure_reason'] = 'capture memory ceiling exceeded'
                discarded_bytes += len(output) + len(value)
                output.clear()
                cancel()
            else:
                output.extend(value)

    try:
        process = subprocess.Popen(command, cwd=cwd, env=environment, stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, start_new_session=True)
        closure.update(child_pid=process.pid, owned_process_group=process.pid)
        os.set_blocking(process.stdout.fileno(), False)
        while not guard.exited(process):
            drain()
            if stop_requested():
                closure['interrupted'] = True
                cancel()
            if time.monotonic() >= deadline:
                closure['timed_out'] = True
                cancel()
            if cleanup_deadline is not None and time.monotonic() >= cleanup_deadline:
                raise ValueError('guardian did not finish its bounded cancellation protocol')
            time.sleep(0.01)
        # The guardian is still unreaped, pinning its outer PGID for inspection.
        if guard.group_has_live_members(process.pid, kill_grace_seconds):
            raise ValueError('guardian left live members in its outer group')
        outer_proof.update(group_inspection_complete=True, no_live_members=True,
                           no_live_members_observed_at=time.time())
        process.wait(timeout=kill_grace_seconds)
        outer_proof.update(leader_reaped=True, leader_exit_code=process.returncode)
        closure.update(leader_reaped=True, group_closed=True, guardian_exit_code=process.returncode)
        until = time.monotonic() + pipe_drain_seconds
        while not eof and time.monotonic() < until:
            drain()
            if not eof:
                time.sleep(0.01)
        started = read_receipt(guard, lifecycle_dir, 'guardian-started.json')
        completed = read_receipt(guard, lifecycle_dir, 'completed.json')
        if (started.get('guard_pid') != process.pid or started.get('guard_pgid') != process.pid
                or started.get('guard_sha256') != expected_guard_sha256
                or completed.get('guard_pid') != process.pid or completed.get('guard_pgid') != process.pid
                or completed.get('guard_exit_code') != process.returncode
                or completed.get('raw_output_files_created') != 0):
            raise ValueError('guardian lifecycle identity mismatch')
        worker = completed.get('worker_pid')
        nested = completed.get('worker_closure', {})
        if worker is not None:
            worker_started = read_receipt(guard, lifecycle_dir, 'worker-started.json')
            if (type(worker) is not int or worker_started.get('guard_pid') != process.pid
                    or worker_started.get('worker_pid') != worker
                    or worker_started.get('worker_pgid') != worker or completed.get('worker_pgid') != worker):
                raise ValueError('nested worker lifecycle identity mismatch')
            closure['nested_worker_closed'] = all(nested.get(key) is True for key in
                                                  ('group_inspection_complete', 'no_live_members', 'leader_reaped'))
        else:
            closure['nested_worker_not_started'] = True
            closure['nested_worker_closed'] = completed.get('guard_failure') is not None
        closure.update(guard_lifecycle=completed, exit_code=completed.get('cargo_exit_code'),
                       communication_complete=eof, captured_bytes=len(output),
                       observed_output_bytes=observed_bytes, discarded_output_bytes=discarded_bytes)
        closure['output_complete'] = (eof and completed.get('pipe_complete') is True
                                      and not closure['capture_limit_exceeded']
                                      and type(completed.get('bytes_read')) is int
                                      and completed['bytes_read'] == completed.get('bytes_forwarded') == len(output))
        closure['source_pins_unchanged'] = (digest(GUARD) == expected_guard_sha256
                                          and digest(Path(__file__)) == expected_client_sha256)
        if (completed.get('guard_failure') is not None or completed.get('control_eof') is True
                or not closure['nested_worker_closed'] or not closure['output_complete']
                or not closure['source_pins_unchanged']):
            closure['closure_failure'] = 'guard refusal or incomplete nested capture; no next command'
        if closure['capture_limit_exceeded']:
            closure['closure_failure'] = 'capture memory ceiling exceeded; no next command'
        if completed.get('guard_failure') == 'build runtime limit exceeded':
            closure['timed_out'] = True
    except (guard.Refusal, OSError, ValueError, subprocess.SubprocessError) as error:
        closure['runner_failure_type'] = type(error).__name__
        closure['closure_failure'] = 'capture guardian acceptance failed; no next command'
    finally:
        if process is not None:
            cancel()
            if not closure['leader_reaped']:
                # Never signal a reaped guardian PID/group. This failure path
                # cannot claim nested closure without the guardian's receipt.
                try:
                    guard.stop_group(process, term_grace_seconds, outer_proof, kill_grace_seconds)
                    closure.update(leader_reaped=True, group_closed=outer_proof.get('no_live_members') is True,
                                   guardian_exit_code=process.returncode)
                except (guard.Refusal, OSError, subprocess.SubprocessError):
                    closure['closure_failure'] = 'outer guardian closure unverified; no next command'
            for stream in (process.stdin, process.stdout):
                if stream is not None:
                    stream.close()
            closure['streams_closed'] = True
    closure['outer_guardian_closure'] = outer_proof
    closure.update(returned_output_bytes=len(output), observed_output_bytes=observed_bytes,
                   discarded_output_bytes=discarded_bytes)
    return bytes(output), closure
