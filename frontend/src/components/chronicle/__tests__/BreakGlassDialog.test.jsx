import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import BreakGlassDialog from '../BreakGlassDialog';

function setup(overrides = {}) {
  const props = {
    open: true, onOpenChange: vi.fn(), reason: '', onReasonChange: vi.fn(),
    onSubmit: vi.fn().mockResolvedValue(false), isSubmitting: false, rustV2Mode: true, ttlMinutes: 120,
    ...overrides,
  };
  const view = render(<BreakGlassDialog {...props} />);
  return { ...view, props };
}
function chooseCategory() {
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Emergency category' }), { key: 'ArrowDown' });
  fireEvent.click(screen.getByRole('option', { name: 'Urgent continuity of care' }));
}

describe('Emergency access dialog', () => {
  it('requires a category and fresh password, submits typed values and clears the password after denial', async () => {
    const { props } = setup({ reason: 'Urgent handover' });
    const submit = screen.getByRole('button', { name: 'Request emergency access' });
    expect(submit).toBeDisabled();
    chooseCategory();
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'Synthetic password ' } });
    fireEvent.click(submit);
    expect(props.onSubmit).toHaveBeenCalledWith({ category: 'urgent_clinical_continuity', reason: 'Urgent handover', password: 'Synthetic password ' });
    await waitFor(() => expect(screen.getByLabelText('Current password')).toHaveValue(''));
    expect(screen.getByText(/120 minutes/)).toBeInTheDocument();
  });

  it('cancels without requesting access and clears the password before reopening', () => {
    const { props } = setup();
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'Synthetic password' } });
    chooseCategory();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Request emergency access' })).toBeDisabled();
  });

  it('prevents pending dismissal and keeps a rejected request visible without a success claim', () => {
    const { props } = setup({ isSubmitting: true, error: 'Fresh authentication required' });
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Fresh authentication required');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(props.onOpenChange).not.toHaveBeenCalled();
    expect(screen.queryByText('Emergency access active')).not.toBeInTheDocument();
  });
});
