import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WaitlistRows } from '../AppointmentScheduleSections';

describe('WaitlistRows', () => {
  it('marks the Omni search target waitlist entry', () => {
    render(
      <WaitlistRows
        entries={[
          {
            id: 'wait-1',
            patient_name: 'First Patient',
            priority: 'routine',
            status: 'waiting',
            service: 'Medicine',
            patient_mrn: 'MRN-001',
          },
          {
            id: 'wait-2',
            patient_name: 'Target Patient',
            priority: 'urgent',
            status: 'offered',
            service: 'Surgery',
            patient_mrn: 'MRN-002',
          },
        ]}
        isLoading={false}
        onPromote={vi.fn()}
        targetEntryId="wait-2"
      />
    );

    const target = document.querySelector('[data-omni-target="true"]');
    expect(target).toBeInTheDocument();
    expect(target).toHaveTextContent('Target Patient');
    expect(screen.getByText('First Patient').closest('[data-omni-target]')).toBeNull();
  });
});
