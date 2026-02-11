import TrendingUp from 'lucide-react/dist/esm/icons/trending-up.js';
import TrendingDown from 'lucide-react/dist/esm/icons/trending-down.js';
import React from 'react';

import { cn } from '@/lib/utils';

/**
 * OccupancyTrendChart - Simple bar chart for occupancy visualization
 *
 * @param {Object} props
 * @param {Array} props.wards - Array of ward data with occupancy info
 * @param {string} props.className - Additional CSS classes
 */
export default function OccupancyTrendChart({ wards = [], className }) {
  if (!wards || wards.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No occupancy data available
      </div>
    );
  }

  // Calculate average occupancy
  const avgOccupancy =
    wards.reduce((sum, ward) => {
      const occupancy =
        ward.total_beds > 0 ? (ward.occupied_beds / ward.total_beds) * 100 : 0;
      return sum + occupancy;
    }, 0) / wards.length;

  // Sort wards by occupancy for better visualization
  const sortedWards = [...wards].sort((a, b) => {
    const aOccupancy =
      a.total_beds > 0 ? (a.occupied_beds / a.total_beds) * 100 : 0;
    const bOccupancy =
      b.total_beds > 0 ? (b.occupied_beds / b.total_beds) * 100 : 0;
    return bOccupancy - aOccupancy;
  });

  return (
    <div className={cn('space-y-6', className)}>
      {/* Summary Stats */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-heading text-base font-semibold text-foreground mb-1">
            Facility Occupancy Overview
          </h3>
          <p className="text-xs text-muted-foreground">
            Average occupancy: {avgOccupancy.toFixed(1)}%
          </p>
        </div>
        <div className="flex items-center gap-2">
          {avgOccupancy > 75 ? (
            <>
              <TrendingUp className="h-4 w-4 text-rose-400" />
              <span className="text-sm font-mono text-rose-400">High</span>
            </>
          ) : (
            <>
              <TrendingDown className="h-4 w-4 text-emerald-400" />
              <span className="text-sm font-mono text-emerald-400">Normal</span>
            </>
          )}
        </div>
      </div>

      {/* Chart */}
      <div className="space-y-4">
        {sortedWards.map((ward) => {
          const occupancyPercent =
            ward.total_beds > 0 ? (ward.occupied_beds / ward.total_beds) * 100 : 0;

          const statusColor =
            occupancyPercent >= 100
              ? 'bg-rose-500'
              : occupancyPercent >= 90
              ? 'bg-amber-500'
              : occupancyPercent >= 75
              ? 'bg-sky-500'
              : 'bg-emerald-500';

          const textColor =
            occupancyPercent >= 100
              ? 'text-rose-400'
              : occupancyPercent >= 90
              ? 'text-amber-400'
              : occupancyPercent >= 75
              ? 'text-sky-400'
              : 'text-emerald-400';

          return (
            <div key={ward.id} className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-heading text-sm font-medium text-foreground truncate flex-1">
                  {ward.name}
                </span>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-muted-foreground">
                    {ward.occupied_beds}/{ward.total_beds}
                  </span>
                  <span className={cn('font-mono text-sm font-semibold', textColor)}>
                    {occupancyPercent.toFixed(0)}%
                  </span>
                </div>
              </div>

              {/* Bar */}
              <div className="relative h-8 rounded-lg bg-muted overflow-hidden">
                <div
                  className={cn(
                    'absolute inset-y-0 left-0 transition-all duration-500 rounded-lg',
                    statusColor
                  )}
                  style={{ width: `${Math.min(occupancyPercent, 100)}%` }}
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent to-white/10" />
                </div>

                {/* Threshold markers */}
                <div className="absolute inset-0 flex">
                  <div
                    className="border-r border-white/20"
                    style={{ width: '75%' }}
                    title="75% threshold"
                  />
                  <div
                    className="border-r border-white/30"
                    style={{ width: '15%' }}
                    title="90% threshold"
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 pt-4 border-t border-border">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-sm bg-emerald-500" />
          <span className="text-xs text-muted-foreground">{'<75% (Normal)'}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-sm bg-sky-500" />
          <span className="text-xs text-muted-foreground">75-90% (Moderate)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-sm bg-amber-500" />
          <span className="text-xs text-muted-foreground">90-100% (High)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-sm bg-rose-500" />
          <span className="text-xs text-muted-foreground">{'≥100% (Critical)'}</span>
        </div>
      </div>
    </div>
  );
}
