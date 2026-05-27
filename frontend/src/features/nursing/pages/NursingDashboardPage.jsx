/* oxlint-disable react-doctor/prefer-useReducer -- These components keep independent UI states; a reducer would add dispatch indirection without a shared transition invariant. */
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import Activity from 'lucide-react/dist/esm/icons/activity.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import ShieldAlert from 'lucide-react/dist/esm/icons/shield-alert.js';
import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

import { usePatientMonitoring, useActiveAlerts } from '@/features/nursing/hooks';
import { useWards } from '@/features/wards/hooks/useWardQueries';
import { PatientMonitoringCard } from '@/components/nursing/PatientMonitoringCard';
import { AlertsPanel } from '@/components/nursing/AlertsPanel';
import { Layout } from '@/components/layout/layout';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import { usePageMeta } from '@/shared/hooks/usePageMeta';
import { cn } from '@/lib/utils';

function filterMonitoringPatients(monitoringData, activeTab) {
  if (!monitoringData) return [];

  switch (activeTab) {
    case 'critical':
      return monitoringData.filter(p =>
        p.latest_vitals?.is_critical || p.active_alerts?.some(a => a.severity === 'critical' || a.severity === 'high')
      );
    case 'alerts':
      return monitoringData.filter(p => p.active_alerts && p.active_alerts.length > 0);
    case 'tasks':
      return monitoringData.filter(p => p.pending_tasks && p.pending_tasks.length > 0);
    default:
      return monitoringData;
  }
}

function buildNursingStats({ monitoringData, totalCount, activeAlerts }) {
  return {
    totalPatients: totalCount || 0,
    criticalPatients: monitoringData.filter(p =>
      p.latest_vitals?.is_critical || p.active_alerts?.some(a => a.severity === 'critical' || a.severity === 'high')
    ).length || 0,
    activeAlerts: activeAlerts?.length || 0,
    pendingTasks: monitoringData.reduce((sum, p) => sum + (p.pending_tasks?.length || 0), 0) || 0,
  };
}

