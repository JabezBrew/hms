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
