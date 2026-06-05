import { useEffect, useState } from 'react';

const DEFAULT_THEME = {
  axis: '#78716c',
  background: 'transparent',
  border: '#e7e5e4',
  card: '#ffffff',
  foreground: '#292524',
  grid: '#e7e5e4',
  muted: '#78716c',
  palette: ['#d97706', '#0f766e', '#be123c', '#0369a1', '#7c3aed', '#15803d'],
};

function cssVar(name, fallback) {
  if (typeof window === 'undefined') return fallback;

  const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export function useChronicleChartTheme() {
  const [theme, setTheme] = useState(DEFAULT_THEME);

  useEffect(() => {
    const readTheme = () => {
      setTheme({
        axis: cssVar('--muted-foreground', DEFAULT_THEME.axis),
        background: 'transparent',
        border: cssVar('--border', DEFAULT_THEME.border),
        card: cssVar('--popover', DEFAULT_THEME.card),
        foreground: cssVar('--foreground', DEFAULT_THEME.foreground),
        grid: cssVar('--border', DEFAULT_THEME.grid),
        muted: cssVar('--muted-foreground', DEFAULT_THEME.muted),
        palette: [
          cssVar('--chart-1', DEFAULT_THEME.palette[0]),
          cssVar('--chart-4', DEFAULT_THEME.palette[3]),
          cssVar('--chart-3', DEFAULT_THEME.palette[2]),
          cssVar('--chart-2', DEFAULT_THEME.palette[1]),
          cssVar('--chart-5', DEFAULT_THEME.palette[4]),
          DEFAULT_THEME.palette[5],
        ],
      });
    };

    readTheme();
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener?.('change', readTheme);
    return () => media?.removeEventListener?.('change', readTheme);
  }, []);

  return theme;
}

export function escapeChartTooltipHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]));
}

export function getChartTooltipParams(params) {
  return Array.isArray(params) ? params.filter(Boolean) : [params].filter(Boolean);
}

export function getChartTooltipDataParam(params) {
  const list = getChartTooltipParams(params);
  return list.find((param) => param?.data?.record) || list[0] || null;
}

export function createItemTooltip(baseTooltip, overrides = {}) {
  return {
    ...baseTooltip,
    ...overrides,
    trigger: 'item',
  };
}

export function createStableBarStyle({ borderRadius, color, opacity = 1 }) {
  const itemStyle = { borderRadius, color, opacity };
  return {
    emphasis: {
      itemStyle: { ...itemStyle },
    },
    itemStyle,
  };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function createStableStateStyle(normalStyle, stateStyle) {
  const normal = isObject(normalStyle) ? normalStyle : {};
  const state = isObject(stateStyle) ? stateStyle : {};
  return {
    ...normal,
    ...state,
    opacity: state.opacity ?? normal.opacity ?? 1,
  };
}

function createStableChartState(series, state) {
  const resolvedState = isObject(state) ? state : {};
  const stableState = {
    ...resolvedState,
    focus: 'none',
  };

  if (
    ['bar', 'line', 'pie', 'scatter'].includes(series?.type) ||
    isObject(series?.itemStyle) ||
    isObject(resolvedState.itemStyle)
  ) {
    stableState.itemStyle = createStableStateStyle(series?.itemStyle, resolvedState.itemStyle);
  }

  if (series?.type === 'line' || isObject(series?.lineStyle) || isObject(resolvedState.lineStyle)) {
    stableState.lineStyle = createStableStateStyle(series?.lineStyle, resolvedState.lineStyle);
  }

  if (isObject(series?.areaStyle) || isObject(resolvedState.areaStyle)) {
    stableState.areaStyle = createStableStateStyle(series?.areaStyle, resolvedState.areaStyle);
  }

  return stableState;
}

function stabilizeDataItemHoverStates(item) {
  if (!isObject(item)) return item;

  return {
    ...item,
    blur: createStableChartState(item, item.blur),
    emphasis: createStableChartState(item, item.emphasis),
    select: createStableChartState(item, item.select),
  };
}

export function stabilizeChartOption(option) {
  if (!isObject(option)) return option;

  const normalizeSeries = (series) => {
    if (!isObject(series)) return series;

    return {
      ...series,
      blur: createStableChartState(series, series.blur),
      data: Array.isArray(series.data)
        ? series.data.map(stabilizeDataItemHoverStates)
        : series.data,
      emphasis: createStableChartState(series, series.emphasis),
      select: createStableChartState(series, series.select),
    };
  };

  return {
    ...option,
    series: Array.isArray(option.series)
      ? option.series.map(normalizeSeries)
      : normalizeSeries(option.series),
  };
}

export function createBaseChartOption(theme) {
  return {
    backgroundColor: theme.background,
    color: theme.palette,
    grid: {
      containLabel: true,
      left: 8,
      right: 20,
      top: 24,
      bottom: 18,
    },
    legend: {
      bottom: 0,
      icon: 'roundRect',
      itemGap: 18,
      itemHeight: 8,
      itemWidth: 16,
      textStyle: {
        color: theme.muted,
        fontFamily: 'var(--font-ibm-plex-mono)',
        fontSize: 11,
      },
    },
    tooltip: {
      appendToBody: true,
      backgroundColor: theme.card,
      borderColor: theme.border,
      borderRadius: 8,
      borderWidth: 1,
      confine: true,
      padding: [10, 12],
      textStyle: {
        color: theme.foreground,
        fontFamily: 'var(--font-ibm-plex-mono)',
        fontSize: 12,
      },
      trigger: 'axis',
    },
    xAxis: {
      axisLabel: {
        color: theme.muted,
        fontFamily: 'var(--font-ibm-plex-mono)',
        fontSize: 11,
        hideOverlap: true,
      },
      axisLine: { lineStyle: { color: theme.axis } },
      axisTick: { show: false },
    },
    yAxis: {
      axisLabel: {
        color: theme.muted,
        fontFamily: 'var(--font-ibm-plex-mono)',
        fontSize: 11,
      },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: {
        lineStyle: {
          color: theme.grid,
          opacity: 0.8,
          type: 'dashed',
        },
      },
    },
  };
}
