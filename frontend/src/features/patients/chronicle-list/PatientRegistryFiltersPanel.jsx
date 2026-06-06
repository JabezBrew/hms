import { useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useWards } from '@/features/wards/hooks/useWardQueries';
import { useSearchPractitioners } from '@/hooks/useStaffQueries';
import { normalizeApiResults } from '@/lib/utils';

import {
  ADMISSION_STATUS_OPTIONS,
  RECORD_STATUS_OPTIONS,
  VITAL_STATUS_OPTIONS,
} from './registryConstants';

export function PatientRegistryFiltersPanel({
  activeFilterCount,
  draftFilters,
  onApplyFilters,
  onClearFilters,
  onDraftFiltersChange,
}) {
  const { data: wardsData, isLoading: isWardsLoading } = useWards(
    { is_active: true },
    { staleTime: 5 * 60 * 1000 }
  );
  const {
    data: practitionerResults = [],
    isLoading: isPractitionersLoading,
    setSearchTerm: setPractitionerSearch,
  } = useSearchPractitioners(false, { minLength: 2 });

  const wards = useMemo(() => normalizeApiResults(wardsData), [wardsData]);
  const wardOptions = useMemo(
    () => wards
      .map((ward) => ({ value: ward.id, label: ward.name }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [wards]
  );
  const practitionerOptions = useMemo(
    () => (practitionerResults || [])
      .flatMap((practitioner) => {
        const value = practitioner.user_id
          || practitioner.user_details?.id
          || practitioner.user?.id
          || practitioner.id;
        const name = practitioner.name
          || practitioner.display_name
          || practitioner.email
          || 'Unknown clinician';
        if (!value) return [];
        return [{
          value,
          label: practitioner.specialization
            ? `${name} - ${practitioner.specialization}`
            : name,
        }];
      }),
    [practitionerResults]
  );

  const updateDraftFilter = (updates) => {
    onDraftFiltersChange((prev) => ({ ...prev, ...updates }));
  };

  const handleWardChange = (value) => {
    const selectedWard = wardOptions.find((option) => option.value === value);
    updateDraftFilter({
      wardId: value === 'all' ? '' : value,
      wardName: selectedWard?.label || '',
    });
  };

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-4">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <SelectFilter
          label="Record Status"
          value={draftFilters.recordStatus}
          options={RECORD_STATUS_OPTIONS}
          placeholder="Any record status"
          onChange={(value) => updateDraftFilter({ recordStatus: value })}
        />
        <SelectFilter
          label="Vital Status"
          value={draftFilters.vitalStatus}
          options={VITAL_STATUS_OPTIONS}
          placeholder="Any vital status"
          onChange={(value) => updateDraftFilter({ vitalStatus: value })}
        />
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
        <WardFilter
          value={draftFilters.wardId || 'all'}
          isLoading={isWardsLoading}
          wardOptions={wardOptions}
          onChange={handleWardChange}
        />
        <AttendingClinicianFilter
          draftFilters={draftFilters}
          practitionerOptions={practitionerOptions}
          isLoading={isPractitionersLoading}
          onDraftFilterChange={updateDraftFilter}
          onPractitionerSearch={setPractitionerSearch}
        />
        <AgeRangeFilter
          draftFilters={draftFilters}
          onDraftFilterChange={updateDraftFilter}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          {activeFilterCount > 0
            ? `${activeFilterCount} active filter${activeFilterCount === 1 ? '' : 's'}`
            : 'No active filters'}
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
          onPractitionerSearch?.('');
        }}
        onInputChange={onPractitionerSearch || (() => {})}
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
