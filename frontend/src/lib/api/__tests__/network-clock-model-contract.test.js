import { afterEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { render, cleanup } from '@testing-library/react';
import { AuthContext } from '@/lib/auth/AuthContext';
import { useReadOnlyMode } from '@/contexts/ReadOnlyModeContext';
import { modelNetworkBudget, ModeledReadOnlyModeProvider } from '@/tests/networkClockModel';
import { serverClock } from '@/shared/lib/serverClock';
import { assertWriteRecoveryReadCurrent } from '@/lib/api/v2/writeUncertainty';
const runtime = window.__HMS_RUNTIME_CONFIG__;
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.__HMS_RUNTIME_CONFIG__ = runtime; });
it('clones the unit snapshot and keeps its fixed monotonic budget despite wall-clock changes', () => {
  let tick = 100; vi.spyOn(performance, 'now').mockImplementation(() => tick);
  const raw = { access_allowed: true }; const copy = modelNetworkBudget(raw, 1000); expect(copy).not.toBe(raw); expect(serverClock(raw)).toBeNull();
  vi.spyOn(Date, 'now').mockReturnValue(0); tick += 600; expect(serverClock(copy).tokenRemaining()).toBe(400); tick += 400; expect(serverClock(copy).tokenRemaining()).toBe(0);
  const fresh = modelNetworkBudget(raw, 1000); expect(serverClock(fresh).tokenRemaining()).toBe(1000); expect(serverClock(copy).tokenRemaining()).toBe(0);
});
it('manufactures no actual response source or recovery-read stamp', () => {
  const copy = modelNetworkBudget({ data: { synthetic: true } }); expect(() => assertWriteRecoveryReadCurrent(copy)).toThrow();
});

it.each([
  { confirmed: true, access_allowed: false, read_only: false },
  { confirmed: true, access_allowed: true, read_only: true },
  { confirmed: false, access_allowed: true, read_only: false },
])('preserves denied/read-only/unconfirmed unit facts and never renews an unchanged observation: %j', flags => {
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
  let tick = 100; vi.spyOn(performance, 'now').mockImplementation(() => tick); let value;
  const decision = { access_allowed: flags.access_allowed, read_only: flags.read_only, classification: 'offsite', mode: 'readonly', policy_version: 7 };
  const requestReauthentication = vi.fn();
  function Probe() { value = useReadOnlyMode(); return null; }
  const tree = () => createElement(AuthContext.Provider, { value: { user: null } }, createElement(ModeledReadOnlyModeProvider, { network: { decision, confirmed: flags.confirmed, requestReauthentication }, windowMs: 1000 }, createElement(Probe)));
  const view = render(tree()); const observation = value.networkDecision;
  expect(observation).toEqual(decision); expect(observation).not.toBe(decision); expect(serverClock(decision)).toBeNull();
  expect(value.networkConfirmed).toBe(flags.confirmed); expect(value.canRead).toBe(flags.confirmed && flags.access_allowed); expect(value.canWrite()).toBe(false); expect(value.requestReauthentication).toBe(requestReauthentication);
  tick += 1000; view.rerender(tree()); expect(value.networkDecision).toBe(observation); expect(serverClock(observation).tokenRemaining()).toBe(0);
  expect(() => assertWriteRecoveryReadCurrent(observation)).toThrow();
});
