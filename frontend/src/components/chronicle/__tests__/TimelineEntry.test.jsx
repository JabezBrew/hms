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
});
