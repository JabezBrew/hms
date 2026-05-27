/* oxlint-disable react-doctor/prefer-useReducer -- These components keep independent UI states; a reducer would add dispatch indirection without a shared transition invariant. */
import Shield from 'lucide-react/dist/esm/icons/shield.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import Filter from 'lucide-react/dist/esm/icons/funnel.js';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import VirtualizedTable from '@/components/ui/VirtualizedTable';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageState } from '@/shared/components/page/PageState';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { useSearchParams } from 'react-router-dom';
import {
  usePatientInsurances,
  useDeletePatientInsurance,
} from '@/features/billing/hooks';
import { useDebounce } from '@/hooks/use-debounce';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import format from 'date-fns/format';
import parseISO from 'date-fns/parseISO';
import { toast } from 'sonner';

import PatientInsuranceFormSlideOver from '@/components/billing/PatientInsuranceFormSlideOver';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Status' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

function createInsuranceColumns({
  insuranceMutationsAvailable,
  onDelete,
  onEdit,
}) {
  return [
    {
      key: 'patient',
      header: 'Patient',
      width: '220px',
      render: (insurance) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{insurance.patient_name || 'Unknown Patient'}</p>
          <p className="truncate text-xs text-muted-foreground">Policy: {insurance.policy_number || '—'}</p>
        </div>
      ),
    },
    {
      key: 'coverage',
      header: 'Coverage',
      width: '240px',
      render: (insurance) => (
        <div className="min-w-0">
          <p className="truncate text-sm text-foreground">{insurance.provider_name || insurance.plan_name || '—'}</p>
          <p className="truncate text-xs text-muted-foreground">{insurance.plan_name || 'No plan name'}</p>
        </div>
      ),
    },
    {
      key: 'member',
      header: 'Member ID',
      width: '160px',
      render: (insurance) => (
        <span className="font-mono text-sm text-muted-foreground">
          {insurance.member_id || insurance.subscriber_number || '—'}
        </span>
      ),
    },
    {
      key: 'validity',
      header: 'Validity',
      width: '220px',
      render: (insurance) => (
        <span className="font-mono text-xs text-muted-foreground">
          {formatDate(insurance.valid_from)}
          {insurance.valid_until ? ` - ${formatDate(insurance.valid_until)}` : ' - No expiry'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '120px',
      render: (insurance) => (
        <Badge
          variant="outline"
          className={insurance.is_active
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700 text-xs'
            : 'text-xs'
          }
        >
          {insurance.is_active ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '160px',
      render: (insurance) => (
        insuranceMutationsAvailable ? (
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={(event) => {
                event.stopPropagation();
                onEdit(insurance);
              }}
            >
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs text-destructive"
              onClick={(event) => {
                event.stopPropagation();
                onDelete(insurance);
              }}
            >
              Delete
            </Button>
          </div>
        ) : null
      ),
    },
  ];
}

function InsuranceHeader({ insuranceMutationsAvailable, onAddInsurance }) {
  return (
    <PageHeader
      title={(
        <span className="flex items-center gap-3">
          <Shield className="size-7 text-[oklch(0.70_0.15_230)]" />
          Patient Insurance
        </span>
      )}
      description="Manage patient insurance records and coverage"
      actions={insuranceMutationsAvailable ? (
        <Button onClick={onAddInsurance} className="font-mono text-xs">
          <Plus className="size-4 mr-2" />
          Add Insurance
        </Button>
      ) : null}
    />
  );
}

function InsuranceReadOnlyNotice({ insuranceMutationsAvailable }) {
  if (insuranceMutationsAvailable) {
    return null;
  }

  return (
    <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
      <p className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
        Rust V2 read-only mode
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        Patient insurance editing is not available in Rust V2 mode yet. Existing coverage
        records remain read-only until patient insurance mutation contracts are implemented.
      </p>
    </div>
  );
}

function InsuranceFilters({
  activeFilter,
  clearFilters,
  handleSearchChange,
  handleStatusChange,
  hasActiveFilters,
  search,
}) {
  return (
    <div className="flex flex-col sm:flex-row gap-3">
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="Search by patient name, policy number..."
          value={search}
          onChange={handleSearchChange}
          className="pl-10 font-mono text-sm"
        />
      </div>

      <Select value={activeFilter} onValueChange={handleStatusChange}>
        <SelectTrigger className="w-full sm:w-40">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value} className="font-mono text-sm">
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasActiveFilters && (
        <Button variant="ghost" onClick={clearFilters} className="font-mono text-xs">
          <Filter className="size-4 mr-2" />
          Clear Filters
        </Button>
      )}
    </div>
  );
}

function InsuranceEmptyState({
  hasActiveFilters,
  insuranceMutationsAvailable,
  onAddInsurance,
}) {
  return (
    <div className="text-center py-12">
      <Shield className="size-12 text-muted-foreground/50 mx-auto mb-4" />
      <h3 className="font-display text-lg text-foreground mb-2">No insurance records found</h3>
      <p className="text-muted-foreground text-sm mb-4">
        {hasActiveFilters
          ? 'Try adjusting your filters'
          : 'Get started by adding a patient insurance record'}
      </p>
      {!hasActiveFilters && insuranceMutationsAvailable && (
        <Button onClick={onAddInsurance} className="font-mono text-xs">
          <Plus className="size-4 mr-2" />
          Add Insurance
        </Button>
      )}
    </div>
  );
}

function InsuranceResults({
  columns,
  handlePageChange,
  hasActiveFilters,
  insuranceMutationsAvailable,
  insurances,
  onAddInsurance,
  page,
  totalCount,
  totalPages,
}) {
  return (
    <>
      <div className="flex items-center justify-between">
        <p className="font-mono text-xs text-muted-foreground">
          {totalCount} record{totalCount !== 1 ? 's' : ''} found
        </p>
      </div>

      {insurances.length === 0 ? (
        <InsuranceEmptyState
          hasActiveFilters={hasActiveFilters}
          insuranceMutationsAvailable={insuranceMutationsAvailable}
          onAddInsurance={onAddInsurance}
        />
      ) : (
        <div className="overflow-x-auto">
          <VirtualizedTable
            rows={insurances}
            rowKey={(insurance) => insurance.id}
            rowHeight={68}
            columns={columns}
            rowClassName="hover:bg-muted/30"
            className="min-w-[1120px]"
            headerClassName="bg-muted/50 border-b border-border"
          />
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-4">
          <p className="font-mono text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(page - 1)}
              disabled={page <= 1}
              className="font-mono text-xs"
            >
              <ChevronLeft className="size-4 mr-1" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(page + 1)}
              disabled={page >= totalPages}
              className="font-mono text-xs"
            >
              Next
              <ChevronRight className="size-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

function InsuranceMutations({
  deleteDialogOpen,
  deleteMutation,
  editingInsurance,
  handleConfirmDelete,
  insuranceMutationsAvailable,
  insuranceToDelete,
  setDeleteDialogOpen,
  setEditingInsurance,
  setShowFormSlideOver,
  showFormSlideOver,
}) {
  if (!insuranceMutationsAvailable) {
    return null;
  }

  return (
    <>
      <PatientInsuranceFormSlideOver
        open={showFormSlideOver}
        onClose={() => {
          setShowFormSlideOver(false);
          setEditingInsurance(null);
        }}
        insurance={editingInsurance}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Insurance Record</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this insurance record for{' '}
              <strong>{insuranceToDelete?.patient_name}</strong>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function InsuranceManagementPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const insuranceMutationsAvailable = !isRustV2ApiMode();

  const [search, setSearch] = useState(searchParams.get('search') || '');
  const activeFilter = searchParams.get('is_active') || 'all';
  const page = parseInt(searchParams.get('page') || '1', 10);

  const [showFormSlideOver, setShowFormSlideOver] = useState(false);
  const [editingInsurance, setEditingInsurance] = useState(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [insuranceToDelete, setInsuranceToDelete] = useState(null);

  const debouncedSearch = useDebounce(search, 300);
  const deleteMutation = useDeletePatientInsurance();

  const queryParams = {
    page,
    page_size: 20,
    ...(debouncedSearch && { search: debouncedSearch }),
    ...(activeFilter !== 'all' && { is_active: activeFilter === 'active' }),
  };

  const {
    data: insurancesData,
    isLoading,
    error,
    refetch,
  } = usePatientInsurances(queryParams);

  const insurances = insurancesData?.results || [];
  const totalCount = insurancesData?.count || 0;
  const totalPages = Math.ceil(totalCount / 20);

  const handleSearchChange = (event) => {
    setSearch(event.target.value);
  };

  const handleStatusChange = (value) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (value !== 'all') {
        params.set('is_active', value);
      } else {
        params.delete('is_active');
      }
      params.set('page', '1');
      return params;
    });
  };

  const clearFilters = () => {
    setSearch('');
    setSearchParams({});
  };

  const hasActiveFilters = activeFilter !== 'all' || debouncedSearch;

  const handlePageChange = (newPage) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set('page', newPage.toString());
      return params;
    });
  };

  const handleAddInsurance = () => {
    setEditingInsurance(null);
    setShowFormSlideOver(true);
  };

  const handleEditInsurance = (insurance) => {
    setEditingInsurance(insurance);
    setShowFormSlideOver(true);
  };

  const handleDeleteClick = (insurance) => {
    setInsuranceToDelete(insurance);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!insuranceToDelete) return;

    try {
      await deleteMutation.mutateAsync(insuranceToDelete.id);
      toast.success('Patient insurance deleted successfully');
      setDeleteDialogOpen(false);
      setInsuranceToDelete(null);
    } catch (err) {
      toast.error(err.message || 'Failed to delete patient insurance');
    }
  };

  const insuranceColumns = createInsuranceColumns({
    insuranceMutationsAvailable,
    onDelete: handleDeleteClick,
    onEdit: handleEditInsurance,
  });

  if (isLoading) {
    return (
      <PageState variant="loading">
        <Skeleton className="h-12 w-64" />
        <div className="flex gap-4">
          <Skeleton className="h-10 flex-1 max-w-md" />
          <Skeleton className="h-10 w-40" />
        </div>
        <div className="space-y-3">
          {[...Array(8)].map((_, index) => (
            <Skeleton key={index} className="h-20 rounded-xl" />
          ))}
        </div>
      </PageState>
    );
  }

  if (error) {
    return (
      <PageState
        variant="error"
        title="Error Loading Insurance Records"
        description={error.message}
        action={() => refetch()}
      />
    );
  }

  return (
    <PageShell>
      <InsuranceHeader
        insuranceMutationsAvailable={insuranceMutationsAvailable}
        onAddInsurance={handleAddInsurance}
      />

      <main className="p-4 sm:p-6 space-y-6">
        <InsuranceReadOnlyNotice insuranceMutationsAvailable={insuranceMutationsAvailable} />

        <InsuranceFilters
          activeFilter={activeFilter}
          clearFilters={clearFilters}
          handleSearchChange={handleSearchChange}
          handleStatusChange={handleStatusChange}
          hasActiveFilters={hasActiveFilters}
          search={search}
        />

        <InsuranceResults
          columns={insuranceColumns}
          handlePageChange={handlePageChange}
          hasActiveFilters={hasActiveFilters}
          insuranceMutationsAvailable={insuranceMutationsAvailable}
          insurances={insurances}
          onAddInsurance={handleAddInsurance}
          page={page}
          totalCount={totalCount}
          totalPages={totalPages}
        />
      </main>

      <InsuranceMutations
        deleteDialogOpen={deleteDialogOpen}
        deleteMutation={deleteMutation}
        editingInsurance={editingInsurance}
        handleConfirmDelete={handleConfirmDelete}
        insuranceMutationsAvailable={insuranceMutationsAvailable}
        insuranceToDelete={insuranceToDelete}
        setDeleteDialogOpen={setDeleteDialogOpen}
        setEditingInsurance={setEditingInsurance}
        setShowFormSlideOver={setShowFormSlideOver}
        showFormSlideOver={showFormSlideOver}
      />
    </PageShell>
  );
}

function formatDate(dateString) {
  if (!dateString) return '-';
  return format(parseISO(dateString), 'MMM d, yyyy');
}
