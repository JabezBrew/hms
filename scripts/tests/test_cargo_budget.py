"""Real lightweight POSIX process tests; never invoke Rust, Docker, or a database."""
from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock


SCRIPT = Path(__file__).resolve().parents[1] / 'cargo-budget.py'
SPEC = importlib.util.spec_from_file_location('cargo_budget', SCRIPT)
BUDGET = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUDGET)


class CargoBudgetTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='hms-cargo-budget-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.repo = self.root / 'repository'
        self.repo.mkdir()
        self.git('init', '-q')
        self.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
                 'commit', '-q', '--allow-empty', '-m', 'fixture')
        (self.repo / 'backend-rs').mkdir()
        (self.repo / 'backend-rs/Cargo.toml').write_text('[workspace]\n')
        self.target = self.root / 'shared-target'
        self.target.mkdir()
        (self.target / '.rustc_info.json').write_text('{}')
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.record = self.root / 'record.json'
        self.env = os.environ.copy()
        self.env.update(PATH=str(self.bin) + os.pathsep + self.env['PATH'], RECORD=str(self.record))
        self.cargo_home = self.root / 'cargo-home'
        self.cargo_home.mkdir()
        self.env['CARGO_HOME'] = str(self.cargo_home)
        self.fake_cargo()

    def git(self, *args):
        return subprocess.run(['git', *args], cwd=self.repo, check=True,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    def fake_cargo(self, body=''):
        path = self.bin / 'cargo'
        path.write_text(f'#!{sys.executable}\n' + '''import json, os, pathlib, signal, subprocess, sys, time
record_path = pathlib.Path(os.environ['RECORD'])
record_tmp = record_path.with_suffix('.tmp')
record_tmp.write_text(json.dumps({
    'argv': sys.argv[1:], 'env': {key: os.environ.get(key) for key in (
        'CARGO_BUILD_JOBS', 'CARGO_INCREMENTAL', 'CARGO_PROFILE_DEV_DEBUG',
        'CARGO_PROFILE_TEST_DEBUG', 'CARGO_ENCODED_RUSTFLAGS', 'RUSTC_WRAPPER',
        'CARGO_BUILD_BUILD_DIR', 'CARGO_TARGET_DIR')}, 'cwd': os.getcwd(),
    'pid': os.getpid(), 'pgid': os.getpgrp(), 'sid': os.getsid(0)
}))
record_tmp.replace(record_path)
''' + body)
        path.chmod(0o700)

    def command(self, cargo=None, extra=(), target=None):
        return [sys.executable, str(SCRIPT), '--target-dir', str(target or self.target),
                '--min-free-gib', '0.000001', '--max-target-gib', '0.01',
                '--poll-seconds', '0.02', '--scan-seconds', '0.08',
                '--term-grace-seconds', '0.2', '--timeout-seconds', '4',
                *extra, '--', *(cargo or ['test', '-p', 'hms-access'])]

    def run_guard(self, cargo=None, extra=(), target=None, cwd=None):
        return subprocess.run(self.command(cargo, extra, target), cwd=cwd or self.repo,
                              env=self.env, capture_output=True, text=True, timeout=10)

    def background(self, extra=()):
        process = subprocess.Popen(self.command(extra=extra), cwd=self.repo, env=self.env,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

        def close():
            if process.poll() is None:
                process.terminate()
                try:
                    process.communicate(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.communicate(timeout=2)
            else:
                process.communicate()
        self.addCleanup(close)
        return process

    def wait_record(self, process, path=None):
        path = path or self.record
        deadline = time.monotonic() + 5
        while not path.exists():
            self.assertIsNone(process.poll(), 'fixture must reach its barrier')
            self.assertLess(time.monotonic(), deadline)
            time.sleep(0.01)
        return json.loads(path.read_text()) if path == self.record else path.read_text()

    def assert_gone(self, pid):
        deadline = time.monotonic() + 3
        while True:
            state = subprocess.run(['ps', '-o', 'stat=', '-p', str(pid)], capture_output=True, text=True)
            if state.returncode or not state.stdout.strip() or state.stdout.strip().startswith('Z'):
                return
            self.assertLess(time.monotonic(), deadline, 'owned process must stop')
            time.sleep(0.02)

    def assert_refused(self, result):
        self.assertEqual(result.returncode, 75, result.stderr)
        self.assertFalse(self.record.exists(), 'refusal must precede Cargo launch')

    def test_fixed_policy_and_runtime_arguments_cross_actual_exec(self):
        self.env.update(CARGO_BUILD_JOBS='9', CARGO_INCREMENTAL='1', CARGO_PROFILE_DEV_DEBUG='2',
                        CARGO_TARGET_DIR='/forbidden', CARGO_BUILD_BUILD_DIR='/forbidden')
        runtime = ['--config=runtime-value', '-j9', '--target-dir=runtime-value']
        result = self.run_guard(['test', '--locked', '--offline', '-phms-worker', '--', *runtime])
        self.assertEqual(result.returncode, 0, result.stderr)
        record = json.loads(self.record.read_text())
        self.assertEqual(record['cwd'], str(self.repo / 'backend-rs'))
        self.assertEqual(record['sid'], record['pgid'])
        self.assertNotEqual(record['pgid'], record['pid'], 'live session leader pins the group through cleanup')
        self.assertNotEqual(record['pgid'], os.getpgrp())
        for key, value in {'CARGO_BUILD_JOBS': '1', 'CARGO_INCREMENTAL': '0',
                           'CARGO_PROFILE_DEV_DEBUG': '0', 'CARGO_PROFILE_TEST_DEBUG': '0',
                           'CARGO_BUILD_BUILD_DIR': str(self.target), 'CARGO_TARGET_DIR': str(self.target)}.items():
            self.assertEqual(record['env'][key], value)
        for key in ('CARGO_ENCODED_RUSTFLAGS', 'RUSTC_WRAPPER'):
            self.assertEqual(record['env'][key], self.env.get(key), 'no new flags or wrapper changes invalidate warm fingerprints')
        args = record['argv']
        self.assertIn('build.jobs=1', args)
        self.assertIn('profile.test.debug=0', args)
        self.assertIn(f'build.build-dir={json.dumps(str(self.target))}', args)
        self.assertEqual(args.count('--locked'), 1)
        self.assertEqual(args[args.index('--') + 1:], runtime)

    def test_cargo_overrides_aliases_and_clean_are_refused(self):
        for option in ['--target-dir=x', '--config=x', '--conf=x', '-j9', '--jobs=9',
                       '-qj9', '-vr', '-r', '--profile=custom', '--release', '-Zbuild-std',
                       '--build-dir=x', '--artifact-dir=x', '--out-dir=x', '--manifest-path=x', '-Cother']:
            with self.subTest(option=option):
                self.assert_refused(self.run_guard(['test', option]))
        for command in ['clean', 'install', 'b', 'rustc', '+nightly']:
            self.assert_refused(self.run_guard([command]))
        for command in ['build', 'check', 'clippy']:
            self.assert_refused(self.run_guard([command, '--', '-Cdebuginfo=2']))

    def test_inherited_flags_and_wrappers_require_review_instead_of_silent_changes(self):
        for key in ('RUSTFLAGS', 'CARGO_ENCODED_RUSTFLAGS', 'RUSTDOCFLAGS', 'CARGO_ENCODED_RUSTDOCFLAGS',
                    'CARGO_BUILD_RUSTFLAGS', 'CARGO_TARGET_AARCH64_APPLE_DARWIN_RUSTFLAGS',
                    'RUSTC_WRAPPER', 'RUSTC_WORKSPACE_WRAPPER', 'CARGO_BUILD_RUSTC_WRAPPER'):
            with self.subTest(key=key), mock.patch.dict(self.env, {key: 'private-flag-value'}):
                result = self.run_guard()
                self.assert_refused(result)
                self.assertNotIn('private-flag-value', result.stderr)

    def test_config_and_manifest_overrides_cannot_hide_debug_flags_or_output_changes(self):
        directory = self.repo / 'backend-rs/.cargo'
        directory.mkdir()
        config = directory / 'config.toml'
        for content in ('[build]\nrustflags=["-Cdebuginfo=2"]',
                        '[target.\'cfg(unix)\']\nrustflags="-Cdebuginfo=2"',
                        '[build]\nrustc-wrapper="private-wrapper"',
                        'include=["hidden.toml"]', '[env]\nCARGO_TARGET_DIR="private-target"',
                        '[env]\nCARGO_BUILD_TARGET="private-target"',
                        '[profile.dev.package.serde]\ndebug=2',
                        '[profile.test.package.serde]\nincremental=true',
                        'target="unsupported-table-shape"'):
            with self.subTest(content=content):
                config.write_text(content)
                self.assert_refused(self.run_guard())
        config.write_text('[build]\nrustflags=[]\n')
        self.assertEqual(self.run_guard().returncode, 0)
        self.record.unlink()
        (self.repo / 'backend-rs/Cargo.toml').write_text('[workspace]\n[profile.dev.package.serde]\ndebug=2\n')
        self.assert_refused(self.run_guard())

    def test_inherited_repository_and_global_build_targets_are_refused_without_new_flags(self):
        with mock.patch.dict(self.env, {'CARGO_BUILD_TARGET': 'aarch64-apple-darwin'}):
            self.assert_refused(self.run_guard())
        directory = self.repo / 'backend-rs/.cargo'
        directory.mkdir()
        for config in (directory / 'config.toml', self.cargo_home / 'config.toml'):
            for target in ('"aarch64-apple-darwin"', '["aarch64-apple-darwin","x86_64-apple-darwin"]'):
                config.write_text('[build]\ntarget=' + target + '\n')
                self.assert_refused(self.run_guard())
            config.unlink()

    def test_cleanup_inspection_failure_or_live_members_never_report_success(self):
        for inspection in (mock.Mock(return_value=True), mock.Mock(side_effect=BUDGET.Refusal('inspection unavailable'))):
            stderr = io.StringIO()
            with self.subTest(inspection=inspection), \
                    mock.patch.object(BUDGET, 'repository', return_value=(self.repo, self.repo / '.git', [self.repo])), \
                    mock.patch.object(BUDGET, 'group_has_live_members', inspection), \
                    mock.patch.dict(os.environ, self.env), contextlib.redirect_stderr(stderr):
                status = BUDGET.main(self.command()[2:])
            self.assertEqual(status, 75, stderr.getvalue())
            self.assertIn('closure could not be verified', stderr.getvalue())
            self.assert_gone(json.loads(self.record.read_text())['pid'])

    def test_group_inspection_distinguishes_live_members_zombies_and_missing_proof(self):
        for output, expected in ((b'123 123 Z\n124 123 S\n', True),
                                 (b'123 123 Z\n124 123 Z\n999 999 S\n', False)):
            result = subprocess.CompletedProcess([], 0, stdout=output)
            with mock.patch.object(BUDGET.subprocess, 'run', return_value=result):
                self.assertEqual(BUDGET.group_has_live_members(123, 1), expected)
        for output in (b'', b'124 123 Z\n', b'invalid\n'):
            result = subprocess.CompletedProcess([], 0, stdout=output)
            with mock.patch.object(BUDGET.subprocess, 'run', return_value=result), self.assertRaises(BUDGET.Refusal):
                BUDGET.group_has_live_members(123, 1)

    def test_invalid_budgets_and_sensitive_errors_do_not_echo_input(self):
        for name, value in [('--min-free-gib', 'nan'), ('--max-target-gib', 'inf'),
                            ('--max-target-gib', '1e308'), ('--min-free-gib', '1e308'),
                            ('--timeout-seconds', '0'), ('--poll-seconds', '11'),
                            ('--scan-seconds', '61'), ('--scan-timeout-seconds', '11'),
                            ('--term-grace-seconds', '11'), ('--max-log-mib', '65'),
                            ('--unknown-private-marker', 'private-marker')]:
            result = self.run_guard(extra=[name, value])
            self.assert_refused(result)
            self.assertNotIn('private-marker', result.stderr)

    def test_preflight_space_and_target_size_refuse_without_deletion(self):
        self.assert_refused(self.run_guard(extra=['--min-free-gib', '999999']))
        artifact = self.target / 'preserved'
        artifact.write_bytes(b'x' * 16384)
        self.assert_refused(self.run_guard(extra=['--max-target-gib', '0.000001']))
        self.assertEqual(artifact.stat().st_size, 16384)

    def test_missing_and_worktree_local_targets_are_refused(self):
        self.assert_refused(self.run_guard(target=self.root / 'absent'))
        (self.target / '.rustc_info.json').unlink()
        self.assert_refused(self.run_guard())
        (self.target / '.rustc_info.json').write_text('{}')
        other = self.root / 'linked'
        self.git('worktree', 'add', '-q', '--detach', str(other))
        local = other / 'target'
        local.mkdir()
        (local / '.rustc_info.json').write_text('{}')
        self.assert_refused(self.run_guard(target=local))
        metadata = self.repo / '.git' / 'not-a-build-target'
        metadata.mkdir()
        (metadata / '.rustc_info.json').write_text('{}')
        self.assert_refused(self.run_guard(target=metadata))

    def test_symlinks_special_files_and_public_target_fail_closed(self):
        alias = self.root / 'alias'
        alias.symlink_to(self.target, target_is_directory=True)
        self.assert_refused(self.run_guard(target=alias))
        nested = self.target / 'nested'
        nested.symlink_to(self.repo, target_is_directory=True)
        self.assert_refused(self.run_guard())
        nested.unlink()
        os.mkfifo(nested)
        self.assert_refused(self.run_guard())
        nested.unlink()
        self.target.chmod(0o777)
        self.assert_refused(self.run_guard())

    def test_shared_lock_rejects_build_from_another_real_worktree_and_target(self):
        self.fake_cargo('time.sleep(8)\n')
        other = self.root / 'linked'
        self.git('worktree', 'add', '-q', '--detach', str(other))
        (other / 'backend-rs').mkdir()
        (other / 'backend-rs/Cargo.toml').write_text('[workspace]\n')
        process = self.background()
        self.wait_record(process)
        self.record.unlink()
        alternate = self.root / 'another-shared-target'
        alternate.mkdir()
        (alternate / '.rustc_info.json').write_text('{}')
        self.assert_refused(self.run_guard(cwd=other, target=alternate))
        process.terminate()
        self.assertEqual(process.wait(timeout=5), 128 + signal.SIGTERM)
        self.fake_cargo()
        self.assertEqual(self.run_guard().returncode, 0)
        self.assertTrue((self.repo / '.git' / BUDGET.STATE_NAME / BUDGET.LOCK_NAME).exists())

    def test_unsafe_state_lock_symlinks_modes_and_hardlinks_are_preserved(self):
        state = self.repo / '.git' / BUDGET.STATE_NAME
        unrelated = self.root / 'preserve'
        unrelated.write_text('preserve')
        state.symlink_to(self.root, target_is_directory=True)
        self.assert_refused(self.run_guard())
        state.unlink()
        state.mkdir(mode=0o700)
        lock = state / BUDGET.LOCK_NAME
        lock.symlink_to(unrelated)
        self.assert_refused(self.run_guard())
        lock.unlink()
        os.link(unrelated, lock)
        self.assert_refused(self.run_guard())
        lock.unlink()
        lock.touch(mode=0o644)
        self.assert_refused(self.run_guard())
        lock.chmod(0o600)
        state.chmod(0o755)
        self.assert_refused(self.run_guard())
        self.assertEqual(unrelated.read_text(), 'preserve')

    def test_timeout_kills_resistant_descendants_and_preserves_unrelated_session(self):
        descendant = self.root / 'descendant'
        self.fake_cargo(f'''signal.signal(signal.SIGTERM, signal.SIG_IGN)
p = subprocess.Popen([sys.executable, '-c', 'import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); time.sleep(12)'])
pathlib.Path({str(descendant)!r}).write_text(str(p.pid))
time.sleep(12)
''')
        unrelated = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(12)'], start_new_session=True)
        try:
            process = self.background(extra=['--timeout-seconds', '2'])
            record = self.wait_record(process)
            self.wait_record(process, descendant)
            _stdout, stderr = process.communicate(timeout=6)
            self.assertEqual(process.returncode, 75, stderr)
            self.assertIn('runtime limit', stderr)
            self.assert_gone(record['pid'])
            self.assert_gone(int(descendant.read_text()))
            self.assertIsNone(unrelated.poll())
        finally:
            unrelated.terminate()
            unrelated.wait(timeout=3)

    def test_all_interrupts_close_actual_owned_group(self):
        for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
            with self.subTest(signum=signum):
                if self.record.exists():
                    self.record.unlink()
                self.fake_cargo('signal.signal(signal.SIGTERM, signal.SIG_IGN)\ntime.sleep(12)\n')
                process = self.background()
                record = self.wait_record(process)
                process.send_signal(signum)
                self.assertEqual(process.wait(timeout=5), 128 + signum)
                self.assert_gone(record['pid'])

    def test_internal_worker_refuses_a_callers_existing_group(self):
        # Isolate the fixture too: a regression must not signal the test runner.
        outer = subprocess.run([sys.executable, '-c', '''import subprocess,sys
p = subprocess.run([sys.executable, sys.argv[1], '--session-worker', '1', '2', '3', '.1', 'cargo'])
print(p.returncode)
''', str(SCRIPT)], start_new_session=True, capture_output=True, text=True, timeout=3)
        self.assertEqual(outer.returncode, 0, outer.stderr)
        self.assertEqual(outer.stdout.strip(), '75')

    def test_unexpected_session_leader_death_still_closes_owned_cargo(self):
        self.fake_cargo('signal.signal(signal.SIGTERM, signal.SIG_IGN)\ntime.sleep(12)\n')
        process = self.background()
        record = self.wait_record(process)
        os.kill(record['pgid'], signal.SIGKILL)
        _stdout, stderr = process.communicate(timeout=5)
        self.assertEqual(process.returncode, 75, stderr)
        self.assert_gone(record['pid'])

    def test_successful_leader_exit_still_closes_stdio_holding_descendant(self):
        descendant = self.root / 'descendant'
        self.fake_cargo(f'''p = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(12)'])
pathlib.Path({str(descendant)!r}).write_text(str(p.pid))
''')
        log = self.root / 'private-output'
        result = self.run_guard(extra=['--log-file', str(log)])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assert_gone(int(descendant.read_text()))

    def test_abrupt_supervisor_death_does_not_unlock_a_live_child(self):
        finish = self.root / 'finish'
        self.fake_cargo(f'''while not pathlib.Path({str(finish)!r}).exists(): time.sleep(.01)
''')
        process = self.background(extra=['--term-grace-seconds', '1'])
        self.wait_record(process)
        process.kill()
        process.wait(timeout=3)
        self.record.unlink()
        try:
            self.assert_refused(self.run_guard())
        finally:
            finish.touch()
        self.fake_cargo()
        deadline = time.monotonic() + 4
        while True:
            result = self.run_guard()
            if result.returncode == 0:
                break
            self.assertLess(time.monotonic(), deadline)
            time.sleep(.02)

    def test_running_target_growth_is_stopped_and_artifacts_preserved(self):
        self.fake_cargo('''time.sleep(.12)
pathlib.Path(os.environ['CARGO_TARGET_DIR'], 'growth').write_bytes(b'x' * 32768)
time.sleep(12)
''')
        result = self.run_guard(extra=['--max-target-gib', '0.00002'])
        self.assertEqual(result.returncode, 75, result.stderr)
        self.assertIn('target size', result.stderr)
        self.assert_gone(json.loads(self.record.read_text())['pid'])
        self.assertEqual((self.target / 'growth').stat().st_size, 32768)

    def test_running_free_space_floor_is_supervised_without_filling_real_disk(self):
        self.fake_cargo('time.sleep(12)\n')
        original = BUDGET.Target.check

        def space(target):
            return 0 if self.record.exists() else original(target)

        stderr = io.StringIO()
        with mock.patch.object(BUDGET, 'repository', return_value=(self.repo, self.repo / '.git', [self.repo])), \
                mock.patch.object(BUDGET.Target, 'check', space), mock.patch.dict(os.environ, self.env), \
                contextlib.redirect_stderr(stderr):
            status = BUDGET.main(self.command()[2:])
        self.assertEqual(status, 75, stderr.getvalue())
        self.assertIn('free-space floor', stderr.getvalue())
        self.assert_gone(json.loads(self.record.read_text())['pid'])

    def test_short_final_growth_and_target_replacement_are_detected(self):
        self.fake_cargo("pathlib.Path(os.environ['CARGO_TARGET_DIR'], 'growth').write_bytes(b'x' * 32768)\n")
        result = self.run_guard(extra=['--max-target-gib', '0.00002', '--scan-seconds', '1'])
        self.assertEqual(result.returncode, 75, result.stderr)
        (self.target / 'growth').unlink()
        old = self.root / 'old-target'
        self.fake_cargo(f'''time.sleep(.1)
pathlib.Path(os.environ['CARGO_TARGET_DIR']).rename({str(old)!r})
pathlib.Path(os.environ['CARGO_TARGET_DIR']).mkdir()
time.sleep(12)
''')
        result = self.run_guard()
        self.assertEqual(result.returncode, 75, result.stderr)
        self.assertIn('identity changed', result.stderr)
        self.assertTrue((old / '.rustc_info.json').exists())

    def test_final_sample_includes_writes_during_cleanup_grace(self):
        ready = self.root / 'late-ready'
        child = f'''import os,pathlib,signal,time
signal.signal(signal.SIGTERM,signal.SIG_IGN)
pathlib.Path({str(ready)!r}).touch()
time.sleep(.15)
pathlib.Path(os.environ['CARGO_TARGET_DIR'],'late-growth').write_bytes(b'x'*32768)
time.sleep(12)
'''
        self.fake_cargo(f'''subprocess.Popen([sys.executable, '-c', {child!r}])
while not pathlib.Path({str(ready)!r}).exists(): time.sleep(.01)
''')
        result = self.run_guard(extra=['--max-target-gib', '0.00002', '--term-grace-seconds', '.4'])
        self.assertEqual(result.returncode, 75, result.stderr)
        self.assertIn('target size', result.stderr)
        self.assertEqual((self.target / 'late-growth').stat().st_size, 32768)

    def test_output_is_private_bounded_and_child_status_is_preserved(self):
        self.fake_cargo("print('private-output-marker', flush=True)\nprint('private-stderr-marker', file=sys.stderr, flush=True)\nsys.exit(23)\n")
        result = self.run_guard()
        self.assertEqual(result.returncode, 23, result.stderr)
        self.assertNotIn('private-output-marker', result.stdout + result.stderr)
        self.assertNotIn('private-stderr-marker', result.stdout + result.stderr)
        self.fake_cargo("sys.stdout.write('x' * 1048576)\nsys.stdout.flush()\ntime.sleep(.1)\n")
        log = self.root / 'private-log'
        result = self.run_guard(extra=['--log-file', str(log), '--max-log-mib', str(4096 / 1024 ** 2)])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(log.stat().st_size, 4096)
        self.assertEqual(log.stat().st_mode & 0o777, 0o600)
        self.assertIn('raw log truncated at configured byte cap', result.stderr)
        self.record.unlink()
        self.assert_refused(self.run_guard(extra=['--log-file', str(log)]))
        public = self.root / 'public'
        public.mkdir(mode=0o755)
        self.assert_refused(self.run_guard(extra=['--log-file', str(public / 'refused')]))

    def test_measurement_deduplicates_hardlinks_counts_sparse_lengths_and_times_out(self):
        artifact = self.target / 'one'
        artifact.write_bytes(b'x' * 8192)
        os.link(artifact, self.target / 'two')
        target = BUDGET.Target(self.target, self.repo, self.repo / '.git', [self.repo])
        try:
            marker = (self.target / '.rustc_info.json').stat()
            root = self.target.stat()
            self.assertEqual(target.measure(100000), 8192 + max(marker.st_size, marker.st_blocks * 512)
                             + max(root.st_size, root.st_blocks * 512))
            with artifact.open('r+b') as output:
                output.truncate(2 * 1024 ** 2)
            with self.assertRaisesRegex(BUDGET.Refusal, 'size limit'):
                target.measure(1024 ** 2)
            with self.assertRaisesRegex(BUDGET.Refusal, 'time budget'):
                target.measure(10000000, lambda: time.sleep(.01), scan_seconds=.001)
        finally:
            target.close()


if __name__ == '__main__':
    unittest.main()
