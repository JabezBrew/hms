import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { appointmentCreateFormSchema } from '@/features/appointments/pages/appointment-create/appointmentCreateUtils';
import { personalCalendarFormSchema } from '@/components/appointments/personalCalendarFormUtils';
import { staffFormSchema } from '@/components/staff/staffForm.utils';

const resolverOptions = { criteriaMode: 'all', shouldUseNativeValidation: false, fields: {} };
const staff = {
  email: 'operator@example.invalid', first_name: 'Test', last_name: 'Operator',
  date_of_birth: new Date('1990-01-01'), user_type: 'receptionist',
  department: 'Operations', position: 'Reception', hire_date: new Date('2020-01-01'),
};

describe('patched validation and existing form contracts', () => {
  it.each(['array', 'set'])('rejects oversized %s before child validation while accepting the valid limit', kind => {
    let childParses = 0;
    const child = z.preprocess(value => {
      childParses += 1;
      return value;
    }, z.string().refine(value => value.startsWith('safe')));
    const schema = (kind === 'array' ? z.array(child) : z.set(child)).max(2);
    const input = values => kind === 'array' ? values : new Set(values);
    const oversized = schema.safeParse(input(Array.from({ length: 100 }, (_, index) => `invalid${index}`)));
    expect(oversized.success).toBe(false);
    expect(childParses).toBe(0);
    expect(oversized.error.issues).toHaveLength(1);
    const valid = schema.safeParse(input(['safe0', 'safe1']));
    expect(valid.success).toBe(true);
    expect(childParses).toBe(2);
  });

  it('returns actual appointment field errors through the form resolver', async () => {
    const result = await zodResolver(appointmentCreateFormSchema)({}, {}, resolverOptions);
    expect(result.values).toEqual({});
    expect(result.errors.patientId.message).toBe('Please select a patient');
    expect(result.errors.clinicId.message).toBe('Please select a clinic');
    expect(result.errors.appointmentTypeId.message).toBe('Please select an appointment type');
  });

  it('keeps a valid appointment submission and strips unsupported keys', async () => {
    const values = { patientId: 'patient-choice', clinicId: 'clinic-choice', appointmentTypeId: 'type-choice' };
    const result = await zodResolver(appointmentCreateFormSchema)({ ...values, unsupported: 'discard' }, {}, resolverOptions);
    expect(result.errors).toEqual({});
    expect(result.values).toEqual(values);
  });

  it('retains existing UUID-shaped seeded practitioner identities', () => {
    const seeded = '00000000-0000-0000-0000-000000000001';
    const result = personalCalendarFormSchema.safeParse({
      name: 'Clinic availability', practitioner: seeded, practitioners: [seeded],
      days_of_week: [0], start_time: '09:00', end_time: '17:00',
      slot_duration: 30, active_from: new Date('2026-01-01'), breaks: [],
    });
    expect(result.success).toBe(true);
    expect(result.data.practitioners).toEqual([seeded]);
    expect(result.data.is_active).toBe(true);
  });

  it('retains required date and role messages in the actual staff resolver', async () => {
    const result = await zodResolver(staffFormSchema)({
      ...staff, date_of_birth: undefined, user_type: undefined, hire_date: undefined,
    }, {}, resolverOptions);
    expect(result.errors.date_of_birth.message).toBe('Date of birth is required');
    expect(result.errors.user_type.message).toBe('Please select a user type');
    expect(result.errors.hire_date.message).toBe('Hire date is required');
  });

  it('rejects more weekday entries than the seven-option domain before parsing children', () => {
    const result = personalCalendarFormSchema.safeParse({
      name: 'Clinic availability', practitioner: 'calendar-choice',
      days_of_week: Array.from({ length: 100 }, () => 'invalid-day'),
      start_time: '09:00', end_time: '17:00', slot_duration: 30,
      active_from: new Date('2026-01-01'),
    });
    expect(result.success).toBe(false);
    const issues = result.error.issues.filter(issue => issue.path[0] === 'days_of_week');
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('too_big');
  });

  it('keeps professional credential requirements and valid staff input', async () => {
    const resolver = zodResolver(staffFormSchema);
    const missing = await resolver({ ...staff, user_type: 'doctor' }, {}, resolverOptions);
    expect(missing.errors.license_number.message).toBe('License number is required for doctors and nurses');
    expect(missing.errors.specialization).toBeDefined();
    expect(missing.errors.qualification).toBeDefined();
    const valid = await resolver({ ...staff, user_type: 'doctor',
      license_number: 'test-license', specialization: 'Test practice', qualification: 'Test qualification',
    }, {}, resolverOptions);
    expect(valid.errors).toEqual({});
  });
});
