import Search from 'lucide-react/dist/esm/icons/search.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import ArrowDown from 'lucide-react/dist/esm/icons/arrow-down.js';
import ArrowUp from 'lucide-react/dist/esm/icons/arrow-up.js';
import ArrowUpDown from 'lucide-react/dist/esm/icons/arrow-up-down.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { TABLE_COLUMNS } from './registryConstants';
import {
  deduplicatePatients,
  formatAdmissionStatus,
  formatDateLabel,
  formatFooterPageLabel,
  formatFooterResultLabel,
  formatGender,
  getPatientAge,
  getPatientLocationDisplay,
  getPatientRowKey,
} from './registryHelpers';

const SKELETON_ROW_KEYS = [
  'loading-row-1',
  'loading-row-2',
  'loading-row-3',
  'loading-row-4',
  'loading-row-5',
  'loading-row-6',
];

export function PatientListRefreshButton({ onRefresh }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <Button
        variant="ghost"
        size="icon"
        onClick={onRefresh}
        className="shrink-0 size-9"
        aria-label="Refresh patient list"
      >
        <RefreshCw className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

export function SearchResultsSection({
  patients,
  isLoading,
  searchQuery,
  hasActiveFilters,
  ordering,
  onOrderingChange,
  pagination,
  onPageChange,
  onOpenPatient,
  onPointerDownPatient,
}) {
  const uniquePatients = deduplicatePatients(patients);

  return (
    <SearchResultsTable
      patients={uniquePatients}
      ordering={ordering}
      onOrderingChange={onOrderingChange}
      pagination={pagination}
      onPageChange={onPageChange}
      onOpenPatient={onOpenPatient}
      onPointerDownPatient={onPointerDownPatient}
      isLoading={isLoading}
      searchQuery={searchQuery}
      hasActiveFilters={hasActiveFilters}
    />
  );
}

function SortableTableHead({ column, ordering, onOrderingChange }) {
  const isDescending = ordering === `-${column.key}`;
  const isAscending = ordering === column.key;
  const isActive = isDescending || isAscending;

  return (
    <TableHead className="h-11">
      <button
        type="button"
        onClick={() => onOrderingChange(column.key)}
        className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
        aria-label={`Sort by ${column.label}`}
      >
        <span>{column.label}</span>
        {isActive ? (
          isDescending ? (
            <ArrowDown className="size-3.5" aria-hidden="true" />
          ) : (
            <ArrowUp className="size-3.5" aria-hidden="true" />
          )
        ) : (
          <ArrowUpDown className="size-3.5 text-muted-foreground/70" aria-hidden="true" />
        )}
      </button>
    </TableHead>
  );
}

function SearchResultsTable({
  patients,
  ordering,
  onOrderingChange,
  pagination,
  onPageChange,
  onOpenPatient,
  onPointerDownPatient,
  isLoading,
  searchQuery,
  hasActiveFilters,
}) {
  const emptyDescription = searchQuery
    ? `No patients match "${searchQuery}". Try a different search term.`
    : hasActiveFilters
      ? 'No patients match these filters. Try adjusting your criteria.'
      : 'No patients found.';
  const {
    currentPage,
    pageSize,
    totalPages,
    totalResults,
    totalResultsExact,
    hasNextPage,
    hasPreviousPage,
  } = pagination;
  const footerResultLabel = formatFooterResultLabel({
    currentPage,
    pageSize,
    visibleCount: patients.length,
    totalResults,
    isExact: totalResultsExact,
    hasNextPage,
  });
  const footerPageLabel = formatFooterPageLabel({
    currentPage,
    totalPages,
    isExact: totalResultsExact,
    hasNextPage,
  });

  return (
    <div className="rounded-xl border border-border/70 bg-card overflow-x-auto">
      <Table className="min-w-[920px]">
        <TableHeader className="bg-muted/30">
          <TableRow>
            {TABLE_COLUMNS.map((column) => (
              <SortableTableHead
                key={column.key}
                column={column}
                ordering={ordering}
                onOrderingChange={onOrderingChange}
              />
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            SKELETON_ROW_KEYS.map((rowKey) => (
              <TableRow key={rowKey}>
                {TABLE_COLUMNS.map((column) => (
                  <TableCell key={`${rowKey}-${column.key}`}>
                    <div className="h-3.5 w-full max-w-[120px] rounded bg-muted/70 animate-pulse" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : patients.length === 0 ? (
            <TableRow>
              <TableCell colSpan={TABLE_COLUMNS.length} className="py-12 text-center">
                <div className="flex flex-col items-center gap-2">
                  <Search className="size-5 text-muted-foreground" aria-hidden="true" />
                  <p className="text-sm text-muted-foreground">{emptyDescription}</p>
                </div>
              </TableCell>
            </TableRow>
          ) : patients.map((patient) => (
            <PatientSearchResultRow
              key={getPatientRowKey(patient)}
              patient={patient}
              isFirstRow={patient === patients[0]}
              onOpenPatient={onOpenPatient}
              onPointerDownPatient={onPointerDownPatient}
            />
          ))}
        </TableBody>
      </Table>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 px-4 py-3">
        <p className="text-xs font-mono text-muted-foreground">
          {footerResultLabel} · {footerPageLabel}
          {!totalResultsExact && hasNextPage ? ' · More available' : ''}
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onPageChange(currentPage - 1)}
            disabled={!hasPreviousPage}
            className="font-mono text-xs"
          >
            <ChevronLeft className="mr-1 size-3.5" aria-hidden="true" />
            Previous
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onPageChange(currentPage + 1)}
            disabled={!hasNextPage}
            className="font-mono text-xs"
          >
            Next
            <ChevronRight className="ml-1 size-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function PatientSearchResultRow({
  patient,
  isFirstRow,
  onOpenPatient,
  onPointerDownPatient,
}) {
  const age = getPatientAge(patient?.date_of_birth);
  const dobLabel = formatDateLabel(patient?.date_of_birth);
  const dobWithAge = age === null ? dobLabel : `${dobLabel} · ${age}y`;
  const locationDisplay = getPatientLocationDisplay(patient);

  return (
    <TableRow
      className="cursor-pointer"
      data-onboarding={isFirstRow ? 'patient-list-row' : undefined}
      onPointerDown={() => onPointerDownPatient(patient)}
      onClick={() => onOpenPatient(patient)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpenPatient(patient);
        }
      }}
      tabIndex={0}
      aria-label={`Open ${patient?.name || 'patient'} chart`}
    >
      <TableCell className="font-mono text-xs text-muted-foreground">
        {formatDateLabel(patient?.created_at)}
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">
        {patient?.medical_record_number || '-'}
      </TableCell>
      <TableCell className="font-medium text-sm">
        {patient?.name || 'Unknown Patient'}
      </TableCell>
      <TableCell className="font-mono text-xs">
        {dobWithAge}
      </TableCell>
      <TableCell className="text-xs">
        {formatGender(patient?.gender)}
      </TableCell>
      <TableCell className="text-xs">
        {!locationDisplay.tooltip ? (
          locationDisplay.label
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="cursor-help underline decoration-dotted underline-offset-2"
                onClick={(event) => {
                  event.stopPropagation();
                }}
                onKeyDown={(event) => {
                  event.stopPropagation();
                }}
              >
                {locationDisplay.label}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[320px] font-mono text-[10px]">
              {locationDisplay.tooltip}
            </TooltipContent>
          </Tooltip>
        )}
      </TableCell>
      <TableCell>
        <Badge variant="outline" className="font-mono text-[10px]">
          {formatAdmissionStatus(patient?.registry_status || patient?.admission_status)}
        </Badge>
      </TableCell>
    </TableRow>
  );
}
