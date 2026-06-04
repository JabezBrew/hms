import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import FluidBalanceTrendsChart from '@/components/nursing/FluidBalanceTrendsChart';

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

afterEach(() => {
  chartMock.instances = [];
});

describe('FluidBalanceTrendsChart', () => {
  it('uses direct item hover for mixed bar and line fluid-balance data', () => {
    render(
      <FluidBalanceTrendsChart
        data={[
          {
            balance: 200,
            dateLabel: 'Jun 4',
            fullDateLabel: 'June 4, 2026',
            intake: 1200,
            output: 1000,
          },
        ]}
      />,
    );

    const option = chartMock.instances[0].option(chartTheme);

    expect(option.tooltip.trigger).toBe('item');
    expect(option.series.some((series) => series.type === 'bar')).toBe(true);
    expect(option.series[0].emphasis.itemStyle.color).toBe(option.series[0].itemStyle.color);
    expect(option.series[0].emphasis.itemStyle.opacity).toBe(1);
    expect(option.tooltip.formatter({
      color: '#123',
      data: { record: option.series[0].data[0].record },
      seriesName: 'Intake',
      value: 1200,
    })).toContain('1200 mL');
  });
});
