import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ClinicalSummarySidebar, { ProblemsSection } from '../ClinicalSummarySidebar';

vi.mock('@/features/nursing/hooks', () => ({
  useTodayFluidBalance: () => ({ data: null, isLoading: false }),
}));

vi.mock('@/components/billing', () => ({
  InvoiceChronicleCard: () => null,
}));

vi.mock('@/components/chronicle/PatientCareTeamCard', () => ({
  PatientCareTeamCompact: () => <section>Care team</section>,
}));

function sectionByHeading(container, heading) {
  return [...container.querySelectorAll('section')]
    .find((section) => within(section).queryByText(heading));
}

describe('ClinicalSummarySidebar', () => {
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
        patient={{ id: 'patient-1' }}
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
      'Recent Labs',
    ]);
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
