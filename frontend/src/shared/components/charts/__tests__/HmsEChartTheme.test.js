import { describe, expect, it } from 'vitest';
import { stabilizeChartOption } from '../HmsEChartTheme';

describe('stabilizeChartOption', () => {
  it('keeps line geometry visible through emphasis blur and select states', () => {
    const option = {
      legend: { show: true },
      series: [{
        data: [1, 2, 3],
        emphasis: { focus: 'series', lineStyle: { width: 4 } },
        lineStyle: { color: '#15803d', width: 2 },
        name: 'General Ward',
        type: 'line',
      }],
    };

    const stableOption = stabilizeChartOption(option);
    const [series] = stableOption.series;

    expect(series.emphasis.focus).toBe('none');
    expect(series.emphasis.lineStyle).toEqual({
      color: '#15803d',
      opacity: 1,
      width: 4,
    });
    expect(series.blur.focus).toBe('none');
    expect(series.blur.lineStyle).toEqual({
      color: '#15803d',
      opacity: 1,
      width: 2,
    });
    expect(series.select.lineStyle.opacity).toBe(1);
    expect(option.series[0].emphasis.focus).toBe('series');
  });

  it('keeps styled data items visible when ECharts activates item hover states', () => {
    const option = {
      series: {
        data: [{
          itemStyle: { borderRadius: [4, 4, 0, 0], color: '#d97706' },
          value: 46.9,
        }],
        name: 'Occupancy',
        type: 'bar',
      },
    };

    const stableOption = stabilizeChartOption(option);
    const [point] = stableOption.series.data;

    expect(point.emphasis.itemStyle).toEqual({
      borderRadius: [4, 4, 0, 0],
      color: '#d97706',
      opacity: 1,
    });
    expect(point.blur.itemStyle).toEqual(point.emphasis.itemStyle);
    expect(point.select.itemStyle).toEqual(point.emphasis.itemStyle);
  });

  it('does not synthesize area hover styles for plain line charts', () => {
    const stableOption = stabilizeChartOption({
      series: [{
        data: [1, 2],
        lineStyle: { color: '#0f766e' },
        type: 'line',
      }],
    });

    expect(stableOption.series[0].emphasis.areaStyle).toBeUndefined();
    expect(stableOption.series[0].blur.areaStyle).toBeUndefined();
  });
});
