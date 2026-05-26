import Search from 'lucide-react/dist/esm/icons/search.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import Star from 'lucide-react/dist/esm/icons/star.js';
import Pin from 'lucide-react/dist/esm/icons/pin.js';
import { useState, useMemo, useEffect } from "react";
import { useNavigate, NavLink } from "react-router-dom";
import {
  useMyPatients,
  useRemoveFromMyPatients,
  useToggleMyPatientPin,
} from "@/features/patients/hooks/useMyPatientsQueries";
import { cn, normalizeApiResults } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import VirtualizedTable from '@/components/ui/VirtualizedTable';
import { PageShell } from "@/shared/components/page/PageShell";
import { PageHeader } from "@/shared/components/page/PageHeader";
import { usePageMeta } from "@/shared/hooks/usePageMeta";
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import {
  prefetchMyPatientsRoute,
  prefetchPatientRegistryRoute,
} from "@/features/patients/prefetch";

/**
 * MyPatientsPage - Dedicated page for user's personal patient list
 *
 * Features:
 * - View manually curated patient list
 * - Pin/unpin patients
 * - Remove patients from list
 * - Filter by search query
 * - Sort by pinned first
 */
const MyPatientsPage = () => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const rustV2Mode = isRustV2ApiMode();
  const pageMeta = usePageMeta({
    title: 'My Patients | Hospital Management System',
    breadcrumbs: [
      { label: 'Patients', path: '/patients' },
      { label: 'My Patients', path: '/patients/my-patients' },
    ],
  });

  useEffect(() => {
    prefetchMyPatientsRoute();
    prefetchPatientRegistryRoute();
  }, []);

  // Fetch My Patients data
  const {
    data: myPatientsData,
    isLoading,
    refetch,
  } = useMyPatients();

  // Mutations
  const removeFromMyPatients = useRemoveFromMyPatients();
  const togglePin = useToggleMyPatientPin();

  // Process patient list
  const patients = useMemo(() => {
    const entries = normalizeApiResults(myPatientsData);
    if (!entries.length) return [];

    // Transform entries to include metadata
    let patientList = entries.map(entry => ({
      ...entry.patient_details,
      _listEntryId: entry.id,
      _isPinned: entry.is_pinned,
      _listNotes: entry.notes,
      _addedAt: entry.added_at,
    }));

    // Sort: pinned first, then by added date
    patientList.sort((a, b) => {
      if (a._isPinned && !b._isPinned) return -1;
      if (!a._isPinned && b._isPinned) return 1;
      return new Date(b._addedAt) - new Date(a._addedAt);
    });

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      patientList = patientList.filter(p => {
        const name = getDisplayName(p).toLowerCase();
        const mrn = (p.medical_record_number || '').toLowerCase();
        return name.includes(query) || mrn.includes(query);
      });
    }

    return patientList;
  }, [myPatientsData, searchQuery]);

  // Stats
  const stats = useMemo(() => {
    const entries = normalizeApiResults(myPatientsData);
    const total = entries.length;
    const pinned = entries.filter(e => e.is_pinned).length;
    return { total, pinned };
  }, [myPatientsData]);

  // Event handlers
  const handleSearchChange = (e) => {
    setSearchQuery(e.target.value);
  };

  const handleClearSearch = () => {
    setSearchQuery("");
  };

  const handleRemoveFromMyPatients = (patientId) => {
    removeFromMyPatients.mutate(patientId);
  };

  const handleTogglePin = (entryId) => {
    togglePin.mutate(entryId);
  };

  const handleStartRound = (patient) => {
    const patientId = patient?.id || patient?.patient_profile;
    if (patientId) {
      navigate(`/patients/${patientId}?wardRound=true`);
    }
  };

  const handleStartConsultation = (patient) => {
    const patientId = patient?.id || patient?.patient_profile;
    if (patientId) {
      navigate(`/patients/${patientId}?consultation=true`);
    }
  };

  const handleAddPatient = () => {
    navigate('/patients');
  };

  const myPatientColumns = useMemo(() => {
    const columns = [];

    if (!rustV2Mode) {
      columns.push({
        key: "pinned",
        header: "",
        width: "56px",
        render: (patient) => (
          <button
            type="button"
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
            onClick={(event) => {
              event.stopPropagation();
              handleTogglePin(patient._listEntryId);
            }}
          >
            <Pin className={cn("size-4", patient._isPinned && "fill-current text-primary")} />
          </button>
        ),
      });
    }

    columns.push({
      key: "patient",
      header: "Patient",
      width: "240px",
      render: (patient) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{getDisplayName(patient)}</p>
          <p className="font-mono text-xs text-muted-foreground">
            MRN: {patient.medical_record_number || "—"}
          </p>
        </div>
      ),
    });

    columns.push({
      key: "notes",
      header: rustV2Mode ? "Context" : "Notes",
      width: "260px",
      render: (patient) => (
        <span className="truncate text-sm text-muted-foreground">
          {patient._listNotes || "No notes"}
        </span>
      ),
    });

    columns.push({
      key: "added",
      header: rustV2Mode ? "Updated" : "Added",
      width: "180px",
      render: (patient) => (
        <span className="font-mono text-sm text-muted-foreground">
          {patient._addedAt ? new Date(patient._addedAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          }) : "—"}
        </span>
      ),
    });

    columns.push({
      key: "status",
      header: "Status",
      width: "120px",
      render: (patient) => (
        <Badge variant="outline" className="text-xs">
          {rustV2Mode ? "Context" : patient._isPinned ? "Pinned" : "Tracked"}
        </Badge>
      ),
    });

    columns.push({
      key: "actions",
      header: "",
      width: rustV2Mode ? "160px" : "240px",
      render: (patient) => (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={(event) => {
              event.stopPropagation();
              handleStartRound(patient);
            }}
          >
            Round
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={(event) => {
              event.stopPropagation();
              handleStartConsultation(patient);
            }}
          >
            Consult
          </Button>
          {!rustV2Mode && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs text-destructive"
              onClick={(event) => {
                event.stopPropagation();
                const patientId = patient?.id || patient?.patient_profile;
                handleRemoveFromMyPatients(patientId);
              }}
            >
              Remove
            </Button>
          )}
        </div>
      ),
    });

    return columns;
  }, [rustV2Mode]);

  return (
    <PageShell>
      {pageMeta}
      <PageHeader
        title="My Patients"
        description={`${stats.total} patients${!rustV2Mode && stats.pinned > 0 ? ` · ${stats.pinned} pinned` : ''}`}
        size="md"
        actions={(
          <Button
            onClick={handleAddPatient}
            variant="outline"
            size="sm"
            className="font-mono text-xs w-full sm:w-auto"
          >
            <Plus className="size-4 mr-2" />
            {rustV2Mode ? 'Open Registry' : 'Add from Registry'}
          </Button>
        )}
      >
        {/* Tab Navigation */}
        <div className="flex items-center gap-1 mt-4 bg-muted rounded-lg p-1 w-fit">
          <NavLink
            to="/patients"
            end
            onMouseEnter={prefetchPatientRegistryRoute}
            onFocus={prefetchPatientRegistryRoute}
            className={({ isActive }) => cn(
              "px-4 py-2 rounded-md text-sm font-mono transition-colors flex items-center gap-2",
              isActive
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Users className="size-4" />
            All Patients
          </NavLink>
          <NavLink
            to="/patients/my-patients"
            onMouseEnter={prefetchMyPatientsRoute}
            onFocus={prefetchMyPatientsRoute}
            className={({ isActive }) => cn(
              "px-4 py-2 rounded-md text-sm font-mono transition-colors flex items-center gap-2",
              isActive
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Star className="size-4" />
            My Patients
          </NavLink>
        </div>

        {/* Search and Controls */}
        <div className="flex flex-col gap-3 mt-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Filter your patients..."
              value={searchQuery}
              onChange={handleSearchChange}
              className="pl-10 pr-10 font-mono text-sm bg-background"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={handleClearSearch}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            )}
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => refetch()}
              className="shrink-0 size-9"
            >
              <RefreshCw className="size-4" />
            </Button>
          </div>
        </div>
      </PageHeader>

      {/* Patient List */}
      <main className="p-4 sm:p-6">
        {isLoading ? (
          <LoadingSkeleton />
        ) : patients.length === 0 ? (
          <EmptyState hasSearch={!!searchQuery} onClear={handleClearSearch} />
        ) : (
          <div className="overflow-x-auto">
            <VirtualizedTable
              rows={patients}
              rowKey={(patient, index) => patient._listEntryId || patient.id || index}
              rowHeight={68}
              columns={myPatientColumns}
              onRowClick={(patient) => {
                const patientId = patient?.id || patient?.patient_profile || patient?.local_data?.id;
                if (patientId) {
                  navigate(`/patients/${patientId}`);
                }
              }}
              rowClassName="hover:bg-muted/30"
              className="min-w-[1140px]"
              headerClassName="bg-muted/50 border-b border-border"
            />
          </div>
        )}
      </main>
    </PageShell>
  );
};

