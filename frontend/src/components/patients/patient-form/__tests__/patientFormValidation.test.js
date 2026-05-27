import { describe, expect, it, vi } from 'vitest';

import { findFirstInvalidStep } from '../patientFormValidation';

describe('findFirstInvalidStep', () => {
  it('validates steps sequentially and stops at the first invalid step', async () => {
    const validateStep = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const result = await findFirstInvalidStep(
      ['encounter', 'identity', 'insurance'],
      validateStep,
    );

    expect(result).toBe('identity');
    expect(validateStep).toHaveBeenCalledTimes(2);
    expect(validateStep).toHaveBeenNthCalledWith(1, 'encounter');
    expect(validateStep).toHaveBeenNthCalledWith(2, 'identity');
  });

  it('returns null when every step is valid', async () => {
    const validateStep = vi.fn().mockResolvedValue(true);

    await expect(findFirstInvalidStep(['identity', 'contact'], validateStep))
      .resolves
      .toBeNull();
  });
});
