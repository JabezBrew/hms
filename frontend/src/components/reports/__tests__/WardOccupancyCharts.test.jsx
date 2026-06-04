import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AdmissionsPanel,
  LengthOfStayPanel,
  OccupancyTrendsPanel,
  UtilizationPanel,
} from '@/components/reports/WardOccupancyCharts';

const chartMock = vi.hoisted(() => ({
  instances: [],
}));

vi.mock('@/shared/components/charts/HmsEChart', () => ({
  HmsEChart: (props) => {
    chartMock.instances.push(props);
    return <img alt={props.ariaLabel} />;
  },
}));

const chartTheme = {
  axis: '#78716c',
  background: 'transparent',
  border: '#e7e5e4',
  card: '#ffffff',
  foreground: '#292524',
  grid: '#e7e5e4',
  muted: '#78716c',
  palette: ['#d97706', '#0f766e', '#be123c', '#0369a1', '#7c3aed', '#15803d'],
};

const utilizationData = [
  {
    avg_los: 4.5,
    bed_days: 90,
    occupied_beds_count: 15,
    occupancy_rate: 75,
    total_beds: 20,
    turnover_rate: 2.5,
    ward: 'Medical Ward',
  },
  {
    occupied_beds_count: 7,
    occupancy_rate: 35,
    total_beds: 20,
    turnover_rate: 1.1,
    ward: 'Surgical Ward',
  },
];

const admissionsByWard = [
  {
    admissions: 12,
    discharges: 8,
    transfers: 2,
    ward: 'Medical Ward',
  },
];

const lengthOfStayData = [
  {
    count: 4,
    percentage: 40,
    range: '0-2 days',
  },
];

const occupancyData = [
  {
    'Medical Ward': 76,
    Overall: 68,
    date: '2026-06-04',
  },
];

afterEach(() => {
  chartMock.instances = [];
});

function resolveOption(instance) {
  return instance.option(chartTheme);
}

describe('WardOccupancyCharts', () => {
  it('keeps line-only trend charts on axis hover for time/category comparison', () => {
    render(
      <OccupancyTrendsPanel
        analyticsMeta={{ mode: 'historical' }}
        occupancyData={occupancyData}
        utilizationData={utilizationData}
        wards={[{ id: 'ward-1', name: 'Medical Ward' }]}
        selectedWard="all"
      />,
    );

    const option = resolveOption(chartMock.instances[0]);

    expect(option.series.every((series) => series.type === 'line')).toBe(true);
    expect(option.tooltip.trigger).toBe('axis');
  });

  it('uses direct item hover for ward snapshot bars and formats the active bar value', () => {
    render(
      <OccupancyTrendsPanel
        analyticsMeta={{ mode: 'rust_v2_snapshot' }}
        utilizationData={utilizationData}
        wards={[]}
        selectedWard="all"
      />,
    );

    const option = resolveOption(chartMock.instances[0]);
    const barData = option.series[0].data[0];

    expect(option.tooltip.trigger).toBe('item');
    expect(barData.value).toBe(75);
    expect(barData.emphasis.itemStyle.color).toBe(barData.itemStyle.color);
    expect(barData.emphasis.itemStyle.opacity).toBe(1);

    const directHoverHtml = option.tooltip.formatter({ data: barData });
    expect(directHoverHtml).toContain('Medical Ward');
    expect(directHoverHtml).toContain('75%');
    expect(directHoverHtml).toContain('15 / 20');

    const axisPayloadHtml = option.tooltip.formatter([{ data: barData }]);
    expect(axisPayloadHtml).toContain('Medical Ward');
    expect(axisPayloadHtml).toContain('75%');
  });

  it('uses direct item hover for snapshot metric bars and keeps the metric value available', () => {
    render(
      <UtilizationPanel
        analyticsMeta={{ mode: 'rust_v2_snapshot' }}
        utilizationData={utilizationData}
      />,
    );

    const turnoverChart = chartMock.instances.find(
      (instance) => instance.ariaLabel === 'Turnover rate by ward chart',
    );
    const option = resolveOption(turnoverChart);
    const barData = option.series[0].data[0];

    expect(option.tooltip.trigger).toBe('item');
    expect(barData.value).toBe(2.5);
    expect(barData.emphasis.itemStyle.color).toBe(barData.itemStyle.color);
    expect(barData.emphasis.itemStyle.opacity).toBe(1);

    const hoverHtml = option.tooltip.formatter({ data: barData });
    expect(hoverHtml).toContain('Medical Ward');
    expect(hoverHtml).toContain('Turnover Rate');
    expect(hoverHtml).toContain('2.5');
  });

  it('uses direct item hover for LOS distribution and admissions bar charts', () => {
    render(
      <LengthOfStayPanel
        analyticsMeta={{ mode: 'rust_v2_snapshot' }}
        lengthOfStayData={lengthOfStayData}
        utilizationData={utilizationData}
      />,
    );
    render(
      <AdmissionsPanel
        admissionsByWard={admissionsByWard}
        analyticsMeta={{ mode: 'rust_v2_snapshot' }}
        wards={[{ name: 'Medical Ward', total_beds: 20 }]}
      />,
    );

    const losDistribution = chartMock.instances.find(
      (instance) => instance.ariaLabel === 'Length of stay distribution chart',
    );
    const admissionsChart = chartMock.instances.find(
      (instance) => instance.ariaLabel === 'Admissions discharges and transfers by ward chart',
    );

    const losOption = resolveOption(losDistribution);
    const admissionsOption = resolveOption(admissionsChart);

    expect(losOption.tooltip.trigger).toBe('item');
    expect(admissionsOption.tooltip.trigger).toBe('item');
    expect(losOption.series[0].emphasis.itemStyle.color).toBe(losOption.series[0].itemStyle.color);
    expect(admissionsOption.series[0].emphasis.itemStyle.color).toBe(admissionsOption.series[0].itemStyle.color);
    expect(losOption.tooltip.formatter({ color: '#123', seriesName: 'Patients', value: 4, name: '0-2 days' }))
      .toContain('4');
    expect(admissionsOption.tooltip.formatter({ color: '#123', seriesName: 'Admissions', value: 12, name: 'Medical Ward' }))
      .toContain('12');
  });
});
