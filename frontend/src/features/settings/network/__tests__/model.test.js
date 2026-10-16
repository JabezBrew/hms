import { describe, expect, it } from 'vitest';
import { confirmedNetworkDecision, confirmedNetworkPolicy } from '../api';
import { assertNetworkAuthority, networkCandidate, networkEditorIdentity, networkReason } from '../model';
import { networkDecision, networkPolicy, networkUser } from './fixtures';

describe('network policy input and least-privilege decisions', () => {
  it('bounds candidate networks without pretending to parse or canonicalize addresses', () => {
    expect(networkCandidate(' 10.10.4.9/24\n\n2001:db8::/48 ', 'fresh_reauth')).toEqual({ onsite_cidrs: ['10.10.4.9/24', '2001:db8::/48'], offsite_mode: 'fresh_reauth' });
    for (const input of ['', '0.0.0.0/0', '10.0.0.0/8\n10.0.0.0/8', Array.from({ length: 65 }, (_, index) => `10.${index}.0.0/16`).join('\n')]) expect(() => networkCandidate(input, 'readonly')).toThrow();
    expect(() => networkReason(' ')).toThrow(); expect(() => networkReason('a'.repeat(1001))).toThrow(); expect(networkReason(' Synthetic reviewed change ')).toBe('Synthetic reviewed change');
  });
  it('never carries addresses or CIDRs into ordinary status', () => {
    const value = confirmedNetworkDecision({ ...networkDecision, client_ip: '203.0.113.5', onsite_cidrs: ['10.10.0.0/16'], raw_headers: 'private' });
    expect(value).toEqual(networkDecision); expect(value).not.toHaveProperty('client_ip');
    expect(() => confirmedNetworkDecision({ ...networkDecision, classification: 'unknown', reason: 'client_unknown', read_only: false })).toThrow();
    expect(() => confirmedNetworkDecision({ ...networkDecision, policy_version: null })).toThrow();
    expect(confirmedNetworkDecision({ ...networkDecision, policy_version: null }, { candidate: true })).toMatchObject({ classification: 'onsite' });
    expect(() => confirmedNetworkDecision({ ...networkDecision, reason: 'arbitrary text' })).toThrow();
    expect(() => confirmedNetworkDecision({ ...networkDecision, classification: 'offsite', mode: 'fresh_reauth', reauth_expires_at: null })).toThrow();
    expect(() => confirmedNetworkPolicy({ ...networkPolicy, onsite_cidrs: [] })).toThrow();
  });
  it('binds credential confirmation to actor/facility/profile and current capability', () => {
    expect(() => assertNetworkAuthority(networkUser, networkUser)).not.toThrow();
    for (const change of [{ id: 'other' }, { facilityCode: 'OTHER' }, { accessContext: { ...networkUser.accessContext, active_profile: 'clinic' } }, { accessContext: { ...networkUser.accessContext, facility_id: 'other' } }, { adminAccess: { capabilities: [] } }, { mfaRequired: true }]) expect(() => assertNetworkAuthority(networkUser, { ...networkUser, ...change })).toThrow();
    expect(networkEditorIdentity(networkUser)).not.toContain(networkUser.email);
    expect(networkEditorIdentity({ ...networkUser, adminAccess: { capabilities: [] } })).not.toBe(networkEditorIdentity(networkUser));
  });
});
