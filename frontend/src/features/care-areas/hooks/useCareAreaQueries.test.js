import { describe, expect, it } from 'vitest';

import { buildMyWorkScope, careAreaKeys } from './useCareAreaQueries';

describe('care-area query keys', () => {
  it('includes sanitized authorization-changing scope for My Work', () => {
    const scope = buildMyWorkScope({
      id: 'user-1',
      role: 'doctor',
      staffId: 'staff-1',
      practitionerId: 'practitioner-1',
      accessContext: {
        active_profile: 'hospital',
        session_version: 4,
        permission_version: 9,
        features: ['wards', 'appointments'],
        permissions: ['ward.view', 'appointment.view'],
        patient_visibility: ['demographics'],
      },
    }, 'HMS');

    expect(careAreaKeys.myWork(scope)).toEqual([
      'care-areas',
      'my-work',
      {
        facility: 'HMS',
        user: 'user-1',
        role: 'doctor',
        staff: 'staff-1',
        practitioner: 'practitioner-1',
        profile: 'hospital',
        sessionVersion: 4,
        permissionVersion: 9,
        features: ['appointments', 'wards'],
        permissions: ['appointment.view', 'ward.view'],
        patientVisibility: ['demographics'],
      },
    ]);
  });
});
