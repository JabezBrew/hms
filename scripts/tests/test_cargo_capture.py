"""Fake-Cargo integration for RAM-only transport and both owned session layers."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import unittest

import test_cargo_budget as fixtures


CLIENT_PATH = fixtures.SCRIPT.with_name('cargo_capture.py')
SPEC = importlib.util.spec_from_file_location('cargo_capture', CLIENT_PATH)
CLIENT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CLIENT)


class CargoCaptureTests(unittest.TestCase):
    setUp = fixtures.CargoBudgetTests.setUp
    git = fixtures.CargoBudgetTests.git
    fake_cargo = fixtures.CargoBudgetTests.fake_cargo
    assert_gone = fixtures.CargoBudgetTests.assert_gone
    wait_record = fixtures.CargoBudgetTests.wait_record
    command = fixtures.CargoBudgetTests.command

    def options(self, **changes):
        folder = self.root / ('lifecycle-' + str(len(list(self.root.glob('lifecycle-*')))))
        folder.mkdir(mode=0o700)
        values = dict(target_dir=self.target, lifecycle_dir=folder, cwd=self.repo,
                      environment=self.env, expected_guard_sha256=CLIENT.digest(fixtures.SCRIPT),
                      expected_client_sha256=CLIENT.digest(CLIENT_PATH), timeout_seconds=4,
                      term_grace_seconds=.2, kill_grace_seconds=.5, pipe_drain_seconds=1,
                      min_free_gib=.000001, max_target_gib=.01, poll_seconds=.02, scan_seconds=.08)
        values.update(changes)
        return values

    def capture(self, arguments=None, **changes):
        options = self.options(**changes)
        raw, closure = CLIENT.capture_cargo(arguments or ['test', '-p', 'hms-access'], **options)
        return raw, closure, options['lifecycle_dir']

    def read_json(self, path):
        until = time.monotonic() + 6
        while time.monotonic() < until:
            try:
                return json.loads(path.read_text())
            except (FileNotFoundError, json.JSONDecodeError):
                time.sleep(.01)
        self.fail('bounded lifecycle fixture barrier')

    def assert_closed(self, closure):
        for key in ('leader_reaped', 'streams_closed', 'group_closed', 'nested_worker_closed',
                    'communication_complete', 'output_complete', 'source_pins_unchanged'):
            self.assertIs(closure[key], True, key)
        self.assertNotIn('closure_failure', closure)
        nested = closure['guard_lifecycle']['worker_closure']
        for key in ('leader_reaped', 'no_live_members', 'group_inspection_complete'):
            self.assertIs(nested[key], True, key)

    def assert_metadata_only(self, folder, marker=b'fictional-private-output'):
        self.assertEqual({path.name for path in folder.iterdir()},
                         {'guardian-started.json', 'worker-started.json', 'completed.json'})
        for path in folder.iterdir():
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertNotIn(marker, path.read_bytes())
            self.assertNotIn(b'fictional-private-env', path.read_bytes())

    def test_success_preserves_full_stdout_stderr_in_ram_without_raw_files(self):
        self.env['PGPASSWORD'] = 'fictional-private-env'
        self.fake_cargo("print('fictional-private-output', flush=True)\nprint('stderr-tail', file=sys.stderr, flush=True)\n")
        raw, closure, folder = self.capture()
        self.assertEqual(raw, b'fictional-private-output\nstderr-tail\n')
        self.assertEqual(closure['exit_code'], 0)
        self.assert_closed(closure)
        self.assert_metadata_only(folder)

    def test_transport_exceeds_legacy_log_cap_without_truncation(self):
        length = 17 * 1024 ** 2 + 127
        self.fake_cargo(f"sys.stdout.buffer.write(b'a' * {length})\nsys.stdout.buffer.write(b'END-OF-FULL-CAPTURE')\nsys.stdout.buffer.flush()\n")
        raw, closure, folder = self.capture(timeout_seconds=8)
        self.assertEqual(len(raw), length + len(b'END-OF-FULL-CAPTURE'))
        self.assertEqual(hashlib.sha256(raw).digest(), hashlib.sha256(b'a' * length + b'END-OF-FULL-CAPTURE').digest())
        self.assert_closed(closure)
        self.assert_metadata_only(folder)

    def test_capture_ceiling_discards_output_and_verifies_both_layers(self):
        self.fake_cargo("sys.stdout.buffer.write(b'x' * 2097152)\nsys.stdout.buffer.flush()\ntime.sleep(12)\n")
        raw, closure, folder = self.capture(max_capture_mib=1024 / 1024 ** 2)
        self.assertEqual(raw, b'')
        self.assertTrue(closure['capture_limit_exceeded'])
        self.assertEqual(closure['capture_limit_bytes'], 1024)
        self.assertFalse(closure['output_complete'])
        self.assertEqual(closure['returned_output_bytes'], 0)
        self.assertGreater(closure['discarded_output_bytes'], 1024)
        self.assertEqual(closure['failure_reason'], 'capture memory ceiling exceeded')
        for key in ('leader_reaped', 'streams_closed', 'group_closed', 'nested_worker_closed'):
            self.assertTrue(closure[key], key)
        self.assert_gone(json.loads(self.record.read_text())['pid'])
        self.assert_metadata_only(folder)

    def test_exact_capture_ceiling_preserves_complete_output(self):
        self.fake_cargo("sys.stdout.buffer.write(b'x' * 2048)\nsys.stdout.buffer.flush()\n")
        raw, closure, _folder = self.capture(max_capture_mib=2048 / 1024 ** 2)
        self.assertEqual(len(raw), 2048)
        self.assertFalse(closure['capture_limit_exceeded'])
        self.assert_closed(closure)

    def test_genuine_nonzero_cargo_status_is_distinct_from_guard_failure(self):
        self.fake_cargo("print('test result: FAILED. 0 passed; 4 failed; 0 ignored; 0 measured; 0 filtered out;')\nsys.exit(101)\n")
        raw, closure, _folder = self.capture()
        self.assertIn(b'4 failed', raw)
        self.assertEqual(closure['exit_code'], 101)
        self.assertEqual(closure['guardian_exit_code'], 101)
        self.assertIsNone(closure['guard_lifecycle']['guard_failure'])
        self.assert_closed(closure)

    def test_successful_command_has_a_separate_cleanup_budget(self):
        raw, closure, _folder = self.capture(timeout_seconds=1, term_grace_seconds=1.1)
        self.assertEqual(raw, b'')
        self.assertEqual(closure['exit_code'], 0)
        self.assert_closed(closure)

    def test_normal_exit_closes_resistant_stdio_holding_descendant(self):
        ready = self.root / 'descendant-ready'
        child = f'''import os,pathlib,signal,time
signal.signal(signal.SIGTERM,signal.SIG_IGN)
pathlib.Path({str(ready)!r}).write_text(str(os.getpid()))
time.sleep(12)
'''
        self.fake_cargo(f'''subprocess.Popen([sys.executable,'-c',{child!r}])
while not pathlib.Path({str(ready)!r}).exists(): time.sleep(.01)
print('completed-cargo',flush=True)
''')
        raw, closure, _folder = self.capture()
        self.assertEqual(raw, b'completed-cargo\n')
        self.assert_closed(closure)
        self.assert_gone(int(ready.read_text()))

    def test_timeout_retains_available_output_and_closes_both_layers(self):
        self.fake_cargo("signal.signal(signal.SIGTERM,signal.SIG_IGN)\nprint('fictional-private-output',flush=True)\ntime.sleep(12)\n")
        raw, closure, folder = self.capture(timeout_seconds=1)
        self.assertIn(b'fictional-private-output', raw)
        self.assertTrue(closure['timed_out'])
        self.assertTrue(closure['nested_worker_closed'])
        self.assertTrue(closure['leader_reaped'])
        self.assertIn('closure_failure', closure)
        self.assert_gone(json.loads(self.record.read_text())['pid'])
        self.assert_metadata_only(folder)

    def test_callback_cancellation_uses_control_eof_without_blind_group_kill(self):
        self.fake_cargo("print('fictional-private-output',flush=True)\ntime.sleep(12)\n")
        raw, closure, folder = self.capture(stop_requested=self.record.exists)
        self.assertTrue(closure['interrupted'])
        self.assertTrue(closure['nested_worker_closed'])
        self.assertTrue(closure['group_closed'])
        self.assertTrue(closure['guard_lifecycle']['control_eof'])
        self.assertFalse(closure['guard_lifecycle']['controller_parent_changed'])
        self.assertIn('closure_failure', closure)
        self.assert_gone(json.loads(self.record.read_text())['pid'])
        self.assert_metadata_only(folder)

    def test_running_target_budget_violation_cannot_be_classified_as_red(self):
        self.fake_cargo("print('test result: FAILED. 0 passed; 4 failed; 0 ignored; 0 measured; 0 filtered out;',flush=True)\npathlib.Path(os.environ['CARGO_TARGET_DIR'],'growth').write_bytes(b'x'*32768)\ntime.sleep(12)\n")
        raw, closure, _folder = self.capture(max_target_gib=.00002)
        self.assertIn(b'4 failed', raw)
        self.assertEqual(closure['guardian_exit_code'], 75)
        self.assertIsNone(closure['exit_code'])
        self.assertIn('closure_failure', closure)
        self.assertTrue(closure['nested_worker_closed'])

    def test_preflight_refusal_has_metadata_and_never_launches_cargo(self):
        raw, closure, folder = self.capture(min_free_gib=999999)
        self.assertEqual(raw, b'')
        self.assertFalse(self.record.exists())
        self.assertTrue(closure['nested_worker_not_started'])
        self.assertIn('closure_failure', closure)
        self.assertEqual({path.name for path in folder.iterdir()}, {'guardian-started.json', 'completed.json'})

    def test_wrong_source_pin_refuses_before_guardian_start(self):
        options = self.options(expected_guard_sha256='0' * 64)
        with self.assertRaises(ValueError):
            CLIENT.capture_cargo(['test'], **options)
        self.assertEqual(list(options['lifecycle_dir'].iterdir()), [])
        self.assertFalse(self.record.exists())

    def test_invalid_client_budgets_refuse_before_guardian_start(self):
        for changes in ({'timeout_seconds': float('nan')}, {'kill_grace_seconds': float('inf')},
                        {'pipe_drain_seconds': 0}, {'min_free_gib': 1e308},
                        {'max_capture_mib': float('nan')}, {'max_capture_mib': 0},
                        {'max_capture_mib': 1e308}):
            options = self.options(**changes)
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                CLIENT.capture_cargo(['test'], **options)
            self.assertEqual(list(options['lifecycle_dir'].iterdir()), [])
        self.assertFalse(self.record.exists())

    def test_receipt_reuse_is_refused_without_replacing_old_evidence(self):
        options = self.options()
        _raw, first = CLIENT.capture_cargo(['test'], **options)
        self.assert_closed(first)
        folder = options['lifecycle_dir']
        before = {path.name: path.read_bytes() for path in folder.iterdir()}
        self.record.unlink()
        raw, second = CLIENT.capture_cargo(['test'], **options)
        self.assertEqual(raw, b'')
        self.assertFalse(self.record.exists())
        self.assertIn('closure_failure', second)
        self.assertEqual(before, {path.name: path.read_bytes() for path in folder.iterdir()})

    def test_blocked_output_consumer_does_not_block_budget_cleanup(self):
        self.fake_cargo("sys.stdout.buffer.write(b'x' * 2097152)\nsys.stdout.buffer.flush()\ntime.sleep(12)\n")
        folder = self.options()['lifecycle_dir']
        command = self.command(extra=['--capture-pipe', '--lifecycle-dir', str(folder),
                                     '--timeout-seconds', '1', '--pipe-drain-seconds', '.3',
                                     '--kill-grace-seconds', '.5'])
        process = subprocess.Popen(command, cwd=self.repo, env=self.env, start_new_session=True,
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        try:
            self.wait_record(process)
            self.assertEqual(process.wait(timeout=6), 75)
            completed = self.read_json(folder / 'completed.json')
            self.assertFalse(completed['pipe_complete'])
            self.assertTrue(completed['worker_closure']['no_live_members'])
            self.assertTrue(completed['worker_closure']['leader_reaped'])
            self.assert_metadata_only(folder)
        finally:
            process.stdin.close()
            process.stdin = None
            if process.poll() is None:
                process.terminate()
            try:
                process.communicate(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.communicate(timeout=2)

    def parent(self, options):
        values = {key: str(value) if isinstance(value, Path) else value for key, value in options.items()
                  if key != 'environment'}
        code = '''import importlib.util,json,os,pathlib,sys
spec=importlib.util.spec_from_file_location('capture',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
o=json.loads(sys.argv[2])
o['environment']=os.environ.copy()
for k in ('target_dir','lifecycle_dir','cwd'): o[k]=pathlib.Path(o[k])
raw,closure=m.capture_cargo(['test'],**o)
pathlib.Path(sys.argv[3]).write_text(json.dumps(closure))
'''
        receipt = self.root / 'parent-result.json'
        process = subprocess.Popen([sys.executable, '-c', code, str(CLIENT_PATH), json.dumps(values), str(receipt)],
                                   cwd=self.repo, env=self.env, stdout=subprocess.DEVNULL,
                                   stderr=subprocess.DEVNULL, start_new_session=True)

        def cleanup():
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=2)
        self.addCleanup(cleanup)
        return process, receipt

    def test_controller_sigkill_leaves_verified_nested_closure_receipt(self):
        self.fake_cargo("signal.signal(signal.SIGTERM,signal.SIG_IGN)\nprint('fictional-private-output',flush=True)\ntime.sleep(12)\n")
        options = self.options()
        process, _result = self.parent(options)
        folder = options['lifecycle_dir']
        self.read_json(folder / 'worker-started.json')
        self.wait_record(process)
        process.kill()
        process.wait(timeout=3)
        completed = self.read_json(folder / 'completed.json')
        self.assertTrue(completed['control_eof'])
        self.assertTrue(completed['controller_parent_changed'])
        self.assertFalse(completed['pipe_complete'])
        self.assertTrue(completed['worker_closure']['no_live_members'])
        self.assertTrue(completed['worker_closure']['leader_reaped'])
        self.assert_gone(completed['worker_pid'])
        self.assert_gone(completed['guard_pid'])
        self.assert_metadata_only(folder)

    def test_guardian_sigkill_is_explicit_missing_proof_even_if_fallback_stops_worker(self):
        self.fake_cargo("signal.signal(signal.SIGTERM,signal.SIG_IGN)\ntime.sleep(12)\n")
        options = self.options()
        process, result = self.parent(options)
        folder = options['lifecycle_dir']
        started = self.read_json(folder / 'worker-started.json')
        self.wait_record(process)
        os.kill(started['guard_pid'], signal.SIGKILL)
        self.assertEqual(process.wait(timeout=6), 0)
        closure = self.read_json(result)
        self.assertFalse(closure['nested_worker_closed'])
        self.assertIn('closure_failure', closure)
        self.assertFalse((folder / 'completed.json').exists())
        self.assert_gone(started['worker_pid'])
        self.assert_gone(json.loads(self.record.read_text())['pid'])

    def test_ram_redaction_happens_before_any_output_file(self):
        password = b'fictional-private-output'
        self.fake_cargo("print('fictional-private-output postgres://fixture:private@127.0.0.1/test /api/v2/patients/fixture-id',flush=True)\n")
        raw, closure, folder = self.capture()
        self.assert_closed(closure)
        import re
        redacted = raw.replace(password, b'[REDACTED_TEST_PASSWORD]')
        redacted = re.sub(rb'postgres(?:ql)?://[^\s]+', b'[REDACTED_DATABASE_URL]', redacted)
        redacted = re.sub(rb'/api/v2/patients/[^\s\x22\x27]+', b'[REDACTED_PATIENT_PATH]', redacted)
        log = self.root / 'redacted.log'
        with log.open('xb') as stream:
            os.chmod(log, 0o600)
            stream.write(redacted)
        self.assertNotIn(password, log.read_bytes())
        self.assertNotIn(b'fixture-id', log.read_bytes())
        self.assert_metadata_only(folder)


if __name__ == '__main__':
    unittest.main()
