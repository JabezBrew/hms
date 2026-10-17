#!/usr/bin/env python3
"""One host-wide kernel lease for every supported HMS deployment writer.

No caller-selected path or PID ownership protocol. Nested shell entrypoints
inherit the actual locked file description; an environment string is not proof.
"""
from __future__ import annotations

import fcntl
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys


LEASE_PATH = Path('/opt/.hms-deploy-state/deploy.lock')
LEGACY_LOCK_PATH = Path('/tmp/hms-deploy.lock')
LEASE_FD_VARIABLE = 'HMS_DEPLOY_LEASE_FD'
RESERVED_FD = 198


class LeaseError(Exception):
    pass


class LegacyLeaseError(LeaseError):
    pass


def reject_legacy_lease() -> None:
    if os.path.lexists(LEGACY_LOCK_PATH):
        raise LegacyLeaseError


def verify_directory() -> None:
    reject_legacy_lease()
    directory = LEASE_PATH.parent
    try:
        directory.mkdir(mode=0o700)
    except FileExistsError:
        pass
    except PermissionError:
        # Create only when absent. Never chown an existing other-owner lease.
        made = subprocess.run(['sudo', '-n', 'mkdir', '-m', '700', str(directory)],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                              timeout=10, check=False)
        if made.returncode == 0:
            changed = subprocess.run(['sudo', '-n', 'chown', f'{os.geteuid()}:{os.getegid()}', str(directory)],
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                     timeout=10, check=False)
            if changed.returncode != 0:
                raise LeaseError
    info = directory.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
        raise LeaseError


def verify_fd(descriptor: int) -> None:
    reject_legacy_lease()
    directory = LEASE_PATH.parent.lstat()
    actual = LEASE_PATH.lstat()
    held = os.fstat(descriptor)
    if (not stat.S_ISDIR(directory.st_mode) or directory.st_uid != os.geteuid()
            or directory.st_mode & 0o077 or not stat.S_ISREG(actual.st_mode)
            or actual.st_uid != os.geteuid() or actual.st_mode & 0o077
            or held.st_nlink != 1 or (actual.st_dev, actual.st_ino) != (held.st_dev, held.st_ino)):
        raise LeaseError
    # Acquiring on an inherited open file description retains the same lease.
    # A forged environment variable with an unrelated/unlocked descriptor cannot
    # skip the kernel lock or lock a different inode.
    fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)


def inherited_fd() -> int:
    value = os.environ.get(LEASE_FD_VARIABLE, '')
    if not value.isascii() or not value.isdigit() or len(value) > 4:
        raise LeaseError
    descriptor = int(value)
    if descriptor < 3:
        raise LeaseError
    verify_fd(descriptor)
    return descriptor


def acquire_fd() -> int:
    verify_directory()
    original = os.open(LEASE_PATH, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        descriptor = fcntl.fcntl(original, fcntl.F_DUPFD, RESERVED_FD)
    finally:
        os.close(original)
    try:
        verify_fd(descriptor)
        os.set_inheritable(descriptor, True)
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def main() -> int:
    if sys.argv[1:] == ['--check']:
        try:
            inherited_fd()
            return 0
        except (LeaseError, OSError, ValueError):
            return 1
    if len(sys.argv) < 3 or sys.argv[1] != '--':
        print('Usage: deploy-lease.py -- <host deployment command>', file=sys.stderr)
        return 2
    try:
        try:
            descriptor = inherited_fd()
        except (LeaseError, OSError, ValueError):
            descriptor = acquire_fd()
        environment = os.environ.copy()
        environment[LEASE_FD_VARIABLE] = str(descriptor)
        child = subprocess.Popen(sys.argv[2:], env=environment, pass_fds=(descriptor,))
        def forward(signum: int, _frame: object) -> None:
            try:
                child.send_signal(signum)
            except ProcessLookupError:
                pass
        for signum in (signal.SIGHUP, signal.SIGINT, signal.SIGTERM):
            signal.signal(signum, forward)
        status = child.wait()
        # Never unlink or unlock by PID. Descendants keep the kernel lease if a
        # supervisor is killed while deployment/recovery is still executing.
        return status if status >= 0 else 128 - status
    except LegacyLeaseError:
        print('Legacy deployment lock requires operator review; it was not removed or stolen.', file=sys.stderr)
        return 75
    except (LeaseError, OSError, ValueError, subprocess.TimeoutExpired):
        print('Host deployment lease unavailable or unsafe; no deployment started.', file=sys.stderr)
        return 75


if __name__ == '__main__':
    raise SystemExit(main())
