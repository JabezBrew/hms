import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import Activity from 'lucide-react/dist/esm/icons/activity.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import ShieldAlert from 'lucide-react/dist/esm/icons/shield-alert.js';
import Package from 'lucide-react/dist/esm/icons/package.js';
import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

import { usePatientMonitoring, useActiveAlerts, useLowSupplyEntries } from '@/hooks/useNursingQueries';
import { useWards } from '@/hooks/useWardQueries';
import { PatientMonitoringCard } from '@/components/nursing/PatientMonitoringCard';
import { AlertsPanel } from '@/components/nursing/AlertsPanel';
import { Layout } from '@/components/layout/layout';
import { PageBreadcrumb } from '@/components/layout/PageBreadcrumb';

export default function NursingDashboardPage() {
  const navigate = useNavigate();
  const [selectedWard, setSelectedWard] = useState(null);
  const [activeTab, setActiveTab] = useState('all');
  const [wardSearchQuery, setWardSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(20);

  const { data: wards, isLoading: wardsLoading } = useWards();
  const { data: monitoringResponse, isLoading: monitoringLoading, refetch, isFetching, error: monitoringError } = usePatientMonitoring(selectedWard, currentPage, pageSize);
  const { data: activeAlerts, isLoading: alertsLoading, error: alertsError } = useActiveAlerts();
  const { data: lowSupplyEntries = [], isLoading: lowSupplyLoading } = useLowSupplyEntries();

  // Extract monitoring data from paginated response
  const monitoringData = monitoringResponse?.results || [];
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

  // Filter patients based on active tab
  const getFilteredPatients = () => {
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
  };

  const filteredPatients = getFilteredPatients();

  // Calculate statistics
  const stats = {
    totalPatients: totalCount || 0,
    criticalPatients: monitoringData.filter(p =>
      p.latest_vitals?.is_critical || p.active_alerts?.some(a => a.severity === 'critical' || a.severity === 'high')
    ).length || 0,
    activeAlerts: activeAlerts?.length || 0,
    pendingTasks: monitoringData.reduce((sum, p) => sum + (p.pending_tasks?.length || 0), 0) || 0,
  };

  const breadcrumbItems = [
    { label: 'Nursing', href: '/nursing' },
    { label: 'Dashboard', href: '/nursing/dashboard' },
  ];

  return (
    <Layout>
      <div className="space-y-6">
        <PageBreadcrumb items={breadcrumbItems} />

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Patient Monitoring Dashboard</h1>
            <p className="text-muted-foreground">
              Real-time patient monitoring and care management
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="w-[300px]">
              <Combobox
                options={wardOptions}
                value={selectedWard || 'all'}
                onChange={handleWardChange}
                onInputChange={setWardSearchQuery}
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
              onClick={handleRefresh}
              disabled={isFetching}
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {/* Error Alerts */}
        {(monitoringError || alertsError) && (
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
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
        )}

        {/* Statistics Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Patients</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalPatients}</div>
              <p className="text-xs text-muted-foreground">Currently admitted</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Critical Patients</CardTitle>
              <Activity className="h-4 w-4 text-red-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{stats.criticalPatients}</div>
              <p className="text-xs text-muted-foreground">Require immediate attention</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Alerts</CardTitle>
              <AlertTriangle className="h-4 w-4 text-orange-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600">{stats.activeAlerts}</div>
              <p className="text-xs text-muted-foreground">Unacknowledged alerts</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pending Tasks</CardTitle>
              <Activity className="h-4 w-4 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">{stats.pendingTasks}</div>
              <p className="text-xs text-muted-foreground">Tasks to complete</p>
            </CardContent>
          </Card>

          <Card
            className="cursor-pointer hover:border-amber-500/50 transition-colors"
            onClick={() => navigate('/pharmacy/supply-queue')}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Low Supply</CardTitle>
              <Package className="h-4 w-4 text-amber-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-600">{lowSupplyEntries.length}</div>
              <p className="text-xs text-muted-foreground">Medications &lt; 2 days</p>
            </CardContent>
          </Card>
        </div>

        {/* Main Content */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Patient List */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Patient List</CardTitle>
                    <CardDescription>
                      {filteredPatients.length} patients
                    </CardDescription>
                  </div>

                  <Tabs value={activeTab} onValueChange={setActiveTab}>
                    <TabsList>
                      <TabsTrigger value="all">All</TabsTrigger>
                      <TabsTrigger value="critical">
                        Critical
                        {stats.criticalPatients > 0 && (
                          <Badge variant="destructive" className="ml-2 h-5 w-5 p-0 flex items-center justify-center">
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
                </div>
              </CardHeader>
              <CardContent>
                {monitoringLoading ? (
                  <div className="space-y-4">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-48 w-full" />
                    ))}
                  </div>
                ) : totalCount === 0 ? (
                  <div className="text-center py-12">
                    <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">No patients found</p>
                    <p className="text-xs text-muted-foreground mt-2">
                      {selectedWard ? 'Try selecting a different ward' : 'No admitted patients at this time'}
                    </p>
                  </div>
                ) : filteredPatients.length === 0 ? (
                  <div className="text-center py-12">
                    <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">No patients match the selected filter</p>
                    <p className="text-xs text-muted-foreground mt-2">
                      Try selecting the "All" tab to see all patients
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {filteredPatients.map((patientData) => (
                      <PatientMonitoringCard
                        key={patientData.patient.id}
                        patientData={patientData}
                      />
                    ))}
                  </div>
                )}

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-6">
                    <div className="text-sm text-muted-foreground">
                      Showing {((currentPage - 1) * pageSize) + 1} to {Math.min(currentPage * pageSize, totalCount)} of {totalCount} patients
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePageChange(currentPage - 1)}
                        disabled={currentPage === 1 || isFetching}
                      >
                        Previous
                      </Button>
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
                              onClick={() => handlePageChange(pageNum)}
                              disabled={isFetching}
                            >
                              {pageNum}
                            </Button>
                          );
                        })}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePageChange(currentPage + 1)}
                        disabled={currentPage === totalPages || isFetching}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Alerts Sidebar */}
          <div>
            <AlertsPanel alerts={activeAlerts} isLoading={alertsLoading} />
          </div>
        </div>
      </div>
    </Layout>
  );
}
