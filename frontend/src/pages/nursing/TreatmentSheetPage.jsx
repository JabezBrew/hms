import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  ChevronLeft,
  ChevronRight,
  Check,
  Clock,
  XCircle,
  AlertTriangle,
  Minus,
  Calendar,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { format, addDays, subDays } from 'date-fns';
import { toast } from 'sonner';
import { useMARGrid, useAdministerMedication, useCreateAndAdminister } from '@/hooks/useNursingQueries';
import { cn } from '@/lib/utils';

// Status icons and colors
const STATUS_CONFIG = {
  administered: {
    icon: Check,
    color: 'bg-emerald-500 text-white',
    hoverColor: 'hover:bg-emerald-600',
    label: 'Given',
  },
  due: {
    icon: Clock,
    color: 'bg-amber-500 text-white animate-pulse',
    hoverColor: 'hover:bg-amber-600',
    label: 'Due Now',
  },
  scheduled: {
    icon: Clock,
    color: 'bg-slate-200 text-slate-600',
    hoverColor: 'hover:bg-blue-400 hover:text-white',
    label: 'Scheduled',
  },
  missed: {
    icon: XCircle,
    color: 'bg-rose-500 text-white',
    hoverColor: 'hover:bg-rose-600',
    label: 'Missed',
  },
  held: {
    icon: AlertTriangle,
    color: 'bg-orange-400 text-white',
    hoverColor: 'hover:bg-orange-500',
    label: 'Held',
  },
  refused: {
    icon: XCircle,
    color: 'bg-purple-500 text-white',
    hoverColor: 'hover:bg-purple-600',
    label: 'Refused',
  },
  not_started: {
    icon: Minus,
    color: 'bg-slate-100 text-slate-300',
    hoverColor: '',
    label: 'Not Started',
  },
  completed: {
    icon: Minus,
    color: 'bg-slate-100 text-slate-300',
    hoverColor: '',
    label: 'Course Ended',
  },
};

