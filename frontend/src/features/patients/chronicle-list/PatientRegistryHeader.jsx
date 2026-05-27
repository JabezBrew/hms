import Search from 'lucide-react/dist/esm/icons/search.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import Filter from 'lucide-react/dist/esm/icons/filter.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import Star from 'lucide-react/dist/esm/icons/star.js';
import { NavLink } from 'react-router-dom';
import { format } from 'date-fns';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { Combobox } from '@/components/ui/combobox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PageHeader } from '@/shared/components/page/PageHeader';

import {
  ADMISSION_STATUS_OPTIONS,
  ADMISSION_TYPE_OPTIONS,
  ENCOUNTER_TYPE_OPTIONS,
  REGISTRY_SCOPE_TABS,
} from './registryConstants';

export function PatientRegistryHeader({ state, loading, options, labels, handlers }) {
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
          <PatientRegistryFiltersPanel
            draftFilters={state.draftFilters}
            activeFilterCount={state.activeFilterCount}
            roleState={{ isClinicalProvider: state.isClinicalProvider }}
            loading={loading}
            options={options}
            onDraftFiltersChange={handlers.onDraftFiltersChange}
            onPractitionerSearch={handlers.onPractitionerSearch}
            onClearFilters={handlers.onClearFilters}
            onApplyFilters={handlers.onApplyFilters}
          />
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

function PatientRegistryFiltersPanel({
  draftFilters,
  activeFilterCount,
  roleState,
  loading,
  options,
  onDraftFiltersChange,
  onPractitionerSearch,
  onClearFilters,
  onApplyFilters,
}) {
  const updateDraftFilter = (updates) => {
    onDraftFiltersChange((prev) => ({ ...prev, ...updates }));
  };

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-4">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <AdmissionDateFilter
          draftFilters={draftFilters}
          onDraftFilterChange={updateDraftFilter}
        />
        <SelectFilter
          label="Admission Status"
          value={draftFilters.admissionStatus}
          options={ADMISSION_STATUS_OPTIONS}
          placeholder="Any status"
          onChange={(value) => updateDraftFilter({ admissionStatus: value })}
        />
        <SelectFilter
          label="Admission Type"
          value={draftFilters.admissionType}
          options={ADMISSION_TYPE_OPTIONS}
          placeholder="Any type"
          onChange={(value) => updateDraftFilter({ admissionType: value })}
        />
        <DepartmentFilter
          value={draftFilters.departmentId || 'all'}
          isLoading={loading.departments}
          departmentOptions={options.departmentOptions}
          onChange={(value) => updateDraftFilter({ departmentId: value === 'all' ? '' : value })}
        />
        <WardFilter
          value={draftFilters.wardId || 'all'}
          isLoading={loading.wards}
          wardOptions={options.wardOptions}
          onChange={(value) => updateDraftFilter({ wardId: value === 'all' ? '' : value })}
        />
        <SelectFilter
          label="Encounter Type"
          value={draftFilters.encounterType}
          options={ENCOUNTER_TYPE_OPTIONS}
          placeholder="Any encounter"
          onChange={(value) => updateDraftFilter({ encounterType: value })}
        />
        <AttendingClinicianFilter
          draftFilters={draftFilters}
          practitionerOptions={options.practitionerOptions}
          isLoading={loading.practitioners}
          onDraftFilterChange={updateDraftFilter}
          onPractitionerSearch={onPractitionerSearch}
        />
        <AgeRangeFilter
          draftFilters={draftFilters}
          onDraftFilterChange={updateDraftFilter}
        />
        {roleState.isClinicalProvider && (
          <MyPatientsFilter
            checked={draftFilters.myPatients}
            onChange={(checked) => updateDraftFilter({ myPatients: checked })}
          />
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          {activeFilterCount > 0 ? `${activeFilterCount} active filter${activeFilterCount === 1 ? '' : 's'}` : 'No active filters'}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearFilters}
            className="font-mono text-xs"
          >
            Reset
          </Button>
          <Button
            size="sm"
            onClick={onApplyFilters}
            className="font-mono text-xs"
          >
            Apply Filters
          </Button>
        </div>
      </div>
    </div>
  );
}

function AdmissionDateFilter({ draftFilters, onDraftFilterChange }) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-mono text-muted-foreground">Admission Date</Label>
      <DateRangePicker
        from={draftFilters.admissionStart}
        to={draftFilters.admissionEnd}
        onChange={({ from, to }) => onDraftFilterChange({
          admissionStart: from,
          admissionEnd: to,
        })}
        pickerClassName="w-[140px] font-mono text-xs"
      />
    </div>
  );
}

