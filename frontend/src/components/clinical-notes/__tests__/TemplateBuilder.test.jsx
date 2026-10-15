import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TemplateBuilder from '../TemplateBuilder';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@/features/clinical-notes/hooks', () => ({
  useCreateNoteTemplate: () => ({ mutateAsync: mocks.create, isPending: false }),
  useUpdateNoteTemplate: () => ({ mutateAsync: mocks.update, isPending: false }),
}));

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { role: 'doctor' } }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const existingTemplate = {
  id: 'synthetic-template',
  title: 'Synthetic review template',
  note_type: 'doctor_note',
  structure: { sections: [{ name: 'Summary', type: 'text', required: true }] },
};

async function advance(user) {
  await user.click(screen.getByRole('button', { name: 'Next' }));
}

describe('TemplateBuilder review before saving', () => {
  beforeEach(() => {
    mocks.create.mockResolvedValue({ id: 'synthetic-created-template' });
    mocks.update.mockResolvedValue({ id: existingTemplate.id });
  });

  it('reaches SOAP review and allows back navigation without saving, then creates only on the explicit save click', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    render(<TemplateBuilder onSuccess={onSuccess} />);

    await user.type(screen.getByLabelText(/Template Title/), 'Synthetic SOAP template');
    await advance(user);
    await screen.findByRole('heading', { name: 'Visibility & Status' });
    await advance(user);
    await user.click(await screen.findByRole('button', { name: 'SOAP', exact: true }));
    await advance(user);

    expect(await screen.findByRole('heading', { name: 'Review Template' })).toBeInTheDocument();
    expect(screen.getByText('Subjective')).toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(await screen.findByRole('heading', { name: 'Template Structure' })).toBeInTheDocument();
    await advance(user);
    expect(await screen.findByRole('heading', { name: 'Review Template' })).toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Create Template' }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Synthetic SOAP template',
      note_type: 'doctor_note',
      structure: { sections: expect.arrayContaining([
        expect.objectContaining({ name: 'Subjective', type: 'text' }),
        expect.objectContaining({ name: 'Plan', type: 'text' }),
      ]) },
    }));
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('does not save a valid form submitted before the review step', async () => {
    const onSuccess = vi.fn();
    const { container } = render(<TemplateBuilder initialTemplate={existingTemplate} onSuccess={onSuccess} />);

    await act(async () => { fireEvent.submit(container.querySelector('form')); });

    expect(screen.getByRole('heading', { name: 'Template Basics' })).toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('supports keyboard advance to review and an explicit keyboard update', async () => {
    const user = userEvent.setup();
    render(<TemplateBuilder initialTemplate={existingTemplate} />);
    await advance(user);
    await screen.findByRole('heading', { name: 'Visibility & Status' });
    await advance(user);
    await screen.findByRole('heading', { name: 'Template Structure' });

    screen.getByRole('button', { name: 'Next' }).focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { name: 'Review Template' })).toBeInTheDocument();
    expect(mocks.update).not.toHaveBeenCalled();

    screen.getByRole('button', { name: 'Update Template' }).focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      id: existingTemplate.id,
      data: expect.objectContaining({ title: existingTemplate.title }),
    }));
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
