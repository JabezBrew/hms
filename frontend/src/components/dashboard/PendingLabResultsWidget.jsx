import TestTube2 from 'lucide-react/dist/esm/icons/test-tube-diagonal.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import Eye from 'lucide-react/dist/esm/icons/eye.js';
import React from 'react';

import { cn } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import format from 'date-fns/format';
import { useLabOrders } from '@/features/laboratory/hooks';
import { useNavigate } from 'react-router-dom';

/**
 * PendingLabResultsWidget - Dashboard widget for pending lab results
 *
 * Features:
 * - Shows lab orders with pending/incomplete results
 * - Priority indicators
 * - Patient information
 * - Quick view action
 * - Chronicle design system styling
 */
export default function PendingLabResultsWidget({ className, limit = 5 }) {
  const navigate = useNavigate();

  // Fetch orders that are processing or completed (may have results)
  const { data: processingOrders } = useLabOrders({ status: 'processing' });
  const { data: completedOrders } = useLabOrders({ status: 'completed' });

  // Combine and sort by priority and date
  const allOrders = [
    ...(processingOrders?.results || []),
    ...(completedOrders?.results || []),
  ]
    .sort((a, b) => {
      // Sort by priority first (stat > urgent > routine)
      const priorityOrder = { stat: 0, urgent: 1, routine: 2 };
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;

      // Then by date
      return new Date(b.created_at) - new Date(a.created_at);
    })
    .slice(0, limit);

  const handleViewOrder = (orderId) => {
    navigate(`/laboratory/orders/${orderId}`);
  };

  const priorityConfig = {
    routine: { label: 'Routine', color: 'bg-stone-100 text-stone-700' },
    urgent: { label: 'Urgent', color: 'bg-amber-100 text-amber-700' },
    stat: { label: 'STAT', color: 'bg-rose-100 text-rose-700' },
  };

  const statusConfig = {
    processing: { label: 'Processing', color: 'bg-indigo-100 text-indigo-700' },
    completed: { label: 'Completed', color: 'bg-emerald-100 text-emerald-700' },
  };

  return (
    <Card className={cn('border-stone-200 animate-chronicle-enter', className)}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-sky-50 border border-sky-200">
              <TestTube2 className="h-5 w-5 text-sky-600" />
            </div>
            <div>
              <CardTitle className="text-lg font-heading">Pending Lab Results</CardTitle>
              <CardDescription>Orders with results to review</CardDescription>
            </div>
          </div>
          <Badge variant="outline" className="text-sky-700 border-sky-300">
            {allOrders.length}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {allOrders.length === 0 ? (
          <div className="text-center py-8 text-stone-500">
            <TestTube2 className="h-12 w-12 mx-auto mb-3 text-stone-300" />
            <p className="text-sm">No pending lab results</p>
          </div>
        ) : (
          <div className="space-y-3">
            {allOrders.map((order) => (
              <div
                key={order.id}
                className="flex items-center justify-between p-3 bg-stone-50 border border-stone-200 rounded-lg hover:border-stone-300 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-mono text-sm font-semibold text-stone-900">
                      #{order.order_number}
                    </p>
                    <Badge className={priorityConfig[order.priority].color} size="sm">
                      {priorityConfig[order.priority].label}
                    </Badge>
                    <Badge variant="outline" className={statusConfig[order.status].color} size="sm">
                      {statusConfig[order.status].label}
                    </Badge>
                  </div>
                  <p className="text-sm text-stone-700 truncate">
                    {order.patient_details?.first_name} {order.patient_details?.last_name}
                    {order.patient_details?.medical_record_number && (
                      <span className="font-mono text-stone-500 ml-2">
                        MRN: {order.patient_details.medical_record_number}
                      </span>
                    )}
                  </p>
                  <div className="flex items-center gap-2 mt-1 text-xs text-stone-500">
                    <Clock className="h-3 w-3" />
                    {format(new Date(order.created_at), 'MMM dd, yyyy')}
                    {order.indication && (
                      <span className="ml-2 truncate">• {order.indication}</span>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleViewOrder(order.id)}
                  className="ml-3"
                >
                  <Eye className="h-4 w-4 mr-1" />
                  View
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
