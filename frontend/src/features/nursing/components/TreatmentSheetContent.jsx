import { scheduledDoseReviewReason } from '@/features/pharmacy/prescribing/scheduledStockPolicy';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import XCircle from 'lucide-react/dist/esm/icons/circle-x.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js';
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import CircleDot from 'lucide-react/dist/esm/icons/circle-dot.js';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageState } from '@/shared/components/page/PageState';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

import format from 'date-fns/format';
import addDays from 'date-fns/addDays';
import subDays from 'date-fns/subDays';
import { toast } from 'sonner';
import { useMARGrid, useAdministerMedication, useCreateAndAdminister } from '@/features/nursing/hooks';
import { cn } from '@/lib/utils';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { MedicationOutcomeDialog } from './MedicationOutcomeDialog';
import { PrnOrders } from './PrnOrders';

// Status colors for dose indicators
const DOSE_STATUS = {
  administered: {
    bg: 'bg-emerald-500',
    border: 'border-emerald-500',
    text: 'text-white',
    label: 'Given',
  },
  due: {
    bg: 'bg-amber-500',
    border: 'border-amber-500',
    text: 'text-white',
    label: 'Due',
    pulse: true,
  },
  scheduled: {
    bg: 'bg-transparent',
    border: 'border-slate-300',
    text: 'text-slate-400',
    label: 'Scheduled',
  },
  missed: {
    bg: 'bg-rose-500',
    border: 'border-rose-500',
    text: 'text-white',
    label: 'Missed',
  },
  refused: { bg: 'bg-amber-100', border: 'border-amber-600', text: 'text-amber-900', label: 'Refused' },
  held: { bg: 'bg-slate-100', border: 'border-slate-500', text: 'text-slate-700', label: 'Held' },
  not_started: {
    bg: 'bg-slate-100',
    border: 'border-slate-200',
    text: 'text-slate-300',
    label: 'Not Started',
  },
  completed: {
    bg: 'bg-slate-100',
    border: 'border-slate-200',
    text: 'text-slate-300',
    label: 'Course Complete',
  },
};

