import Search from 'lucide-react/dist/esm/icons/search.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import Filter from 'lucide-react/dist/esm/icons/filter.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import Star from 'lucide-react/dist/esm/icons/star.js';
import { lazy, Suspense } from 'react';
import { NavLink } from 'react-router-dom';
import { format } from 'date-fns';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/shared/components/page/PageHeader';

import {
  ADMISSION_STATUS_OPTIONS,
  REGISTRY_SCOPE_TABS,
} from './registryConstants';

const PatientRegistryFiltersPanel = lazy(() => import('./PatientRegistryFiltersPanel').then((module) => ({
  default: module.PatientRegistryFiltersPanel,
})));

export function PatientRegistryHeader({ state, labels, handlers }) {
  const headerActions = ['admin', 'receptionist'].includes(state.userRole) ? (
    <Button onClick={handlers.onAddPatient} size="sm" className="font-mono text-xs">
      <Plus className="size-4 mr-2" />
      Register Patient
    </Button>
  ) : null;

  return (
    <PageHeader
      title="Patient Registry"
      description="Search and browse all patients in a sortable registry table"
      size="md"
      actions={headerActions}
      contentClassName="sm:items-start"
    >
      <PatientRegistryRouteTabs isClinicalProvider={state.isClinicalProvider} />
      <RegistryScopeTabs
        registryScope={state.registryScope}
        onRegistryScopeChange={handlers.onRegistryScopeChange}
      />

      <div className="flex flex-col gap-3 mt-4">
        <PatientRegistrySearchControls
          searchQuery={state.searchQuery}
          hasSearchQuery={state.hasSearchQuery}
          activeFilterCount={state.activeFilterCount}
          onSearchChange={handlers.onSearchChange}
          onClearSearch={handlers.onClearSearch}
          onToggleFilters={handlers.onToggleFilters}
        />

        {state.filtersOpen && (
          <Suspense fallback={<PatientRegistryFiltersFallback />}>
            <PatientRegistryFiltersPanel
              draftFilters={state.draftFilters}
              activeFilterCount={state.activeFilterCount}
              onDraftFiltersChange={handlers.onDraftFiltersChange}
              onWardLabelsChange={handlers.onWardLabelsChange}
              onClearFilters={handlers.onClearFilters}
              onApplyFilters={handlers.onApplyFilters}
            />
          </Suspense>
        )}

        {state.hasActiveFilters && (
          <ActiveFilterChips
            appliedFilters={state.appliedFilters}
            labels={labels}
            displayState={{
              hasSearchQuery: state.hasSearchQuery,
              hasActiveFilters: state.hasActiveFilters,
            }}
            onRemoveFilter={handlers.onRemoveFilter}
            onClearAll={handlers.onClearAll}
          />
        )}

        {state.hasSearchSignal && (
          <div className="text-xs text-muted-foreground">
            <span>{state.searchSummary}</span>
          </div>
        )}
      </div>
    </PageHeader>
  );
}

function PatientRegistryFiltersFallback() {
  return (
    <div
      className="rounded-xl border border-border bg-muted/30 p-4"
      aria-label="Loading patient registry filters"
    >
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="space-y-2">
            <div className="h-3 w-24 rounded bg-muted-foreground/20" />
            <div className="h-9 rounded-md border border-border bg-background" />
          </div>
        ))}
      </div>
    </div>
  );
}

function PatientRegistryRouteTabs({ isClinicalProvider }) {
  if (!isClinicalProvider) {
    return null;
  }

  return (
    <div className="flex items-center gap-1 mt-4 bg-muted rounded-lg p-1 w-fit">
      <PatientRegistryRouteTab to="/patients" label="All Patients" icon={Users} end />
      <PatientRegistryRouteTab to="/patients/my-patients" label="My Patients" icon={Star} />
    </div>
  );
}

function PatientRegistryRouteTab({ to, label, icon: Icon, end = false }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => cn(
        'px-4 py-2 rounded-md text-sm font-mono transition-colors flex items-center gap-2',
        isActive
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'
      )}
    >
      <Icon className="size-4" />
      {label}
    </NavLink>
  );
}