export default function NursingDashboardPage() {
  const [selectedWard, setSelectedWard] = useState(null);
  const [activeTab, setActiveTab] = useState('all');
  const [wardSearchQuery, setWardSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(20);

  const { data: wards, isLoading: wardsLoading } = useWards();
  const { data: monitoringResponse, isLoading: monitoringLoading, refetch, isFetching, error: monitoringError } = usePatientMonitoring(selectedWard, currentPage, pageSize);
  const { data: activeAlerts, isLoading: alertsLoading, error: alertsError } = useActiveAlerts();

  // Extract monitoring data from paginated response
  const monitoringData = useMemo(() => monitoringResponse?.results || [], [monitoringResponse?.results]);
  const totalCount = monitoringResponse?.count || 0;
  const totalPages = monitoringResponse?.total_pages || 1;

  // Prepare ward options for combobox with search
  const wardOptions = useMemo(() => {
    if (!wards) return [];

    const options = [
      { value: 'all', label: 'All Wards' },
      ...wards.map((ward) => ({
        value: ward.id,
        label: `${ward.name} (${ward.available_beds_count}/${ward.total_beds} available)`,
      }))
    ];

    // Filter based on search query
    if (wardSearchQuery) {
      return options.filter(opt =>
        opt.label.toLowerCase().includes(wardSearchQuery.toLowerCase())
      );
    }

    return options;
  }, [wards, wardSearchQuery]);

  const handleWardChange = (value) => {
    setSelectedWard(value === 'all' ? null : value);
    setCurrentPage(1); // Reset to first page when ward changes
  };

  const handleRefresh = () => {
    refetch();
  };

  const handlePageChange = (newPage) => {
    setCurrentPage(newPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const filteredPatients = useMemo(
    () => filterMonitoringPatients(monitoringData, activeTab),
    [activeTab, monitoringData]
  );

  const stats = useMemo(
    () => buildNursingStats({ monitoringData, totalCount, activeAlerts }),
    [activeAlerts, monitoringData, totalCount]
  );

  const pageMeta = usePageMeta({
    title: 'Nursing Dashboard | HMS',
    breadcrumbs: [
      { label: 'Nursing', href: '/nursing' },
      { label: 'Dashboard', href: '/nursing/dashboard' },
    ],
  });

  return (
    <Layout>
      <PageShell>
        {pageMeta}
        <NursingDashboardHeader
          wardOptions={wardOptions}
          selectedWard={selectedWard}
          wardsLoading={wardsLoading}
          isFetching={isFetching}
          onWardChange={handleWardChange}
          onWardSearchChange={setWardSearchQuery}
          onRefresh={handleRefresh}
        />

        <div className="p-4 sm:p-6 space-y-6">
          <NursingDataErrorAlert
            monitoringError={monitoringError}
            alertsError={alertsError}
          />

          <NursingStatsGrid stats={stats} />

          <NursingDashboardGrid
            activeAlerts={activeAlerts}
            activeTab={activeTab}
            alertsLoading={alertsLoading}
            currentPage={currentPage}
            filteredPatients={filteredPatients}
            isFetching={isFetching}
            monitoringLoading={monitoringLoading}
            pageSize={pageSize}
            selectedWard={selectedWard}
            stats={stats}
            totalCount={totalCount}
            totalPages={totalPages}
            onPageChange={handlePageChange}
            onTabChange={setActiveTab}
          />
        </div>
      </PageShell>
    </Layout>
  );
}

function NursingDashboardHeader({
  wardOptions,
  selectedWard,
  wardsLoading,
  isFetching,
  onWardChange,
  onWardSearchChange,
  onRefresh,
}) {
  return (
    <PageHeader
      title="Patient Monitoring Dashboard"
      description="Real-time patient monitoring and care management"
      actions={(
        <div className="flex items-center gap-2">
          <div className="w-[300px]">
            <Combobox
              options={wardOptions}
              value={selectedWard || 'all'}
              onChange={onWardChange}
              onInputChange={onWardSearchChange}
              placeholder="Search wards..."
              searchPlaceholder="Type to search wards..."
              emptyMessage="No wards found."
              isLoading={wardsLoading}
              maxHeight="20rem"
            />
          </div>

          <Button
            variant="outline"
            size="icon"
            onClick={onRefresh}
            disabled={isFetching}
            aria-label="Refresh nursing dashboard"
          >
            <RefreshCw className={`size-4 ${isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      )}
    />
  );
}

function NursingDataErrorAlert({ monitoringError, alertsError }) {
  if (!monitoringError && !alertsError) {
    return null;
  }

  return (
    <Alert variant="destructive">
      <ShieldAlert className="size-4" />
      <AlertTitle>Error Loading Nursing Data</AlertTitle>
      <AlertDescription>
        {monitoringError && (
          <div className="mb-2">
            <strong>Patient Monitoring:</strong>{' '}
            {monitoringError.response?.status === 403
              ? 'You do not have permission to access nursing features. Please contact your administrator to assign you a nurse role.'
              : monitoringError.response?.status === 404
              ? 'Nursing endpoints not found. The nursing module may not be properly configured.'
              : monitoringError.message || 'Unable to load patient monitoring data.'}
          </div>
        )}
        {alertsError && (
          <div>
            <strong>Active Alerts:</strong>{' '}
            {alertsError.response?.status === 403
              ? 'You do not have permission to view alerts.'
              : alertsError.response?.status === 404
              ? 'Alerts endpoint not found.'
              : alertsError.message || 'Unable to load active alerts.'}
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}

function NursingStatsGrid({ stats }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <NursingStatCard
        title="Total Patients"
        value={stats.totalPatients}
        description="Currently admitted"
        icon={Users}
      />
      <NursingStatCard
        title="Critical Patients"
        value={stats.criticalPatients}
        description="Require immediate attention"
        icon={Activity}
        valueClassName="text-red-600"
        iconClassName="text-red-600"
      />
      <NursingStatCard
        title="Active Alerts"
        value={stats.activeAlerts}
        description="Unacknowledged alerts"
        icon={AlertTriangle}
        valueClassName="text-orange-600"
        iconClassName="text-orange-600"
      />
      <NursingStatCard
        title="Pending Tasks"
        value={stats.pendingTasks}
        description="Tasks to complete"
        icon={Activity}
        valueClassName="text-blue-600"
        iconClassName="text-blue-600"
      />
    </div>
  );
}

function NursingStatCard({
  title,
  value,
  description,
  icon: Icon,
  valueClassName,
  iconClassName = 'text-muted-foreground',
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className={cn('size-4', iconClassName)} />
      </CardHeader>
      <CardContent>
        <div className={cn('text-2xl font-bold', valueClassName)}>{value}</div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function NursingDashboardGrid({
  activeAlerts,
  activeTab,
  alertsLoading,
  currentPage,
  filteredPatients,
  isFetching,
  monitoringLoading,
  pageSize,
  selectedWard,
  stats,
  totalCount,
  totalPages,
  onPageChange,
  onTabChange,
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <NursingPatientList
          activeTab={activeTab}
          currentPage={currentPage}
          filteredPatients={filteredPatients}
          isFetching={isFetching}
          monitoringLoading={monitoringLoading}
          pageSize={pageSize}
          selectedWard={selectedWard}
          stats={stats}
          totalCount={totalCount}
          totalPages={totalPages}
          onPageChange={onPageChange}
          onTabChange={onTabChange}
        />
      </div>

      <div>
        <AlertsPanel alerts={activeAlerts} isLoading={alertsLoading} />
      </div>
    </div>
  );
}

function NursingPatientList({
  activeTab,
  currentPage,
  filteredPatients,
  isFetching,
  monitoringLoading,
  pageSize,
  selectedWard,
  stats,
  totalCount,
  totalPages,
  onPageChange,
  onTabChange,
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Patient List</CardTitle>
            <CardDescription>
              {filteredPatients.length} patients
            </CardDescription>
          </div>

          <NursingPatientTabs
            activeTab={activeTab}
            stats={stats}
            onTabChange={onTabChange}
          />
        </div>
      </CardHeader>
      <CardContent>
        <NursingPatientListContent
          filteredPatients={filteredPatients}
          monitoringLoading={monitoringLoading}
          selectedWard={selectedWard}
          totalCount={totalCount}
        />

        <NursingPagination
          currentPage={currentPage}
          isFetching={isFetching}
          pageSize={pageSize}
          totalCount={totalCount}
          totalPages={totalPages}
          onPageChange={onPageChange}
        />
      </CardContent>
    </Card>
  );
}

function NursingPatientTabs({ activeTab, stats, onTabChange }) {
  return (
    <Tabs value={activeTab} onValueChange={onTabChange}>
      <TabsList>
        <TabsTrigger value="all">All</TabsTrigger>
        <TabsTrigger value="critical">
          Critical
          {stats.criticalPatients > 0 && (
            <Badge variant="destructive" className="ml-2 size-5 p-0 flex items-center justify-center">
              {stats.criticalPatients}
            </Badge>
          )}
        </TabsTrigger>
        <TabsTrigger value="alerts">
          Alerts
          {stats.activeAlerts > 0 && (
            <Badge variant="outline" className="ml-2">
              {stats.activeAlerts}
            </Badge>
          )}
        </TabsTrigger>
        <TabsTrigger value="tasks">Tasks</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

function NursingPatientListContent({
  filteredPatients,
  monitoringLoading,
  selectedWard,
  totalCount,
}) {
  if (monitoringLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-48 w-full" />
        ))}
      </div>
    );
  }

  if (totalCount === 0) {
    return (
      <NursingPatientEmptyState
        title="No patients found"
        description={selectedWard ? 'Try selecting a different ward' : 'No admitted patients at this time'}
      />
    );
  }

  if (filteredPatients.length === 0) {
    return (
      <NursingPatientEmptyState
        title="No patients match the selected filter"
        description='Try selecting the "All" tab to see all patients'
      />
    );
  }

  return (
    <div className="space-y-4">
      {filteredPatients.map((patientData) => (
        <PatientMonitoringCard
          key={patientData.patient.id}
          patientData={patientData}
        />
      ))}
    </div>
  );
}

function NursingPatientEmptyState({ title, description }) {
  return (
    <div className="text-center py-12">
      <Users className="size-12 text-muted-foreground mx-auto mb-4" />
      <p className="text-muted-foreground">{title}</p>
      <p className="text-xs text-muted-foreground mt-2">
        {description}
      </p>
    </div>
  );
}

function NursingPagination({
  currentPage,
  isFetching,
  pageSize,
  totalCount,
  totalPages,
  onPageChange,
}) {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <div className="flex items-center justify-between mt-6">
      <div className="text-sm text-muted-foreground">
        Showing {((currentPage - 1) * pageSize) + 1} to {Math.min(currentPage * pageSize, totalCount)} of {totalCount} patients
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1 || isFetching}
        >
          Previous
        </Button>
        <NursingPageButtons
          currentPage={currentPage}
          isFetching={isFetching}
          totalPages={totalPages}
          onPageChange={onPageChange}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages || isFetching}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

function NursingPageButtons({ currentPage, isFetching, totalPages, onPageChange }) {
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
        let pageNum;
        if (totalPages <= 5) {
          pageNum = i + 1;
        } else if (currentPage <= 3) {
          pageNum = i + 1;
        } else if (currentPage >= totalPages - 2) {
          pageNum = totalPages - 4 + i;
        } else {
          pageNum = currentPage - 2 + i;
        }

        return (
          <Button
            key={pageNum}
            variant={currentPage === pageNum ? 'default' : 'outline'}
            size="sm"
            onClick={() => onPageChange(pageNum)}
            disabled={isFetching}
          >
            {pageNum}
          </Button>
        );
      })}
    </div>
  );
}
