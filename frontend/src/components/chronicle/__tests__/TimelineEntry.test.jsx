import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import TimelineEntry from '../TimelineEntry';

vi.mock('../NoteDetailModal', () => ({
  default: () => null,
}));

vi.mock('../CopyNoteModal', () => ({
  default: () => null,
}));

vi.mock('../PrescriptionActionsDialog', () => ({
  default: () => null,
}));

vi.mock('../ChronicleNoteBody', () => ({
  default: ({ content, data }) => (
    <div>
      <div>{content}</div>
      {data?.assessment && <div>{data.assessment}</div>}
    </div>
  ),
}));

const noteEntry = {
  id: 'note-1',
  type: 'progress_note',
  title: 'Morning Review',
  timestamp: '2026-04-13T09:00:00Z',
  author: 'Dr. Ada',
  author_id: 'user-1',
  data: {
    assessment: 'Stable after overnight observation',
    plan: 'Continue monitoring and repeat labs in six hours',
  },
  template: { id: 'template-1', title: 'Progress Note' },
};

const chartEntry = {
  id: 'chart-1',
  type: 'chart',
  title: 'Vital Signs Trend Chart',
  timestamp: '2026-04-13T11:00:00Z',
  author: 'Nurse Ada',
  data: {
    template_name: 'Vital Signs Trend Chart',
    scope_type: 'encounter',
    notes: 'Pain improved after analgesia',
  },
  content: 'Blood Pressure: 124/82 | Pain Score: 3',
};

describe('TimelineEntry note expansion', () => {
  it('shows inline note controls for expandable notes', () => {
    render(
      <TimelineEntry
        entry={noteEntry}
        currentUserId="user-1"
        onEditNote={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Open note' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Focus view' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('expands inline note content when toggled without a controller', async () => {
    const user = userEvent.setup();
    render(<TimelineEntry entry={noteEntry} currentUserId="user-1" />);

    await user.click(screen.getByRole('button', { name: 'Open note' }));

    expect(screen.getByRole('button', { name: 'Collapse note' })).toBeInTheDocument();
    expect(await screen.findByText('Stable after overnight observation')).toBeInTheDocument();
  });

  it('uses the controlled toggle callback when expansion state is managed by the page', async () => {
    const user = userEvent.setup();
    const onToggleNoteExpanded = vi.fn();

    render(
      <TimelineEntry
        entry={noteEntry}
        currentUserId="user-1"
        isNoteExpanded={false}
        onToggleNoteExpanded={onToggleNoteExpanded}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Open note' }));

    expect(onToggleNoteExpanded).toHaveBeenCalledWith('note-1');
    expect(screen.getByRole('button', { name: 'Open note' })).toBeInTheDocument();
    expect(document.getElementById('chronicle-note-body-note-1')).not.toBeInTheDocument();
  });

  it('renders chart summary entries with scope and summary content', () => {
    render(<TimelineEntry entry={chartEntry} />);

    expect(screen.getByText('Vital Signs Trend Chart')).toBeInTheDocument();
    expect(screen.getByText('encounter')).toBeInTheDocument();
    expect(screen.getByText('Blood Pressure: 124/82 | Pain Score: 3')).toBeInTheDocument();
    expect(screen.getByText('Pain improved after analgesia')).toBeInTheDocument();
  });

  it('renders vital signs with fallback timestamps and oxygen saturation fields', () => {
    render(
      <TimelineEntry
        entry={{
          id: 'vitals-1',
          type: 'vitals',
          recorded_at: '2026-05-12T09:15:00Z',
          data: {
            temperature: '37.2',
            blood_pressure_systolic: '124',
            blood_pressure_diastolic: '82',
            heart_rate: '88',
            oxygen_saturation: '97',
            respiratory_rate: '18',
          },
        }}
      />,
    );

    expect(screen.getByText(/May 12, 2026/)).toBeInTheDocument();
    expect(screen.getByText('124/82')).toBeInTheDocument();
    expect(screen.getByText('97%')).toBeInTheDocument();
  });
});