/**
 * LoadingSkeleton
 */
const LoadingSkeleton = () => {
  return (
    <div className="space-y-3 rounded-xl border border-border/60 bg-card/40 p-4">
      <Skeleton className="h-10 w-full rounded-lg" />
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-lg" />
      ))}
    </div>
  );
};

/**
 * EmptyState
 */
const EmptyState = ({ hasSearch, onClear }) => {
  const navigate = useNavigate();

  if (hasSearch) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="size-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <Search className="size-8 text-muted-foreground" />
        </div>
        <h3 className="font-display text-xl text-foreground mb-2">
          No matching patients
        </h3>
        <p className="text-muted-foreground text-sm mb-4 max-w-md">
          No patients in your list match your search.
        </p>
        <Button variant="outline" size="sm" onClick={onClear}>
          <X className="size-4 mr-2" />
          Clear Filter
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="size-16 rounded-full bg-muted flex items-center justify-center mb-4">
        <Star className="size-8 text-muted-foreground" />
      </div>
      <h3 className="font-display text-xl text-foreground mb-2">
        No patients in your list
      </h3>
      <p className="text-muted-foreground text-sm mb-4 max-w-md">
        Add patients to your personal list for quick access during ward rounds.
      </p>
      <Button onClick={() => navigate('/patients')}>
        <Plus className="size-4 mr-2" />
        Browse Patient Registry
      </Button>
    </div>
  );
};

// Helper function
const getDisplayName = (patient) => {
  if (patient?.user_details) {
    const { first_name, last_name } = patient.user_details;
    return `${first_name || ''} ${last_name || ''}`.trim() || "Unknown";
  }
  return "Unknown";
};

export default MyPatientsPage;
