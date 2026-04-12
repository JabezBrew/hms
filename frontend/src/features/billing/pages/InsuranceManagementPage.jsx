import Shield from 'lucide-react/dist/esm/icons/shield.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Filter from 'lucide-react/dist/esm/icons/funnel.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import User from 'lucide-react/dist/esm/icons/user.js';
import Building from 'lucide-react/dist/esm/icons/building.js';
import Edit from 'lucide-react/dist/esm/icons/square-pen.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import CheckCircle from 'lucide-react/dist/esm/icons/circle-check-big.js';
import XCircle from 'lucide-react/dist/esm/icons/circle-x.js';
import { useState } from 'react';
import { cn } from '@/lib/utils';
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
import format from 'date-fns/format';
import parseISO from 'date-fns/parseISO';
import { toast } from 'sonner';

import PatientInsuranceFormSlideOver from '@/components/billing/PatientInsuranceFormSlideOver';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Status' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

export default function InsuranceManagementPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Filters from URL
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const activeFilter = searchParams.get('is_active') || 'all';
  const page = parseInt(searchParams.get('page') || '1', 10);

  // Slide-over state
  const [showFormSlideOver, setShowFormSlideOver] = useState(false);
  const [editingInsurance, setEditingInsurance] = useState(null);

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [insuranceToDelete, setInsuranceToDelete] = useState(null);

  // Debounced search
  const debouncedSearch = useDebounce(search, 300);

  // Delete mutation
  const deleteMutation = useDeletePatientInsurance();

  // Build query params
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

  const insuranceColumns = [
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
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={(event) => {
              event.stopPropagation();
              handleEditInsurance(insurance);
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
              handleDeleteClick(insurance);
            }}
          >
            Delete
          </Button>
        </div>
      ),
    },
  ];

  // Update search input
  const handleSearchChange = (e) => {
    setSearch(e.target.value);
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

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    return format(parseISO(dateString), 'MMM d, yyyy');
  };

  // Loading state
  if (isLoading) {
    return (
      <PageState variant="loading">
        <Skeleton className="h-12 w-64" />
        <div className="flex gap-4">
          <Skeleton className="h-10 flex-1 max-w-md" />
          <Skeleton className="h-10 w-40" />
        </div>
        <div className="space-y-3">
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      </PageState>
    );
  }

  // Error state
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
      <PageHeader
        title={(
          <span className="flex items-center gap-3">
            <Shield className="h-7 w-7 text-[oklch(0.70_0.15_230)]" />
            Patient Insurance
          </span>
        )}
        description="Manage patient insurance records and coverage"
        actions={(
          <Button onClick={handleAddInsurance} className="font-mono text-xs">
            <Plus className="h-4 w-4 mr-2" />
            Add Insurance
          </Button>
        )}
      />

      <main className="p-4 sm:p-6 space-y-6">
        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by patient name, policy number..."
              value={search}
              onChange={handleSearchChange}
              className="pl-10 font-mono text-sm"
            />
          </div>

          {/* Status Filter */}
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

          {/* Clear Filters */}
          {hasActiveFilters && (
            <Button variant="ghost" onClick={clearFilters} className="font-mono text-xs">
              <Filter className="h-4 w-4 mr-2" />
              Clear Filters
            </Button>
          )}
        </div>

        {/* Results Count */}
        <div className="flex items-center justify-between">
          <p className="font-mono text-xs text-muted-foreground">
            {totalCount} record{totalCount !== 1 ? 's' : ''} found
          </p>
        </div>

        {/* Insurance List */}
        {insurances.length === 0 ? (
          <div className="text-center py-12">
            <Shield className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" />
            <h3 className="font-display text-lg text-foreground mb-2">No insurance records found</h3>
            <p className="text-muted-foreground text-sm mb-4">
              {hasActiveFilters
                ? 'Try adjusting your filters'
                : 'Get started by adding a patient insurance record'}
            </p>
            {!hasActiveFilters && (
              <Button onClick={handleAddInsurance} className="font-mono text-xs">
                <Plus className="h-4 w-4 mr-2" />
                Add Insurance
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <VirtualizedTable
              rows={insurances}
              rowKey={(insurance) => insurance.id}
              rowHeight={68}
              columns={insuranceColumns}
              rowClassName="hover:bg-muted/30"
              className="min-w-[1120px]"
              headerClassName="bg-muted/50 border-b border-border"
            />
          </div>
        )}

        {/* Pagination */}
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
                <ChevronLeft className="h-4 w-4 mr-1" />
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
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </main>

      {/* Form Slide-Over */}
      <PatientInsuranceFormSlideOver
        open={showFormSlideOver}
        onClose={() => {
          setShowFormSlideOver(false);
          setEditingInsurance(null);
        }}
        insurance={editingInsurance}
      />

      {/* Delete Confirmation Dialog */}
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
    </PageShell>
  );
}

/**
 * Insurance Card Component
 */
function InsuranceCard({ insurance, onEdit, onDelete, formatDate }) {
  const isValid = insurance.is_active && (!insurance.valid_until || new Date(insurance.valid_until) >= new Date());

  return (
    <div className="bg-card border border-border rounded-xl p-4 hover:border-primary/30 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4 flex-1 min-w-0">
          {/* Status Icon */}
          <div
            className={cn(
              'p-2 rounded-lg shrink-0',
              isValid
                ? 'bg-[oklch(0.70_0.17_155_/_0.1)]'
                : 'bg-muted'
            )}
          >
            {isValid ? (
              <CheckCircle className="h-5 w-5 text-[oklch(0.70_0.17_155)]" />
            ) : (
              <XCircle className="h-5 w-5 text-muted-foreground" />
            )}
          </div>

          {/* Details */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-display text-lg text-foreground truncate">
                {insurance.patient_name || 'Unknown Patient'}
              </h3>
              <span
                className={cn(
                  'text-xs px-2 py-0.5 rounded',
                  isValid
                    ? 'badge-chronicle-emerald'
                    : 'bg-muted text-muted-foreground'
                )}
              >
                {isValid ? 'Active' : 'Inactive'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mt-2">
              {/* Provider & Plan */}
              <div className="flex items-center gap-2 text-sm">
                <Building className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground truncate">
                  {insurance.provider_name || insurance.plan_name || '-'}
                </span>
              </div>

              {/* Plan Name */}
              {insurance.plan_name && insurance.provider_name && (
                <div className="flex items-center gap-2 text-sm">
                  <Shield className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground truncate">{insurance.plan_name}</span>
                </div>
              )}

              {/* Policy Number */}
              <div className="flex items-center gap-2 text-sm">
                <span className="font-mono text-xs text-muted-foreground">
                  Policy: {insurance.policy_number}
                </span>
              </div>

              {/* Coverage */}
              {insurance.coverage_percentage && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-mono text-xs text-[oklch(0.70_0.15_230)]">
                    {insurance.coverage_percentage}% coverage
                  </span>
                </div>
              )}
            </div>

            {/* Validity Period */}
            <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3" />
              <span>
                Valid: {formatDate(insurance.valid_from)}
                {insurance.valid_until ? ` - ${formatDate(insurance.valid_until)}` : ' (No expiry)'}
              </span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={onEdit}
            className="font-mono text-xs"
          >
            <Edit className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="font-mono text-xs text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