// Cell component for each dose slot
function DoseCell({ slot, medication, date, timeSlot, onAdminister }) {
  const config = STATUS_CONFIG[slot.status] || STATUS_CONFIG.scheduled;
  const Icon = config.icon;

  const isClickable = ['scheduled', 'due', 'missed'].includes(slot.status);

  const handleClick = () => {
    if (isClickable && onAdminister) {
      onAdminister({
        medication,
        date,
        timeSlot,
        slot,
      });
    }
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={handleClick}
            disabled={!isClickable}
            className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center transition-all",
              config.color,
              isClickable && config.hoverColor,
              isClickable && "hover:scale-110 hover:shadow-md cursor-pointer",
              !isClickable && "cursor-default"
            )}
          >
            <Icon className="w-4 h-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="text-sm">
            <p className="font-semibold">{config.label}</p>
            <p className="text-xs">{medication.medication_name} {medication.dosage}</p>
            <p className="text-xs text-muted-foreground">{timeSlot} on {date}</p>
            {slot.administered_time && (
              <p className="text-xs text-muted-foreground mt-1">
                Given: {format(new Date(slot.administered_time), 'h:mm a')}
              </p>
            )}
            {slot.administered_by && (
              <p className="text-xs text-muted-foreground">
                By: {slot.administered_by}
              </p>
            )}
            {slot.notes && (
              <p className="text-xs mt-1 italic">{slot.notes}</p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Medication row with time sub-rows
function MedicationRow({ medication, dateHeaders, onAdminister }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="border-b border-border last:border-b-0">
      {/* Medication header row */}
      <div
        className="flex items-center bg-muted/40 cursor-pointer hover:bg-muted/60 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="w-56 min-w-56 p-3 flex items-center gap-2 border-r border-border">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
          <div className="min-w-0">
            <p className="font-medium text-sm truncate">{medication.medication_name}</p>
            <p className="text-xs text-muted-foreground truncate">
              {medication.dosage} {medication.route_display} · {medication.frequency_display}
            </p>
          </div>
        </div>
        {/* Empty cells for header row - just show day summary */}
        {dateHeaders.map((header) => {
          // Count doses for this day
          const dayData = medication.days?.[header.date] || {};
          const administered = Object.values(dayData).filter(s => s.status === 'administered').length;
          const total = Object.values(dayData).length;

          return (
            <div
              key={header.date}
              className={cn(
                "flex-1 min-w-24 p-2 text-center border-r border-border last:border-r-0",
                header.is_today && "bg-primary/5"
              )}
            >
              {total > 0 && (
                <span className="text-xs text-muted-foreground">
                  {administered}/{total}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Time slot sub-rows */}
      {expanded && medication.time_slots?.map((timeSlot) => (
        <div key={timeSlot} className="flex items-center hover:bg-muted/20 transition-colors">
          <div className="w-56 min-w-56 py-2 px-3 pl-10 text-sm text-muted-foreground border-r border-border font-mono">
            {timeSlot}
          </div>
          {dateHeaders.map((header) => {
            const dayData = medication.days?.[header.date] || {};
            const slotData = dayData[timeSlot];

            return (
              <div
                key={header.date}
                className={cn(
                  "flex-1 min-w-24 py-2 flex justify-center border-r border-border last:border-r-0",
                  header.is_today && "bg-primary/5"
                )}
              >
                {slotData ? (
                  <DoseCell
                    slot={slotData}
                    medication={medication}
                    date={header.date}
                    timeSlot={timeSlot}
                    onAdminister={onAdminister}
                  />
                ) : (
                  <span className="text-slate-300">—</span>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default function TreatmentSheetPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const admissionId = searchParams.get('admission');

  // Date navigation state - start from today
  const [startDate, setStartDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [daysToShow] = useState(7);

  const { data: marData, isLoading, error, refetch } = useMARGrid(admissionId, startDate, daysToShow);
  const administerMutation = useAdministerMedication();
  const createAndAdministerMutation = useCreateAndAdminister();

  // Navigation handlers
  const handlePreviousWeek = () => {
    const newDate = subDays(new Date(startDate), 7);
    setStartDate(format(newDate, 'yyyy-MM-dd'));
  };

  const handleNextWeek = () => {
    const newDate = addDays(new Date(startDate), 7);
    setStartDate(format(newDate, 'yyyy-MM-dd'));
  };

  const handleToday = () => {
    setStartDate(format(new Date(), 'yyyy-MM-dd'));
  };

  // Handle administer click
  const handleAdminister = async ({ medication, date, timeSlot, slot }) => {
    if (slot.id) {
      // Existing MAR entry - administer it
      try {
        await administerMutation.mutateAsync({
          medicationId: slot.id,
          data: { status: 'administered' }
        });
        toast.success(`${medication.medication_name} marked as given`);
        refetch();
      } catch (err) {
        toast.error(`Failed to administer: ${err.message}`);
      }
    } else {
      // No MAR entry exists - create and administer in one step
      try {
        await createAndAdministerMutation.mutateAsync({
          prescription_id: medication.id,
          scheduled_time: slot.scheduled_time,
        });
        toast.success(`${medication.medication_name} marked as given`);
        refetch();
      } catch (err) {
        toast.error(`Failed to administer: ${err.message}`);
      }
    }
  };

  if (!admissionId) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertDescription>
            No admission ID provided. Please access the treatment sheet from a patient's record.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <div>
              <h1 className="text-2xl font-bold">Medication Administration Record</h1>
              {marData && (
                <p className="text-muted-foreground">
                  {marData.patient_name} · MRN: {marData.patient_mrn}
                </p>
              )}
            </div>
          </div>

          {/* Date Navigation */}
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handlePreviousWeek}>
              <ChevronLeft className="h-4 w-4" />
              <span className="hidden sm:inline ml-1">Prev Week</span>
            </Button>
            <Button variant="outline" size="sm" onClick={handleToday}>
              <Calendar className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Today</span>
            </Button>
            <Button variant="outline" size="sm" onClick={handleNextWeek}>
              <span className="hidden sm:inline mr-1">Next Week</span>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 text-sm flex-wrap">
          <span className="text-muted-foreground font-medium">Legend:</span>
          {Object.entries(STATUS_CONFIG).slice(0, 6).map(([key, config]) => {
            const Icon = config.icon;
            return (
              <div key={key} className="flex items-center gap-1.5">
                <div className={cn("w-6 h-6 rounded-full flex items-center justify-center", config.color)}>
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <span className="text-xs text-muted-foreground">{config.label}</span>
              </div>
            );
          })}
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
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            </CardContent>
          </Card>
        )}

        {/* MAR Grid */}
        {!isLoading && marData && (
          <Card className="overflow-hidden">
            <CardContent className="p-0 overflow-x-auto">
              <div className="min-w-[800px]">
                {/* Date Headers */}
                <div className="flex border-b-2 border-border bg-muted sticky top-0 z-10">
                  <div className="w-56 min-w-56 p-3 font-semibold text-sm border-r border-border">
                    Medication / Time
                  </div>
                  {marData.date_headers?.map((header) => (
                    <div
                      key={header.date}
                      className={cn(
                        "flex-1 min-w-24 p-2 text-center border-r border-border last:border-r-0",
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
                    <p className="text-lg font-medium">No medications prescribed</p>
                    <p className="text-sm mt-2">
                      This patient has no active medications for the selected date range.
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
  );
}
