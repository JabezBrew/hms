import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import User from 'lucide-react/dist/esm/icons/user.js';
import TestTube2 from 'lucide-react/dist/esm/icons/test-tube-diagonal.js';
import TrendingUp from 'lucide-react/dist/esm/icons/trending-up.js';
import TrendingDown from 'lucide-react/dist/esm/icons/trending-down.js';
import Eye from 'lucide-react/dist/esm/icons/eye.js';
import React from 'react';

import { cn } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import format from 'date-fns/format';
import { useLabResults } from '@/features/laboratory/hooks';
import { useNavigate } from 'react-router-dom';

/**
 * CriticalLabAlertsWidget - Dashboard widget for critical lab values
 *
 * Features:
 * - Shows lab results marked as critical
 * - Patient information
 * - Test details with values
 * - Trending indicators
 * - Quick view action
 * - Chronicle design system styling
 */
export default function CriticalLabAlertsWidget({ className, limit = 5 }) {
  const navigate = useNavigate();

  // Fetch results marked as critical
  const { data: resultsData } = useLabResults({ is_critical: true });

  // Sort by date and limit
  const criticalResults = (resultsData?.results || [])
    .sort((a, b) => new Date(b.result_date) - new Date(a.result_date))
    .slice(0, limit);

  const handleViewResult = (resultId, orderId) => {
    navigate(`/laboratory/orders/${orderId}`);
  };

  // Get trending indicator
  const getTrendIndicator = (result) => {
    if (!result.reference_range) return null;

    const value = parseFloat(result.value);
    const { low, high } = result.reference_range;

    if (low && value < low) {
      return {
        icon: TrendingDown,
        color: 'text-rose-600',
        label: 'Below range',
      };
    }
    if (high && value > high) {
      return {
        icon: TrendingUp,
        color: 'text-rose-600',
        label: 'Above range',
      };
    }

    return null;
  };

  return (
    <Card className={cn('border-rose-200 bg-rose-50/30 animate-chronicle-enter', className)}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-rose-100 border border-rose-300">
              <AlertTriangle className="h-5 w-5 text-rose-600" />
            </div>
            <div>
              <CardTitle className="text-lg font-heading text-rose-900">
                Critical Lab Alerts
              </CardTitle>
              <CardDescription className="text-rose-700">
                Results requiring immediate attention
              </CardDescription>
            </div>
          </div>
          <Badge variant="outline" className="text-rose-700 border-rose-300 bg-white">
            {criticalResults.length}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {criticalResults.length === 0 ? (
          <div className="text-center py-8 text-stone-500">
            <AlertTriangle className="h-12 w-12 mx-auto mb-3 text-stone-300" />
            <p className="text-sm">No critical lab alerts</p>
          </div>
        ) : (
          <div className="space-y-3">
            {criticalResults.map((result) => {
              const trend = getTrendIndicator(result);
              const TrendIcon = trend?.icon;

              return (
                <div
                  key={result.id}
                  className="flex items-start justify-between p-3 bg-white border-2 border-rose-300 rounded-lg hover:border-rose-400 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge className="bg-rose-600 hover:bg-rose-700">Critical</Badge>
                      {!result.verified && (
                        <Badge variant="outline" className="text-amber-700 border-amber-300">
                          Unverified
                        </Badge>
                      )}
                    </div>

                    {/* Patient Info */}
                    <div className="flex items-center gap-2 mb-2 text-sm text-stone-700">
                      <User className="h-4 w-4" />
                      <span className="font-semibold">
                        {result.order_test?.order?.patient_details?.first_name}{' '}
                        {result.order_test?.order?.patient_details?.last_name}
                      </span>
                      {result.order_test?.order?.patient_details?.medical_record_number && (
                        <span className="font-mono text-stone-500 text-xs">
                          MRN: {result.order_test.order.patient_details.medical_record_number}
                        </span>
                      )}
                    </div>

                    {/* Test and Result */}
                    <div className="flex items-center gap-2 mb-1">
                      <TestTube2 className="h-4 w-4 text-stone-500" />
                      <span className="font-semibold text-stone-900">
                        {result.order_test?.test?.name}
                      </span>
                    </div>

                    {/* Value with trend */}
                    <div className="flex items-center gap-2 ml-6">
                      <div className="flex items-baseline gap-1">
                        <span className="text-2xl font-bold text-rose-600">
                          {result.value}
                        </span>
                        {result.unit && (
                          <span className="text-sm text-stone-600">{result.unit}</span>
                        )}
                        {TrendIcon && (
                          <div className="flex items-center gap-1 ml-2">
                            <TrendIcon className={cn('h-4 w-4', trend.color)} />
                            <span className={cn('text-xs font-medium', trend.color)}>
                              {trend.label}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Reference Range */}
                    {result.reference_range && (
                      <div className="text-xs text-stone-600 ml-6 mt-1">
                        Normal range: {result.reference_range.low || '—'} -{' '}
                        {result.reference_range.high || '—'} {result.reference_range.unit}
                      </div>
                    )}

                    {/* Notes */}
                    {result.result_notes && (
                      <div className="text-xs text-stone-700 ml-6 mt-2 p-2 bg-stone-50 border border-stone-200 rounded">
                        {result.result_notes}
                      </div>
                    )}

                    {/* Timestamp */}
                    <div className="text-xs text-stone-500 mt-2">
                      {format(new Date(result.result_date), 'MMM dd, yyyy HH:mm')}
                    </div>
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      handleViewResult(result.id, result.order_test?.order?.id)
                    }
                    className="ml-3 border-rose-300 text-rose-700 hover:bg-rose-50"
                  >
                    <Eye className="h-4 w-4 mr-1" />
                    View
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