// Single dose indicator component
function DoseIndicator({ dose, medication, date, onAdminister }) {
  const status = DOSE_STATUS[dose.status] || DOSE_STATUS.scheduled;
  const isClickable = (isRustV2ApiMode() ? ['scheduled', 'due'] : ['scheduled', 'due', 'missed']).includes(dose.status);

  const stockReview = isClickable ? scheduledDoseReviewReason(dose) : null;

  const administerDose = () => {
    if (isClickable && onAdminister) {
      onAdminister({ medication, date, dose });
    }
  };

  // Format time for display
  const formatTime = (isoString) => {
    if (!isoString) return null;
    try {
      return format(new Date(isoString), 'h:mm a');
    } catch {
      return null;
    }
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={administerDose}
            disabled={!isClickable}
            aria-label={`${isClickable ? 'Record outcome' : status.label}: ${medication.medication_name}, dose ${dose.dose_number}, ${date}`}
            className={cn(
              "size-7 rounded-full border-2 flex items-center justify-center transition-all",
              status.bg,
              status.border,
              status.text,
              status.pulse && "animate-pulse",
              isClickable && "hover:scale-110 hover:shadow-md cursor-pointer hover:border-blue-500",
              !isClickable && "cursor-default"
            )}
          >
            {dose.status === 'administered' && <Check className="size-4" />}
            {dose.status === 'due' && <Clock className="size-3.5" />}
            {dose.status === 'missed' && <XCircle className="size-3.5" />}
            {['refused', 'held'].includes(dose.status) && <XCircle className="size-3.5" />}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="text-sm space-y-1">
            <p className="font-semibold">{status.label}</p>
            <p className="text-xs">{medication.medication_name} {medication.dosage}</p>
            <p className="text-xs text-muted-foreground">Dose {dose.dose_number} of {medication.doses_per_day} for {date}</p>
            {dose.administered_time && (
              <p className="text-xs text-emerald-600 font-medium">
                Given at {formatTime(dose.administered_time)}
              </p>
            )}
            {dose.administered_by && (
              <p className="text-xs text-muted-foreground">By: {dose.administered_by}</p>
            )}
            {dose.notes && (
              <p className="text-xs italic mt-1">{dose.notes}</p>
            )}
            {stockReview && <p className="text-xs">{stockReview}</p>}
            {dose.dispensed_stock_quantity != null && dose.dispensed_stock_unit && <p className="text-xs">Saved supplied stock: {dose.dispensed_stock_quantity} {dose.dispensed_stock_unit}</p>}
            {dose.reason_not_given && <p className="text-xs">Reason: {dose.reason_not_given}</p>}
            {dose.outcome_recorded_at && <p className="text-xs text-muted-foreground">Recorded at {formatTime(dose.outcome_recorded_at)}{dose.outcome_recorded_by_display_name ? ` by ${dose.outcome_recorded_by_display_name}` : ''}</p>}
            {isClickable && (
              <p className="text-xs text-blue-600 mt-1">Click to record dose outcome</p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Day cell showing dose indicators
function DayDoses({ dayData, medication, date, onAdminister }) {
  if (!dayData) return <span className="text-slate-300">-</span>;

  const { doses, doses_given, doses_required } = dayData;

  return (
    <div className="flex flex-col items-center gap-1">
      {/* Dose circles */}
      <div className="flex items-center gap-1.5 flex-wrap justify-center">
        {doses.map((dose) => (
          <DoseIndicator
            key={dose.dose_number}
            dose={dose}
            medication={medication}
            date={date}
            onAdminister={onAdminister}
          />
        ))}
      </div>
      {/* Progress text */}
      <span className={cn(
        "text-xs font-mono",
        doses_given === doses_required ? "text-emerald-600" : "text-muted-foreground"
      )}>
        {doses_given}/{doses_required}
      </span>
    </div>
  );
}

// Medication row
function MedicationRow({ medication, dateHeaders, onAdminister }) {
  const progressPercent = medication.total_doses_required > 0
    ? Math.min((medication.total_doses_administered / medication.total_doses_required) * 100, 100)
    : 0;

  const durationDays = medication.duration_days;

  return (
    <div className="border-b border-border last:border-b-0 hover:bg-muted/20 transition-colors">
      <div className="flex items-center">
        {/* Medication info column */}
        <div className="w-64 min-w-64 p-3 border-r border-border">
          <div className="flex items-start gap-2">
            <Pill className="size-4 text-primary mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-sm truncate">{medication.medication_name}</p>
              <p className="text-xs text-muted-foreground truncate">
                {medication.dosage} · {medication.route_display}
                {durationDays && ` · ${durationDays} day${durationDays !== 1 ? 's' : ''}`}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {medication.frequency_display}
              </p>

              {/* Course progress */}
              {medication.total_doses_required > 0 && (
                <div className="mt-2 space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{medication.progress_scope === 'selected_period' ? 'Given in selected period' : 'Course progress'}</span>
                    <span className={cn(
                      "font-medium",
                      medication.course_complete ? "text-emerald-600" : "text-foreground"
                    )}>
                      {medication.total_doses_administered}/{medication.total_doses_required}
                    </span>
                  </div>
                  <Progress value={progressPercent} className="h-1.5" />
                  {(medication.course_complete || medication.period_complete) && (
                    <Badge variant="outline" className="text-emerald-600 border-emerald-300 text-xs">
                      <Check className="size-3 mr-1" />
                      {medication.progress_scope === 'selected_period' ? 'All shown doses recorded' : 'Complete'}
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Day columns */}
        {dateHeaders.map((header) => (
          <div
            key={header.date}
            className={cn(
              "flex-1 min-w-28 p-3 flex justify-center border-r border-border last:border-r-0",
              header.is_today && "bg-primary/5"
            )}
          >
            <DayDoses
              dayData={medication.days?.[header.date]}
              medication={medication}
              date={header.date}
              onAdminister={onAdminister}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function TreatmentSheetContent(props) {
  return <TreatmentSheetWorkspace key={props.admissionId || 'no-admission'} {...props} />;
}

function TreatmentSheetWorkspace({
  admissionId,
  showHeader = true,
  onBack = null,
}) {
  const navigate = useNavigate();
  const rustV2Mode = isRustV2ApiMode();
  const [selectedDose, setSelectedDose] = useState(null);

  // Date navigation state - start from today
  const [startDate, setStartDate] = useState(() => rustV2Mode ? new Date().toISOString().slice(0, 10) : format(new Date(), 'yyyy-MM-dd'));
  const [daysToShow] = useState(7);

  const { data: marData, isLoading, error, refetch } = useMARGrid(admissionId, startDate, daysToShow);
  const administerMutation = useAdministerMedication();
  const createAndAdministerMutation = useCreateAndAdminister();

  // Navigation handlers
  const handlePreviousWeek = () => {
    const newDate = subDays(new Date(`${startDate}T12:00:00`), 7);
    setStartDate(format(newDate, 'yyyy-MM-dd'));
  };

  const handleNextWeek = () => {
    const newDate = addDays(new Date(`${startDate}T12:00:00`), 7);
    setStartDate(format(newDate, 'yyyy-MM-dd'));
  };

  const handleToday = () => {
    setStartDate(rustV2Mode ? new Date().toISOString().slice(0, 10) : format(new Date(), 'yyyy-MM-dd'));
  };

  // Handle administer click
  const handleAdminister = async ({ medication, date, dose }) => {
    if (rustV2Mode) {
      if (!dose.id) { toast.error('Reload the prescribed schedule before recording this dose.'); return; }
      setSelectedDose({ ...dose, medication_name: medication.medication_name, dosage: medication.dosage, route_display: medication.route_display });
      return;
    }
    if (dose.id) {
      // Existing MAR entry - update it
      try {
        await administerMutation.mutateAsync({
          medicationId: dose.id,
          data: { status: 'administered' }
        });
        toast.success(`${medication.medication_name} dose ${dose.dose_number} marked as given`);
        refetch();
      } catch (err) {
        toast.error(`Failed to administer: ${err.message}`);
      }
    } else {
      // Create new MAR entry and administer
      try {
        const [year, month, day] = date.split('-').map(Number);
        const now = new Date();
        const scheduledTime = new Date(
          year,
          month - 1,
          day,
          now.getHours(),
          now.getMinutes(),
          now.getSeconds(),
          now.getMilliseconds()
        );

        await createAndAdministerMutation.mutateAsync({
          prescription_id: medication.id,
          scheduled_time: scheduledTime.toISOString(),
          dose_number: dose.dose_number,
        });
        toast.success(`${medication.medication_name} dose ${dose.dose_number} marked as given`);
        refetch();
      } catch (err) {
        toast.error(`Failed to administer: ${err.message}`);
      }
    }
  };

  if (!admissionId) {
    return (
      <>
        {showHeader && (
          <PageHeader
            title="Medication Administration Record"
            description="Track medication administration across the current admission."
          />
        )}
        <PageState
          variant="error"
          title="Admission required"
          description="No admission ID provided. Please access the treatment sheet from a patient's record."
        />
      </>
    );
  }

  const headerDescription = marData
    ? `${marData.patient_name} · MRN: ${marData.patient_mrn}`
    : 'Track medication administration across the current admission.';

  return (
    <>
      {selectedDose && <MedicationOutcomeDialog key={selectedDose.id} medication={selectedDose} onClose={() => setSelectedDose(null)} onRecorded={refetch} />}
      {showHeader && (
        <PageHeader
          title="Medication Administration Record"
          description={headerDescription}
          actions={(
            <TreatmentSheetActions
              onBack={onBack || (() => navigate(-1))}
              onPreviousWeek={handlePreviousWeek}
              onToday={handleToday}
              onNextWeek={handleNextWeek}
            />
          )}
        />
      )}

      {!showHeader && (
        <div className="sticky top-0 z-20 border-b border-border bg-background/95 px-6 py-3 backdrop-blur">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Current admission
              </p>
              <p className="text-sm text-muted-foreground">{headerDescription}</p>
            </div>
            <TreatmentSheetActions
              compact
              onBack={null}
              onPreviousWeek={handlePreviousWeek}
              onToday={handleToday}
              onNextWeek={handleNextWeek}
            />
          </div>
        </div>
      )}

      <div className="p-6 space-y-4">

      {rustV2Mode && <PrnOrders admissionId={admissionId} />}

      {/* Legend */}
      <div className="flex items-center gap-4 text-sm flex-wrap">
        <span className="text-muted-foreground font-medium">Legend:</span>
        <div className="flex items-center gap-1.5">
          <div className="size-5 rounded-full bg-emerald-500 flex items-center justify-center">
            <Check className="size-3 text-white" />
          </div>
          <span className="text-xs text-muted-foreground">Given</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="size-5 rounded-full bg-amber-500 flex items-center justify-center animate-pulse">
            <Clock className="size-3 text-white" />
          </div>
          <span className="text-xs text-muted-foreground">Due</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="size-5 rounded-full border-2 border-slate-300" />
          <span className="text-xs text-muted-foreground">Scheduled</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="size-5 rounded-full bg-rose-500 flex items-center justify-center">
            <XCircle className="size-3 text-white" />
          </div>
          <span className="text-xs text-muted-foreground">Missed</span>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error.message || 'Failed to load medication administration record'}
          </AlertDescription>
        </Alert>
      )}

      {/* Loading State */}
      {isLoading && (
        <Card>
          <CardContent className="p-6">
            <div className="space-y-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* MAR Grid */}
      {!isLoading && marData && (
        <Card className="overflow-hidden">
          <CardContent className="p-0 overflow-x-auto">
            <div className="min-w-[900px]">
              {/* Date Headers */}
              <div className="flex border-b-2 border-border bg-muted sticky top-0 z-10">
                <div className="w-64 min-w-64 p-3 font-semibold text-sm border-r border-border">
                  Medication
                </div>
                {marData.date_headers?.map((header) => (
                  <div
                    key={header.date}
                    className={cn(
                      "flex-1 min-w-28 p-2 text-center border-r border-border last:border-r-0",
                      header.is_today && "bg-primary/10"
                    )}
                  >
                    <div className="text-xs text-muted-foreground font-medium">{header.day_name}</div>
                    <div className={cn(
                      "text-xl font-bold font-mono",
                      header.is_today && "text-primary"
                    )}>
                      {header.day_num}
                    </div>
                    <div className="text-xs text-muted-foreground">{header.month}</div>
                  </div>
                ))}
              </div>

              {/* Medication Rows */}
              {marData.medications?.length > 0 ? (
                marData.medications.map((medication) => (
                  <MedicationRow
                    key={medication.id}
                    medication={medication}
                    dateHeaders={marData.date_headers || []}
                    onAdminister={handleAdminister}
                  />
                ))
              ) : (
                <div className="p-12 text-center text-muted-foreground">
                  <CircleDot className="size-12 mx-auto mb-4 opacity-20" />
                  <p className="text-lg font-medium">No doses in this period</p>
                  <p className="text-sm mt-2">
                    Scheduled and recorded doses will appear here. As-needed orders are listed separately.
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Date range info */}
      {marData?.date_range && (
        <p className="text-xs text-muted-foreground text-center">
          Showing {marData.date_range.start} to {marData.date_range.end}
        </p>
      )}
      </div>
    </>
  );
}

function TreatmentSheetActions({
  compact = false,
  onBack,
  onPreviousWeek,
  onToday,
  onNextWeek,
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {onBack && (
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4 mr-2" />
          Back
        </Button>
      )}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onPreviousWeek}>
          <ChevronLeft className="size-4" />
          <span className={compact ? 'sr-only' : 'hidden sm:inline ml-1'}>Prev Week</span>
        </Button>
        <Button variant="outline" size="sm" onClick={onToday}>
          <Calendar className="size-4 sm:mr-2" />
          <span className={compact ? 'sr-only' : 'hidden sm:inline'}>Today</span>
        </Button>
        <Button variant="outline" size="sm" onClick={onNextWeek}>
          <span className={compact ? 'sr-only' : 'hidden sm:inline mr-1'}>Next Week</span>
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
