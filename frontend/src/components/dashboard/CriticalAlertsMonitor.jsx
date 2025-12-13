import React, { useEffect, useRef } from 'react';
import {
  useNurseDashboard,
  useAdminDashboard,
  useInpatientDashboard,
} from '@/hooks/useDashboardQueries';
import { toast } from 'sonner';
import { AlertTriangle, Bell } from 'lucide-react';
import { useAuth } from '@/lib/auth';

/**
 * CriticalAlertsMonitor - Background component that monitors for critical alerts
 * and shows real-time toast notifications
 *
 * This component should be mounted in the app root for nurses, doctors, and admins
 */
export default function CriticalAlertsMonitor() {
  const { user, isAuthenticated } = useAuth();
  const previousAlertsRef = useRef(new Set());

  // Early return if not authenticated - security safeguard
  if (!isAuthenticated || !user) {
    return null;
  }

  // Determine which dashboard to monitor based on role
  const userRole = user?.role;
  const shouldMonitor = userRole && ['nurse', 'head_nurse', 'nurse_practitioner', 'doctor', 'inpatient_doctor', 'admin'].includes(userRole);

  // Use role-appropriate dashboard hook
  const isNurse = ['nurse', 'head_nurse', 'nurse_practitioner'].includes(userRole);
  const isInpatientDoctor = ['doctor', 'inpatient_doctor'].includes(userRole);
  const isAdmin = userRole === 'admin';

  // Poll appropriate dashboard based on role
  const { data: nurseDashboardData } = useNurseDashboard(
    {},
    {
      enabled: shouldMonitor && isNurse,
      refetchInterval: 30000,
      refetchIntervalInBackground: false,
    }
  );

  const { data: inpatientDashboardData } = useInpatientDashboard({
    enabled: shouldMonitor && isInpatientDoctor,
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  });

  const { data: adminDashboardData } = useAdminDashboard({
    enabled: shouldMonitor && isAdmin,
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  });

  // Select the appropriate dashboard data
  const dashboardData = isNurse
    ? nurseDashboardData
    : isInpatientDoctor
    ? inpatientDashboardData
    : isAdmin
    ? adminDashboardData
    : null;

  useEffect(() => {
    if (!dashboardData?.urgent) return;

    const currentAlerts = dashboardData.urgent.critical_alerts || [];
    const newAlerts = currentAlerts.filter(
      (alert) => !previousAlertsRef.current.has(alert.id)
    );

    // Show toast for new critical alerts
    newAlerts.forEach((alert) => {
      toast.error(
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-rose-400 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="font-heading font-semibold text-sm mb-1">
              {alert.severity === 'critical' ? 'CRITICAL ALERT' : 'HIGH PRIORITY'}
            </div>
            <div className="font-display text-base font-semibold mb-0.5">
              {alert.patient_name}
            </div>
            <div className="text-sm text-muted-foreground">
              {alert.message}
            </div>
          </div>
        </div>,
        {
          duration: 10000, // Show for 10 seconds
          important: true,
          closeButton: true,
          action: {
            label: 'View',
            onClick: () => {
              // Navigate to patient or alert detail
              window.location.href = `/patients/${alert.patient_id}`;
            },
          },
        }
      );
    });

    // Update the set of seen alerts
    const alertIds = new Set(currentAlerts.map((a) => a.id));
    previousAlertsRef.current = alertIds;
  }, [dashboardData]);

  useEffect(() => {
    if (!dashboardData?.urgent) return;

    const overdueMeds = dashboardData.urgent.overdue_medications || [];
    const newOverdueMeds = overdueMeds.filter(
      (med) => !previousAlertsRef.current.has(`med-${med.id}`)
    );

    // Show toast for overdue medications
    newOverdueMeds.forEach((med) => {
      toast.warning(
        <div className="flex items-start gap-3">
          <Bell className="h-5 w-5 text-amber-400 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="font-heading font-semibold text-sm mb-1">
              MEDICATION OVERDUE
            </div>
            <div className="font-display text-base font-semibold mb-0.5">
              {med.patient_name}
            </div>
            <div className="text-sm text-muted-foreground">
              {med.medication_name} - Scheduled: {med.scheduled_time}
            </div>
          </div>
        </div>,
        {
          duration: 8000,
          important: true,
          closeButton: true,
          action: {
            label: 'Administer',
            onClick: () => {
              window.location.href = `/patients/${med.patient_id}`;
            },
          },
        }
      );

      // Add to seen set
      previousAlertsRef.current.add(`med-${med.id}`);
    });
  }, [dashboardData]);

  // This component doesn't render anything
  return null;
}
