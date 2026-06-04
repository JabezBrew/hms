/* oxlint-disable react-doctor/prefer-useReducer -- These components keep independent UI states; a reducer would add dispatch indirection without a shared transition invariant. */
import Search from 'lucide-react/dist/esm/icons/search.js';
import Package from 'lucide-react/dist/esm/icons/package.js';
import CheckCircle from 'lucide-react/dist/esm/icons/circle-check-big.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import User from 'lucide-react/dist/esm/icons/user.js';
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import format from 'date-fns/format';

import { toast } from 'sonner';
import PatientContextPanel from '@/components/patients/PatientContextPanel';
import {
  usePendingDispensingGrouped,
  useDispenseMedication,
  useBulkDispense
} from '@/features/nursing/hooks';

const STAT_CARD_COLOR_STYLES = {
  amber: 'bg-primary/10 text-primary',
  sky: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  rose: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
};

function formatQueueTime(timestamp) {
  if (!timestamp) return '-';
  try {
    return format(new Date(timestamp), 'h:mm a');
  } catch {
    return timestamp;
  }
}

function formatQueueDateTime(timestamp) {
  if (!timestamp) return '-';
  try {
    return format(new Date(timestamp), 'MMM d, h:mm a');
  } catch {
    return timestamp;
  }
}

function getQueuePatientName(med) {
  if (med.patient_name) return med.patient_name;
  if (med.patient_details?.user_details) {
    const { first_name: firstName, last_name: lastName } = med.patient_details.user_details;
    if (firstName || lastName) {
      return `${firstName || ''} ${lastName || ''}`.trim();
    }
  }
  return 'Unknown Patient';
}

function getQueuePatientMRN(med) {
  return med.patient_mrn || med.patient_details?.medical_record_number || '-';
}

function getQueuePatientWard(med) {
  return med.patient_ward || med.patient_details?.current_ward || 'Unknown';
}

function getQueuePrescriberName(med) {
  if (med.prescriber_name) return med.prescriber_name;
  if (med.prescribed_by_details?.staff_details?.user_details) {
    const { first_name: firstName, last_name: lastName } = med.prescribed_by_details.staff_details.user_details;
    if (firstName || lastName) {
      return `Dr. ${firstName || ''} ${lastName || ''}`.trim();
    }
  }
  return '-';
}

function filterPendingMedications(pendingMeds, searchTerm) {
  const normalizedSearch = searchTerm.toLowerCase();
  return (pendingMeds || []).filter((med) => (
    med.medication_name?.toLowerCase().includes(normalizedSearch) ||
    getQueuePatientName(med).toLowerCase().includes(normalizedSearch) ||
    med.dosage?.toLowerCase().includes(normalizedSearch)
  ));
}

function groupMedicationsByPatient(medications) {
  return medications.reduce((acc, med) => {
    const patientId = med.patient;
    if (!acc[patientId]) {
      acc[patientId] = {
        firstMed: med,
        medications: []
      };
    }
    acc[patientId].medications.push(med);
    return acc;
  }, {});
}

function getMedicationDispenseIds(medication) {
  return medication.mar_entry_ids?.length
    ? medication.mar_entry_ids
    : [medication.mar_entry_id || medication.id];
}

function expandSelectedDispenseIds(pendingMeds, selectedMeds) {
  const groupsById = new Map((pendingMeds || []).map((med) => [med.id, med]));
  return selectedMeds.flatMap((groupId) => {
    const group = groupsById.get(groupId);
    if (!group) return [];
    if (group.mar_entry_ids?.length) return group.mar_entry_ids;
    return group.mar_entry_id ? [group.mar_entry_id] : [];
  });
}

function PharmacyQueueLoadingState() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-12 rounded-xl" />
      <Skeleton className="h-96 rounded-xl" />
    </div>
  );
}

function PharmacyQueueErrorState({ error, onRetry }) {
  return (
    <div className="bg-card/50 backdrop-blur border border-destructive/30 rounded-xl p-8 text-center">
      <AlertCircle className="size-12 text-destructive mx-auto mb-4" />
      <h3 className="font-display text-xl text-foreground mb-2">Error Loading Queue</h3>
      <p className="text-muted-foreground mb-4">
        {error.message || 'Failed to load dispensing queue'}
      </p>
      <Button variant="outline" onClick={onRetry}>
        <RefreshCw className="size-4 mr-2" />
        Try Again
      </Button>
    </div>
  );
}

