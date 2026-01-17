import Users from 'lucide-react/dist/esm/icons/users.js';
import UserPlus from 'lucide-react/dist/esm/icons/user-plus.js';
import Bed from 'lucide-react/dist/esm/icons/bed.js';
import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import Activity from 'lucide-react/dist/esm/icons/activity.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import TrendingUp from 'lucide-react/dist/esm/icons/trending-up.js';
import Settings from 'lucide-react/dist/esm/icons/settings.js';
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '@/components/layout/layout';
import { PageBreadcrumb } from '@/components/layout/PageBreadcrumb';
import {
  ChroniclePageHeader,
  StatCard,
  DashboardSection,
  DashboardGrid,
  OccupancyTrendChart,
} from '@/components/dashboard';
import { useAdminDashboard } from '@/hooks/useDashboardQueries';
import { useFacilities } from '@/hooks/useFacilityQueries';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';

import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import FacilityRequiredPanel from '@/components/facilities/FacilityRequiredPanel';

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { facilityCode } = useAuth();

  // Fetch dashboard data with polling
  const {
    data: dashboardData,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useAdminDashboard({ refetchInterval: 30000 });

  const {
    data: facilities = [],
    isLoading: facilitiesLoading,
    error: facilitiesError,
  } = useFacilities({ includeInactive: true });

  const breadcrumbItems = [
    { label: 'Dashboards', href: '/dashboards' },
    { label: 'Admin Dashboard', href: '/dashboards/admin' },
  ];

  if (!facilityCode) {
    return (
      <Layout>
        <PageBreadcrumb items={breadcrumbItems} />
        <FacilityRequiredPanel />
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout>
        <div className="p-6">
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-6">
            <AlertTriangle className="h-6 w-6 text-rose-400 mb-2" />
            <h3 className="font-heading text-lg font-semibold text-rose-400 mb-1">
              Failed to load dashboard
            </h3>
            <p className="text-sm text-muted-foreground">{error.message}</p>
          </div>
        </div>
      </Layout>
    );
  }

  const stats = dashboardData?.stats || {};
  const wards = dashboardData?.wards || [];

  // Calculate overall system health
  const systemHealth =
    stats.occupancy_rate > 90
      ? 'critical'
      : stats.occupancy_rate > 75
      ? 'warning'
      : 'good';

  return (
    <Layout>
      <PageBreadcrumb items={breadcrumbItems} />

      <ChroniclePageHeader
        title="Admin Dashboard"
        role="admin"
        subtitle="System overview and facility management"
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/admin/settings')}
            >
              <Settings className="h-4 w-4 mr-2" />
              Settings
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            </Button>
          </>
        }
      />

      <div className="p-4 sm:p-6 space-y-6 sm:space-y-8">
        {/* System Health Banner */}
        {!isLoading && systemHealth !== 'good' && (
          <div
            className={cn(
              'rounded-xl border p-4 sm:p-6',
              systemHealth === 'critical'
                ? 'bg-rose-500/10 border-rose-500/30'
                : 'bg-amber-500/10 border-amber-500/30'
            )}
          >
            <div className="flex items-start gap-3">
              <AlertTriangle
                className={cn(
                  'h-6 w-6 mt-1',
                  systemHealth === 'critical' ? 'text-rose-400' : 'text-amber-400'
                )}
              />
              <div className="flex-1">
                <h3
                  className={cn(
                    'font-heading text-lg font-semibold mb-1',
                    systemHealth === 'critical' ? 'text-rose-400' : 'text-amber-400'
                  )}
                >
                  {systemHealth === 'critical'
                    ? 'Critical Bed Capacity'
                    : 'High Bed Occupancy'}
                </h3>
                <p className="text-sm text-muted-foreground">
                  Current occupancy is at {stats.occupancy_rate?.toFixed(1)}%. Consider
                  discharge planning and capacity management.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* System Statistics */}
        {isLoading ? (
          <DashboardGrid columns="4">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </DashboardGrid>
        ) : (
          <DashboardGrid columns="4">
            <StatCard
              title="Total Patients"
              value={stats.total_patients || 0}
              subtitle="Registered in system"
              icon={Users}
              color="amber"
              onClick={() => navigate('/patients')}
            />
            <StatCard
              title="Bed Occupancy"
              value={`${stats.occupancy_rate?.toFixed(0)}%`}
              subtitle={`${stats.occupied_beds}/${stats.total_beds} beds`}
              icon={Bed}
              color={
                stats.occupancy_rate > 90
                  ? 'rose'
                  : stats.occupancy_rate > 75
                  ? 'amber'
                  : 'emerald'
              }
              trend={{
                value: stats.occupancy_rate > 75 ? 'High' : 'Normal',
                direction: stats.occupancy_rate > 75 ? 'up' : 'neutral',
              }}
              onClick={() => navigate('/wards')}
            />
            <StatCard
              title="Current Admissions"
              value={stats.current_admissions || 0}
              subtitle="Active inpatients"
              icon={UserPlus}
              color="sky"
              onClick={() => navigate('/admissions')}
            />
            <StatCard
              title="Today's Appointments"
              value={stats.todays_appointments || 0}
              subtitle="Scheduled consultations"
              icon={Calendar}
              color="emerald"
              onClick={() => navigate('/appointments')}
            />
          </DashboardGrid>
        )}

        {/* Quick Actions */}
        <DashboardSection title="Quick Actions">
          <DashboardGrid columns="3">
            <Button
              variant="outline"
              className="h-24 flex flex-col items-center justify-center gap-2"
              onClick={() => navigate('/patients/create')}
            >
              <UserPlus className="h-6 w-6" />
              <span>Register Patient</span>
            </Button>
            <Button
              variant="outline"
              className="h-24 flex flex-col items-center justify-center gap-2"
              onClick={() => navigate('/staff/create')}
            >
              <Users className="h-6 w-6" />
              <span>Add Staff</span>
            </Button>
            <Button
              variant="outline"
              className="h-24 flex flex-col items-center justify-center gap-2"
              onClick={() => navigate('/wards')}
            >
              <Building2 className="h-6 w-6" />
              <span>Manage Wards</span>
            </Button>
          </DashboardGrid>
        </DashboardSection>

        {/* Facility Management */}
        <DashboardSection
          title="Facilities"
          subtitle="Facility registry status and availability"
        >
          {facilitiesLoading ? (
            <DashboardGrid columns="3">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-32" />
              ))}
            </DashboardGrid>
          ) : facilitiesError ? (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-6">
              <AlertTriangle className="h-5 w-5 text-rose-400 mb-2" />
              <p className="text-sm text-muted-foreground">
                {facilitiesError.message || 'Failed to load facilities.'}
              </p>
            </div>
          ) : facilities.length === 0 ? (
            <div className="text-center py-10 rounded-xl border border-border bg-card/50">
              <Building2 className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No facilities configured</p>
            </div>
          ) : (
            <DashboardGrid columns="3">
              {facilities.map((facility) => {
                const status = facility.status || (facility.is_active ? 'ready' : 'suspended');
                const statusTone =
                  status === 'ready'
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    : status === 'running'
                    ? 'bg-sky-500/10 text-sky-400 border-sky-500/30'
                    : status === 'pending'
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                    : 'bg-rose-500/10 text-rose-400 border-rose-500/30';

                return (
                  <div
                    key={facility.id}
                    className="rounded-xl border border-border bg-card p-4 sm:p-5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-heading text-base font-semibold text-foreground">
                          {facility.name}
                        </h3>
                        <p className="text-xs font-mono text-muted-foreground">
                          {facility.code} · {facility.facility_type?.replace('_', ' ')}
                        </p>
                      </div>
                      <span
                        className={cn(
                          'text-[10px] uppercase tracking-wide border rounded-full px-2 py-1',
                          statusTone
                        )}
                      >
                        {status}
                      </span>
                    </div>
                    <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                      <span>{facility.parent_facility_code ? `Parent: ${facility.parent_facility_code}` : 'Primary facility'}</span>
                      <span className={facility.is_active ? 'text-emerald-400' : 'text-rose-400'}>
                        {facility.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </DashboardGrid>
          )}
        </DashboardSection>

        {/* Ward Overview with Analytics Chart */}
        <DashboardSection
          title="Ward Overview"
          subtitle="Bed occupancy by ward with trend visualization"
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/wards')}
            >
              View All
            </Button>
          }
        >
          {isLoading ? (
            <div className="space-y-4">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-32" />
              ))}
            </div>
          ) : wards.length === 0 ? (
            <div className="text-center py-12 rounded-xl border border-border bg-card/50">
              <Building2 className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No wards configured</p>
            </div>
          ) : (
            <>
              {/* Occupancy Trend Chart */}
              <div className="rounded-xl border border-border bg-card p-6 mb-6">
                <OccupancyTrendChart wards={wards} />
              </div>

              {/* Detailed Ward Cards */}
              <div className="space-y-4">
                {wards.map((ward) => {
                const occupancyPercent = ward.total_beds > 0
                  ? (ward.occupied_beds / ward.total_beds) * 100
                  : 0;

                const wardStatus =
                  occupancyPercent >= 100
                    ? 'critical'
                    : occupancyPercent >= 90
                    ? 'warning'
                    : occupancyPercent >= 75
                    ? 'caution'
                    : 'good';

                return (
                  <div
                    key={ward.id}
                    className="rounded-xl border border-border bg-card p-4 sm:p-6 hover:border-primary/30 transition-colors cursor-pointer"
                    onClick={() => navigate(`/wards/${ward.id}`)}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
                      <div className="flex items-start gap-3">
                        <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
                          <Building2 className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1">
                          <h3 className="font-heading text-lg font-semibold text-foreground">
                            {ward.name}
                          </h3>
                          {ward.description && (
                            <p className="text-sm text-muted-foreground">
                              {ward.description}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Status badge */}
                      <span
                        className={cn(
                          'text-xs font-mono px-3 py-1 rounded-full shrink-0',
                          wardStatus === 'critical' &&
                            'bg-rose-500/10 text-rose-400 border border-rose-500/30',
                          wardStatus === 'warning' &&
                            'bg-amber-500/10 text-amber-400 border border-amber-500/30',
                          wardStatus === 'caution' &&
                            'bg-sky-500/10 text-sky-400 border border-sky-500/30',
                          wardStatus === 'good' &&
                            'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                        )}
                      >
                        {occupancyPercent.toFixed(0)}% OCCUPIED
                      </span>
                    </div>

                    {/* Bed statistics */}
                    <div className="grid grid-cols-4 gap-4 mb-4">
                      <div className="space-y-1">
                        <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wide">
                          Total Beds
                        </span>
                        <div className="font-mono text-xl font-semibold text-foreground">
                          {ward.total_beds}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wide">
                          Occupied
                        </span>
                        <div className="font-mono text-xl font-semibold text-foreground">
                          {ward.occupied_beds}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wide">
                          Available
                        </span>
                        <div className="font-mono text-xl font-semibold text-emerald-400">
                          {ward.available_beds}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wide">
                          Maintenance
                        </span>
                        <div className="font-mono text-xl font-semibold text-amber-400">
                          {ward.maintenance_beds || 0}
                        </div>
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs font-mono text-muted-foreground">
                        <span>Occupancy</span>
                        <span>
                          {ward.occupied_beds} / {ward.total_beds}
                        </span>
                      </div>
                      <Progress
                        value={occupancyPercent}
                        className="h-2"
                        indicatorClassName={cn(
                          wardStatus === 'critical' && 'bg-rose-500',
                          wardStatus === 'warning' && 'bg-amber-500',
                          wardStatus === 'caution' && 'bg-sky-500',
                          wardStatus === 'good' && 'bg-emerald-500'
                        )}
                      />
                    </div>
                  </div>
                );
              })}
              </div>
            </>
          )}
        </DashboardSection>

        {/* System Activity */}
        <DashboardSection title="System Activity" subtitle="Recent system statistics">
          {isLoading ? (
            <DashboardGrid columns="2">
              {[...Array(2)].map((_, i) => (
                <Skeleton key={i} className="h-32" />
              ))}
            </DashboardGrid>
          ) : (
            <DashboardGrid columns="2">
              <div className="rounded-xl border border-border bg-card p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h4 className="font-heading text-base font-semibold mb-1">
                      Active Staff
                    </h4>
                    <p className="text-xs text-muted-foreground">Currently on duty</p>
                  </div>
                  <Activity className="h-5 w-5 text-emerald-400" />
                </div>
                <div className="font-display text-3xl font-semibold text-foreground">
                  {stats.active_staff || 0}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h4 className="font-heading text-base font-semibold mb-1">
                      System Status
                    </h4>
                    <p className="text-xs text-muted-foreground">Overall health</p>
                  </div>
                  <TrendingUp className="h-5 w-5 text-emerald-400" />
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="font-heading text-lg font-semibold text-emerald-400">
                    Operational
                  </span>
                </div>
              </div>
            </DashboardGrid>
          )}
        </DashboardSection>
      </div>
    </Layout>
  );
}
