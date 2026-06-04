import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import LabOrdersPage from '../LabOrdersPage';

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { role: 'admin' } }),
}));

vi.mock('@/hooks/use-debounce', () => ({
  useDebounce: (value) => value,
}));

vi.mock('@/shared/hooks/useAfterInitialPaint', () => ({
  useAfterInitialPaint: () => true,
}));

vi.mock('@/features/staff/hooks', () => ({
  usePractitioners: () => ({ data: [] }),
}));

vi.mock('@/features/laboratory/hooks', () => ({
  usePaginatedLabOrders: () => ({
    data: { count: 0, page: 1, results: [] },
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/components/laboratory', () => ({
  LabOrderDetailSlideOver: ({ open, orderId }) =>
    open ? <div data-testid="lab-order-target">{orderId}</div> : null,
}));

describe('LabOrdersPage deep links', () => {
  it('opens the order detail slide-over from an order query param', () => {
    render(
      <MemoryRouter initialEntries={['/laboratory/orders?order=order-target']}>
        <LabOrdersPage />
      </MemoryRouter>
    );

    expect(screen.getByTestId('lab-order-target')).toHaveTextContent('order-target');
  });
});