function PharmacyQueueControls({
  bulkActionsAvailable,
  bulkDispensePending,
  onBulkDispense,
  onRefresh,
  onSearchChange,
  onViewModeChange,
  searchTerm,
  selectedCount,
  totalPatients,
  totalPending,
  viewMode,
}) {
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard icon={Package} value={totalPending} label="Pending Dispensing" color="amber" />
        <StatCard icon={User} value={totalPatients} label="Patients Waiting" color="sky" />
        <StatCard icon={CheckCircle} value={selectedCount} label="Selected" color="emerald" />
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search by patient name or medication..."
            value={searchTerm}
            onChange={(event) => onSearchChange(event.target.value)}
            className="pl-10 font-mono text-sm bg-background"
          />
        </div>
        <div className="flex gap-2">
          <div className="flex bg-muted rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => onViewModeChange('by-patient')}
              className={cn(
                "px-3 py-1.5 rounded-md text-sm font-mono transition-colors flex items-center gap-1.5",
                viewMode === 'by-patient'
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <User className="size-3.5" />
              By Patient
            </button>
            <button
              type="button"
              onClick={() => onViewModeChange('all')}
              className={cn(
                "px-3 py-1.5 rounded-md text-sm font-mono transition-colors flex items-center gap-1.5",
                viewMode === 'all'
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Pill className="size-3.5" />
              All Medications
            </button>
          </div>
          <Button variant="ghost" size="icon" onClick={onRefresh} className="shrink-0">
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </div>

      {!bulkActionsAvailable && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-100">
          Rust V2 dispensing is available per medication row once the prescription is linked to an inventory item. Select the dispensing location before issuing supply.
        </div>
      )}

      {bulkActionsAvailable && selectedCount > 0 && (
        <div className="flex items-center justify-between bg-primary/10 border border-primary/20 rounded-xl px-4 py-3">
          <span className="font-mono text-sm text-primary">
            {selectedCount} medication{selectedCount !== 1 ? 's' : ''} selected
          </span>
          <Button onClick={onBulkDispense} disabled={bulkDispensePending} size="sm">
            <Package className="size-4 mr-2" />
            Dispense Selected
          </Button>
        </div>
      )}
    </>
  );
}

export function PharmacyQueue() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMeds, setSelectedMeds] = useState([]);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [confirmMedication, setConfirmMedication] = useState(null);
  const [dispenseStock, setDispenseStock] = useState({
    itemId: '',
    locationId: '',
    quantity: '1',
  });
  const [viewMode, setViewMode] = useState('by-patient');
  const [contextOpen, setContextOpen] = useState(false);
  const [contextPatient, setContextPatient] = useState(null);
  const rustV2Mode = isRustV2ApiMode();
  const dispensingActionsAvailable = true;
  const bulkActionsAvailable = !rustV2Mode;

  // Fetch pending dispensing (grouped per prescription so a "5 mg TDS x 7 days"
  // course shows as one row, not 21).
  const {
    data: pendingMeds,
    isLoading,
    error,
    refetch
  } = usePendingDispensingGrouped();

  // All dispenses (single or bulk) flow through bulk-dispense, since dispensing a
  // group means flipping every MAR entry it contains.
  const bulkDispenseMutation = useBulkDispense();
  const singleDispenseMutation = useDispenseMedication();
  const dispenseMutation = rustV2Mode ? singleDispenseMutation : bulkDispenseMutation;

  const filteredMeds = filterPendingMedications(pendingMeds, searchTerm);
  const groupedByPatient = groupMedicationsByPatient(filteredMeds);

  // Toggle medication selection
  const toggleMedSelection = (medId) => {
    if (!bulkActionsAvailable) return;
    setSelectedMeds(prev =>
      prev.includes(medId)
        ? prev.filter(id => id !== medId)
        : [...prev, medId]
    );
  };

  // Select all for a patient
  const selectAllForPatient = (patientId) => {
    if (!bulkActionsAvailable) return;
    const patientMeds = groupedByPatient[patientId]?.medications.map(m => m.id) || [];
    const allSelected = patientMeds.every(id => selectedMeds.includes(id));

    if (allSelected) {
      setSelectedMeds(prev => prev.filter(id => !patientMeds.includes(id)));
    } else {
      setSelectedMeds(prev => [...new Set([...prev, ...patientMeds])]);
    }
  };

  // Single dispense (a "row" is now a prescription group, so dispense flips every
  // MAR entry it represents — one supply issued covers all scheduled doses).
  const handleDispense = async (medication) => {
    if (!dispensingActionsAvailable) {
      toast.error('Pharmacy dispensing actions from the nursing queue are not available in Rust V2 mode yet.');
      return;
    }
    try {
      if (rustV2Mode) {
        await singleDispenseMutation.mutateAsync({
          fulfillmentId: medication.fulfillment_id || medication.id,
          itemId: dispenseStock.itemId.trim(),
          locationId: dispenseStock.locationId.trim(),
          quantity: dispenseStock.quantity,
        });
      } else {
        const ids = getMedicationDispenseIds(medication);
        await bulkDispenseMutation.mutateAsync(ids);
      }
      toast.success(`${medication.medication_name} dispensed successfully`);
      setConfirmMedication(null);
      setShowConfirmDialog(false);
    } catch (error) {
      toast.error(error.message || 'Failed to dispense medication');
    }
  };

  // Bulk dispense — selectedMeds holds group ids; expand to the union of their
  // child MAR entry ids before posting.
  const handleBulkDispense = async () => {
    if (!bulkActionsAvailable) {
      toast.error('Use individual dispense in Rust V2 so stock item, location, and quantity are captured.');
      return;
    }
    if (selectedMeds.length === 0) {
      toast.error('No medications selected');
      return;
    }

    const marIds = expandSelectedDispenseIds(pendingMeds, selectedMeds);

    try {
      const result = await bulkDispenseMutation.mutateAsync(marIds);
      toast.success(`${result.dispensed_count || marIds.length} doses dispensed`);
      setSelectedMeds([]);
    } catch (error) {
      toast.error(error.message || 'Failed to dispense medications');
    }
  };

  // Open confirm dialog
  const openConfirmDialog = (medication) => {
    if (!dispensingActionsAvailable) return;
    setConfirmMedication(medication);
    setDispenseStock({
      itemId: medication.inventory_item_id || '',
      locationId: medication.dispensing_location_id || '',
      quantity: String(Math.max(1, Number(medication.dose_count || 1))),
    });
    setShowConfirmDialog(true);
  };

  const openPatientContext = (medication) => {
    setContextPatient({
      name: getQueuePatientName(medication),
      mrn: getQueuePatientMRN(medication),
      ward: getQueuePatientWard(medication),
      allergies: medication.patient_allergies || [],
      problems: medication.patient_problems || [],
      medications: medication.patient_medications || [],
    });
    setContextOpen(true);
  };

  if (isLoading) {
    return <PharmacyQueueLoadingState />;
  }

  if (error) {
    return <PharmacyQueueErrorState error={error} onRetry={() => refetch()} />;
  }

  const totalPending = filteredMeds.length;
  const totalPatients = Object.keys(groupedByPatient).length;
  const totalSelected = selectedMeds.length;

  return (
    <div className="space-y-6">
      <PharmacyQueueControls
        bulkActionsAvailable={bulkActionsAvailable}
        bulkDispensePending={bulkDispenseMutation.isPending}
        onBulkDispense={handleBulkDispense}
        onRefresh={() => refetch()}
        onSearchChange={setSearchTerm}
        onViewModeChange={setViewMode}
        searchTerm={searchTerm}
        selectedCount={totalSelected}
        totalPatients={totalPatients}
        totalPending={totalPending}
        viewMode={viewMode}
      />

      {/* Main Content */}
      {viewMode === 'by-patient' ? (
        <ByPatientView
          groupedByPatient={groupedByPatient}
          selectedMeds={selectedMeds}
          toggleMedSelection={toggleMedSelection}
          selectAllForPatient={selectAllForPatient}
          openConfirmDialog={openConfirmDialog}
          openPatientContext={openPatientContext}
          dispenseMutation={dispenseMutation}
          getPatientName={getQueuePatientName}
          getPatientMRN={getQueuePatientMRN}
          getPatientWard={getQueuePatientWard}
          formatTime={formatQueueTime}
          dispensingActionsAvailable={dispensingActionsAvailable}
          selectionAvailable={bulkActionsAvailable}
        />
      ) : (
        <AllMedicationsView
          filteredMeds={filteredMeds}
          selectedMeds={selectedMeds}
          setSelectedMeds={setSelectedMeds}
          toggleMedSelection={toggleMedSelection}
          openConfirmDialog={openConfirmDialog}
          openPatientContext={openPatientContext}
          dispenseMutation={dispenseMutation}
          getPatientName={getQueuePatientName}
          getPatientMRN={getQueuePatientMRN}
          getPrescriberName={getQueuePrescriberName}
          formatDateTime={formatQueueDateTime}
          dispensingActionsAvailable={dispensingActionsAvailable}
          selectionAvailable={bulkActionsAvailable}
        />
      )}

      {/* Confirm Dispense Dialog */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">Confirm Dispensing</DialogTitle>
            <DialogDescription>
              Please verify the medication details before dispensing.
            </DialogDescription>
          </DialogHeader>

          {confirmMedication && (
            <div className="space-y-4 py-4">
              {confirmMedication.is_overdue && (
                <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive">
                  <AlertTriangle className="size-5 shrink-0" />
                  <span className="font-medium text-sm">This medication is overdue</span>
                </div>
              )}
              <div className="bg-muted/50 rounded-xl p-4 space-y-3">
                <DetailRow label="Patient" value={getQueuePatientName(confirmMedication)} highlight />
                <DetailRow label="MRN" value={getQueuePatientMRN(confirmMedication)} mono />
                <hr className="border-border" />
                <DetailRow label="Medication" value={confirmMedication.medication_name} highlight />
                <DetailRow label="Dosage" value={confirmMedication.dosage} />
                <DetailRow label="Route" value={confirmMedication.route} />
                <DetailRow label="Frequency" value={confirmMedication.frequency} />
                {confirmMedication.dose_count > 1 ? (
                  <>
                    <DetailRow
                      label="Doses to dispense"
                      value={`${confirmMedication.dose_count} doses (whole supply)`}
                      highlight
                    />
                    <DetailRow
                      label="Next due"
                      value={formatQueueDateTime(confirmMedication.scheduled_time)}
                      mono
                    />
                  </>
                ) : (
                  <DetailRow label="Scheduled" value={formatQueueDateTime(confirmMedication.scheduled_time)} mono />
                )}
                <hr className="border-border" />
                <DetailRow label="Prescribed by" value={getQueuePrescriberName(confirmMedication)} />
              </div>
              {rustV2Mode && (
                <div className="grid gap-3">
                  <div>
                    <label
                      className="mb-1 block text-xs font-mono uppercase tracking-wider text-muted-foreground"
                      htmlFor="pharmacy-dispense-item-id"
                    >
                      Linked stock item ID
                    </label>
                    <Input
                      id="pharmacy-dispense-item-id"
                      readOnly
                      value={dispenseStock.itemId}
                      onChange={(event) => setDispenseStock((current) => ({
                        ...current,
                        itemId: event.target.value,
                      }))}
                      placeholder="No linked inventory item"
                      className="font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label
                      className="mb-1 block text-xs font-mono uppercase tracking-wider text-muted-foreground"
                      htmlFor="pharmacy-dispense-location-id"
                    >
                      Location ID
                    </label>
                    <Input
                      id="pharmacy-dispense-location-id"
                      value={dispenseStock.locationId}
                      onChange={(event) => setDispenseStock((current) => ({
                        ...current,
                        locationId: event.target.value,
                      }))}
                      placeholder="Dispensing location UUID"
                      className="font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label
                      className="mb-1 block text-xs font-mono uppercase tracking-wider text-muted-foreground"
                      htmlFor="pharmacy-dispense-quantity"
                    >
                      Quantity
                    </label>
                    <Input
                      id="pharmacy-dispense-quantity"
                      min="1"
                      type="number"
                      value={dispenseStock.quantity}
                      onChange={(event) => setDispenseStock((current) => ({
                        ...current,
                        quantity: event.target.value,
                      }))}
                      className="font-mono text-xs"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirmDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => handleDispense(confirmMedication)}
              disabled={dispenseMutation.isPending || (rustV2Mode && !confirmMedication?.inventory_item_id)}
            >
              {dispenseMutation.isPending ? 'Dispensing...' : 'Confirm Dispense'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PatientContextPanel
        open={contextOpen}
        onClose={() => setContextOpen(false)}
        mode="pharmacy"
        patientContext={contextPatient}
        patientName={contextPatient?.name}
        patientMrn={contextPatient?.mrn}
      />
    </div>
  );
}

/**
 * StatCard - Chronicle-styled stat card
 */
const StatCard = ({ icon: Icon, value, label, color = 'amber' }) => {
  return (
    <div className="bg-card/50 backdrop-blur border border-border rounded-xl p-4">
      <div className="flex items-center gap-4">
        <div className={cn("p-3 rounded-lg", STAT_CARD_COLOR_STYLES[color])}>
          <Icon className="size-5" />
        </div>
        <div>
          <p className="font-display text-2xl text-foreground">{value}</p>
          <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
        </div>
      </div>
    </div>
  );
};

/**
 * DetailRow - Row for confirm dialog details
 */
const DetailRow = ({ label, value, mono, highlight }) => (
  <div className="flex justify-between items-center">
    <span className="text-muted-foreground text-sm">{label}</span>
    <span className={cn(
      "text-sm",
      mono && "font-mono",
      highlight && "font-medium text-foreground"
    )}>
      {value}
    </span>
  </div>
);

/**
 * ByPatientView - Medications grouped by patient
 */
const ByPatientView = ({
  groupedByPatient,
  selectedMeds,
  toggleMedSelection,
  selectAllForPatient,
  openConfirmDialog,
  openPatientContext,
  dispenseMutation,
  getPatientName,
  getPatientMRN,
  getPatientWard,
  formatTime,
  dispensingActionsAvailable,
  selectionAvailable,
}) => {
  const totalPatients = Object.keys(groupedByPatient).length;

  if (totalPatients === 0) {
    return <EmptyState />;
  }

  return (
    <ScrollArea className="h-[600px]">
      <div className="space-y-4">
        {Object.entries(groupedByPatient).map(([patientId, data]) => {
          const patientMedIds = data.medications.map(m => m.id);
          const allSelected = patientMedIds.every(id => selectedMeds.includes(id));
          const someSelected = patientMedIds.some(id => selectedMeds.includes(id));
          const hasOverdue = data.medications.some(m => m.is_overdue);

          return (
            <article
              key={patientId}
              className={cn(
                "bg-card/50 backdrop-blur border rounded-xl overflow-hidden",
                hasOverdue ? "border-destructive/30" : "border-border"
              )}
            >
              {/* Patient Header */}
              <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
                <div className="flex items-center gap-3">
                  {selectionAvailable ? (
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={() => selectAllForPatient(patientId)}
                      className={someSelected && !allSelected ? 'opacity-50' : ''}
                    />
                  ) : null}
                  <div>
                    <h3 className="font-display text-base text-foreground">
                      {getPatientName(data.firstMed)}
                    </h3>
                    <p className="font-mono text-xs text-muted-foreground">
                      {getPatientMRN(data.firstMed)} · {data.medications.length} medication{data.medications.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-mono text-xs">
                    {getPatientWard(data.firstMed)}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openPatientContext(data.firstMed)}
                    className="font-mono text-xs"
                  >
                    Patient
                  </Button>
                </div>
              </header>

              {/* Medications List */}
              <div className="divide-y divide-border">
                {data.medications.map(med => (
                  <div
                    key={med.id}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors",
                      med.is_overdue && "bg-destructive/5"
                    )}
                  >
                    {selectionAvailable ? (
                      <Checkbox
                        checked={selectedMeds.includes(med.id)}
                        onCheckedChange={() => toggleMedSelection(med.id)}
                      />
                    ) : null}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground truncate">
                          {med.medication_name}
                        </span>
                        {med.is_overdue && (
                          <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                            <AlertTriangle className="size-2.5 mr-0.5" />
                            Overdue
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        <span className="font-mono text-xs text-muted-foreground">
                          {med.dosage} · {med.route} · {med.frequency}
                        </span>
                        {med.dose_count > 1 && (
                          <Badge variant="outline" className="font-mono text-[10px] px-1.5 py-0">
                            {med.dose_count} doses
                          </Badge>
                        )}
                        <span className={cn(
                          "font-mono text-xs flex items-center gap-1",
                          med.is_overdue ? "text-destructive" : "text-muted-foreground"
                        )}>
                          <Clock className="size-3" />
                          {med.dose_count > 1 ? 'Next due ' : ''}{formatTime(med.scheduled_time)}
                        </span>
                      </div>
                    </div>
                    {dispensingActionsAvailable ? (
                      <Button
                        size="sm"
                        variant={med.is_overdue ? 'destructive' : 'outline'}
                        onClick={() => openConfirmDialog(med)}
                        disabled={dispenseMutation.isPending}
                        className="font-mono text-xs shrink-0"
                      >
                        <Package className="size-3.5 mr-1.5" />
                        Dispense
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </ScrollArea>
  );
};

/**
 * AllMedicationsView - Flat list of all medications
 */
const AllMedicationsView = ({
  filteredMeds,
  selectedMeds,
  setSelectedMeds,
  toggleMedSelection,
  openConfirmDialog,
  openPatientContext,
  dispenseMutation,
  getPatientName,
  getPatientMRN,
  getPrescriberName,
  formatDateTime,
  dispensingActionsAvailable,
  selectionAvailable,
}) => {
  if (filteredMeds.length === 0) {
    return <EmptyState />;
  }

  const allSelected = selectedMeds.length === filteredMeds.length && filteredMeds.length > 0;

  return (
    <div className="bg-card/50 backdrop-blur border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-border bg-muted/30">
        {selectionAvailable ? (
          <Checkbox
            checked={allSelected}
            onCheckedChange={(checked) => {
              if (checked) {
                setSelectedMeds(filteredMeds.map(m => m.id));
              } else {
                setSelectedMeds([]);
              }
            }}
          />
        ) : null}
        <h3 className="font-heading text-sm font-medium text-foreground">
          All Pending Medications ({filteredMeds.length})
        </h3>
      </header>

      {/* Medications List */}
      <ScrollArea className="h-[550px]">
        <div className="divide-y divide-border">
          {filteredMeds.map(med => (
            <div
              key={med.id}
              className={cn(
                "flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors",
                med.is_overdue && "bg-destructive/5"
              )}
            >
              {selectionAvailable ? (
                <Checkbox
                  checked={selectedMeds.includes(med.id)}
                  onCheckedChange={() => toggleMedSelection(med.id)}
                />
              ) : null}
              <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-4">
                <div>
                  <p className="font-display text-sm text-foreground truncate">
                    {getPatientName(med)}
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {getPatientMRN(med)}
                  </p>
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm text-foreground truncate">
                      {med.medication_name}
                    </span>
                    {med.is_overdue && (
                      <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                        Overdue
                      </Badge>
                    )}
                    {med.dose_count > 1 && (
                      <Badge variant="outline" className="font-mono text-[10px] px-1.5 py-0">
                        {med.dose_count} doses
                      </Badge>
                    )}
                  </div>
                  <p className="font-mono text-xs text-muted-foreground">
                    {med.dosage} · {med.route} · {med.frequency}
                  </p>
                </div>
                <div className="text-left sm:text-right">
                  <p className={cn(
                    "font-mono text-xs",
                    med.is_overdue ? "text-destructive" : "text-muted-foreground"
                  )}>
                    {med.dose_count > 1 ? 'Next due ' : ''}{formatDateTime(med.scheduled_time)}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {getPrescriberName(med)}
                  </p>
                </div>
              </div>
              {dispensingActionsAvailable ? (
                <Button
                  size="sm"
                  variant={med.is_overdue ? 'destructive' : 'outline'}
                  onClick={() => openConfirmDialog(med)}
                  disabled={dispenseMutation.isPending}
                  className="font-mono text-xs shrink-0"
                >
                  Dispense
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => openPatientContext(med)}
                className="font-mono text-xs"
              >
                Patient
              </Button>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
};

/**
 * EmptyState - Chronicle-styled empty state
 */
const EmptyState = () => (
  <div className="bg-card/50 backdrop-blur border border-border rounded-xl p-12">
    <div className="flex flex-col items-center justify-center text-center">
      <div className="size-16 rounded-full bg-emerald-500/10 flex items-center justify-center mb-4">
        <CheckCircle className="size-8 text-emerald-500" />
      </div>
      <h3 className="font-display text-xl text-foreground mb-2">
        Queue Empty
      </h3>
      <p className="text-muted-foreground text-sm max-w-md">
        No medications pending dispensing at this time.
      </p>
    </div>
  </div>
);
