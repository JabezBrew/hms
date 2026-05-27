import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import DynamicNoteForm from '../DynamicNoteForm';

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('@/features/clinical-notes/hooks', () => ({
  useCreateNoteEntry: vi.fn(),
}));

import { useCreateNoteEntry } from '@/features/clinical-notes/hooks';
import { toast } from 'sonner';

const template = {
  id: 'template-1',
  title: 'Ward Round Note',
  note_type: 'progress',
  structure: [
    { type: 'text', section: 'History' },
    { type: 'observation', section: 'Vitals', observation_type: 'vitals' },
    { type: 'medication_administration', section: 'Medication Given' },
  ],
};

describe('DynamicNoteForm', () => {
  let mutateAsync;

  beforeEach(() => {
    vi.clearAllMocks();
    mutateAsync = vi.fn().mockResolvedValue({});
    useCreateNoteEntry.mockReturnValue({
      isPending: false,
      mutateAsync,
    });
  });

  it('submits text and nested clinical note fields through React Hook Form', async () => {
    const onSuccess = vi.fn();
    render(
      <DynamicNoteForm
        template={template}
        encounterId="encounter-1"
        patientId="patient-1"
        onSuccess={onSuccess}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('Enter history'), {
      target: { value: 'Patient reports improving cough.' },
    });
    fireEvent.change(screen.getByLabelText('Heart Rate (bpm)'), {
      target: { value: '72' },
    });
    fireEvent.change(screen.getByLabelText('Medication'), {
      target: { value: 'Paracetamol' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Submit Note' }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));

    expect(mutateAsync).toHaveBeenCalledWith({
      template: 'template-1',
      template_id: 'template-1',
      encounter: 'encounter-1',
      patient: 'patient-1',
      note_type: 'progress',
      title: 'Ward Round Note',
      data: {
        History: 'Patient reports improving cough.',
        Vitals: {
          heart_rate: '72',
        },
        'Medication Given': {
          medication: 'Paracetamol',
        },
      },
    });
    expect(toast.success).toHaveBeenCalledWith('Clinical note submitted successfully');
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });
});
