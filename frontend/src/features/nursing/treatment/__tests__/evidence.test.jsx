import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CourseBalances } from '../CourseBalances';
import { CourseReceipt } from '../CourseReceipt';
import { counts, command, receipt } from './fixtures';
afterEach(cleanup);
it('shows complete actual dose denominators and physical issue separately, without inventing bedside stock or days', () => {
  render(<CourseBalances counts={counts({ generated_scheduled_doses: 3, requested_prn_doses: 2 })} />);
  for (const text of ['Generated scheduled doses', 'Requested as-needed doses', 'Supplied doses', 'Given doses', '4 tablet', 'Not estimated']) expect(screen.getByText(text)).toBeInTheDocument();
  expect(screen.getByText(/do not establish bedside stock or a stock return/)).toBeInTheDocument();
});
it.each(['missing_evidence', 'mixed_units', 'quantity_overflow'])('leaves the complete physical total unknown for %s', (reason) => {
  render(<CourseBalances counts={counts({ issued_stock_quantity: null, issued_stock_unit: null, issued_stock_unrecorded_doses: reason === 'missing_evidence' ? 1 : 0, stock_total_unavailable_reason: reason })} />); expect(screen.getByText('Not recorded as a complete stock total')).toBeInTheDocument(); expect(screen.queryByText('0 tablet')).not.toBeInTheDocument(); expect(screen.getByText('Not estimated')).toBeInTheDocument();
});
it('labels a local stop and immutable source status independently and offers original membership review only', () => {
  const review = vi.fn(); render(<CourseReceipt receipt={receipt(command())} onReviewMembership={review} />); expect(screen.getByText(/active · unchanged by this admission-local stop/)).toBeInTheDocument(); expect(screen.getByText(/No stock was returned/)).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Review original affected dose membership' })); expect(review).toHaveBeenCalledOnce(); expect(screen.queryByRole('button', { name: 'Stop this admission course' })).not.toBeInTheDocument();
});
it('keeps original created membership paged and distinct from live outcomes or stock availability', () => {
  const saved = receipt(command('window')); saved.result.created_doses = Array.from({ length: 27 }, (_, index) => ({ ...saved.result.created_doses[0], id: `13131313-1313-4313-8313-${String(100 + index).padStart(12, '0')}`, dose_sequence: index + 4, scheduled_at: new Date(Date.parse(saved.result.previous_scheduled_through) + index * 12 * 3600000).toISOString() })); saved.result.created_dose_count = 27; saved.result.scheduled_through = '2030-06-01T06:00:00Z'; render(<CourseReceipt receipt={saved} />); expect(screen.getAllByRole('row')).toHaveLength(26); expect(screen.getByText(/did not issue physical stock or record a Given dose/)).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Next saved doses' })); expect(screen.getAllByRole('row')).toHaveLength(3); expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
});
