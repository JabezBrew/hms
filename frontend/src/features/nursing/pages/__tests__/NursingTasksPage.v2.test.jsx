import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import NursingTasksPage, { getTaskTypeOptions } from '../NursingTasksPage';

const updateTask = vi.fn();
const completeTask = vi.fn();
const createTask = vi.fn();
const refetch = vi.fn();

const pendingTask = {
  id: 'task-1',
  patient_name: 'Ama Mensah',
  patient_mrn: 'MRN-2026-0001',
  task_type: 'vitals',
  description: 'Check blood pressure',
  priority: 'medium',
  status: 'pending',
  scheduled_time: '2026-05-16T08:00:00Z',
  assigned_to_name: 'Nurse Esi',
};

vi.mock('@/components/layout/layout', () => ({
  Layout: ({ children }) => <div>{children}</div>,
}));

vi.mock('@/shared/components/page/PageShell', () => ({
  PageShell: ({ children }) => <div>{children}</div>,
}));

vi.mock('@/shared/components/page/PageHeader', () => ({
  PageHeader: ({ title, description, actions }) => (
    <header>
      <h1>{title}</h1>
      <p>{description}</p>
      {actions}
    </header>
  ),
}));

vi.mock('@/shared/hooks/usePageMeta', () => ({
  usePageMeta: () => null,
}));

vi.mock('@/features/staff/hooks', () => ({
  useStaff: () => ({ data: [] }),
}));

vi.mock('@/features/nursing/hooks', () => ({
  useNursingTasks: () => ({
    data: [pendingTask],
    isLoading: false,
    refetch,
  }),
  useTodayTasks: () => ({ data: [] }),
  usePatientMonitoring: () => ({ data: [] }),
  useCreateNursingTask: () => ({
    mutateAsync: createTask,
    isPending: false,
  }),
  useCompleteTask: () => ({
    mutateAsync: completeTask,
    isPending: false,
  }),
  useUpdateTask: () => ({
    mutateAsync: updateTask,
    isPending: false,
  }),
}));

async function openTaskMenu(container) {
  const trigger = container.querySelector('.lucide-ellipsis')?.closest('button');
  expect(trigger).toBeTruthy();
  await userEvent.click(trigger);
}

describe('NursingTasksPage Rust V2 guards', () => {
  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__;
    vi.clearAllMocks();
  });

  it('hides unsupported start-task edits while keeping complete and cancel in Rust V2 mode', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    const { container } = render(<NursingTasksPage />);

    expect(screen.getByText('Check blood pressure')).toBeInTheDocument();
    await openTaskMenu(container);

    expect(screen.queryByText('Start Task')).not.toBeInTheDocument();
    expect(screen.getByText('Complete Task')).toBeInTheDocument();
    expect(screen.getByText('Cancel Task')).toBeInTheDocument();
    expect(
      screen.getByText(/general nursing task edits are not available for this deployment yet/i),
    ).toBeInTheDocument();
  });

  it('limits task type choices to the generated Rust V2 task enum', () => {
    expect(getTaskTypeOptions(true).map((option) => option.value)).toEqual([
      'ward_round',
      'observation',
      'medication',
      'handoff',
    ]);
    expect(getTaskTypeOptions(true).map((option) => option.value)).not.toContain('wound_care');
    expect(getTaskTypeOptions(true).map((option) => option.value)).not.toContain('vitals');
  });

  it('keeps start-task edits available outside Rust V2 mode', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' };
    const { container } = render(<NursingTasksPage />);

    await openTaskMenu(container);

    expect(screen.getByText('Start Task')).toBeInTheDocument();
    expect(
      screen.queryByText(/general nursing task edits are not available for this deployment yet/i),
    ).not.toBeInTheDocument();
  });
});
