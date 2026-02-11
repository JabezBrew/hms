/**
 * Tests for TeamSelectionField component.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TeamSelectionField } from '../TeamSelectionField';

// Mock the organization API
vi.mock('@/features/admin/api', () => ({
  rosterEntriesApi: {
    onDutyDepartment: vi.fn(),
  },
  clinicalUnitsApi: {
    descendants: vi.fn(),
  },
}));

import { rosterEntriesApi, clinicalUnitsApi } from '@/features/admin/api';

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('TeamSelectionField', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is hidden for outpatient encounters', () => {
    const onChange = vi.fn();
    const { container } = render(
      <TeamSelectionField
        departmentId="dept-1"
        encounterType="outpatient"
        value=""
        onChange={onChange}
      />,
      { wrapper: createWrapper() }
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('shows on-duty team badge when roster entry exists', async () => {
    rosterEntriesApi.onDutyDepartment.mockResolvedValue({
      results: [
        {
          id: 'roster-1',
          team_id: 'team-1',
          team_name: 'Surgical Team A',
          date: '2026-02-03',
          start_time: '08:00:00',
          end_time: '17:00:00',
        },
      ],
    });

    clinicalUnitsApi.descendants.mockResolvedValue({
      results: [
        { id: 'team-1', name: 'Surgical Team A', code: 'SURG-A', is_active: true },
        { id: 'team-2', name: 'Surgical Team B', code: 'SURG-B', is_active: true },
      ],
    });

    const onChange = vi.fn();
    render(
      <TeamSelectionField
        departmentId="dept-1"
        encounterType="inpatient"
        value=""
        onChange={onChange}
      />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      // Check for On Duty badge with team name
      expect(screen.getByText(/On Duty:/)).toBeInTheDocument();
      // The team name appears within the badge
      expect(screen.getByText(/Surgical Team A/)).toBeInTheDocument();
    });
  });

  it('auto-selects on-duty team on mount', async () => {
    rosterEntriesApi.onDutyDepartment.mockResolvedValue({
      results: [
        {
          id: 'roster-1',
          team_id: 'team-1',
          team_name: 'Medical Team A',
          date: '2026-02-03',
          start_time: '08:00:00',
          end_time: '17:00:00',
        },
      ],
    });

    clinicalUnitsApi.descendants.mockResolvedValue({
      results: [{ id: 'team-1', name: 'Medical Team A', code: 'MED-A', is_active: true }],
    });

    const onChange = vi.fn();
    render(
      <TeamSelectionField
        departmentId="dept-1"
        encounterType="inpatient"
        value=""
        onChange={onChange}
      />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('team-1');
    });
  });

  it('shows fallback message when no roster entry', async () => {
    rosterEntriesApi.onDutyDepartment.mockResolvedValue({ results: [] });
    clinicalUnitsApi.descendants.mockResolvedValue({
      results: [{ id: 'team-1', name: 'Team A', code: 'TEAM-A', is_active: true }],
    });

    const onChange = vi.fn();
    render(
      <TeamSelectionField
        departmentId="dept-1"
        encounterType="emergency"
        value=""
        onChange={onChange}
      />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(
        screen.getByText(/No duty roster entry found/)
      ).toBeInTheDocument();
    });
  });

  it('allows manual team selection override', async () => {
    rosterEntriesApi.onDutyDepartment.mockResolvedValue({
      results: [
        {
          id: 'roster-1',
          team_id: 'team-1',
          team_name: 'Team A',
          date: '2026-02-03',
          start_time: '08:00:00',
          end_time: '17:00:00',
        },
      ],
    });

    clinicalUnitsApi.descendants.mockResolvedValue({
      results: [
        { id: 'team-1', name: 'Team A', code: 'TEAM-A', is_active: true },
        { id: 'team-2', name: 'Team B', code: 'TEAM-B', is_active: true },
      ],
    });

    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <TeamSelectionField
        departmentId="dept-1"
        encounterType="inpatient"
        value="team-1"
        onChange={onChange}
      />,
      { wrapper: createWrapper() }
    );

    // Wait for auto-selected state
    await waitFor(() => {
      expect(screen.getByText(/Auto-selected:/)).toBeInTheDocument();
    });

    // Click change button
    const changeButton = screen.getByRole('button', { name: /change/i });
    await user.click(changeButton);

    // Should call onChange with empty value to reset selection
    expect(onChange).toHaveBeenCalledWith('');
  });
});
