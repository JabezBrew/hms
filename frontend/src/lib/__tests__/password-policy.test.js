import { describe, expect, it } from 'vitest';

import {
  passwordMeetsPolicy,
  passwordRequirementChecks,
} from '../password-policy';

describe('Rust V2 password policy helpers', () => {
  it('matches the Rust signed-in password policy', () => {
    expect(passwordMeetsPolicy('Password123')).toBe(false);
    expect(passwordMeetsPolicy('Password12345')).toBe(false);
    expect(passwordMeetsPolicy('Replacement123!')).toBe(true);
  });

  it('reports the 12-character and special-character requirements for UI forms', () => {
    const checks = passwordRequirementChecks('Password12345');

    expect(checks).toEqual(
      expect.arrayContaining([
        { label: 'At least 12 characters', met: true },
        { label: 'One special character', met: false },
      ]),
    );
  });
});
