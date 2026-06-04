import { useEffect, useMemo, useRef } from 'react';
import { init, use as registerEChartsModules } from 'echarts/core';
import { install as BarChart } from 'echarts/lib/chart/bar/install.js';
import { install as LineChart } from 'echarts/lib/chart/line/install.js';
import { install as GridSimpleComponent } from 'echarts/lib/component/grid/installSimple.js';
import { install as TooltipComponent } from 'echarts/lib/component/tooltip/install.js';
import { install as CanvasRenderer } from 'echarts/lib/renderer/installCanvasRenderer.js';
import { cn } from '@/lib/utils';
import { useChronicleChartTheme } from './HmsEChartTheme';

registerEChartsModules([
  BarChart,
  CanvasRenderer,
  GridSimpleComponent,
  LineChart,
  TooltipComponent,
]);

function getSeriesColor(series, palette, index) {
  const color = series?.itemStyle?.color || series?.lineStyle?.color || palette?.[index];
  return typeof color === 'string' ? color : palette?.[index] || 'currentColor';
}

export function HmsEChart({
  ariaLabel,
  className,
  height = 320,
  option,
  renderer = 'canvas',
}) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const theme = useChronicleChartTheme();
  const resolvedOption = useMemo(
    () => (typeof option === 'function' ? option(theme) : option),
    [option, theme],
  );
  const chartOption = useMemo(() => {
    if (!resolvedOption) return resolvedOption;

    const { legend: _legend, ...optionWithoutLegend } = resolvedOption;
    return optionWithoutLegend;
  }, [resolvedOption]);
  const legendItems = useMemo(() => {
    if (!resolvedOption?.legend?.show) return [];

    const series = Array.isArray(resolvedOption.series)
      ? resolvedOption.series
      : [resolvedOption.series].filter(Boolean);

    return series
      .filter((entry) => entry?.name && !entry.silent)
      .map((entry, index) => ({
        color: getSeriesColor(entry, resolvedOption.color, index),
        name: entry.name,
      }));
  }, [resolvedOption]);

  useEffect(() => {
    if (!containerRef.current) return undefined;

    chartRef.current = init(containerRef.current, null, { renderer });
    return () => {
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, [renderer]);

  useEffect(() => {
    if (!chartRef.current || !chartOption) return;
    chartRef.current.setOption(chartOption, { lazyUpdate: true, notMerge: true });
  }, [chartOption]);

  useEffect(() => {
    if (!containerRef.current || !chartRef.current) return undefined;

    if (typeof ResizeObserver === 'undefined') {
      const handleResize = () => chartRef.current?.resize();
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }

    const observer = new ResizeObserver(() => {
      chartRef.current?.resize();
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={cn('w-full', className)}>
      <div
        ref={containerRef}
        aria-label={ariaLabel}
        className="w-full"
        role="img"
        style={{ height }}
      />
      {legendItems.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          {legendItems.map((item) => (
            <span
              key={item.name}
              className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground"
            >
              <span
                aria-hidden="true"
                className="h-2 w-3 rounded-sm"
                style={{ backgroundColor: item.color }}
              />
              {item.name}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