function RegistryScopeTabs({ registryScope, onRegistryScopeChange }) {
  return (
    <div className="flex flex-wrap items-center gap-2 mt-4">
      {REGISTRY_SCOPE_TABS.map((scopeTab) => (
        <Button
          key={scopeTab.value}
          type="button"
          variant={registryScope === scopeTab.value ? 'default' : 'outline'}
          size="sm"
          onClick={() => onRegistryScopeChange(scopeTab.value)}
          className={cn(
            'font-mono text-xs',
            registryScope === scopeTab.value
              ? 'bg-foreground text-background hover:bg-foreground/90'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {scopeTab.label}
        </Button>
      ))}
    </div>
  );
}

function PatientRegistrySearchControls({
  searchQuery,
  hasSearchQuery,
  activeFilterCount,
  onSearchChange,
  onClearSearch,
  onToggleFilters,
}) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
      <div className="relative w-full sm:max-w-3xl lg:max-w-4xl">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" aria-hidden="true" />
        <Label htmlFor="patient-search" className="sr-only">Search by name, MRN, or NHIS ID</Label>
        <Input
          id="patient-search"
          placeholder="Search by name, MRN, or NHIS ID..."
          value={searchQuery}
          onChange={onSearchChange}
          className="pl-10 pr-10 font-mono text-sm bg-background"
        />
        {hasSearchQuery && (
          <button
            type="button"
            onClick={onClearSearch}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onToggleFilters}
          className="font-mono text-xs"
        >
          <Filter className="size-4 mr-2" />
          Filters
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="ml-2 px-1.5 py-0 text-[10px]">
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      </div>
    </div>
  );
}

function ActiveFilterChips({
  appliedFilters,
  labels,
  displayState,
  onRemoveFilter,
  onClearAll,
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {(appliedFilters.admissionStart || appliedFilters.admissionEnd) && (
        <FilterChip
          label={appliedFilters.admissionStart && appliedFilters.admissionEnd
            ? `Admission ${format(appliedFilters.admissionStart, 'MMM d')}-${format(appliedFilters.admissionEnd, 'MMM d')}`
            : appliedFilters.admissionStart
              ? `Admission after ${format(appliedFilters.admissionStart, 'MMM d')}`
              : `Admission before ${format(appliedFilters.admissionEnd, 'MMM d')}`}
          onRemove={() => onRemoveFilter('admissionRange')}
        />
      )}
      {appliedFilters.wardId && (
        <FilterChip
          label={`Ward: ${labels.wardLabels.get(appliedFilters.wardId) || 'Selected'}`}
          onRemove={() => onRemoveFilter('wardId')}
        />
      )}
      {appliedFilters.admissionStatus !== 'all' && (
        <FilterChip
          label={`Status: ${ADMISSION_STATUS_OPTIONS.find((opt) => opt.value === appliedFilters.admissionStatus)?.label || appliedFilters.admissionStatus}`}
          onRemove={() => onRemoveFilter('admissionStatus')}
        />
      )}
      {appliedFilters.attending?.id && (
        <FilterChip
          label={`Attending: ${appliedFilters.attending.name || 'Selected clinician'}`}
          onRemove={() => onRemoveFilter('attending')}
        />
      )}
      {(appliedFilters.ageMin || appliedFilters.ageMax) && (
        <FilterChip
          label={`Age ${appliedFilters.ageMin || '0'}-${appliedFilters.ageMax || 'infinity'}`}
          onRemove={() => onRemoveFilter('ageRange')}
        />
      )}
      {(displayState.hasSearchQuery || displayState.hasActiveFilters) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onClearAll}
          className="font-mono text-xs text-muted-foreground hover:text-foreground"
        >
          Clear all
        </Button>
      )}
    </div>
  );
}

function FilterChip({ label, onRemove }) {
  return (
    <Badge variant="secondary" className="gap-1 pr-1 text-[10px] font-mono">
      <span className="truncate max-w-[220px]">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        className="rounded-full p-0.5 text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label={`Remove ${label}`}
      >
        <X className="size-3" aria-hidden="true" />
      </button>
    </Badge>
  );
}