function SelectFilter({ label, value, options, placeholder, onChange }) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-mono text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full font-mono text-xs">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} className="font-mono text-xs">
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function DepartmentFilter({ value, isLoading, departmentOptions, onChange }) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-mono text-muted-foreground">Department</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full font-mono text-xs">
          <SelectValue placeholder={isLoading ? 'Loading...' : 'Any department'} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all" className="font-mono text-xs">Any department</SelectItem>
          {departmentOptions.map((option) => (
            <SelectItem key={option.value} value={option.value} className="font-mono text-xs">
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function WardFilter({ value, isLoading, wardOptions, onChange }) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-mono text-muted-foreground">Ward</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full font-mono text-xs">
          <SelectValue placeholder={isLoading ? 'Loading...' : 'Any ward'} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all" className="font-mono text-xs">Any ward</SelectItem>
          {wardOptions.map((option) => (
            <SelectItem key={option.value} value={option.value} className="font-mono text-xs">
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function AttendingClinicianFilter({
  draftFilters,
  practitionerOptions,
  isLoading,
  onDraftFilterChange,
  onPractitionerSearch,
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-mono text-muted-foreground">Attending Clinician</Label>
      <Combobox
        options={practitionerOptions}
        value={draftFilters.attending?.id || null}
        onChange={(value) => {
          const selected = practitionerOptions.find((option) => option.value === value);
          onDraftFilterChange({
            attending: selected ? { id: selected.value, name: selected.label } : null,
          });
          onPractitionerSearch('');
        }}
        onInputChange={onPractitionerSearch}
        displayValue={() => draftFilters.attending?.name || 'Select clinician'}
        searchPlaceholder="Search clinicians..."
        emptyMessage="No clinicians found."
        isLoading={isLoading}
        className="font-mono text-xs"
      />
    </div>
  );
}

function AgeRangeFilter({ draftFilters, onDraftFilterChange }) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-mono text-muted-foreground">Age Range</Label>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min="0"
          placeholder="Min"
          value={draftFilters.ageMin}
          onChange={(event) => onDraftFilterChange({
            ageMin: event.target.value.replace(/[^\d]/g, ''),
          })}
          className="w-20 font-mono text-xs"
        />
        <span className="text-xs text-muted-foreground">to</span>
        <Input
          type="number"
          min="0"
          placeholder="Max"
          value={draftFilters.ageMax}
          onChange={(event) => onDraftFilterChange({
            ageMax: event.target.value.replace(/[^\d]/g, ''),
          })}
          className="w-20 font-mono text-xs"
        />
      </div>
    </div>
  );
}

function MyPatientsFilter({ checked, onChange }) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-mono text-muted-foreground">My Patients</Label>
      <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
        <span className="text-xs text-muted-foreground">Only patients in my list</span>
        <Switch checked={checked} onCheckedChange={onChange} />
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
      {appliedFilters.departmentId && (
        <FilterChip
          label={`Department: ${labels.departmentLabels.get(appliedFilters.departmentId) || 'Selected'}`}
          onRemove={() => onRemoveFilter('departmentId')}
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
      {appliedFilters.admissionType !== 'all' && (
        <FilterChip
          label={`Admission Type: ${ADMISSION_TYPE_OPTIONS.find((opt) => opt.value === appliedFilters.admissionType)?.label || appliedFilters.admissionType}`}
          onRemove={() => onRemoveFilter('admissionType')}
        />
      )}
      {appliedFilters.encounterType !== 'all' && (
        <FilterChip
          label={`Encounter: ${ENCOUNTER_TYPE_OPTIONS.find((opt) => opt.value === appliedFilters.encounterType)?.label || appliedFilters.encounterType}`}
          onRemove={() => onRemoveFilter('encounterType')}
        />
      )}
      {appliedFilters.attending?.id && (
        <FilterChip
          label={`Attending: ${appliedFilters.attending.name}`}
          onRemove={() => onRemoveFilter('attending')}
        />
      )}
      {(appliedFilters.ageMin || appliedFilters.ageMax) && (
        <FilterChip
          label={`Age ${appliedFilters.ageMin || '0'}-${appliedFilters.ageMax || 'infinity'}`}
          onRemove={() => onRemoveFilter('ageRange')}
        />
      )}
      {appliedFilters.myPatients && (
        <FilterChip
          label="My Patients"
          onRemove={() => onRemoveFilter('myPatients')}
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
