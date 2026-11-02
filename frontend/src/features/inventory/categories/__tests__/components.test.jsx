import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CategoryCurrent } from '../components/CategoryCurrent';
import { CategoryHistory } from '../components/CategoryHistory';
import { category, historyId, parentId, stamp } from './fixtures';
afterEach(cleanup);
it('renders exact historical metadata and retained unavailable parent without foreign labels or an actionable manager control for readers', () => {
  const value = { ...category, code: '', name: 'x'.repeat(121), description: '  raw\ntext  ', parent_id: parentId, parent: null };
  render(<CategoryCurrent category={value} eligibility={{ lifecycle_blocked_by: 'item_reference', parent_unavailable: true }} access={{ canManage: false, canWrite: false }} onAction={vi.fn()} />);
  expect(screen.getAllByText(value.name).length).toBeGreaterThan(0); expect(screen.getByText('raw text', { exact: false })).toHaveTextContent('raw text');
  expect(screen.getByText(parentId)).toBeInTheDocument(); expect(screen.getByText('Recorded parent unavailable')).toBeInTheDocument(); expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
it.each(['item_reference', 'child_reference'])('blocks lifecycle for %s while leaving metadata correction available', blocker => {
  render(<CategoryCurrent category={category} eligibility={{ lifecycle_blocked_by: blocker, parent_unavailable: false }} access={{ canManage: true, canWrite: true }} onAction={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Correct category details' })).toBeEnabled(); expect(screen.getByRole('button', { name: 'Review category retirement' })).toBeDisabled();
});
it('renders only history flags and revisions without description snapshots, actor or reason content', () => {
  render(<CategoryHistory rows={[{ id: historyId, action: 'correct', recorded_at: stamp, before_version: 1, after_version: 2, name_changed: false, description_changed: true, parent_changed: false, active_changed: false }]} />);
  expect(screen.getByText('Description changed')).toBeInTheDocument(); expect(screen.getByText('Before revision')).toBeInTheDocument(); expect(screen.getByText('Recorded revision')).toBeInTheDocument(); expect(screen.queryByText(/recorded by/i)).not.toBeInTheDocument(); expect(screen.queryByText('Empty text')).not.toBeInTheDocument();
});
