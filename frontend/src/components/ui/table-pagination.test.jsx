import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TablePagination } from './table-pagination';

describe('TablePagination', () => {
  it('stays hidden for an empty first page', () => {
    const { container } = render(
      <TablePagination
        currentPage={1}
        totalCount={0}
        pageSize={25}
        onPageChange={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('keeps recovery controls visible for an empty later page', async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();

    render(
      <TablePagination
        currentPage={3}
        totalCount={0}
        pageSize={25}
        onPageChange={onPageChange}
      />,
    );

    expect(screen.getByText(/Showing/i)).toBeInTheDocument();
    await user.click(screen.getByLabelText('Go to previous page'));

    expect(onPageChange).toHaveBeenCalledWith(2);
  });
});
