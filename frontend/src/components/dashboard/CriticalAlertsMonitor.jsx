import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import Bell from 'lucide-react/dist/esm/icons/bell.js';
import React, { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import {
  useAdminDashboard,
  useInpatientDashboard,
} from '@/features/dashboards/hooks';
import { useActiveAlerts, useOverdueMedications } from '@/features/nursing/hooks';
import { toast } from 'sonner';

import { useAuth } from '@/lib/auth';
import { usePageVisibility } from '@/shared/hooks/usePageVisibility';

/**
 * CriticalAlertsMonitor - Background component that monitors for critical alerts
 * and shows real-time toast notifications
 *
 * This component should be mounted in the app root for nurses, doctors, and admins
 */
export default function CriticalAlertsMonitor() {
  const { user } = useAuth();
  const { isPageActive } = usePageVisibility();
  const location = useLocation();
  const previousAlertIdsRef = useRef(null);
  const previousMedicationIdsRef = useRef(null);
  if (previousAlertIdsRef.current === null) {
    previousAlertIdsRef.current = new Set();
  }
  if (previousMedicationIdsRef.current === null) {
    previousMedicationIdsRef.current = new Set();
  }

  // Determine which dashboard to monitor based on role
  const userRole = user?.role;
  const shouldMonitor =
    isPageActive &&
    userRole &&
    ['nurse', 'head_nurse', 'nurse_practitioner', 'doctor', 'inpatient_doctor', 'admin'].includes(userRole);

  // Use role-appropriate dashboard hook
  const isNurse = ['nurse', 'head_nurse', 'nurse_practitioner'].includes(userRole);
  const isInpatientDoctor = ['doctor', 'inpatient_doctor'].includes(userRole);
  const isAdmin = userRole === 'admin';
  const isAdminDashboardRoute = location.pathname === '/dashboards/admin';

  const { data: nurseAlerts = [] } = useActiveAlerts({
    enabled: shouldMonitor && isNurse,
  });

  const { data: nurseOverdueMedications = [] } = useOverdueMedications({
    enabled: shouldMonitor && isNurse,
  });

  const { data: inpatientDashboardData } = useInpatientDashboard({
    enabled: shouldMonitor && isInpatientDoctor,
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  });

  const { data: adminDashboardData } = useAdminDashboard({
    enabled: shouldMonitor && isAdmin && !isAdminDashboardRoute,
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  });

  const dashboardData = isInpatientDoctor
    ? inpatientDashboardData
    : isAdmin
    ? adminDashboardData
    : null;

  useEffect(() => {
    if (!shouldMonitor) return;

    const currentAlerts = isNurse
      ? nurseAlerts.filter((alert) => ['critical', 'high'].includes(String(alert.severity || '').toLowerCase()))
      : dashboardData?.urgent?.critical_alerts || [];
    const newAlerts = currentAlerts.filter(
      (alert) => !previousAlertIdsRef.current.has(alert.id)
    );

    // Show toast for new critical alerts
    newAlerts.forEach((alert) => {
      toast.error(
        <div className="flex items-start gap-3">
          <AlertTriangle className="size-5 text-rose-400 mt-0.5" />
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
    previousAlertIdsRef.current = alertIds;
  }, [dashboardData, isNurse, nurseAlerts, shouldMonitor]);

  useEffect(() => {
    if (!shouldMonitor) return;

    const overdueMeds = isNurse
      ? nurseOverdueMedications
      : dashboardData?.urgent?.overdue_medications || [];
    const newOverdueMeds = overdueMeds.filter(
      (med) => !previousMedicationIdsRef.current.has(med.id)
    );

    // Show toast for overdue medications
    newOverdueMeds.forEach((med) => {
      toast.warning(
        <div className="flex items-start gap-3">
          <Bell className="size-5 text-amber-400 mt-0.5" />
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
      previousMedicationIdsRef.current.add(med.id);
    });
  }, [dashboardData, isNurse, nurseOverdueMedications, shouldMonitor]);

  // This component doesn't render anything
  return null;
}
