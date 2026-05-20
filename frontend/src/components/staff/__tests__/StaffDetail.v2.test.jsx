import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import StaffDetail from '../StaffDetail';
import { authApi } from '@/shared/api/auth';
import { useResendStaffSetupLink } from '@/features/staff/hooks';

const resendSetupLink = vi.fn();

vi.mock('@/features/staff/hooks', () => ({
  staffKeys: {
    detail: (id) => ['staff', 'detail', id],
    lists: () => ['staff', 'list'],
  },
  useReactivateStaff: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useResendStaffSetupLink: vi.fn(),
  useUpdateStaff: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/features/staff/api', () => ({
  staffApi: {
    deleteStaff: vi.fn(),
    updateStaff: vi.fn(),
  },
}));

vi.mock('@/shared/api/auth', () => ({
  authApi: {
    adminForceResetPassword: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('../StaffActivityLog', () => ({
  default: () => <div data-testid="activity-log" />,
}));

vi.mock('../StaffWardAssignments', () => ({
  StaffWardAssignments: () => <div data-testid="ward-assignments" />,
}));

function renderStaffDetail() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <StaffDetail
          staff={{
            id: 'staff-1',
            employee_id: 'EMP-001',
            department: 'Nursing',
            position: 'Ward Nurse',
            hire_date: '2026-05-01',
            user_details: {
              id: 'user-1',
              email: 'ama@example.test',
              first_name: 'Ama',
              last_name: 'Mensah',
              user_type: 'nurse',
              is_active: true,
            },
          }}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('StaffDetail Rust V2 actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resendSetupLink.mockResolvedValue({ mode: 'password_reset' });
    vi.mocked(useResendStaffSetupLink).mockReturnValue({
      mutateAsync: resendSetupLink,
      isPending: false,
    });
  });

  it('uses the staff force-password-reset lifecycle endpoint from the reset-password action', async () => {
    const user = userEvent.setup();
    renderStaffDetail();

    await user.click(screen.getByRole('button', { name: /reset password/i }));
    await user.click(screen.getByRole('button', { name: /send reset email/i }));

    expect(resendSetupLink).toHaveBeenCalledWith('staff-1');
    expect(authApi.adminForceResetPassword).not.toHaveBeenCalled();
  });
});
