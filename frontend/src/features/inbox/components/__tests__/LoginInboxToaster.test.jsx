import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { StrictMode } from 'react';

vi.mock('sonner', () => {
  const fn = vi.fn();
  fn.warning = vi.fn();
  fn.info = vi.fn();
  return { toast: fn };
});

vi.mock('@/lib/auth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/features/inbox/hooks', () => ({
  useInboxItems: vi.fn(),
  useMarkInboxRead: vi.fn(),
}));

import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import { useInboxItems, useMarkInboxRead } from '@/features/inbox/hooks';
import LoginInboxToaster from '../LoginInboxToaster';

function CurrentLocation() {
  const location = useLocation();
  return <output data-testid="current-location">{location.pathname}</output>;
}

const renderToaster = () =>
  render(
    <MemoryRouter>
      <LoginInboxToaster />
    </MemoryRouter>,
  );

const item = (overrides = {}) => ({
  id: overrides.id || crypto.randomUUID(),
  source_type: 'lab_result',
  source_id: crypto.randomUUID(),
  title: 'Lab Results Ready',
  summary: 'CBC completed for Jane Doe',
  action_url: '/patients/123?action=view_lab_results',
  priority: 'normal',
  status: 'unread',
  is_action_required: true,
  is_read: false,
  occurred_at: '2026-05-04T10:00:00Z',
  ...overrides,
});

describe('LoginInboxToaster', () => {
  let mutate;

  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
    useAuth.mockReturnValue({ isAuthenticated: true });
    mutate = vi.fn();
    useMarkInboxRead.mockReturnValue({ mutate });
  });

  it('does nothing when pending-login flag is not set', () => {
    useInboxItems.mockReturnValue({ data: { results: [item()], count: 1 } });

    renderToaster();

    expect(toast).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('does nothing when there are no unread items', () => {
    sessionStorage.setItem('hms.pendingLoginToast', '1');
    useInboxItems.mockReturnValue({ data: { results: [], count: 0 } });

    renderToaster();

    expect(toast).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('fires a single summary toast when no urgent items', () => {
    sessionStorage.setItem('hms.pendingLoginToast', '1');
    useInboxItems.mockReturnValue({
      data: {
        results: [
          item({ title: 'Routine 1', priority: 'routine' }),
          item({ title: 'Normal 1', priority: 'normal' }),
        ],
        count: 9,
      },
    });

    renderToaster();

    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toBe('9 unread');
  });

  it('shows the login summary and urgent notification once under StrictMode replay', () => {
    sessionStorage.setItem('hms.pendingLoginToast', '1');
    const urgent = item({ id: 'strict-urgent', title: 'Urgent review ready', priority: 'urgent' });
    useInboxItems.mockImplementation((_params, { enabled }) => ({
      data: enabled ? { results: [urgent], count: 1 } : undefined,
    }));

    const view = render(
      <StrictMode>
        <MemoryRouter><LoginInboxToaster /></MemoryRouter>
      </StrictMode>,
    );

    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(toast.warning.mock.calls[0][0]).toBe('Urgent review ready');
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toBe('1 unread • 1 urgent');
    expect(sessionStorage.getItem('hms.pendingLoginToast')).toBeNull();
    expect(mutate).not.toHaveBeenCalled();

    view.unmount();
    render(<StrictMode><MemoryRouter><LoginInboxToaster /></MemoryRouter></StrictMode>);
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('retains the committed login request until the unread query finishes', () => {
    sessionStorage.setItem('hms.pendingLoginToast', '1');
    let inboxData;
    useInboxItems.mockImplementation((_params, { enabled }) => ({ data: enabled ? inboxData : undefined }));
    const tree = <StrictMode><MemoryRouter><LoginInboxToaster /></MemoryRouter></StrictMode>;
    const view = render(tree);
    expect(sessionStorage.getItem('hms.pendingLoginToast')).toBeNull();
    expect(toast).not.toHaveBeenCalled();

    inboxData = { results: [item({ priority: 'urgent' })], count: 1 };
    view.rerender(<StrictMode><MemoryRouter><LoginInboxToaster /></MemoryRouter></StrictMode>);
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledTimes(1);
    view.rerender(<StrictMode><MemoryRouter><LoginInboxToaster /></MemoryRouter></StrictMode>);
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('fires up to 3 urgent toasts + summary, newest first', () => {
    sessionStorage.setItem('hms.pendingLoginToast', '1');
    useInboxItems.mockReturnValue({
      data: {
        results: [
          item({ title: 'U Old', priority: 'urgent', occurred_at: '2026-05-04T01:00:00Z' }),
          item({ title: 'U Mid', priority: 'urgent', occurred_at: '2026-05-04T05:00:00Z' }),
          item({ title: 'U New', priority: 'emergency', occurred_at: '2026-05-04T09:00:00Z' }),
          item({ title: 'U Extra', priority: 'urgent', occurred_at: '2026-05-04T02:00:00Z' }),
          item({ title: 'Routine', priority: 'routine' }),
        ],
        count: 12,
      },
    });

    renderToaster();

    expect(toast.warning).toHaveBeenCalledTimes(3);
    expect(toast.warning.mock.calls[0][0]).toBe('U New');
    expect(toast.warning.mock.calls[1][0]).toBe('U Mid');
    expect(toast.warning.mock.calls[2][0]).toBe('U Extra');

    // Summary fires once
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toBe('12 unread • 4 urgent');
  });

  it('omits PHI summary from urgent toasts (title only, no description)', () => {
    sessionStorage.setItem('hms.pendingLoginToast', '1');
    useInboxItems.mockReturnValue({
      data: {
        results: [
          item({ title: 'CRITICAL Lab', priority: 'urgent', summary: 'Potassium for John Smith' }),
        ],
        count: 1,
      },
    });

    renderToaster();

    const opts = toast.warning.mock.calls[0][1];
    expect(opts.description).toBeUndefined();
  });

  it('View click calls markRead then navigates', () => {
    sessionStorage.setItem('hms.pendingLoginToast', '1');
    const u = item({ id: 'abc', title: 'Urgent', priority: 'urgent', action_url: '/patients/x' });
    useInboxItems.mockReturnValue({ data: { results: [u], count: 1 } });

    render(<MemoryRouter><LoginInboxToaster /><CurrentLocation /></MemoryRouter>);

    const opts = toast.warning.mock.calls[0][1];
    act(() => {
      opts.action.onClick();
    });

    expect(mutate).toHaveBeenCalledWith('abc');
    expect(screen.getByTestId('current-location')).toHaveTextContent('/patients/x');
  });

  it('consumes the flag so a remount does not retoast', () => {
    sessionStorage.setItem('hms.pendingLoginToast', '1');
    useInboxItems.mockReturnValue({ data: { results: [item()], count: 3 } });

    const { unmount } = renderToaster();
    expect(toast).toHaveBeenCalledTimes(1);

    unmount();
    renderToaster();

    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('skips when unauthenticated', () => {
    sessionStorage.setItem('hms.pendingLoginToast', '1');
    useAuth.mockReturnValue({ isAuthenticated: false });
    useInboxItems.mockReturnValue({ data: undefined });

    renderToaster();

    expect(toast).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });
});
