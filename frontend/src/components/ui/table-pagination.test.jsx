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

  it('shows exact totals without page numbering when random access is unsupported', () => {
    render(
      <TablePagination
        currentPage={1}
        totalCount={2700}
        pageSize={25}
        countExact
        canJumpToPage={false}
        hasNextPage
        hasPrevPage={false}
        onPageChange={vi.fn()}
        itemLabel="patients"
      />,
    );

    expect(screen.getByText((_, element) => (
      element?.tagName === 'P'
      && element.textContent?.includes('Showing 1 to 25 of 2700 patients')
    ))).toBeInTheDocument();
    expect(screen.queryByText(/Page 1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/2700\+/)).not.toBeInTheDocument();
  });

  it('keeps page controls by default for exact-count random-access tables even with availability overrides', () => {
    render(
      <TablePagination
        currentPage={2}
        totalCount={60}
        pageSize={25}
        countExact
        totalPages={3}
        hasNextPage
        hasPrevPage
        onPageChange={vi.fn()}
        itemLabel="logs"
      />,
    );

    expect(screen.getByText((_, element) => (
      element?.tagName === 'SPAN'
      && element.textContent?.includes('Page 2 of 3')
    ))).toBeInTheDocument();
    expect(screen.getByLabelText('Go to first page')).toBeInTheDocument();
    expect(screen.getByLabelText('Go to last page')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to page' })).toBeInTheDocument();
  });

  it('does not render lower-bound totals as plus-suffixed totals', () => {
    render(
      <TablePagination
        currentPage={1}
        totalCount={25}
        pageSize={25}
        countExact={false}
        canJumpToPage={false}
        hasNextPage
        hasPrevPage={false}
        onPageChange={vi.fn()}
        itemLabel="patients"
      />,
    );

    expect(screen.getByText((_, element) => (
      element?.tagName === 'P'
      && element.textContent?.includes('Showing 1 to 25 patients')
      && element.textContent?.includes('More results available')
    ))).toBeInTheDocument();
    expect(screen.queryByText(/25\+/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Page 1/)).not.toBeInTheDocument();
  });

  it('shows the final known total on a lower-bound cursor list when no next page remains', () => {
    render(
      <TablePagination
        currentPage={4}
        totalCount={83}
        pageSize={25}
        countExact={false}
        canJumpToPage={false}
        hasNextPage={false}
        hasPrevPage
        onPageChange={vi.fn()}
        itemLabel="patients"
      />,
    );

    expect(screen.getByText((_, element) => (
      element?.tagName === 'P'
      && element.textContent?.includes('Showing 76 to 83 of 83 patients')
    ))).toBeInTheDocument();
    expect(screen.queryByText(/83\+/)).not.toBeInTheDocument();
    expect(screen.queryByText(/More results available/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Page 4/)).not.toBeInTheDocument();
  });
});
