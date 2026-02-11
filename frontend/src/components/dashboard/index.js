/**
 * Dashboard Components - Chronicle Design System
 * Shared components for role-based dashboards
 */

export { default as ChroniclePageHeader } from './ChroniclePageHeader';
export { default as UrgentBanner } from './UrgentBanner';
export { default as StatCard } from './StatCard';
export { default as ActionCard } from './ActionCard';
export { default as DashboardSection, DashboardGrid } from './DashboardSection';
export { default as CriticalAlertsMonitor } from './CriticalAlertsMonitor';
export { default as OccupancyTrendChart } from './OccupancyTrendChart';

// Re-export existing dashboard components (named exports)
export { AppointmentCard } from './AppointmentCard';
export { Inbox } from './Inbox';

// Laboratory and Referral Widgets
export { default as PendingLabResultsWidget } from './PendingLabResultsWidget';
export { default as ActiveReferralsWidget } from './ActiveReferralsWidget';
export { default as CriticalLabAlertsWidget } from './CriticalLabAlertsWidget';
export { default as LabWorklistWidget } from './LabWorklistWidget';
