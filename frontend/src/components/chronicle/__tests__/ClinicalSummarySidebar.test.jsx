import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ClinicalSummarySidebar, { ProblemsSection } from '../ClinicalSummarySidebar';

vi.mock('@/features/nursing/hooks', () => ({
  useTodayFluidBalance: () => ({ data: null, isLoading: false }),
}));

vi.mock('@/components/billing', () => ({
  InvoiceChronicleCard: () => (
    <section>
      <h3>Billing</h3>
    </section>
  ),
}));

vi.mock('@/components/chronicle/PatientCareTeamCard', () => ({
  PatientCareTeamCompact: () => <section>Care team</section>,
}));

function sectionByHeading(container, heading) {
  return [...container.querySelectorAll('section')]
    .find((section) => within(section).queryByText(heading));
}

describe('ClinicalSummarySidebar', () => {
  it('renders as a natural-height scroll panel inside the page-defined sidebar boundary', () => {
    const { container } = render(
      <ClinicalSummarySidebar
        patient={{ id: 'patient-1' }}
        style={{ maxHeight: 'min(calc(100vh - 5rem), 640px)' }}
      />,
    );

    const sidebar = container.querySelector('aside');

    expect(sidebar).toHaveClass('min-h-0');
    expect(sidebar).toHaveClass('overflow-y-auto');
    expect(sidebar).not.toHaveClass('flex-1');
    expect(sidebar).not.toHaveClass('sticky');
    expect(sidebar).not.toHaveClass('h-screen');
    expect(sidebar).toHaveStyle({ maxHeight: 'min(calc(100vh - 5rem), 640px)' });
  });

  it('renders vital signs in Recent Vitals and lab results in Recent Labs', () => {
    const { container } = render(
      <ClinicalSummarySidebar
        patient={{ id: 'patient-1' }}
        allergies={[]}
        vitals={[
          {
            id: 'temp-vitals-1',
            name: 'Temp',
            value: '37.2',
            unit: '°C',
            timestamp: '2026-05-12T08:40:00Z',
          },
          {
            id: 'hr-vitals-1',
            name: 'HR',
            value: '88',
            unit: 'bpm',
            timestamp: '2026-05-12T08:40:00Z',
          },
        ]}
        labResults={[
          {
            id: 'lab-1',
            name: 'WBC',
            value: '6.1',
            unit: '10^9/L',
            timestamp: '2026-05-12T09:10:00Z',
          },
        ]}
      />,
    );

    const vitalsSection = sectionByHeading(container, 'Recent Vitals');
    const labsSection = sectionByHeading(container, 'Recent Labs');

    expect(within(vitalsSection).getByText('37.2')).toBeInTheDocument();
    expect(within(vitalsSection).getByText('HR (bpm)')).toBeInTheDocument();
    expect(within(vitalsSection).queryByText('WBC')).not.toBeInTheDocument();
    expect(within(labsSection).getByText('WBC')).toBeInTheDocument();
    expect(within(labsSection).getByText('6.1 10^9/L')).toBeInTheDocument();
  });

  it('orders high-value clinical sidebar sections before lower-context panels', () => {
    const { container } = render(
      <ClinicalSummarySidebar
        patient={{ id: 'patient-1', current_admission_id: 'admission-1' }}
        allergies={['Penicillin']}
        vitals={[{ id: 'hr-1', name: 'HR', value: '88', unit: 'bpm' }]}
        problems={[{ id: 'problem-1', label: 'Hypertension' }]}
        medications={[{ id: 'rx-1', medication_name: 'Amlodipine', dose: '5 mg' }]}
        labResults={[{ id: 'lab-1', name: 'WBC', value: '6.1' }]}
      />,
    );

    const headings = [...container.querySelectorAll('h3')].map((heading) => heading.textContent.trim());

    expect(headings).toEqual([
      'Allergies',
      'Recent Vitals',
      'Active Problems',
      'Active Medications',
      'Fluid Balance (Today)',
      'Recent Labs',
      'Billing',
    ]);
  });

  it('does not emit duplicate React key warnings for repeated allergy labels', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      render(
        <ClinicalSummarySidebar
          patient={{ id: 'patient-1' }}
          allergies={[
            { substance: 'Latex', severity: 'severe' },
            { substance: 'Latex', severity: 'severe' },
            { substance: 'Penicillin', severity: 'moderate' },
            { substance: 'Penicillin', severity: 'moderate' },
          ]}
        />,
      );

      expect(screen.getAllByText(/Latex/)).toHaveLength(2);
      expect(screen.getAllByText('Penicillin')).toHaveLength(2);
      expect(
        consoleErrorSpy.mock.calls.some((call) => (
          call.some((argument) => String(argument).includes('Encountered two children with the same key'))
        )),
      ).toBe(false);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});

describe('ProblemsSection', () => {
  it('skips problem rows that do not have a displayable clinical label', () => {
    const { container } = render(
      <ProblemsSection
        problems={[
          { id: 'problem-empty', severity: 'high' },
          { id: 'problem-1', label: 'Hypertension', severity: 'high' },
        ]}
      />,
    );

    expect(screen.getByText('Hypertension')).toBeInTheDocument();
    expect(container.querySelectorAll('li')).toHaveLength(1);
  });
});
