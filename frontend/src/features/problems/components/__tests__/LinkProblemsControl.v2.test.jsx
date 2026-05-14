import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import LinkProblemsControl from '../LinkProblemsControl';

vi.mock('../../hooks', () => ({
  usePatientProblems: () => ({
    data: [
      {
        id: 'problem-1',
        label: 'Hypertension',
        code_value: 'I10',
      },
    ],
  }),
  useProblemLinks: () => ({
    data: [
      {
        id: 'link-1',
        problem: 'problem-1',
      },
    ],
  }),
  useCreateProblemLink: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteProblemLink: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

describe('LinkProblemsControl Rust V2 guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__;
  });

  it('hides unsupported artifact link controls in Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };

    render(<LinkProblemsControl patientId="patient-1" noteEntryId="note-1" />);

    expect(screen.queryByRole('button', { name: /link problem/i })).not.toBeInTheDocument();
    expect(screen.queryByTitle(/unlink/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(/problem artifact linking is not available in rust v2/i),
    ).toBeInTheDocument();
  });

  it('keeps artifact link controls available outside Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' };

    render(<LinkProblemsControl patientId="patient-1" noteEntryId="note-1" />);

    expect(screen.getByText('Hypertension')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /link problem/i })).toBeInTheDocument();
    expect(screen.getByTitle(/unlink/i)).toBeInTheDocument();
  });
});
