import Beaker from 'lucide-react/dist/esm/icons/beaker.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import CheckCircle from 'lucide-react/dist/esm/icons/circle-check-big.js';
import Play from 'lucide-react/dist/esm/icons/play.js';
import TestTube2 from 'lucide-react/dist/esm/icons/test-tube-diagonal.js';
import React from 'react';

import { cn } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useLabOrders } from '@/features/laboratory/hooks';
import { useNavigate } from 'react-router-dom';

/**
 * LabWorklistWidget - Dashboard widget for lab technician worklist
 *
 * Features:
 * - Shows order counts by status
 * - Quick stats with color coding
 * - Navigation to full dashboard
 * - Chronicle design system styling
 */
export default function LabWorklistWidget({ className }) {
  const navigate = useNavigate();

  // Fetch orders by status
  const { data: submittedOrders } = useLabOrders({ status: 'submitted', page_size: 1 });
  const { data: collectedOrders } = useLabOrders({ status: 'collected', page_size: 1 });
  const { data: receivedOrders } = useLabOrders({ status: 'received', page_size: 1 });
  const { data: processingOrders } = useLabOrders({ status: 'processing', page_size: 1 });

  const statusStats = [
    {
      label: 'Submitted',
      count: submittedOrders?.count || 0,
      icon: TestTube2,
      color: 'sky',
      bgColor: 'bg-sky-50',
      borderColor: 'border-sky-200',
      textColor: 'text-sky-700',
      iconColor: 'text-sky-600',
      description: 'Awaiting collection',
    },
    {
      label: 'Collected',
      count: collectedOrders?.count || 0,
      icon: CheckCircle,
      color: 'amber',
      bgColor: 'bg-amber-50',
      borderColor: 'border-amber-200',
      textColor: 'text-amber-700',
      iconColor: 'text-amber-600',
      description: 'Ready to receive',
    },
    {
      label: 'Received',
      count: receivedOrders?.count || 0,
      icon: Clock,
      color: 'violet',
      bgColor: 'bg-violet-50',
      borderColor: 'border-violet-200',
      textColor: 'text-violet-700',
      iconColor: 'text-violet-600',
      description: 'Ready to process',
    },
    {
      label: 'Processing',
      count: processingOrders?.count || 0,
      icon: Play,
      color: 'indigo',
      bgColor: 'bg-indigo-50',
      borderColor: 'border-indigo-200',
      textColor: 'text-indigo-700',
      iconColor: 'text-indigo-600',
      description: 'In progress',
    },
  ];

  const totalOrders = statusStats.reduce((sum, stat) => sum + stat.count, 0);

  const handleViewWorklist = () => {
    navigate('/laboratory/worklist');
  };

  return (
    <Card className={cn('border-stone-200 animate-chronicle-enter', className)}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-50 border border-indigo-200">
              <Beaker className="h-5 w-5 text-indigo-600" />
            </div>
            <div>
              <CardTitle className="text-lg font-heading">Lab Worklist</CardTitle>
              <CardDescription>Orders requiring attention</CardDescription>
            </div>
          </div>
          <Badge variant="outline" className="text-indigo-700 border-indigo-300">
            {totalOrders}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {totalOrders === 0 ? (
          <div className="text-center py-8 text-stone-500">
            <Beaker className="h-12 w-12 mx-auto mb-3 text-stone-300" />
            <p className="text-sm">No orders in worklist</p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Status Cards */}
            <div className="grid grid-cols-2 gap-3">
              {statusStats.map((stat) => {
                const Icon = stat.icon;
                return (
                  <div
                    key={stat.label}
                    className={cn(
                      'p-4 rounded-lg border transition-all',
                      stat.bgColor,
                      stat.borderColor,
                      stat.count > 0 && 'hover:shadow-md cursor-pointer'
                    )}
                    onClick={stat.count > 0 ? handleViewWorklist : undefined}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <Icon className={cn('h-4 w-4', stat.iconColor)} />
                      <span className={cn('text-2xl font-bold', stat.textColor)}>
                        {stat.count}
                      </span>
                    </div>
                    <div className="space-y-1">
                      <p className={cn('text-sm font-semibold', stat.textColor)}>
                        {stat.label}
                      </p>
                      <p className="text-xs text-stone-600">{stat.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Action Button */}
            <Button
              onClick={handleViewWorklist}
              className="w-full bg-indigo-600 hover:bg-indigo-700"
            >
              <Beaker className="h-4 w-4 mr-2" />
              View Full Worklist
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
