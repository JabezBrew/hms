import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import Info from 'lucide-react/dist/esm/icons/info.js';
import XCircle from 'lucide-react/dist/esm/icons/circle-x.js';
import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

const DEFAULT_EMPTY_ARRAY = [];

const SEVERITY_CONFIG = {
  critical: {
    icon: XCircle,
    className: 'border-red-500 bg-red-50 text-red-900',
    badgeVariant: 'destructive',
    label: 'Critical',
    color: 'text-red-600',
  },
  high: {
    icon: AlertTriangle,
    className: 'border-orange-500 bg-orange-50 text-orange-900',
    badgeVariant: 'default',
    label: 'High',
    color: 'text-orange-600',
  },
  moderate: {
    icon: AlertCircle,
    className: 'border-yellow-500 bg-yellow-50 text-yellow-900',
    badgeVariant: 'secondary',
    label: 'Moderate',
    color: 'text-yellow-600',
  },
  low: {
    icon: Info,
    className: 'border-blue-500 bg-blue-50 text-blue-900',
    badgeVariant: 'outline',
    label: 'Low',
    color: 'text-blue-600',
  },
};

/**
 * DrugSafetyDialog - Modal for displaying drug safety alerts
 *
 * @param {Object} props
 * @param {boolean} props.open - Whether dialog is open
 * @param {Function} props.onOpenChange - Callback for open state change
 * @param {Array} props.alerts - Array of safety alerts
 * @param {boolean} props.hasCriticalAlerts - Whether there are critical alerts
 * @param {string} props.medicationName - Name of medication being checked
 * @param {Function} props.onProceed - Callback when user proceeds despite alerts
 * @param {Function} props.onCancel - Callback when user cancels
 * @param {boolean} props.allowOverride - Whether user can override alerts
 * @param {boolean} props.loading - Whether check is in progress
 */
export function DrugSafetyDialog({
  open,
  onOpenChange,
  alerts = DEFAULT_EMPTY_ARRAY,
  hasCriticalAlerts,
  medicationName,
  onProceed,
  onCancel,
  allowOverride = false,
  loading = false,
}) {
  const [overrideReason, setOverrideReason] = useState('');
  const [showOverrideInput, setShowOverrideInput] = useState(false);

  const handleProceed = () => {
    if (hasCriticalAlerts && !overrideReason.trim()) {
      setShowOverrideInput(true);
      return;
    }

    onProceed?.(overrideReason);
    setOverrideReason('');
    setShowOverrideInput(false);
  };

  const handleCancel = () => {
    onCancel?.();
    setOverrideReason('');
    setShowOverrideInput(false);
  };

  // Group alerts by severity
  const groupedAlerts = alerts.reduce((acc, alert) => {
    const severity = alert.severity || 'low';
    if (!acc[severity]) {
      acc[severity] = [];
    }
    acc[severity].push(alert);
    return {};
  }, {});

  const orderedSeverities = ['critical', 'high', 'moderate', 'low'];

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {hasCriticalAlerts ? (
              <>
                <XCircle className="size-6 text-red-600" />
                <span className="text-red-600">Critical Drug Safety Alert</span>
              </>
            ) : (
              <>
                <AlertTriangle className="size-6 text-orange-600" />
                <span>Drug Safety Warnings</span>
              </>
            )}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {alerts.length} safety {alerts.length === 1 ? 'alert' : 'alerts'} detected for{' '}
            <span className="font-semibold">{medicationName}</span>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4 my-4">
          {orderedSeverities.map((severity) => {
            const severityAlerts = groupedAlerts[severity];
            if (!severityAlerts || severityAlerts.length === 0) return null;

            const config = SEVERITY_CONFIG[severity];
            const Icon = config.icon;

            return (
              <div key={severity} className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant={config.badgeVariant}>{config.label}</Badge>
                  <span className="text-sm text-muted-foreground">
                    {severityAlerts.length} {severityAlerts.length === 1 ? 'alert' : 'alerts'}
                  </span>
                </div>

                {severityAlerts.map((alert, index) => (
                  <Alert key={index} className={config.className}>
                    <Icon className={`size-4 ${config.color}`} />
                    <AlertTitle className="font-semibold">
                      {alert.alert_type_display || alert.alert_type}
                    </AlertTitle>
                    <AlertDescription className="mt-2 space-y-1">
                      <p>{alert.description}</p>
                      {alert.recommendation && (
                        <p className="mt-2 font-medium">
                          <span className="text-xs uppercase tracking-wide">Recommendation:</span>{' '}
                          {alert.recommendation}
                        </p>
                      )}
                    </AlertDescription>
                  </Alert>
                ))}
              </div>
            );
          })}
        </div>

        {hasCriticalAlerts && allowOverride && (
          <div className="space-y-2 p-4 border border-amber-200 bg-amber-50 rounded-lg">
            <div className="flex items-start gap-2">
              <AlertTriangle className="size-5 text-amber-600 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-amber-900">
                  Override Required
                </p>
                <p className="text-sm text-amber-700 mt-1">
                  Critical alerts require documented justification to proceed.
                </p>
              </div>
            </div>

            {showOverrideInput && (
              <div className="mt-3 space-y-2">
                <Label htmlFor="override-reason">
                  Reason for Override <span className="text-red-600">*</span>
                </Label>
                <Textarea
                  id="override-reason"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="Provide a detailed reason for overriding these critical safety alerts..."
                  rows={4}
                  className="resize-none"
                />
                <p className="text-xs text-muted-foreground">
                  Minimum 10 characters required
                </p>
              </div>
            )}
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleCancel}>
            Cancel Prescription
          </AlertDialogCancel>

          {hasCriticalAlerts ? (
            allowOverride ? (
              <Button
                onClick={handleProceed}
                variant="destructive"
                disabled={loading || (showOverrideInput && overrideReason.trim().length < 10)}
              >
                {showOverrideInput ? 'Proceed with Override' : 'Override Alerts'}
              </Button>
            ) : (
              <AlertDialogAction disabled className="bg-gray-400">
                Cannot Proceed
              </AlertDialogAction>
            )
          ) : (
            <AlertDialogAction onClick={handleProceed} disabled={loading}>
              Acknowledge and Proceed
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
