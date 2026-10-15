import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TemplateBuilder from '../TemplateBuilder';

const mutations = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));
const runtimeMode = vi.hoisted(() => ({ rustV2: true }));

vi.mock('@/features/clinical-notes/hooks', () => ({
  useCreateNoteTemplate: () => ({ mutateAsync: mutations.create, isPending: false }),
  useUpdateNoteTemplate: () => ({ mutateAsync: mutations.update, isPending: false }),
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { role: 'doctor' } }) }));
vi.mock('@/lib/api/v2/runtime', () => ({ isRustV2ApiMode: () => runtimeMode.rustV2 }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

async function openStructure(user) {
  await user.type(screen.getByLabelText('Template Title *'), 'Routine review template');
  await user.type(screen.getByLabelText('Description'), 'A reusable clinical workflow.');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByRole('heading', { name: 'Facility Sharing & Status' });
  expect(screen.getByText('Shared within your facility')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Private/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByRole('heading', { name: 'Template Structure' });
  await user.click(screen.getByRole('button', { name: 'SOAP' }));
}

describe('TemplateBuilder review and structure controls', () => {
  beforeEach(() => {
    runtimeMode.rustV2 = true;
    mutations.create.mockResolvedValue({ id: 'template-created' });
    mutations.update.mockResolvedValue({ id: 'template-updated' });
  });

  it('offers only persisted V2 settings while preserving legacy configuration controls', () => {
    const { unmount } = render(<TemplateBuilder />);
    expect(screen.getByLabelText('Note Type')).toBeInTheDocument();
    expect(screen.queryByLabelText('Icon')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Template Mode')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Estimated Steps')).not.toBeInTheDocument();

    unmount();
    runtimeMode.rustV2 = false;
    render(<TemplateBuilder />);
    expect(screen.getByLabelText('Icon')).toBeInTheDocument();
    expect(screen.getByLabelText('Template Mode')).toBeInTheDocument();
    expect(screen.getByLabelText('Estimated Steps')).toBeInTheDocument();
  });

  it('names section actions and lets the visible required label toggle its switch', async () => {
    const user = userEvent.setup();
    render(<TemplateBuilder />);
    await openStructure(user);

    expect(screen.getByRole('button', { name: 'Move section 1 up' })).toBeDisabled();
    const required = screen.getByRole('switch', { name: 'Required Section 1' });
    expect(required).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getAllByText('Required Section', { selector: 'label' })[0]);
    expect(required).toHaveAttribute('aria-checked', 'false');

    await user.click(screen.getByRole('button', { name: 'Move section 1 down' }));
    expect(screen.getAllByLabelText('Section Name *')[0]).toHaveValue('Objective');
    await user.click(screen.getByRole('button', { name: 'Remove section 4' }));
    expect(screen.getAllByLabelText('Section Name *')).toHaveLength(3);
    expect(mutations.create).not.toHaveBeenCalled();
  });

  it('requires Review and a separate save action after Next before creating a template', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    const { container } = render(<TemplateBuilder onSuccess={onSuccess} />);
    await openStructure(user);

    await act(async () => { fireEvent.submit(container.querySelector('form')); });
    expect(mutations.create).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: 'Review Template' });
    expect(screen.queryByText(/^Mode:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^\d+ steps$/)).not.toBeInTheDocument();
    expect(screen.getByText('A reusable clinical workflow.')).toBeInTheDocument();
    expect(mutations.create).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Create Template' }));
    await waitFor(() => expect(mutations.create).toHaveBeenCalledTimes(1));
    expect(mutations.create).toHaveBeenCalledWith(expect.objectContaining({
      description: 'A reusable clinical workflow.',
      structure: { sections: expect.any(Array) },
    }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });

  it('keeps existing body metadata available to the adapter when editing', async () => {
    const user = userEvent.setup();
    const structure = [{ name: 'Review', type: 'text', required: false }];
    const bodyTemplate = JSON.stringify({ sections: structure, description: 'Existing workflow.', schema_version: 2 });
    render(<TemplateBuilder initialTemplate={{
      id: 'template-edit', title: 'Routine review', description: 'Existing workflow.',
      body_template: bodyTemplate, structure, is_active: true,
    }} />);

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: 'Facility Sharing & Status' });
    expect(screen.getByRole('switch', { name: 'Active Template' })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByText('Active Template', { selector: 'label' }));
    expect(screen.getByRole('switch', { name: 'Active Template' })).toHaveAttribute('aria-checked', 'false');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: 'Template Structure' });
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: 'Review Template' });
    await user.click(screen.getByRole('button', { name: 'Update Template' }));

    await waitFor(() => expect(mutations.update).toHaveBeenCalledWith({
      id: 'template-edit', data: expect.objectContaining({
        body_template: bodyTemplate, description: 'Existing workflow.', is_active: false,
      }),
    }));
  });
});
