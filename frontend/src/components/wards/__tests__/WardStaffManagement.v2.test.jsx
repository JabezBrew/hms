import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WardStaffManagement } from '../WardStaffManagement';

vi.mock('@/features/wards/hooks/useWardQueries', () => ({
  useStaffAssignments: () => ({
    data: {
      results: [
        {
          id: 'assignment-1',
          practitioner: 'practitioner-1',
          practitioner_name: 'Dr. Ama Mensah',
          role: 'role-1',
          role_name: 'Ward Doctor',
          role_category: 'medical',
          is_active: true,
          is_primary: true,
        },
      ],
    },
    isLoading: false,
  }),
  useStaffRoles: () => ({ data: [] }),
  useCreateStaffAssignment: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateStaffAssignment: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteStaffAssignment: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/features/staff/hooks', () => ({
  useSearchPractitioners: () => ({
    data: [],
    isLoading: false,
    searchTerm: '',
    setSearchTerm: vi.fn(),
  }),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }) => <div>{children}</div>,
  DialogTrigger: ({ children }) => <>{children}</>,
  DialogContent: () => null,
  DialogDescription: ({ children }) => <p>{children}</p>,
  DialogFooter: ({ children }) => <div>{children}</div>,
  DialogHeader: ({ children }) => <div>{children}</div>,
  DialogTitle: ({ children }) => <h2>{children}</h2>,
}));

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children }) => <div>{children}</div>,
  AlertDialogAction: ({ children, onClick }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  AlertDialogCancel: ({ children }) => <button type="button">{children}</button>,
  AlertDialogContent: ({ children }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }) => <h2>{children}</h2>,
  AlertDialogTrigger: ({ children }) => <>{children}</>,
}));

describe('WardStaffManagement Rust V2 guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__;
  });

  it('renders ward staff assignments read-only in Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };

    render(<WardStaffManagement wardId="ward-1" />);

    expect(screen.getByText('Dr. Ama Mensah')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /assign staff/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^remove$/i })).not.toBeInTheDocument();
    expect(
      screen.getByText(/ward staff assignment management is not available in rust v2/i),
    ).toBeInTheDocument();
  });

  it('keeps ward staff assignment actions available outside Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' };

    render(<WardStaffManagement wardId="ward-1" />);

    expect(screen.getByRole('button', { name: /assign staff/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^remove$/i })).toBeInTheDocument();
  });
});
