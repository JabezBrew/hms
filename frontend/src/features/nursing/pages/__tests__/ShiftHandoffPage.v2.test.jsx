import { describe, expect, it } from 'vitest';

import { getHandoffNurseOptions } from '../ShiftHandoffPage';

describe('ShiftHandoffPage Rust V2 staff fallback', () => {
  it('uses active staff directory users when ward-specific assignments are unavailable', () => {
    const result = getHandoffNurseOptions({
      rustV2Mode: true,
      wardStaff: [],
      staff: [
        {
          id: 'staff-profile-1',
          user_id: 'user-1',
          name: 'Nurse Ama',
          user_type: 'nurse',
          is_active: true,
        },
        {
          id: 'staff-profile-2',
          user_id: 'user-2',
          name: 'Inactive Nurse',
          user_type: 'nurse',
          is_active: false,
        },
      ],
    });

    expect(result).toEqual({
      usesDirectoryFallback: true,
      nurses: [
        {
          id: 'user-1',
          full_name: 'Nurse Ama',
          role_name: 'nurse',
        },
      ],
    });
  });

  it('falls back to the current user when the Rust V2 staff directory is empty', () => {
    const result = getHandoffNurseOptions({
      rustV2Mode: true,
      wardStaff: [],
      staff: [],
      currentUser: {
        id: 'user-current',
        firstName: 'HMS',
        lastName: 'Owner',
        role: 'admin',
      },
    });

    expect(result).toEqual({
      usesDirectoryFallback: true,
      nurses: [
        {
          id: 'user-current',
          full_name: 'HMS Owner',
          role_name: 'admin',
        },
      ],
    });
  });

  it('keeps assigned ward staff as the source of truth when present', () => {
    const result = getHandoffNurseOptions({
      rustV2Mode: true,
      wardStaff: [
        {
          id: 'ward-user-1',
          full_name: 'Ward Nurse',
          role_name: 'Nurse',
        },
      ],
      staff: [
        {
          id: 'staff-profile-1',
          user_id: 'user-1',
          name: 'Directory Nurse',
          user_type: 'nurse',
          is_active: true,
        },
      ],
    });

    expect(result).toEqual({
      usesDirectoryFallback: false,
      nurses: [
        {
          id: 'ward-user-1',
          full_name: 'Ward Nurse',
          role_name: 'Nurse',
        },
      ],
    });
  });
});
