import format from 'date-fns/format';

function csvCell(value) {
  const text = String(value ?? '');
  const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}

function isUnavailableMetric(analyticsMeta, metric) {
  return analyticsMeta?.unavailable_metrics?.includes(metric) || false;
}

function csvMetric(value, unavailable = false) {
  if (unavailable || value === null || value === undefined || value === '') {
    return 'Not available';
  }

  return value;
}

function trendLabelForWard(day, ward) {
  return day?.__wardLabels?.[ward.id] || ward.name;
}

function trendValueForWard(day, ward) {
  return csvMetric(day?.[trendLabelForWard(day, ward)]);
}
function trendColumns(data, wards) {
  const columns = new Set(wards.map(ward => trendLabelForWard(data[0], ward)));
  data.forEach(day => Object.keys(day).forEach(key => { if (key !== 'date' && key !== 'Overall' && !key.startsWith('__')) columns.add(key); }));
  return [...columns];
}

export function buildWardOccupancyCsv({
  admissionsByWard,
  analyticsMeta,
  dateRange,
  facilityEpisodeTotals,
  occupancyData,
  selectedWard,
  utilizationData,
  wards,
}) {
  const columns = trendColumns(occupancyData, wards);
  const lines = [
    'Ward Occupancy Report',
    `Date Range: ${format(dateRange.start, 'MMM dd, yyyy')} - ${format(dateRange.end, 'MMM dd, yyyy')}`,
    ...(analyticsMeta?.mode === 'rust_v2_snapshot'
      ? ['Mode: Rust V2 live capacity snapshot; historical aggregate analytics unavailable']
      : []),
    ...(analyticsMeta?.mode === 'rust_v2_aggregates'
      ? ['Mode: Rust V2 ward analytics aggregates']
      : []),
    ...(analyticsMeta?.occupancy_basis === 'known_placement_intervals'
      ? ['Occupancy basis: recorded placement intervals; bed days are known-only', 'Capacity basis: current active ward nonclosed beds', ...(analyticsMeta.observed_through ? [`Occupancy measured through: ${analyticsMeta.observed_through}`, 'No future occupancy extrapolation; full requested-range denominator'] : []), `Placement attribution: ${analyticsMeta.placement_attribution}`, `Partial metrics: ${(analyticsMeta.partial_metrics || []).join('; ')}`]
      : []),
    '',
    'Occupancy Trends',
  ];

  if (selectedWard === 'all') {
    lines.push(['Date', ...columns, 'Overall'].map(csvCell).join(','));
  } else {
    const ward = wards.find((item) => item.id === selectedWard);
    const firstDay = occupancyData[0] || {};
    lines.push(['Date', ward ? trendLabelForWard(firstDay, ward) : 'Ward'].map(csvCell).join(','));
  }

  occupancyData.forEach((day) => {
    if (selectedWard === 'all') {
      lines.push([day.date, ...columns.map(label => csvMetric(day[label])), csvMetric(day.Overall)].map(csvCell).join(','));
      return;
    }

    const ward = wards.find((item) => item.id === selectedWard);
    lines.push([day.date, ward ? trendValueForWard(day, ward) : 'Not available'].map(csvCell).join(','));
  });

  lines.push(
    '',
    'Ward Utilization',
    ['Ward', 'Occupancy Rate (%)', 'Occupied Beds', 'Total Beds', 'Turnover Rate', 'Avg LOS (days)', 'Bed Days'].map(csvCell).join(',')
  );
  utilizationData.forEach((ward) => {
    lines.push([
      ward.ward,
      csvMetric(ward.occupancy_rate),
      csvMetric(ward.occupied_beds_count),
      csvMetric(ward.total_beds),
      csvMetric(ward.turnover_rate, isUnavailableMetric(analyticsMeta, 'turnover_rate')),
      csvMetric(ward.avg_los, isUnavailableMetric(analyticsMeta, 'avg_los') || isUnavailableMetric(analyticsMeta, 'length_of_stay')),
      csvMetric(ward.bed_days, isUnavailableMetric(analyticsMeta, 'bed_days')),
    ].map(csvCell).join(','));
  });

  lines.push(
    '',
    'Admissions, Discharges, and Transfers',
    ['Ward', 'Admissions', 'Discharges', 'Transfers'].map(csvCell).join(',')
  );
  admissionsByWard.forEach((ward) => {
    lines.push([
      ward.ward,
      csvMetric(ward.admissions),
      csvMetric(ward.discharges),
      csvMetric(ward.transfers, isUnavailableMetric(analyticsMeta, 'transfers')),
    ].map(csvCell).join(','));
  });

  if (facilityEpisodeTotals) lines.push('', 'Original Facility Episode Totals', ['Admissions', 'Discharges'].map(csvCell).join(','), [csvMetric(facilityEpisodeTotals.admissions), csvMetric(facilityEpisodeTotals.discharges)].map(csvCell).join(','));

  return lines.join('\n');
}
