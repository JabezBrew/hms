import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const roles = ['reception', 'doctor', 'nurse', 'lab', 'pharmacy', 'billing', 'admin'];
const source = fs.readFileSync(new URL('../k6-rust-v2-realistic.js', import.meta.url), 'utf8');
// Execute the production session interface with fake authentication adapters.
// k6's HTTP/metric imports are intentionally outside this network-free test.
const sessionSource = source.slice(source.indexOf('function sessionFor('), source.indexOf('\nfunction loginWithCredentials('));

function virtualUser() {
  let now = 0;
  let failRefresh = false;
  const logins = [];
  const refreshes = [];
  const sessions = {};
  const sessionFor = vm.runInNewContext(`${sessionSource}\nsessionFor;`, {
    ALL_WORKFLOWS: roles,
    TOKEN_REFRESH_SECONDS: 480,
    Date: { now: () => now },
    sessions,
    loginWithCredentials: (role, credential) => {
      logins.push({ role, credential });
      return { accessToken: `synthetic-token-${logins.length}`, lastAuthenticatedAt: now };
    },
    refreshSession: (session, role) => {
      refreshes.push({ session, role });
      return failRefresh ? null : { accessToken: 'synthetic-refreshed-token', lastAuthenticatedAt: now };
    },
  }, { filename: 'k6-session-interface' });
  return {
    sessionFor, sessions, logins, refreshes,
    expire: () => { now += 481000; },
    failRefresh: () => { failRefresh = true; },
  };
}

function sharedCredentials() {
  return Object.fromEntries(roles.map((role) => [role, {
    email: 'shared@synthetic.invalid', password: 'synthetic-shared-password',
  }]));
}

test('one virtual user reuses one shared-account login across every workflow', () => {
  const vu = virtualUser();
  const credentials = sharedCredentials();
  const sessions = roles.map((role) => vu.sessionFor(role, credentials));

  assert.equal(vu.logins.length, 1);
  assert.equal(new Set(sessions).size, 1);
  assert.deepEqual(Object.keys(vu.sessions), ['reception']);
});

test('distinct accounts and distinct credentials for one account remain isolated', () => {
  const vu = virtualUser();
  const credentials = sharedCredentials();
  credentials.doctor = { email: 'doctor@synthetic.invalid', password: 'synthetic-doctor-password' };
  credentials.lab = { email: credentials.nurse.email, password: 'synthetic-other-password' };
  const nurse = vu.sessionFor('nurse', credentials);
  const doctor = vu.sessionFor('doctor', credentials);
  const lab = vu.sessionFor('lab', credentials);

  assert.equal(vu.logins.length, 3);
  assert.notEqual(nurse, doctor);
  assert.notEqual(nurse, lab);
  assert.equal(vu.sessionFor('nurse', credentials), nurse);
  assert.deepEqual(Object.keys(vu.sessions).sort(), ['doctor', 'lab', 'reception']);
});

test('one refresh replaces the shared session for every matching workflow', () => {
  const vu = virtualUser();
  const credentials = sharedCredentials();
  vu.sessionFor('nurse', credentials);
  vu.expire();
  const refreshed = vu.sessionFor('doctor', credentials);

  assert.equal(vu.sessionFor('billing', credentials), refreshed);
  assert.equal(vu.refreshes.length, 1);
  assert.equal(vu.logins.length, 1);
});

test('failed refresh retries one shared-account login without replacing another account', () => {
  const vu = virtualUser();
  const credentials = sharedCredentials();
  credentials.doctor = { email: 'doctor@synthetic.invalid', password: 'synthetic-doctor-password' };
  vu.sessionFor('nurse', credentials);
  vu.expire();
  const doctor = vu.sessionFor('doctor', credentials);
  vu.failRefresh();
  const retried = vu.sessionFor('billing', credentials);

  assert.equal(vu.sessionFor('nurse', credentials), retried);
  assert.equal(vu.sessionFor('doctor', credentials), doctor);
  assert.equal(vu.refreshes.length, 1);
  assert.equal(vu.logins.length, 3);
});

test('virtual users keep independent sessions even with identical credentials', () => {
  const first = virtualUser();
  const second = virtualUser();
  const credentials = sharedCredentials();

  assert.notEqual(first.sessionFor('nurse', credentials), second.sessionFor('doctor', credentials));
  assert.equal(first.logins.length, 1);
  assert.equal(second.logins.length, 1);
});

test('missing credentials do not attempt authentication', () => {
  const vu = virtualUser();

  assert.equal(vu.sessionFor('nurse', {}), null);
  assert.equal(vu.logins.length, 0);
});
