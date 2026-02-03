import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import Bell from 'lucide-react/dist/esm/icons/bell.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

import { useState } from 'react';
import { useAcknowledgeAlert } from '@/features/nursing/hooks';
import { toast } from 'sonner';

export function AlertsPanel({ alerts, isLoading }) {
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [resolutionNotes, setResolutionNotes] = useState('');

  const acknowledgeAlert = useAcknowledgeAlert();

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-500 text-white';
      case 'high':
        return 'bg-orange-500 text-white';
      case 'medium':
        return 'bg-yellow-500 text-white';
      case 'low':
        return 'bg-blue-500 text-white';
      default:
        return 'bg-gray-500 text-white';
    }
  };

  const getAlertIcon = (alertType) => {
    switch (alertType) {
      case 'vital_signs':
        return '🫀';
      case 'medication':
        return '💊';
      case 'task_overdue':
        return '⏰';
      case 'patient_fall':
        return '⚠️';
      default:
        return '🔔';
    }
  };

  const handleAcknowledge = async () => {
    if (!selectedAlert) return;

    try {
      await acknowledgeAlert.mutateAsync({
        alertId: selectedAlert.id,
        notes: resolutionNotes,
      });

      toast.success('Alert Acknowledged', {
        description: 'The alert has been acknowledged successfully.',
      });

      setSelectedAlert(null);
      setResolutionNotes('');
    } catch (error) {
      toast.error('Error', {
        description: 'Failed to acknowledge alert. Please try again.',
      });
    }
  };

  const formatTimeAgo = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Active Alerts
          </CardTitle>
          <CardDescription>
            {alerts?.length || 0} unacknowledged alerts
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          ) : !alerts || alerts.length === 0 ? (
            <div className="text-center py-8">
              <Check className="h-12 w-12 text-green-500 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No active alerts</p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[600px] overflow-y-auto">
              {alerts.map((alert) => (
                <div
                  key={alert.id}
                  className="border rounded-lg p-3 space-y-2 hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => setSelectedAlert(alert)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 flex-1">
                      <span className="text-lg">{getAlertIcon(alert.alert_type)}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge className={getSeverityColor(alert.severity)}>
                            {alert.severity}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {formatTimeAgo(alert.created_at)}
                          </span>
                        </div>
                        <p className="text-sm font-medium">
                          {alert.patient_details?.user_details?.full_name ||
                           `${alert.patient_details?.user_details?.first_name || ''} ${alert.patient_details?.user_details?.last_name || ''}`.trim() ||
                           'Unknown Patient'}
                        </p>
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {alert.message}
                        </p>
                      </div>
                    </div>
                    <AlertTriangle className="h-4 w-4 text-orange-500 flex-shrink-0" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Acknowledge Alert Dialog */}
      <Dialog open={!!selectedAlert} onOpenChange={(open) => !open && setSelectedAlert(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Acknowledge Alert</DialogTitle>
            <DialogDescription>
              Review and acknowledge this alert
            </DialogDescription>
          </DialogHeader>

          {selectedAlert && (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge className={getSeverityColor(selectedAlert.severity)}>
                    {selectedAlert.severity}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {selectedAlert.alert_type?.replace('_', ' ')}
                  </span>
                </div>

                <div>
                  <p className="font-medium">
                    Patient: {selectedAlert.patient_details?.user_details?.full_name ||
                             `${selectedAlert.patient_details?.user_details?.first_name || ''} ${selectedAlert.patient_details?.user_details?.last_name || ''}`.trim() ||
                             'Unknown Patient'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    MRN: {selectedAlert.patient_details?.medical_record_number || 'N/A'}
                  </p>
                </div>

                <div className="p-3 bg-gray-50 rounded">
                  <p className="text-sm">{selectedAlert.message}</p>
                </div>

                <div className="text-xs text-muted-foreground">
                  Created: {new Date(selectedAlert.created_at).toLocaleString()}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="resolution-notes">Resolution Notes (Optional)</Label>
                <Textarea
                  id="resolution-notes"
                  value={resolutionNotes}
                  onChange={(e) => setResolutionNotes(e.target.value)}
                  placeholder="Enter any notes about how this alert was resolved..."
                  rows={3}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedAlert(null)}>
              Cancel
            </Button>
            <Button onClick={handleAcknowledge} disabled={acknowledgeAlert.isPending}>
              {acknowledgeAlert.isPending ? 'Acknowledging...' : 'Acknowledge'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
