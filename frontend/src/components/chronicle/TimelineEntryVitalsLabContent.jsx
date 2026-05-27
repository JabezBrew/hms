import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js';
import ChevronUp from 'lucide-react/dist/esm/icons/chevron-up.js';
import { useState } from 'react';

import { cn } from '@/lib/utils';

export const VitalsContent = ({ vitals }) => {
  if (!vitals) return null;

  const bloodPressure = vitals.blood_pressure
    || (vitals.blood_pressure_systolic && vitals.blood_pressure_diastolic
      ? `${vitals.blood_pressure_systolic}/${vitals.blood_pressure_diastolic}`
      : null);

  const vitalItems = [
    { label: 'Temp', value: vitals.temperature, unit: '°C' },
    { label: 'BP', value: bloodPressure, unit: '' },
    { label: 'HR', value: vitals.heart_rate || vitals.pulse, unit: ' bpm' },
    { label: 'SpO2', value: vitals.spo2 || vitals.oxygen_saturation, unit: '%' },
    { label: 'RR', value: vitals.respiratory_rate, unit: '/min' },
  ].filter(item => item.value !== null && item.value !== undefined && String(item.value).trim() !== '');

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
      {vitalItems.map((item) => (
        <div key={item.label} className="p-2 rounded-lg bg-background/50">
          <div className="font-mono text-lg text-foreground">
            {item.value}{item.unit}
          </div>
          <div className="font-mono text-[10px] text-muted-foreground uppercase">
            {item.label}
          </div>
        </div>
      ))}
    </div>
  );
};

export const LabResultContent = ({ result }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!result) return null;

  if (result.test_name && !result.results) {
    return (
      <div className="space-y-2">
        <h4 className="font-medium text-foreground/90">
          {result.test_name}
        </h4>
        <div className="flex items-baseline gap-3">
          <span className={cn(
            'font-mono text-2xl',
            result.is_abnormal ? 'text-destructive' : 'text-foreground'
          )}>
            {result.value} {result.unit}
          </span>
          {result.reference_range && (
            <span className="font-mono text-xs text-muted-foreground">
              Ref: {result.reference_range}
            </span>
          )}
          {result.is_abnormal && (
            <span className="badge-chronicle-rose">
              {result.abnormal_flag || 'ABNORMAL'}
            </span>
          )}
        </div>
      </div>
    );
  }

  const { results_summary: summary, results, order_number, priority_display } = result;

  const getFlagStyle = (flag, isCritical) => {
    if (isCritical) return 'text-rose-600 bg-rose-50 dark:bg-rose-900/20 font-semibold';
    if (flag === 'low' || flag === 'high' || flag === 'abnormal') {
      return 'text-amber-600 bg-amber-50 dark:bg-amber-900/20';
    }
    return 'text-emerald-600';
  };

  const getFlagLabel = (flag) => {
    const labels = {
      critical_low: '↓↓ CRITICAL',
      critical_high: '↑↑ CRITICAL',
      low: '↓ Low',
      high: '↑ High',
      abnormal: '⚠ Abnormal',
      normal: '✓',
    };
    return labels[flag] || flag;
  };

  const abnormalResults = Array.isArray(results)
    ? results.filter(r => r.is_abnormal || r.is_critical)
    : [];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="font-mono text-xs text-muted-foreground">
          {order_number}
        </span>
        {priority_display && priority_display !== 'Routine' && (
          <span className="badge-chronicle-rose text-[10px]">
            {priority_display.toUpperCase()}
          </span>
        )}

        <div className="flex items-center gap-2 ml-auto">
          {summary?.critical > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400">
              {summary.critical} critical
            </span>
          )}
          {summary?.abnormal > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              {summary.abnormal} abnormal
            </span>
          )}
          {summary?.normal > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
              {summary.normal} normal
            </span>
          )}
        </div>
      </div>

      {!isExpanded && results && results.length > 0 && (
        <div className="space-y-1.5">
          {abnormalResults.slice(0, 3).map((r) => (
            <div
              key={r.id || r.test_id || r.test_name || `${r.value}-${r.unit}-${r.reference_range || 'result'}`}
              className={cn(
                'flex items-center justify-between px-2 py-1 rounded text-sm',
                r.is_critical ? 'bg-rose-50 dark:bg-rose-900/10' : 'bg-amber-50 dark:bg-amber-900/10'
              )}
            >
              <span className="font-mono text-xs text-muted-foreground">
                {r.test_name}
              </span>
              <div className="flex items-center gap-2">
                <span className={cn(
                  'font-mono text-sm font-medium',
                  r.is_critical ? 'text-rose-600' : 'text-amber-600'
                )}>
                  {r.value} {r.unit}
                </span>
                <span className={cn(
                  'text-[10px] font-mono',
                  getFlagStyle(r.flag, r.is_critical)
                )}>
                  {getFlagLabel(r.flag)}
                </span>
              </div>
            </div>
          ))}
          {abnormalResults.length > 3 && (
            <p className="text-xs text-muted-foreground font-mono pl-2">
              +{abnormalResults.length - 3} more abnormal…
            </p>
          )}
        </div>
      )}

      {isExpanded && results && results.length > 0 && (
        <div className="border border-border/50 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left font-mono text-xs text-muted-foreground uppercase tracking-wider">
                  Test
                </th>
                <th className="px-3 py-2 text-right font-mono text-xs text-muted-foreground uppercase tracking-wider">
                  Value
                </th>
                <th className="px-3 py-2 text-right font-mono text-xs text-muted-foreground uppercase tracking-wider">
                  Ref Range
                </th>
                <th className="px-3 py-2 text-center font-mono text-xs text-muted-foreground uppercase tracking-wider">
                  Flag
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {results.map((r) => (
                <tr
                  key={r.id || r.test_id || r.test_name || `${r.value}-${r.unit}-${r.reference_range || 'result'}`}
                  className={cn(
                    'transition-colors',
                    r.is_critical && 'bg-rose-50/50 dark:bg-rose-900/10',
                    r.is_abnormal && !r.is_critical && 'bg-amber-50/50 dark:bg-amber-900/10'
                  )}
                >
                  <td className="px-3 py-2">
                    <span className="font-mono text-xs text-foreground/80">
                      {r.test_name}
                    </span>
                    {r.test_full_name && r.test_full_name !== r.test_name && (
                      <span className="block text-[10px] text-muted-foreground">
                        {r.test_full_name}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className={cn(
                      'font-mono font-medium',
                      r.is_critical ? 'text-rose-600' : r.is_abnormal ? 'text-amber-600' : 'text-foreground'
                    )}>
                      {r.value}
                    </span>
                    <span className="text-muted-foreground ml-1 text-xs">
                      {r.unit}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">
                    {r.reference_range || '—'}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className={cn(
                      'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono',
                      getFlagStyle(r.flag, r.is_critical)
                    )}>
                      {getFlagLabel(r.flag)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {results && results.length > 0 && (
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-mono transition-colors"
        >
          {isExpanded ? (
            <>
              <ChevronUp className="size-3" />
              Hide details
            </>
          ) : (
            <>
              <ChevronDown className="size-3" />
              View all {results.length} results
            </>
          )}
        </button>
      )}
    </div>
  );
};
