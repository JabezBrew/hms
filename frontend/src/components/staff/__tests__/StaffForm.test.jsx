import { describe, expect, it } from 'vitest';
import { buildRegistrationPayload, staffFormSchema } from '../staffForm.utils';

const baseFormValues = {
  email: 'staff@example.com',
  first_name: 'Ada',
  last_name: 'Lovelace',
  phone_number: '+1234567890',
  date_of_birth: new Date('1990-01-10'),
  user_type: 'billing',
  department: 'Finance',
  position: 'Billing Clerk',
  hire_date: new Date('2020-06-15'),
  license_number: '',
  specialization: '',
  qualification: '',
  address_line1: '123 Main St',
  address_line2: '',
  city: 'Accra',
  state: 'Greater Accra',
  postal_code: '10001',
  country: 'Ghana',
};

describe('staffFormSchema', () => {
  it('requires practitioner credentials for doctor role', () => {
    const result = staffFormSchema.safeParse({
      ...baseFormValues,
      user_type: 'doctor',
      license_number: '',
      specialization: '',
      qualification: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const errorPaths = result.error.issues.map((issue) => issue.path.join('.'));
      expect(errorPaths).toContain('license_number');
      expect(errorPaths).toContain('specialization');
      expect(errorPaths).toContain('qualification');
    }
  });

  it('rejects hire dates earlier than date of birth', () => {
    const result = staffFormSchema.safeParse({
      ...baseFormValues,
      hire_date: new Date('1980-05-01'),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const hireDateErrors = result.error.issues.filter((issue) => issue.path.join('.') === 'hire_date');
      expect(hireDateErrors.length).toBeGreaterThan(0);
    }
  });
});

describe('buildRegistrationPayload', () => {
  it('omits practitioner fields for non-practitioner roles', () => {
    const payload = buildRegistrationPayload({
      ...baseFormValues,
      user_type: 'billing',
      license_number: 'LIC-001',
      specialization: 'General',
      qualification: 'BSc',
    });

    expect(payload).not.toHaveProperty('license_number');
    expect(payload).not.toHaveProperty('specialization');
    expect(payload).not.toHaveProperty('qualification');
    expect(payload.date_of_birth).toBe('1990-01-10');
    expect(payload.hire_date).toBe('2020-06-15');
  });

  it('includes practitioner fields for practitioner roles', () => {
    const payload = buildRegistrationPayload({
      ...baseFormValues,
      email: 'Doctor@Example.COM',
      user_type: 'doctor',
      license_number: '  MD-12345 ',
      specialization: '  Cardiology ',
      qualification: '  MBBS, MD  ',
    });

    expect(payload.email).toBe('doctor@example.com');
    expect(payload.license_number).toBe('MD-12345');
    expect(payload.specialization).toBe('Cardiology');
    expect(payload.qualification).toBe('MBBS, MD');
  });
});
