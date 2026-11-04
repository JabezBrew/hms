#!/usr/bin/env python3
"""Cooperative, POSIX-only admission and supervision for HMS Cargo builds.

No Cargo execution on import. See ops/CARGO_BUDGET.md for the Interface and limits.
"""
from __future__ import annotations

import argparse
import contextlib
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import selectors
import signal
import stat
import struct
import subprocess
import sys
import time
import tomllib


GIB = 1024 ** 3
STATE_NAME = 'hms-cargo-budget'
LOCK_NAME = 'build.lock'
DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


class Refusal(Exception):
    """Only fixed, non-sensitive messages belong in this exception."""


def identity(info: os.stat_result) -> tuple[int, int]:
    return info.st_dev, info.st_ino


def open_directory(path: Path) -> int:
    """Open an absolute directory without following any symlink component."""
    if not path.is_absolute() or '..' in path.parts:
        raise Refusal('an absolute, canonical directory is required')
    descriptor = os.open('/', DIRECTORY_FLAGS)
    try:
        for part in path.parts[1:]:
            following = os.open(part, DIRECTORY_FLAGS, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = following
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def private(info: os.stat_result, directory: bool = False) -> None:
    expected = stat.S_ISDIR if directory else stat.S_ISREG
    if (not expected(info.st_mode) or info.st_uid != os.geteuid()
            or info.st_mode & 0o077 or (not directory and info.st_nlink != 1)):
        raise Refusal('private state or log is unsafe')


def git(*arguments: str) -> bytes:
    result = subprocess.run(['git', *arguments], stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, timeout=10, check=False)
    if result.returncode:
        raise Refusal('repository discovery failed')
    return result.stdout


def repository() -> tuple[Path, Path, list[Path]]:
    root = Path(os.fsdecode(git('rev-parse', '--show-toplevel').strip())).resolve(strict=True)
    common = Path(os.fsdecode(git('rev-parse', '--git-common-dir').strip())).resolve(strict=True)
    trees = [Path(os.fsdecode(part[9:])).resolve() for part in
             git('worktree', 'list', '--porcelain', '-z').split(b'\0') if part.startswith(b'worktree ')]
    if not trees or not (root / 'backend-rs' / 'Cargo.toml').is_file():
        raise Refusal('an HMS worktree is required')
    return root, common, trees


@contextlib.contextmanager
def lease(common: Path):
    """One persistent inode in the common Git directory, across all worktrees."""
    with contextlib.ExitStack() as stack:
        common_fd = open_directory(common)
        stack.callback(os.close, common_fd)
        try:
            os.mkdir(STATE_NAME, mode=0o700, dir_fd=common_fd)
        except FileExistsError:
            pass
        state_fd = os.open(STATE_NAME, DIRECTORY_FLAGS, dir_fd=common_fd)
        stack.callback(os.close, state_fd)
        private(os.fstat(state_fd), directory=True)
        if identity(os.fstat(state_fd)) != identity(os.stat(STATE_NAME, dir_fd=common_fd, follow_symlinks=False)):
            raise Refusal('repository lock directory identity changed')
        descriptor = os.open(LOCK_NAME, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK,
                             0o600, dir_fd=state_fd)
        stack.callback(os.close, descriptor)
        private(os.fstat(descriptor))
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Refusal('another guarded build owns the repository lock') from None
        if identity(os.fstat(descriptor)) != identity(os.stat(LOCK_NAME, dir_fd=state_fd, follow_symlinks=False)):
            raise Refusal('repository lock identity changed')
        # Do not unlink or explicitly unlock. The child inherits this open file
        # description so supervisor SIGKILL cannot admit a competing build.
        yield descriptor


class Target:
    def __init__(self, path: Path, root: Path, common: Path, trees: list[Path]):
        self.path = path
        self.fd = open_directory(path)
        try:
            info = os.fstat(self.fd)
            self.original = identity(info)
            if (info.st_uid != os.geteuid() or info.st_mode & 0o022
                    or info.st_dev != root.stat().st_dev
                    or root.is_relative_to(path) or common.is_relative_to(path) or path.is_relative_to(common)
                    or any(path.is_relative_to(tree) for tree in trees[1:])):
                raise Refusal('target must be owned, shared, and on the repository filesystem')
            marker = os.stat('.rustc_info.json', dir_fd=self.fd, follow_symlinks=False)
            if not stat.S_ISREG(marker.st_mode):
                raise Refusal('an existing Cargo target marker is required')
        except BaseException:
            self.close()
            raise

    def close(self) -> None:
        os.close(self.fd)

    def check(self) -> int:
        """Check path identity and filesystem headroom without walking the tree."""
        descriptor = open_directory(self.path)
        try:
            info = os.fstat(descriptor)
            if identity(info) != self.original:
                raise Refusal('selected target identity changed')
            if info.st_uid != os.geteuid() or info.st_mode & 0o022:
                raise Refusal('selected target ownership or permissions became unsafe')
        finally:
            os.close(descriptor)
        disk = os.fstatvfs(self.fd)
        return disk.f_bavail * disk.f_frsize

    def measure(self, maximum: int, heartbeat=lambda: None, scan_seconds: float = 5) -> int:
        """Conservative allocated/apparent size; no symlinks or nested mounts.

        Walk by directory descriptors. Deduplicate hard links, tolerate ordinary
        concurrent deletion, and fail closed on unsafe entries or slow scans.
        """
        deadline = time.monotonic() + scan_seconds
        root_info = os.fstat(self.fd)
        seen: set[tuple[int, int]] = {identity(root_info)}
        total = max(root_info.st_size, root_info.st_blocks * 512)
        if total > maximum:
            raise Refusal('target size limit exceeded')

        def visit(descriptor: int) -> None:
            nonlocal total
            heartbeat()
            with os.scandir(descriptor) as entries:
                for entry in entries:
                    if time.monotonic() >= deadline:
                        raise Refusal('target scan exceeded its time budget')
                    heartbeat()
                    try:
                        info = entry.stat(follow_symlinks=False)
                        if info.st_dev != self.original[0] or stat.S_ISLNK(info.st_mode):
                            raise Refusal('target contains a symlink or nested filesystem')
                        if identity(info) not in seen:
                            seen.add(identity(info))
                            total += max(info.st_size, info.st_blocks * 512)
                            if total > maximum:
                                raise Refusal('target size limit exceeded')
                        if stat.S_ISDIR(info.st_mode):
                            following = os.open(entry.name, DIRECTORY_FLAGS, dir_fd=descriptor)
                            try:
                                if identity(os.fstat(following)) != identity(info):
                                    raise Refusal('target directory identity changed during scan')
                                visit(following)
                            finally:
                                os.close(following)
                        elif not stat.S_ISREG(info.st_mode):
                            raise Refusal('target contains a special file')
                    except FileNotFoundError:
                        # Cargo routinely renames and removes ordinary artifacts.
                        continue

        visit(self.fd)
        return total


def cargo_arguments(arguments: list[str], target: Path) -> list[str]:
    if not arguments or arguments[0] not in {'build', 'check', 'test', 'run', 'clippy'}:
        raise Refusal('expected build, check, test, run, or clippy after --')
    if '--' in arguments and arguments[0] not in {'test', 'run'}:
        raise Refusal('only test and run accept runtime arguments after the Cargo separator')
    before_separator = arguments[:arguments.index('--')] if '--' in arguments else arguments
    forbidden = ('--config', '--jobs', '--target-dir', '--build-dir', '--artifact-dir',
                 '--out-dir', '--profile', '--release', '--manifest-path', '--lockfile-path')
    for arg in before_separator[1:]:
        option = arg.split('=', 1)[0]
        short_option = arg[1:].lstrip('qv') if arg.startswith('-') and not arg.startswith('--') else ''
        if (option.startswith('--') and any(item.startswith(option) or option.startswith(item) for item in forbidden)
                or short_option[:1] in {'j', 'Z', 'r', 'C'}):
            raise Refusal('Cargo resource or output overrides are not allowed')
    configs = {'build.jobs': 1, 'build.target-dir': str(target), 'build.build-dir': str(target),
               'build.incremental': False, 'profile.dev.debug': 0, 'profile.test.debug': 0,
               'profile.dev.incremental': False, 'profile.test.incremental': False,
               'profile.dev.build-override.debug': 0, 'profile.test.build-override.debug': 0}
    result = ['cargo']
    for key, value in configs.items():
        result.extend(['--config', f'{key}={json.dumps(value)}'])
    automatic = [flag for flag in ('--locked', '--offline') if flag not in before_separator]
    result.extend([arguments[0], *automatic, *arguments[1:]])
    return result


def cargo_environment(target: Path) -> dict[str, str]:
    environment = os.environ.copy()
    environment.update(CARGO_BUILD_JOBS='1', CARGO_INCREMENTAL='0', CARGO_PROFILE_DEV_DEBUG='0',
                       CARGO_PROFILE_TEST_DEBUG='0', CARGO_TARGET_DIR=str(target),
                       CARGO_BUILD_TARGET_DIR=str(target), CARGO_BUILD_BUILD_DIR=str(target))
    environment.setdefault('RUST_TEST_THREADS', '1')
    return environment


def flag_or_wrapper(key: str) -> bool:
    return (key in {'RUSTFLAGS', 'RUSTDOCFLAGS', 'RUSTC_WRAPPER', 'RUSTC_WORKSPACE_WRAPPER'}
            or key.startswith('CARGO_') and key.endswith(('_RUSTFLAGS', '_RUSTDOCFLAGS', '_WRAPPER')))


def read_toml(path: Path) -> dict:
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return {}
    with os.fdopen(descriptor, 'rb') as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > 1024 ** 2:
            raise Refusal('Cargo policy source is unsafe or too large')
        content = source.read(1024 ** 2 + 1)
        if len(content) > 1024 ** 2:
            raise Refusal('Cargo policy source is unsafe or too large')
        return tomllib.loads(content.decode('utf-8'))


def validate_configuration(root: Path) -> None:
    """Preserve warm fingerprints: refuse unreviewed flags rather than erase them.

    Empty rustflags match the selected warm target. CLI scalar profile settings
    handle standard profiles; per-package overrides need separate admission.
    """
    if any(value and flag_or_wrapper(key) for key, value in os.environ.items()):
        raise Refusal('inherited compiler flags or wrappers require separate compatibility review')
    if os.environ.get('CARGO_BUILD_TARGET'):
        raise Refusal('inherited Cargo build target requires separate compatibility review')
    cwd = root / 'backend-rs'
    directories = [path / '.cargo' for path in (cwd, *cwd.parents)]
    directories.append(Path(os.environ.get('CARGO_HOME', str(Path.home() / '.cargo'))))
    sources = []
    for directory in directories:
        legacy = directory / 'config'
        sources.append(legacy if os.path.lexists(legacy) else directory / 'config.toml')

    def table(value):
        if not isinstance(value, dict):
            raise Refusal('Cargo policy source has an unsupported table shape')
        return value

    for source in [cwd / 'Cargo.toml', *sources]:
        data = read_toml(source)
        if data.get('include'):
            raise Refusal('Cargo configuration includes require separate compatibility review')
        build = table(data.get('build', {}))
        if 'target' in build:
            raise Refusal('configured Cargo build target requires separate compatibility review')
        sections = [build, *[table(item) for item in table(data.get('target', {})).values()]]
        if any(section.get(key) for section in sections for key in
               ('rustflags', 'rustdocflags', 'rustc-wrapper', 'rustc-workspace-wrapper')):
            raise Refusal('configured compiler flags or wrappers require separate compatibility review')
        for key in table(data.get('env', {})):
            if (flag_or_wrapper(key) or key.startswith('CARGO_PROFILE_')
                    or key in {'CARGO_BUILD_JOBS', 'CARGO_INCREMENTAL', 'CARGO_TARGET_DIR', 'CARGO_BUILD_TARGET',
                               'CARGO_BUILD_TARGET_DIR', 'CARGO_BUILD_BUILD_DIR'}):
                raise Refusal('Cargo configured child environment overrides the resource policy')
        for name in ('dev', 'test'):
            profile = table(table(data.get('profile', {})).get(name, {}))
            for package in table(profile.get('package', {})).values():
                package = table(package)
                if package.get('debug', 0) not in (0, False, 'none') or package.get('incremental', False):
                    raise Refusal('per-package debug or incremental overrides require separate review')


@contextlib.contextmanager
def private_log(path: Path | None):
    if path is None:
        yield None
        return
    parent = open_directory(path.parent)
    try:
        private(os.fstat(parent), directory=True)
        descriptor = os.open(path.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                             0o600, dir_fd=parent)
    finally:
        os.close(parent)
    with os.fdopen(descriptor, 'wb', buffering=0) as output:
        yield output


def exited(child: subprocess.Popen) -> bool:
    # Unexpected session-leader exit only. Normal Cargo status arrives through
    # its live leader. Keep even a failed leader unreaped through final signals.
    return os.waitid(os.P_PID, child.pid, os.WEXITED | os.WNOHANG | os.WNOWAIT) is not None


def session_worker(lock: int, status: int, control: int, grace: float, command: list[str]) -> None:
    """Pin the group with a live leader until final KILL, including on macOS.

    A caught handler resets to default across exec, so Cargo does not inherit
    ignored termination signals. The control pipe has exactly one writer (the
    supervisor); EOF closes the owned group even after supervisor SIGKILL.
    """
    if (os.getpid() != os.getpgrp() or os.getsid(0) != os.getpid()
            or not math.isfinite(grace) or not 0 < grace <= 10):
        # The internal entry point is never allowed to signal a caller's group.
        raise SystemExit(75)
    for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(signum, lambda *_args: None)
    child = None
    sent_status = False
    try:
        child = subprocess.Popen(command, pass_fds=(lock,))
        with selectors.DefaultSelector() as selector:
            selector.register(control, selectors.EVENT_READ)
            while True:
                if not sent_status and child.poll() is not None:
                    os.write(status, struct.pack('!i', child.returncode))
                    os.close(status)
                    sent_status = True
                if selector.select(timeout=0.05):
                    if not os.read(control, 1):
                        break
    except (OSError, subprocess.SubprocessError):
        if not sent_status:
            with contextlib.suppress(OSError):
                os.write(status, struct.pack('!i', 127))
    finally:
        # EOF or a worker failure: the leader still owns and pins this group.
        os.killpg(os.getpgrp(), signal.SIGTERM)
        deadline = time.monotonic() + grace
        while time.monotonic() < deadline:
            if child is not None:
                child.poll()
            time.sleep(min(0.02, max(0, deadline - time.monotonic())))
        os.killpg(os.getpgrp(), signal.SIGKILL)


def stop_group(child: subprocess.Popen, grace: float, proof: dict | None = None,
               kill_grace: float | None = None) -> None:
    proof = {} if proof is None else proof
    proof.update(term_attempted=False, kill_attempted=False, group_inspection_complete=False,
                 no_live_members=False, leader_reaped=False, group_probe_count=0)
    def send(signum: int) -> None:
        proof['term_attempted' if signum == signal.SIGTERM else 'kill_attempted'] = True
        try:
            os.killpg(child.pid, signum)
        except (ProcessLookupError, PermissionError) as error:
            # macOS also reports EPERM for a zombie-only group. Final group
            # inspection, while the leader remains unreaped, decides closure.
            proof.setdefault('signal_errors', []).append({'signal': signum, 'errno': error.errno})

    send(signal.SIGTERM)
    # Also close descendants after normal Cargo exit; a shell/build script
    # must not leave background writers behind. Never signal other sessions.
    deadline = time.monotonic() + grace
    while time.monotonic() < deadline:
        time.sleep(min(0.05, max(0, deadline - time.monotonic())))
    send(signal.SIGKILL)
    deadline = time.monotonic() + (grace if kill_grace is None else kill_grace)
    failure = None
    try:
        while True:
            proof['group_probe_count'] += 1
            if not group_has_live_members(child.pid, max(0.001, deadline - time.monotonic())):
                proof.update(group_inspection_complete=True, no_live_members=True,
                             no_live_members_observed_at=time.time())
                break
            if time.monotonic() >= deadline:
                raise Refusal('owned process group still has live members after cleanup')
            time.sleep(min(0.02, max(0, deadline - time.monotonic())))
    except (Refusal, OSError, subprocess.SubprocessError) as error:
        failure = error
    try:
        child.wait(timeout=max(0.001, deadline - time.monotonic()))
        proof.update(leader_reaped=True, leader_exit_code=child.returncode)
    except subprocess.TimeoutExpired:
        raise Refusal('owned process group did not reap within the cleanup budget') from None
    if failure:
        raise Refusal('owned process-group closure could not be verified') from None


def group_has_live_members(group: int, timeout: float) -> bool:
    # Only IDs and state, never names/arguments/paths. The unreaped leader pins
    # this PGID until inspection ends; never use this query to select kill PIDs.
    result = subprocess.run(['/bin/ps', '-eo', 'pid=,pgid=,stat='], stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, timeout=timeout, check=False)
    if result.returncode:
        raise Refusal('process-group closure inspection was denied')
    observed_leader = False
    live = False
    for line in result.stdout.splitlines():
        parts = line.split()
        if len(parts) != 3 or not parts[0].isdigit() or not parts[1].isdigit():
            raise Refusal('process-group closure inspection was incomplete')
        if int(parts[1]) == group:
            observed_leader |= int(parts[0]) == group
            live |= not parts[2].startswith(b'Z')
    if not observed_leader:
        raise Refusal('pinned process-group leader was absent from closure inspection')
    return live


CAPTURE_PROTOCOL = 'hms-cargo-pipe-capture-v1'


class PipeCapture:
    """Pipe-only raw transport; all persisted fields are fixed metadata.

    The controller must retain stdin's sole writer and continuously drain stdout.
    Only one 64 KiB pending chunk lives here; backpressure never blocks sampling.
    """
    def __init__(self, directory: Path, drain_seconds: float):
        if (os.getpid() != os.getpgrp() or os.getsid(0) != os.getpid()
                or not stat.S_ISFIFO(os.fstat(0).st_mode) or not stat.S_ISFIFO(os.fstat(1).st_mode)):
            raise Refusal('pipe capture requires an isolated session with piped input and output')
        self.directory = open_directory(directory)
        try:
            private(os.fstat(self.directory), directory=True)
            self.parent = os.getppid()
            self.drain_seconds = drain_seconds
            self.stream = None
            self.pending = b''
            self.read_bytes = self.forwarded_bytes = 0
            self.eof = self.control_eof = self.parent_changed = self.consumer_closed = False
            self.finish_attempted = False
            self.worker = None
            self.closure = {}
            self.reason = None
            self.started = time.time()
            os.set_blocking(0, False)
            os.set_blocking(1, False)
            self.save('guardian-started.json', {
                'protocol': CAPTURE_PROTOCOL, 'guard_pid': os.getpid(), 'guard_pgid': os.getpgrp(),
                'controller_pid': self.parent, 'started_at': self.started,
                'guard_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()})
        except BaseException:
            os.close(self.directory)
            raise

    def save(self, name: str, value: dict) -> None:
        descriptor = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                             0o600, dir_fd=self.directory)
        with os.fdopen(descriptor, 'w') as destination:
            json.dump(value, destination, sort_keys=True)
            destination.write('\n')

    def attach(self, child: subprocess.Popen) -> None:
        self.worker = child.pid
        self.stream = child.stdout
        os.set_blocking(self.stream.fileno(), False)
        self.save('worker-started.json', {'protocol': CAPTURE_PROTOCOL,
                  'guard_pid': os.getpid(), 'worker_pid': child.pid, 'worker_pgid': child.pid})

    def controller_closed(self) -> bool:
        if not self.control_eof:
            try:
                value = os.read(0, 1)
            except BlockingIOError:
                value = None
            if value == b'':
                self.control_eof = True
            elif value is not None:
                raise Refusal('capture controller sent unsupported control data')
        self.parent_changed = os.getppid() != self.parent
        return self.control_eof

    def pump(self) -> bool:
        progress = False
        for _ in range(16):
            if self.pending:
                try:
                    count = os.write(1, self.pending)
                except BlockingIOError:
                    break
                except BrokenPipeError:
                    self.consumer_closed = True
                    raise Refusal('capture output consumer closed its pipe') from None
                self.forwarded_bytes += count
                self.pending = self.pending[count:]
                progress = progress or bool(count)
                if self.pending:
                    break
            if self.eof or self.stream is None:
                break
            try:
                self.pending = os.read(self.stream.fileno(), 65536)
            except BlockingIOError:
                break
            if not self.pending:
                self.eof = True
                break
            self.read_bytes += len(self.pending)
            progress = True
        return progress

    def finish(self) -> None:
        self.finish_attempted = True
        deadline = time.monotonic() + self.drain_seconds
        while self.stream is not None and (not self.eof or self.pending):
            if time.monotonic() >= deadline:
                raise Refusal('capture pipe did not drain completely within its budget')
            self.controller_closed()
            if not self.pump():
                time.sleep(min(0.01, max(0, deadline - time.monotonic())))

    def complete(self, status: int, reason: str | None) -> None:
        self.controller_closed()
        complete = (self.stream is not None and self.eof and not self.pending
                    and not self.consumer_closed and not self.parent_changed)
        self.save('completed.json', {
            'protocol': CAPTURE_PROTOCOL, 'guard_pid': os.getpid(), 'guard_pgid': os.getpgrp(),
            'worker_pid': self.worker, 'worker_pgid': self.worker,
            'guard_exit_code': status, 'guard_failure': reason or self.reason,
            'control_eof': self.control_eof, 'controller_parent_changed': self.parent_changed,
            'cargo_exit_code': getattr(self, 'cargo_status', None), 'worker_closure': self.closure,
            'raw_output_files_created': 0, 'pipe_eof': self.eof, 'pipe_complete': complete,
            'bytes_read': self.read_bytes, 'bytes_forwarded': self.forwarded_bytes,
            'consumer_closed': self.consumer_closed, 'finished_at': time.time()})

    def close(self) -> None:
        os.close(self.directory)


def supervise(command: list[str], environment: dict[str, str], cwd: Path, lock: int,
              target: Target, options, log, capture: PipeCapture | None = None) -> int:
    interrupted = 0

    def interrupt(signum, _frame):
        nonlocal interrupted
        interrupted = signum

    previous = {sig: signal.signal(sig, interrupt) for sig in
                (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)}
    child = None
    started = time.monotonic()
    next_disk = next_scan = 0.0
    log_bytes = 0
    log_truncated = False
    failure = None
    cleanup_attempted = False
    cargo_status = None
    command_finished_at = None
    status_read = status_write = control_read = control_write = None

    def heartbeat():
        nonlocal next_disk
        now = time.monotonic()
        if capture is not None and capture.controller_closed():
            raise Refusal('capture controller closed its liveness pipe')
        if interrupted:
            raise Refusal('interrupted; closing owned process group')
        if (now if command_finished_at is None else command_finished_at) - started >= options.timeout_seconds:
            raise Refusal('build runtime limit exceeded')
        if now >= next_disk:
            if target.check() < options.min_free_gib * GIB:
                raise Refusal('filesystem free-space floor crossed')
            next_disk = now + options.poll_seconds

    try:
        heartbeat()
        size = target.measure(int(options.max_target_gib * GIB), heartbeat, options.scan_timeout_seconds)
        print(f'cargo-budget: admitted; target={size / GIB:.2f} GiB; jobs=1 incremental=0 debug=0',
              file=sys.stderr, flush=True)
        heartbeat()
        if interrupted:
            raise Refusal('interrupted before launch')
        status_read, status_write = os.pipe()
        control_read, control_write = os.pipe()
        worker = [sys.executable, str(Path(__file__).resolve()), '--session-worker',
                  str(lock), str(status_write), str(control_read), str(options.term_grace_seconds),
                  *command]
        child = subprocess.Popen(worker, cwd=cwd, env=environment, start_new_session=True,
                                 pass_fds=(lock, status_write, control_read), stdin=subprocess.DEVNULL,
                                 stdout=subprocess.PIPE if log or capture else subprocess.DEVNULL,
                                 stderr=subprocess.STDOUT)
        if capture is not None:
            capture.attach(child)
        os.close(status_write)
        status_write = None
        os.close(control_read)
        control_read = None
        os.set_blocking(status_read, False)
        started = time.monotonic()
        next_scan = started + options.scan_seconds
        with selectors.DefaultSelector() as selector:
            if child.stdout and capture is None:
                os.set_blocking(child.stdout.fileno(), False)
                selector.register(child.stdout, selectors.EVENT_READ)

            def drain():
                nonlocal log_bytes, log_truncated
                if capture is not None:
                    capture.pump()
                    return
                for key, _event in selector.select(timeout=0):
                    data = os.read(key.fileobj.fileno(), 65536)
                    if not data:
                        selector.unregister(key.fileobj)
                    else:
                        remaining = max(0, int(options.max_log_mib * 1024 ** 2) - log_bytes)
                        if remaining:
                            log.write(data[:remaining])
                            log_bytes += min(len(data), remaining)
                        if len(data) > remaining and not log_truncated:
                            log_truncated = True
                            print('cargo-budget: raw log truncated at configured byte cap',
                                  file=sys.stderr, flush=True)

            def scan_heartbeat():
                heartbeat()
                drain()

            while cargo_status is None:
                heartbeat()
                drain()
                try:
                    report = os.read(status_read, 4)
                except BlockingIOError:
                    report = None
                if report is not None:
                    if len(report) != 4:
                        raise Refusal('build session ended without a complete exit status')
                    cargo_status = struct.unpack('!i', report)[0]
                    command_finished_at = time.monotonic()
                    if capture is not None:
                        capture.cargo_status = cargo_status
                    break
                if exited(child):
                    raise Refusal('build session leader exited unexpectedly')
                if time.monotonic() >= next_scan:
                    target.measure(int(options.max_target_gib * GIB), scan_heartbeat,
                                   options.scan_timeout_seconds)
                    next_scan = time.monotonic() + options.scan_seconds
                time.sleep(min(options.poll_seconds, 0.005 if capture is not None else 0.05))
            heartbeat()
            drain()
        # Close writers before the final sample: a descendant may have written
        # during TERM grace after Cargo itself exited. Keep signal handling
        # active through this sample and never signal an already-reaped group.
        cleanup_attempted = True
        stop_group(child, options.term_grace_seconds, None if capture is None else capture.closure,
                   options.kill_grace_seconds)
        if capture is not None:
            capture.finish()
        next_disk = 0
        heartbeat()
        target.measure(int(options.max_target_gib * GIB), heartbeat, options.scan_timeout_seconds)
    except Refusal as error:
        failure = error
        if capture is not None:
            capture.reason = str(error)
    finally:
        try:
            if child is not None and not cleanup_attempted:
                stop_group(child, options.term_grace_seconds, None if capture is None else capture.closure,
                           options.kill_grace_seconds)
        finally:
            if capture is not None and not capture.finish_attempted:
                try:
                    capture.finish()
                except (Refusal, OSError):
                    capture.reason = capture.reason or 'capture pipe completion failed'
            if child is not None and child.stdout:
                child.stdout.close()
            for descriptor in (status_read, status_write, control_read, control_write):
                if descriptor is not None:
                    os.close(descriptor)
            for sig, handler in previous.items():
                signal.signal(sig, handler)
    if interrupted:
        print('cargo-budget: interrupted; owned process group closed', file=sys.stderr)
        return 128 + interrupted
    if failure:
        raise failure
    return cargo_status if cargo_status >= 0 else 128 - cargo_status


class SafeParser(argparse.ArgumentParser):
    def error(self, _message):
        raise Refusal('invalid invocation; see --help and ops/CARGO_BUDGET.md')


def parser() -> argparse.ArgumentParser:
    result = SafeParser(description=__doc__, allow_abbrev=False)
    result.add_argument('--target-dir', required=True, type=Path, help='existing shared Cargo target; absolute canonical path')
    result.add_argument('--min-free-gib', type=float, default=30)
    result.add_argument('--max-target-gib', type=float, default=40)
    result.add_argument('--poll-seconds', type=float, default=1)
    result.add_argument('--scan-seconds', type=float, default=30)
    result.add_argument('--scan-timeout-seconds', type=float, default=5)
    result.add_argument('--timeout-seconds', type=float, default=3600)
    result.add_argument('--term-grace-seconds', type=float, default=3)
    result.add_argument('--kill-grace-seconds', type=float, help='inspection/reap grace; defaults to TERM grace')
    result.add_argument('--log-file', type=Path, help='optional NEW private file in an owned 0700 directory; raw output never printed')
    result.add_argument('--max-log-mib', type=float, default=16)
    result.add_argument('--capture-pipe', action='store_true', help='protocol-v1 guardian: raw stdout ONLY to a pipe; no raw files')
    result.add_argument('--lifecycle-dir', type=Path, help='existing private directory for exclusive nonsensitive lifecycle receipts')
    result.add_argument('--pipe-drain-seconds', type=float, default=5)
    return result


def main(arguments: list[str] | None = None) -> int:
    arguments = sys.argv[1:] if arguments is None else arguments
    capture = None
    status = 75
    reason = None
    try:
        if arguments == ['--help']:
            parser().print_help()
            return 0
        separator = arguments.index('--')
        options = parser().parse_args(arguments[:separator])
        if options.kill_grace_seconds is None:
            options.kill_grace_seconds = options.term_grace_seconds
        command_args = arguments[separator + 1:]
        for name in ('min_free_gib', 'max_target_gib', 'poll_seconds', 'scan_seconds',
                     'scan_timeout_seconds', 'timeout_seconds', 'term_grace_seconds', 'kill_grace_seconds',
                     'max_log_mib', 'pipe_drain_seconds'):
            if not math.isfinite(getattr(options, name)) or getattr(options, name) <= 0:
                raise Refusal('budgets must be finite and positive')
        if any(not math.isfinite(getattr(options, name) * GIB) for name in ('min_free_gib', 'max_target_gib')):
            raise Refusal('storage budgets exceed the supported numeric range')
        if (options.poll_seconds > 10 or options.scan_seconds > 60
                or options.scan_seconds < options.poll_seconds or options.scan_timeout_seconds > 10
                or options.term_grace_seconds > 10 or options.kill_grace_seconds > 10
                or options.pipe_drain_seconds > 10 or options.max_log_mib > 64):
            raise Refusal('sampling, cleanup, or log budget is outside supported bounds')
        if options.capture_pipe != bool(options.lifecycle_dir) or options.capture_pipe and options.log_file:
            raise Refusal('pipe capture requires lifecycle receipts and forbids raw log files')
        if options.capture_pipe:
            if options.lifecycle_dir.is_relative_to(options.target_dir):
                raise Refusal('capture lifecycle receipts must remain outside the Cargo target')
            capture = PipeCapture(options.lifecycle_dir, options.pipe_drain_seconds)
        command = cargo_arguments(command_args, options.target_dir)
        root, common, trees = repository()
        validate_configuration(root)
        with lease(common) as lock, contextlib.ExitStack() as stack:
            target = Target(options.target_dir, root, common, trees)
            stack.callback(target.close)
            with private_log(options.log_file) as log:
                status = supervise(command, cargo_environment(options.target_dir), root / 'backend-rs',
                                   lock, target, options, log, capture)
        print(f'cargo-budget: finished; status={status}', file=sys.stderr)
    except (Refusal, OSError, ValueError, subprocess.SubprocessError, RecursionError) as error:
        message = str(error) if isinstance(error, Refusal) else 'unsafe or unavailable resource; build refused or closed'
        reason = message
        print(f'cargo-budget: {message}', file=sys.stderr)
        status = 75
    finally:
        if capture is not None:
            try:
                capture.complete(status, reason)
            except (Refusal, OSError):
                print('cargo-budget: capture lifecycle receipt could not be completed', file=sys.stderr)
                status = 75
            finally:
                capture.close()
    return status


if __name__ == '__main__':
    if len(sys.argv) >= 7 and sys.argv[1] == '--session-worker':
        try:
            session_worker(int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]),
                           float(sys.argv[5]), sys.argv[6:])
        except (ValueError, OSError):
            raise SystemExit(75)
        raise SystemExit(127)
    raise SystemExit(main())
